import type { CellValue, DataRow, TableInfo } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import type { SqliteEditColumn, SqliteOriginalValue } from '../shared/sqliteTableEdit';
import { recordTemplateContentSchema, recordTemplateLimits as limits, type RecordTemplateContent, type RecordTemplateField } from '../shared/recordTemplates';
import { binaryByteLength, binaryCellFromHex } from './binaryCell';
import { cellText, ownCell } from './lib';
import { postgresBatchValueValid } from './postgresBatchSelection';
import { recordValueSummary } from './recordViews';
import { recordTemplatesZh as text } from './locales/recordTemplates.zh-CN';

export interface RecordTemplateColumn { name: string; signature: string; }
export interface RecordTemplateCandidate { dialect: RecordTemplateContent['dialect']; fields: Array<RecordTemplateColumn & { value?: RecordTemplateField['value']; unavailable?: string }>; }

/** 按准确列名匹配，目录重排不影响模板；类型、可空、生成及字符集改变会拒绝整份。 */
export function mysqlTemplateColumns(info: TableInfo): RecordTemplateColumn[] {
  return info.columns.filter(column => !column.generated && !/\bauto_increment\b/i.test(column.extra)).map(column => ({ name: column.name, signature: JSON.stringify([column.type, column.nullable, column.extra, column.characterSet ?? null]) }));
}
/** SQLite保留声明类型与动态值类型，生成列始终没有模板写入资格。 */
export function sqliteTemplateColumns(columns: readonly SqliteEditColumn[]): RecordTemplateColumn[] {
  return columns.filter(column => !column.generated).map(column => ({ name: column.name, signature: JSON.stringify([column.declaredType, column.nullable, column.hasDefault]) }));
}
/** 新增时让数据库分配标识及序列值，生成列也不进入模板字段清单。 */
export function postgresTemplateColumns(columns: readonly PostgresTableColumn[]): RecordTemplateColumn[] {
  return columns.filter(column => !column.generated && !column.identityAlways && !column.sequenceDefault).map(column => ({
    name: column.name, signature: JSON.stringify([column.type, column.nullable, column.defaultValue, column.primary, column.binary]),
  }));
}
/** 精确字符串不解析；有限数字和负零用显式number标签往返，BLOB保留原base64。 */
function mysqlValue(value: CellValue): RecordTemplateField['value'] {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'text', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 2) throw Error(text.binaryInvalid);
  const type = Object.getOwnPropertyDescriptor(value, 'type'), base64 = Object.getOwnPropertyDescriptor(value, 'base64');
  if (!type?.enumerable || !('value' in type) || type.value !== 'binary' || !base64?.enumerable || !('value' in base64) || typeof base64.value !== 'string') throw Error(text.binaryInvalid);
  return { kind: 'binary', value: base64.value };
}
/** 单字段不适合保存时明确显示原因，不能因一个大字段而偷偷截断或把DEFAULT变NULL。 */
function candidate(dialect: RecordTemplateContent['dialect'], columns: RecordTemplateColumn[], read: (name: string) => RecordTemplateField['value'] | undefined): RecordTemplateCandidate {
  return { dialect, fields: columns.map(column => {
    try {
      const value = read(column.name); if (value === undefined) return { ...column, unavailable: text.unfilled };
      const checked = recordTemplateContentSchema.parse({ version: 1, dialect, fields: [{ ...column, value }] });
      return { ...column, value: checked.fields[0].value };
    } catch { return { ...column, unavailable: text.unsupported }; }
  }) };
}
/** 只捕获已有普通自有值；INVISIBLE缺值不补取、不生成默认值，也不读原型属性。 */
export function mysqlTemplateCandidate(data: DataRow, info: TableInfo): RecordTemplateCandidate {
  return candidate('mysql', mysqlTemplateColumns(info), name => {
    const descriptor = Object.getOwnPropertyDescriptor(data, name);
    if (!descriptor) return undefined;
    if (!descriptor.enumerable || !('value' in descriptor)) throw Error(text.accessor);
    return descriptor.value === undefined ? undefined : mysqlValue(descriptor.value);
  });
}
/** SQLite按原字段索引取typed值，省略槽和实际NULL保持不同。 */
export function sqliteTemplateCandidate(values: readonly (SqliteOriginalValue | undefined)[], columns: readonly SqliteEditColumn[]): RecordTemplateCandidate {
  return candidate('sqlite', sqliteTemplateColumns(columns), name => values[columns.findIndex(column => column.name === name)]);
}
/** 保留 PostgreSQL 协议文本和二进制。暂存的 DEFAULT 省略，未暂存的列从原行取值。 */
export function postgresTemplateCandidate(page: PostgresTablePage, index: number, prior?: PostgresTableChange): RecordTemplateCandidate | undefined {
  const row = page.rows[index];
  if (!row || prior?.kind === 'delete') return undefined;
  const columns = new Map(page.columns.map(column => [column.name, column]));
  const staged = new Map(prior?.kind === 'update' ? prior.fields.map(field => [field.column, field.value]) : []);
  return candidate('postgresql', postgresTemplateColumns(page.columns), name => {
    const column = columns.get(name)!;
    const value = staged.get(column.key);
    if (value) {
      if (value.mode === 'default') return undefined;
      if (!postgresBatchValueValid(column, value)) throw Error(text.postgresValueInvalid(name));
      if (value.mode === 'null') return { kind: 'null' };
      if (value.mode === 'text') return { kind: 'text', value: value.value };
      return { kind: 'binary', value: binaryCellFromHex(value.value).base64 };
    }
    const raw = ownCell(row, column.key);
    if (raw === undefined) return undefined;
    if (raw === null && column.nullable) return { kind: 'null' };
    if (typeof raw === 'string') return { kind: 'text', value: raw };
    if (raw && typeof raw === 'object' && column.binary && binaryByteLength(raw)! * 2 <= postgresTableLimits.value)
      return { kind: 'binary', value: raw.base64 };
    throw Error(text.postgresValueInvalid(name));
  });
}
/** 用户选择的字段整体通过当前元数据；任何缺列、变型或跨驱动均拒绝，不删列凑成可用模板。 */
export function validateRecordTemplate(raw: unknown, dialect: RecordTemplateContent['dialect'], columns: readonly RecordTemplateColumn[]): RecordTemplateContent {
  const content = recordTemplateContentSchema.parse(raw), current = new Map(columns.map(column => [column.name, column.signature]));
  if (content.dialect !== dialect || content.fields.some(field => current.get(field.name) !== field.signature)) throw Error(text.fieldsChanged);
  return content;
}
/** 整批预算在复制任何值之前检查，随后由各驱动现有新增账本继续校验原页总预算。 */
function copies(content: RecordTemplateContent, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > limits.copies || content.fields.length * count > 10000 || new TextEncoder().encode(JSON.stringify(content)).byteLength * count > 2 * 1024 * 1024) throw Error(text.batchLimit);
  return count;
}
/** 将MySQL模板还原为正式CellValue，任何数值文本及二进制都不经过通用JSON类型推断。 */
function decodeMysql(value: RecordTemplateField['value']): CellValue {
  if (value.kind === 'null') return null;
  if (value.kind === 'text' || value.kind === 'boolean') return value.value;
  if (value.kind === 'number') return value.value === '-0' ? -0 : Number(value.value);
  if (value.kind === 'binary') return { type: 'binary', base64: value.value };
  throw Error(text.mysqlValueInvalid);
}
/** MySQL模板按原值和独立二进制包装展开，未选列完全省略。 */
export function mysqlTemplateRows(raw: unknown, info: TableInfo, count: number): DataRow[] {
  const content = validateRecordTemplate(raw, 'mysql', mysqlTemplateColumns(info));
  return Array.from({ length: copies(content, count) }, () => Object.fromEntries(content.fields.map(field => [field.name, decodeMysql(field.value)])));
}
/** SQLite输出完整列矩阵，未选列显式保留undefined，供原appendRows原子暂存与一步撤销。 */
export function sqliteTemplateRows(raw: unknown, columns: readonly SqliteEditColumn[], count: number): (SqliteOriginalValue | undefined)[][] {
  const content = validateRecordTemplate(raw, 'sqlite', sqliteTemplateColumns(columns)), fields = new Map(content.fields.map(field => [field.name, field.value]));
  return Array.from({ length: copies(content, count) }, () => columns.map(column => fields.has(column.name) ? structuredClone(fields.get(column.name)) as SqliteOriginalValue : undefined));
}
/** 当前目录映射回原页字段键，整批验证后只交付现有账本可接受的新增草稿。 */
export function postgresTemplateRows(raw: unknown, columns: readonly PostgresTableColumn[], count: number): PostgresTableChange[] {
  const content = validateRecordTemplate(raw, 'postgresql', postgresTemplateColumns(columns));
  const length = copies(content, count);
  const current = new Map(columns.map(column => [column.name, column]));
  if (content.fields.length > postgresTableLimits.fields) throw Error(text.batchLimit);
  const fields = content.fields.map(({ name, value }): PostgresTableField => {
    const column = current.get(name)!;
    let input: PostgresTableField['value'];
    if (value.kind === 'null') input = { mode: 'null' };
    else if (value.kind === 'text') input = { mode: 'text', value: value.value };
    else if (value.kind === 'binary') {
      const binary = { type: 'binary' as const, base64: value.value };
      if (!column.binary || binaryByteLength(binary)! * 2 > postgresTableLimits.value) throw Error(text.postgresValueInvalid(name));
      input = { mode: 'binary', value: cellText(binary).slice(2) };
    } else throw Error(text.postgresValueInvalid(name));
    if (!postgresBatchValueValid(column, input)) throw Error(text.postgresValueInvalid(name));
    return { column: column.key, value: input };
  });
  return Array.from({ length }, () => ({ kind: 'insert', fields: structuredClone(fields) }));
}
/** 预览明确区分动态类型、空串、NULL、负零与二进制，不把记录值当HTML显示。 */
export function recordTemplateValueSummary(value: RecordTemplateField['value']): string {
  if (value.kind === 'null') return text.null;
  if (value.kind === 'text' && value.value === '') return text.emptyString;
  if (value.kind === 'binary' || value.kind === 'blob') return text.binary(value.kind === 'blob' ? value.value.length / 2 : value.value.length / 4 * 3 - (value.value.endsWith('==') ? 2 : value.value.endsWith('=') ? 1 : 0));
  return `${text.types[value.kind]}：${recordValueSummary(value.value)}`;
}

/** 原页面与草稿状态一旦变化永久撤权；只允许本票据的唯一模态，不依赖同名元素重获资格。 */
export class RecordTemplateLease {
  private valid = true; private attached = false;
  constructor(readonly id: string, private readonly check: () => boolean) {}
  /** 永久撤销本票据，后继来源恢复也不能复活。 */
  invalidate(): void { this.valid = false; }
  /** 同步核对原页及唯一模态，不能用同名目标重新领取旧值。 */
  current(): boolean {
    if (!this.valid) return false;
    try {
      if (!this.check()) throw Error('模板原页已变化');
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      if (!dialogs.length && !this.attached) return true;
      if (dialogs.length !== 1 || dialogs[0].querySelector('[data-record-template-owner]')?.getAttribute('data-record-template-owner') !== this.id) throw Error('模板模态归属已变化');
      this.attached = true; return true;
    } catch { this.valid = false; return false; }
  }
}
