import { importFileInspectOutputSchema, importSourceColumn } from '../shared/importNewTable';
import type { DataRow } from '../shared/contracts';
import { sqliteTableCreateDesignSchema, sqliteTableCreateLimits, type SqliteTableCreateDesign } from '../shared/sqliteTableCreate';
import type { SqliteTableImportMapping } from '../shared/sqliteTableImport';

export interface SqliteImportNewTableDesignInput { name: string; sourceColumns: readonly string[]; selectedSources: readonly string[]; sample?: readonly DataRow[]; }
export interface SqliteImportNewTableDesign { design: SqliteTableCreateDesign; mapping: SqliteTableImportMapping[]; warnings: string[]; }
export const sqliteImportNewTableDesignMessages = {
  selection: '请明确选择1～128个来源字段；不能静默截断目录或自动增加字段。',
  text: '初始字段全部使用TEXT保留数字、日期和JSON原文，NULL保持NULL；请人工确认目标类型及映射。',
  binary: '选中字段的样本含二进制值；不会自动猜测类型，请人工改为BLOB及二进制映射后再完整预检。',
} as const;
const invalid = (): never => { throw Error('SQLite新表导入设计输入无效，请重新选择来源字段'); };
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
/** 只保留合法原名；空键、控制字符或超长名称使用确定的字段序号，不改变原source身份。 */
function initialName(source: string, index: number): string {
  return source.trim().length && [...source].length <= sqliteTableCreateLimits.nameCharacters && !/[\u0000-\u001f\u007f-\u009f]/u.test(source) ? source : '字段' + (index + 1);
}
/** ASCII大小写去重，后缀按Unicode码点裁剪，不能切开非BMP字符或折叠不同Unicode名称。 */
function uniqueName(initial: string, used: Set<string>): string {
  let value = initial, suffix = 1;
  while (used.has(fold(value))) { const ending = '_' + (++suffix); value = [...initial].slice(0, sqliteTableCreateLimits.nameCharacters - ending.length).join('') + ending; }
  used.add(fold(value)); return value;
}
/** 有界检查后只生成可编辑草稿与初始映射；不读数据库、不发送IPC，也不伪造主键或自动执行。 */
export function buildSqliteImportNewTableDesign(input: SqliteImportNewTableDesignInput): SqliteImportNewTableDesign {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const raw: Record<string, unknown> = Object.create(null), keys = Reflect.ownKeys(input);
  if (keys.length > 4) return invalid();
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(input, key); if (typeof key !== 'string' || !['name', 'sourceColumns', 'selectedSources', 'sample'].includes(key) || !item || !item.enumerable || !('value' in item)) return invalid(); raw[key] = item.value; }
  if (!['name', 'sourceColumns', 'selectedSources'].every(key => Object.hasOwn(raw, key))) return invalid();
  const selected = raw.selectedSources;
  if (!Array.isArray(selected) || Object.getPrototypeOf(selected) !== Array.prototype || selected.length < 1 || selected.length > sqliteTableCreateLimits.columns || Reflect.ownKeys(selected).length !== selected.length + 1) throw Error(sqliteImportNewTableDesignMessages.selection);
  const chosen: string[] = [];
  for (let index = 0; index < selected.length; index++) { const item = Object.getOwnPropertyDescriptor(selected, String(index)); if (!item || !item.enumerable || !('value' in item)) return invalid(); chosen.push(importSourceColumn(item.value)); }
  if (new Set(chosen).size !== chosen.length) return invalid();
  const sample = Object.hasOwn(raw, 'sample') ? raw.sample : [];
  // 复用原来源合同，在复制之前验证1000列/20样本/256KiB及每个自有值；不从样本推断精确数值类型。
  const inspected = importFileInspectOutputSchema.parse({ columns: raw.sourceColumns, rows: sample, records: Array.isArray(sample) ? sample.length : 0, source: { sha256: '0'.repeat(64), bytes: 0 }, sampleOmitted: false });
  const sources = new Set(inspected.columns); if (chosen.some(source => !sources.has(source))) return invalid();
  const used = new Set<string>(), mapping: SqliteTableImportMapping[] = chosen.map((source, index) => ({ source, target: uniqueName(initialName(source, index), used), kind: 'text' }));
  const design = sqliteTableCreateDesignSchema.parse({ name: raw.name, columns: mapping.map(item => ({ name: item.target, declaredType: 'TEXT', nullable: true, default: { kind: 'none' } })), primaryKey: [], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false });
  const binary = inspected.rows.some(row => chosen.some(source => Object.hasOwn(row, source) && row[source] !== null && typeof row[source] === 'object'));
  return { design, mapping, warnings: [sqliteImportNewTableDesignMessages.text, ...(binary ? [sqliteImportNewTableDesignMessages.binary] : [])] };
}
