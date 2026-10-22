import type { ColumnAttributeAccess, TableColumnDefinition } from '../shared/tableColumnPatches';
import { columnOnUpdateVersionSupported, hasUnprovenBinaryDefault, tableColumnDefaultRisks, readControlledTimestampDefault } from '../shared/tableColumnPatches';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';
import { columnEncodingSchema, columnEncodingAcknowledgement, columnEncodingMessages as text } from '../shared/tableColumnEncoding';
import type { ColumnEncodingFacts } from './tableColumnEncodingRead';
import { structureDocumentOf, sameStructureFragment, structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { identifier, qualified, SqlScriptScanner } from './sql';
import { readTableAutoIncrementDefinition } from './tableAutoIncrementSql';
import { sameTableColumnAutoIncrementMode } from './tableColumnAutoIncrementSql';
import type { ColumnPatchSqlPlan } from './tableColumnPatchSql';
import { types } from 'node:util';

export interface ColumnEncodingPlan extends ColumnPatchSqlPlan { columnRef: string; columnName: string; before: TableEncodingPair; next: TableEncodingPair; executionMode: string; preflightSql: string; maximumBytes?: number; }
/** 只按真实唯一配对授权，字符串字面量、变量和客户端SQL均不进入USING位置。 */
function pair(facts: ColumnEncodingFacts, input: TableEncodingPair): TableEncodingPair {
  const value = columnEncodingSchema.parse(input), matches = facts.catalog.candidates.filter(candidate => candidate.collation === value.collation);
  if (value.charset === 'binary' || matches.length !== 1 || matches[0].charset !== value.charset || !new Map(facts.maxlen).has(value.charset)) throw Error('目标不是实际目录的唯一字符集/排序规则配对');
  return value;
}
/** 只有目标编码范围可替换；NULL/default/comment和名称/type均来自原始已定位片段。 */
function withoutEncoding(column: TableColumnDefinition): string {
  let raw = column.raw;
  for (const attribute of column.attributes.filter(item => ['charset', 'collation'].includes(item.kind)).sort((left, right) => right.range.start - left.range.start)) raw = raw.slice(0, attribute.range.start - column.range.start) + ' ' + raw.slice(attribute.range.end - column.range.start);
  return raw;
}
/** COPY全表风险独立于目标依赖；不能因旁生成列不引用目标就允许重算。 */
const preparations=new WeakMap<ColumnEncodingFacts,{document?:ReturnType<typeof structureDocumentOf>;reason?:string}>();
/** 一次解析及整表风险扫描同时供全部列投影使用，失败结果也缓存，避免宽表二次方开销。 */
function preparedDocument(facts:ColumnEncodingFacts):ReturnType<typeof structureDocumentOf>{
  const existing=preparations.get(facts);if(existing){if(!existing.document)throw Error(existing.reason);return existing.document;}
  try{
  const document=structureDocumentOf(facts.base);
  if(!columnOnUpdateVersionSupported(document.context.dialect,facts.base.serverVersion))throw Error(text.unavailable);
  if (document.columns.some(item => item.attributes.some(attribute => ['generated', 'check', 'opaque', 'visibility', 'storage', 'column-format'].includes(attribute.kind)) || item.default.kind === 'opaque' || item.default.kind === 'expression' && !readControlledTimestampDefault(item.default.sql) || item.default.kind === 'literal' && item.default.introducer !== undefined || hasUnprovenBinaryDefault(item)) || tableColumnDefaultRisks(document).length || document.items.some(item => item.kind === 'constraint' && tableDefinitionTokens(item.raw, document.context).some(token => token.kind === 'word' && token.value.toUpperCase() === 'CHECK')) || readTableAutoIncrementDefinition(document.source, document.context).reasons.length) throw Error(text.risks);
  const dependencies = facts.core.indexes.model.dependencies;
  if (dependencies.incomingCoverage.kind !== 'complete' || !dependencies.outgoingComplete || dependencies.partition.kind !== 'none') throw Error('列编码完整外键或分区目录未证明');
  for (const index of facts.core.indexes.model.indexes.values()) if (!index.definition || index.generated !== false || index.parsed.opaqueReasons.length || index.parsed.parts.some(part => part.expressionSql || part.opaqueReasons.length)) throw Error('整表存在未证明的生成、函数或不透明索引，COPY保真尚未证明');
  preparations.set(facts,{document});return document;
  }catch(error){const reason=error instanceof Error?error.message:text.unavailable;preparations.set(facts,{reason});throw Error(reason);}
}
function target(facts: ColumnEncodingFacts, ref: string) {
  const document=preparedDocument(facts),name=facts.core.indexes.model.columns.get(ref)?.name,column=name&&document.columnsByName.get(name),trusted=facts.core.indexes.model.columns.get(ref);
  if(!column||!trusted)throw Error(text.unavailable);
  if (facts.core.indexes.model.dependencies.foreignKeys.some(relation => relation.targetColumnRefs.includes(ref))) throw Error(text.foreign);
  if (!/^(?:(?:CHAR|VARCHAR)\s*\(\s*[1-9]\d{0,4}\s*\)|(?:TINY|MEDIUM|LONG)?TEXT)$/i.test(column.type.raw.trim()) || trusted.generated || trusted.hidden || column.attributes.some(attribute => !['nullable', 'default', 'comment', 'charset', 'collation'].includes(attribute.kind)) || !['none', 'null'].includes(column.default.kind) && !(column.default.kind === 'literal' && column.default.valueType === 'text' && !column.default.introducer)) throw Error('跨字符集转换只开放完整已证明的普通CHAR/VARCHAR/TEXT字段及文本默认值');
  const observed = facts.base.encodings.filter(item => item.name === column.name);
  if (observed.length !== 1 || !observed[0].charset || !observed[0].collation || observed[0].charset !== trusted.charset || observed[0].collation !== trusted.collation) throw Error('目标列当前实际编码不能交叉证明');
  return { document, column, trusted, current: pair(facts, { charset: observed[0].charset, collation: observed[0].collation }) };
}
/** 每个组合键按真实列及前缀单位累计，目标字符列使用新charset MAXLEN，绝不封禁整个索引类别。 */
export function assertColumnEncodingIndexBudget(facts: ColumnEncodingFacts, ref: string, next: TableEncodingPair): void {
  const maxlen = new Map(facts.maxlen).get(next.charset), options = facts.core.indexes.options;
  if (!maxlen || !options) throw Error(text.unavailable);
  for (const index of facts.core.indexes.model.indexes.values()) {
    const definition = index.definition;
    if (!definition?.keyParts.some(part => part.columnRef === ref)) continue;
    if (definition.method !== 'BTREE' || !['ordinary', 'unique', 'primary'].includes(definition.kind)) throw Error('目标的特殊索引转换尚未证明');
    let bytes = 0;
    for (const part of definition.keyParts) {
      const column = facts.core.indexes.model.columns.get(part.columnRef); if (!column) throw Error(text.unavailable);
      let partBytes: number | undefined;
      if (part.columnRef === ref) {
        const length = part.prefixLength ?? (/^(?:CHAR|VARCHAR)$/i.test(column.dataType) ? Number(column.characterMaxLength) : undefined);
        if (!length || !Number.isSafeInteger(length)) throw Error(text.index); partBytes = length * maxlen;
      } else partBytes = part.prefixLength === undefined ? column.fullKeyBytes : column.prefix.kind === 'allowed' && part.prefixLength <= column.prefix.maxLength ? part.prefixLength * (column.prefix.unit === 'bytes' ? 1 : column.charsetMaxBytes ?? NaN) : undefined;
      if (partBytes === undefined || !Number.isSafeInteger(partBytes) || partBytes < 1) throw Error(text.index);
      bytes += partBytes;
    }
    if (!Number.isSafeInteger(bytes) || bytes > options.capabilities.maxKeyBytes) throw Error(text.index);
  }
}
/** 文本全列在服务器聚合比较往返原字节；只返回四个十进制计数，不把整列传到客户端。 */
function preflight(facts: ColumnEncodingFacts, ref: string, next: TableEncodingPair): string {
  const { column, current, trusted, document } = target(facts, ref), original = identifier(column.name), maxlen = new Map(facts.maxlen);
  // 官方定义BMP的UTF8编码逐字节相同；只对真实目录证明的3→4升级省去弃用的旧USING名称，不能按utf8别名猜测。
  // https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb4.html
  const utf8Upgrade = columnOnUpdateVersionSupported(document.context.dialect, facts.base.serverVersion) && facts.core.physical.dialect === document.context.dialect && facts.core.physical.version === facts.base.serverVersion && ['utf8', 'utf8mb3'].includes(current.charset) && next.charset === 'utf8mb4' && maxlen.get(current.charset) === 3 && trusted.charsetMaxBytes === 3 && maxlen.get(next.charset) === 4;
  const roundtrip = utf8Upgrade ? `CONVERT(${original} USING utf8mb4)` : `CONVERT(CONVERT(${original} USING ${next.charset}) USING ${current.charset})`;
  const defaultHex = column.default.kind === 'literal' ? `X'${Buffer.from(column.default.value, 'utf8').toString('hex')}'` : 'NULL';
  const defaultSql = utf8Upgrade ? defaultHex : column.default.kind === 'literal' ? `CONVERT(CONVERT(${defaultHex} USING utf8mb4) USING ${current.charset})` : 'NULL';
  const returnedDefault = utf8Upgrade ? `CONVERT(${defaultHex} USING utf8mb4)` : `CONVERT(CONVERT(${defaultSql} USING ${next.charset}) USING ${current.charset})`;
  const sizes: Record<string, number> = { TINYTEXT: 255, TEXT: 65535, MEDIUMTEXT: 16777215, LONGTEXT: 4294967295 }, limit = sizes[column.type.raw.trim().toUpperCase()];
  const oversized = limit === undefined ? '' : ` OR OCTET_LENGTH(CONVERT(${original} USING ${next.charset}))>${limit}`;
  return `SELECT CAST(COUNT(*) AS CHAR) AS rowCount,CAST(COALESCE(SUM(CASE WHEN NOT(CAST(${original} AS BINARY)<=>CAST(${roundtrip} AS BINARY))${oversized} THEN 1 ELSE 0 END),0) AS CHAR) AS lossy,CAST(NOT(CAST(${defaultSql} AS BINARY)<=>CAST(${returnedDefault} AS BINARY)) AS CHAR) AS defaultLossy,CAST(COALESCE(MAX(OCTET_LENGTH(CONVERT(${original} USING ${next.charset}))),0) AS CHAR) AS maxConvertedBytes FROM ${qualified(facts.core.indexes.options!.database, facts.core.indexes.model.definition.table)}`;
}
/** 模式只追加完整严格检查及保零位，原ANSI/NBE/PAD等位均保留并读回确认。 */
export function columnEncodingExecutionMode(original: string): string {
  if (!/^[A-Z0-9_,]*$/i.test(original)) throw Error('原SQL模式未知');
  const modes = original ? original.split(',') : []; for (const value of ['STRICT_ALL_TABLES', 'NO_AUTO_VALUE_ON_ZERO']) if (!modes.some(mode => mode.toUpperCase() === value)) modes.push(value); return modes.join(',');
}
export function buildColumnEncodingPlan(facts: ColumnEncodingFacts, ref: string, input: TableEncodingPair): ColumnEncodingPlan {
  const { document, column, current } = target(facts, ref), next = pair(facts, input);
  if (current.charset === next.charset) throw Error('跨字符集入口要求实际字符集发生变化；同字符集请使用排序规则入口');
  if(/^VARCHAR\b/i.test(column.type.raw)&&Number(facts.core.indexes.model.columns.get(ref)?.characterMaxLength)*new Map(facts.maxlen).get(next.charset)!>65535)throw Error('目标VARCHAR按真实MAXLEN超过原类型字节上限，不能隐式改为TEXT');
  assertColumnEncodingIndexBudget(facts, ref, next);
  const plain = withoutEncoding(column), typeEnd = column.type.range.end - column.range.start, definition = plain.slice(0, typeEnd) + ` CHARACTER SET ${next.charset} COLLATE ${next.collation}` + plain.slice(typeEnd);
  const clauses = [`MODIFY COLUMN ${definition}`, 'ALGORITHM=COPY', 'LOCK=EXCLUSIVE'], sql = `ALTER TABLE ${qualified(facts.core.indexes.options!.database, document.table)} ${clauses.join(', ')};`;
  if (Buffer.byteLength(sql) > 4 * 1024 * 1024 || new SqlScriptScanner(document.context.mode.noBackslashEscapes, document.context.mode.ansiQuotes).push(sql, true).length !== 1) throw Error('列编码计划必须是预算内单条ALTER');
  if (Buffer.byteLength(preflight(facts,ref,next)) > 4*1024*1024) throw Error('列编码默认值往返预检SQL超过4MiB预算');
  return { columnRef: ref, columnName: column.name, before: current, next, executionMode: columnEncodingExecutionMode(facts.base.normalizedMode), preflightSql: preflight(facts, ref, next), ...(/^(?:TINY|MEDIUM|LONG)?TEXT$/i.test(column.type.raw.trim()) ? {maximumBytes:({TINYTEXT:255,TEXT:65535,MEDIUMTEXT:16777215,LONGTEXT:4294967295} as Record<string,number>)[column.type.raw.trim().toUpperCase()]} : {}), sql, clauses, requiredAcknowledgements: [columnEncodingAcknowledgement], warnings: ['转换前在服务器对整列及文本默认值做原字符集往返字节预检，未抽样；预检和DDL之间仍有并发窗口，请暂停外部写入和DDL。', '明确COPY重建和LOCK=EXCLUSIVE，可能等待元数据锁、阻塞读写并消耗磁盘。仅独立结构会话追加STRICT_ALL_TABLES/NO_AUTO_VALUE_ON_ZERO；唯一冲突、不可表示或超长由服务器严格拒绝，绝不自动重试。', '改变字符集及排序规则可能改变比较、排序、分组和唯一性语义；定义后核不证明全部外部程序行为。'], finalColumns: [...facts.core.indexes.model.columns].map(([columnRef, value]) => ({ columnRef, name: value.name })), preserved: { columns: document.columns.filter(item => item !== column).map(item => item.raw), constraints: document.items.filter(item => item.kind === 'constraint').map(item => item.raw), tail: document.tail.raw } };
}
/** 投影不做数据扫描，只给结构准入；最终选择、数据和唯一性始终由预览/执行重核。 */
export function columnEncodingAccess(facts: ColumnEncodingFacts, ref: string): ColumnAttributeAccess {
  try { target(facts, ref); return { editable: true }; } catch (error) { return { editable: false, reason: error instanceof Error ? error.message : text.unavailable }; }
}
/** 四个计数及立即SHOW WARNINGS均精确且有界；任何警告和有损均拒绝后续DDL。 */
export async function checkColumnEncodingRoundtrip(context: StructureTaskContext, plan: ColumnEncodingPlan): Promise<void> {
  const result = (await structureTaskQuery<unknown>(context, plan.preflightSql)).rows;
  const warnings = (await structureTaskQuery<unknown>(context, 'SHOW WARNINGS LIMIT 21')).rows;
  context.checkCancelled();
  if (types.isProxy(warnings) || !Array.isArray(warnings) || warnings.length || Reflect.ownKeys(warnings).length!==1) throw Error(text.warning);
  if (types.isProxy(result) || !Array.isArray(result) || result.length !== 1 || Reflect.ownKeys(result).length !== 2) throw Error('字符集预检未返回有界完整计数');
  const first=Object.getOwnPropertyDescriptor(result,'0'),value:unknown=first?.value;
  if(!first||!Object.hasOwn(first,'value')||!value||typeof value!=='object'||types.isProxy(value)||Reflect.ownKeys(value).length!==4)throw Error('字符集预检行不是自有原始标量');
  const row:Record<string,string>=Object.create(null);
  for (const key of ['rowCount', 'lossy', 'defaultLossy', 'maxConvertedBytes']) {const field=Object.getOwnPropertyDescriptor(value,key),count:unknown=field?.value;if(!field?.enumerable||!Object.hasOwn(field,'value')||typeof count!=='string'||!/^(?:0|[1-9]\d{0,19})$/.test(count)||BigInt(count)>18446744073709551615n)throw Error('字符集预检计数无效');row[key]=count;}
  if (row.lossy !== '0' || row.defaultLossy !== '0' || plan.maximumBytes !== undefined && BigInt(row.maxConvertedBytes as string) > BigInt(plan.maximumBytes)) throw Error(text.lossy);
}
/** COPY只豁免物理ID与顶层自增计数；目标除实际编码和MAXLEN衍生目录外完全保持。 */
export function verifyColumnEncodingChange(before: ColumnEncodingFacts, after: ColumnEncodingFacts, plan: ColumnEncodingPlan): boolean {
  const a = before.core, b = after.core, old = structureDocumentOf(before.base), current = structureDocumentOf(after.base), left = old.columnsByName.get(plan.columnName), right = current.columnsByName.get(plan.columnName);
  const physical = ({ tableId: _id, ...value }: typeof a.physical) => value;
  if (!left || !right || JSON.stringify(physical(a.physical)) !== JSON.stringify(physical(b.physical)) || JSON.stringify(a.policy)!==JSON.stringify(b.policy) || JSON.stringify(a.indexes.options)!==JSON.stringify(b.indexes.options) || before.base.identity !== after.base.identity || !sameTableColumnAutoIncrementMode(after.base.normalizedMode, plan.executionMode) || after.base.originalMode !== after.base.normalizedMode || before.catalog.digest !== after.catalog.digest || JSON.stringify(before.maxlen) !== JSON.stringify(after.maxlen) || JSON.stringify(before.base.tableEncoding) !== JSON.stringify(after.base.tableEncoding) || JSON.stringify(before.base.nullability) !== JSON.stringify(after.base.nullability) || JSON.stringify(before.base.columnExtras) !== JSON.stringify(after.base.columnExtras) || old.columns.length !== current.columns.length) return false;
  if (!sameStructureFragment(withoutEncoding(left), withoutEncoding(right), current.context)) return false;
  for (let index = 0; index < old.columns.length; index++) { const x = old.columns[index], y = current.columns[index]; if (x.name !== y.name || x.name !== plan.columnName && x.raw !== y.raw) return false; }
  const constraints = (document: typeof old) => document.items.filter(item => item.kind === 'constraint').map(item => item.raw);
  if (JSON.stringify(constraints(old)) !== JSON.stringify(constraints(current))) return false;
  const tail = (document: typeof old) => { const value = readTableAutoIncrementDefinition(document.source, document.context); return value.reasons.length ? undefined : JSON.parse(value.preserved)[1]; };
  if (tail(old) === undefined || JSON.stringify(tail(old)) !== JSON.stringify(tail(current))) return false;
  if (a.columns.length !== b.columns.length) return false;
  for (let index = 0; index < a.columns.length; index++) {
    const x = a.columns[index], y = b.columns[index]; if (!y || x.name !== y.name) return false;
    if (x.name === plan.columnName) { if (y.charset !== plan.next.charset || y.collation !== plan.next.collation || JSON.stringify({...x,charset:y.charset,collation:y.collation}) !== JSON.stringify(y)) return false; }
    else if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  const indexDefs = (facts: ColumnEncodingFacts) => [...facts.core.indexes.model.indexes].map(([ref, value]) => [ref, value.definition, value.visible, value.generated]);
  if (JSON.stringify(indexDefs(before)) !== JSON.stringify(indexDefs(after)) || JSON.stringify(a.indexes.model.dependencies) !== JSON.stringify(b.indexes.model.dependencies)) return false;
  for (const [ref, column] of a.indexes.model.columns) {
    const changed = b.indexes.model.columns.get(ref); if (!changed) return false;
    if (ref !== plan.columnRef) { if (JSON.stringify(column) !== JSON.stringify(changed)) return false; }
    else {
      const maxlen = new Map(after.maxlen).get(plan.next.charset), length = column.characterMaxLength && Number(column.characterMaxLength), isFixed = /^(?:CHAR|VARCHAR)$/i.test(column.dataType);
      if (!maxlen || changed.charset !== plan.next.charset || changed.collation !== plan.next.collation || changed.charsetMaxBytes !== maxlen || isFixed && (!length || changed.characterOctetLength !== String(length * maxlen) || changed.fullKeyBytes !== length * maxlen)) return false;
      // 六个实际基线TEXT族目录均报告原字节容量，不按MAXLEN猜测字符数缩小。
      if(!isFixed){const capacity=({TINYTEXT:255,TEXT:65535,MEDIUMTEXT:16777215,LONGTEXT:4294967295} as Record<string,number>)[column.dataType.toUpperCase()];if(!capacity||column.characterMaxLength!==String(capacity)||column.characterOctetLength!==String(capacity)||changed.characterMaxLength!==String(capacity)||changed.characterOctetLength!==String(capacity)||changed.fullKeyBytes!==undefined)return false;}
      const omit = ({charset:_c,collation:_o,charsetMaxBytes:_m,characterOctetLength:_l,fullKeyBytes:_b,...value}:typeof column)=>value;
      if (JSON.stringify(omit(column)) !== JSON.stringify(omit(changed))) return false;
    }
  }
  return true;
}
