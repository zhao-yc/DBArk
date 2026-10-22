import { columnRestateAccess, columnOnUpdateVersionSupported, tableColumnDefaultRisks, hasUnprovenBinaryDefault, type ColumnAttributeAccess, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { tableAutoIncrementMaximum, readTableAutoIncrementDefinition } from './tableAutoIncrementSql';
import type { TableColumnAutoIncrementFacts } from './tableColumnAutoIncrementRead';
import type { ColumnPatchSqlPlan } from './tableColumnPatchSql';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { qualified, SqlScriptScanner } from './sql';
import { sameStructureFragment, structureDocumentOf, type StructureDefinitionRead } from './structureDefinition';

export const columnAutoIncrementAcknowledgement = 'column-auto-increment-copy';
export interface TableColumnAutoIncrementPlan extends ColumnPatchSqlPlan { columnName: string; enabled: boolean; originalMode: string; executionMode: string; }
interface Prepared { catalog: Map<string, TableColumnAutoIncrementFacts['columns'][number]>; refs: Map<string, string>; support: Set<string>; referenced: Set<string>; auto: string[]; reason?: string; }
const preparations = new WeakMap<TableColumnDefinitionDocument, { facts: TableColumnAutoIncrementFacts; prepared: Prepared }>();

/** 完整表只扫描一次，逐列能力投影不重新分词整张表或重复解析依赖目录。 */
function prepare(document: TableColumnDefinitionDocument, facts: TableColumnAutoIncrementFacts): Prepared {
  const previous = preparations.get(document); if (previous?.facts === facts) return previous.prepared;
  const result: Prepared = { catalog: new Map(facts.columns.map(column => [column.name, column])), refs: new Map([...facts.indexes.model.columns].map(([ref, column]) => [column.name, ref])), support: new Set(), referenced: new Set(), auto: [] };
  if (!columnOnUpdateVersionSupported(document.context.dialect, facts.physical.version) || facts.physical.dialect !== document.context.dialect || facts.indexes.serverVersion !== facts.physical.version || facts.indexes.identity !== facts.physical.serverIdentity) result.reason = '列自增实际版本或服务器身份不能交叉证明';
  if (result.catalog.size !== facts.columns.length || result.catalog.size !== document.columns.length || result.refs.size !== document.columns.length || document.columns.some(column => !result.catalog.has(column.name) || !result.refs.has(column.name))) result.reason = '列自增实际字段引用或完整目录不唯一';
  if (tableColumnDefaultRisks(document).length || document.columns.some(hasUnprovenBinaryDefault)) result.reason = '表中存在不能证明重述保真的默认值，不能复制修改列自增属性';
  if (readTableAutoIncrementDefinition(document.source, document.context).reasons.length) result.reason = '列自增表尾含分区或未知选项，无法证明复制后保留';
  const dependencies = facts.indexes.model.dependencies;
  const unknownHidden = dependencies.hiddenDependencies.some(value => value.indexRefs.length !== 0 || value.reason !== '无显式主键时的隐式聚簇键选择尚未证明，不能改变相关唯一键或主键');
  if (dependencies.incomingCoverage.kind !== 'complete' || !dependencies.outgoingComplete || dependencies.partition.kind !== 'none' || unknownHidden) result.reason = '列自增入向关系、隐藏依赖或非分区目录不能完整证明';
  const names = new Map(document.columns.map(column => [column.name.toLowerCase(), column.name]));
  const references = (source: string): void => {
    for (const token of tableDefinitionTokens(source, document.context)) {
      if (token.kind === 'executable') result.reason = '列自增存在未知可执行属性依赖';
      if (token.kind === 'word' || token.kind === 'identifier') { const name = names.get(token.value.toLowerCase()); if (name) result.referenced.add(name); }
    }
  };
  const indexRanges = new Set(facts.indexes.model.indexDocument.indexes.map(index => index.range.start + ':' + index.range.end));
  for (const item of document.items) {
    if (item.kind === 'constraint') { if (!indexRanges.has(item.range.start + ':' + item.range.end)) references(item.raw); continue; }
    if (item.attributes.some(attribute => attribute.kind === 'auto-increment')) result.auto.push(item.name);
    for (const attribute of item.attributes) {
      const relevant = ['generated', 'check', 'opaque'].includes(attribute.kind) || attribute.kind === 'default' && ['expression', 'opaque'].includes(item.default.kind);
      if (relevant) references(attribute.raw);
      if (attribute.kind === 'opaque') result.reason = '存在未知列属性，不能证明COPY保真';
    }
  }
  for (const relation of dependencies.foreignKeys) for (const ref of relation.targetColumnRefs) {
    const name = facts.indexes.model.columns.get(ref)?.name; if (name) result.referenced.add(name); else result.reason = '列自增关联目录引用缺失';
  }
  for (const index of facts.indexes.model.indexes.values()) {
    const parsed = index.parsed, first = parsed.parts[0];
    if (['ordinary', 'primary', 'unique'].includes(parsed.kind) && parsed.method === 'BTREE' && !parsed.opaqueReasons.length && first?.columnName && first.prefixLength === undefined && !first.expressionSql && !first.opaqueReasons.length && index.visible === true && index.generated === false) result.support.add(first.columnName);
  }
  // COPY会重算与目标无关的生成列；相同SHOW/目录及零警告不能证明原行值保真。
  // 在可独立证明重算规则前整表只读，不以生成列是否引用目标或是否建索引作为豁免。
  if (document.columns.some(column => column.attributes.some(attribute => attribute.kind === 'generated')) || facts.columns.some(column => column.generationExpression !== '' || /\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(column.extra)) || [...facts.indexes.model.columns.values()].some(column => column.generated)) result.reason = '表中存在生成列，COPY可能按当前SQL模式重新计算已有数据；尚不能证明生成列原值保真，列自增属性仅可只读';
  preparations.set(document, { facts, prepared: result }); return result;
}

/** 模式仅追加必要开关，不删原严格模式；NBE/ANSI词法语义与原快照保持。 */
export function tableColumnAutoIncrementExecutionMode(mode: string): string {
  if (typeof mode !== 'string' || !/^[A-Z0-9_,]*$/i.test(mode)) throw Error('列自增原SQL模式无法确认');
  const parts = mode ? mode.split(',') : [];
  return parts.some(value => value.toUpperCase() === 'NO_AUTO_VALUE_ON_ZERO') ? mode : [...parts, 'NO_AUTO_VALUE_ON_ZERO'].join(',');
}
/** 服务器按模式位规范化输出顺序；只允许集合完全相同，不允许漏掉原严格模式。 */
export function sameTableColumnAutoIncrementMode(actual: string, expected: string): boolean {
  const modes = (value: string) => {
    if (!/^[A-Z0-9_,]*$/i.test(value)) return;
    const parts = value ? value.toUpperCase().split(',') : [];
    if (new Set(parts).size !== parts.length || parts.some(part => !part)) return;
    return parts.sort().join(',');
  };
  const left = modes(actual), right = modes(expected); return left !== undefined && right !== undefined && left === right;
}
/** 依赖准入只阻止目标真实相关关系，不把合法普通/复合支持索引一概禁用。 */
function assertTarget(document: TableColumnDefinitionDocument, name: string, facts: TableColumnAutoIncrementFacts): void {
  const prepared = prepare(document, facts), column = document.columnsByName.get(name), current = prepared.catalog.get(name);
  if (!column || !current || !column.type.known || column.access.type.editable !== true || !tableAutoIncrementMaximum(column.type.raw.trim()) || column.nullable !== false || column.default.kind !== 'none' || !column.attributes.some(attribute => attribute.kind === 'nullable') || column.attributes.some(attribute => !['nullable', 'comment', 'auto-increment'].includes(attribute.kind)) || current.nullable !== 'NO' || current.defaultValue !== null || current.generationExpression !== '' || current.charset !== null || current.collation !== null || !sameStructureFragment(current.typeSql, column.type.raw, document.context)) throw Error('列自增仅支持已证明NOT NULL、无默认值的普通整数列；请先在字段设计中明确准备条件');
  const restate = columnRestateAccess(column, document.context.dialect);
  if (current.extra.toLowerCase() !== (column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '') || !sameStructureFragment(current.dataType, /^[A-Za-z]+/.exec(column.type.raw.trim())?.[0] ?? '', document.context)) throw Error('列自增实际类型或EXTRA与原定义矛盾');
  if (!restate.editable || prepared.reason) throw Error(restate.reason ?? prepared.reason);
  const ref = prepared.refs.get(name), actual = ref && facts.indexes.model.columns.get(ref);
  if (!actual || actual.generated || actual.hidden) throw Error('列自增真实列引用不完整或隐藏');
  if (prepared.referenced.has(name)) throw Error('目标自增列参与外键、CHECK、生成列或表达式依赖，不能自动调整');
  if (!prepared.support.has(name)) throw Error('自增整数列必须已有经完整目录证明的首列BTREE索引；可为普通非唯一或复合索引');
  if (prepared.auto.length > 1 || prepared.auto.length === 1 && prepared.auto[0] !== name) throw Error('表中已有另一自增列，不能启用第二个AUTO_INCREMENT');
}
/** 只投影专属资格；没有完整目录时缺省只读，旧七项访问能力不变。 */
export function tableColumnAutoIncrementAccess(document: TableColumnDefinitionDocument, name: string, facts?: TableColumnAutoIncrementFacts): { enabled: boolean; access: ColumnAttributeAccess } {
  const enabled = document.columnsByName.get(name)?.attributes.some(attribute => attribute.kind === 'auto-increment') === true;
  try { if (!facts) throw Error('列自增完整目录、原生身份或运行策略尚未证明'); assertTarget(document, name, facts); return { enabled, access: { editable: true } }; }
  catch (reason) { return { enabled, access: { editable: false, reason: reason instanceof Error ? reason.message : '列自增能力无法证明' } }; }
}
/** 只对已定位原片段增删属性，原列名/类型/备注/位次/键均不从草稿重造。 */
export function planTableColumnAutoIncrement(document: TableColumnDefinitionDocument, facts: TableColumnAutoIncrementFacts, columnRef: string, name: string, enabled: boolean, database: string, originalMode: string): TableColumnAutoIncrementPlan {
  if (typeof enabled !== 'boolean') throw Error('列自增切换必须是明确布尔值');
  if (document.database !== undefined && document.database !== database || facts.physical.nativeName !== database + '/' + document.table || [...facts.indexes.model.columns].filter(([ref, column]) => ref === columnRef && column.name === name).length !== 1) throw Error('列自增计划目标与真实实体或字段引用不一致');
  assertTarget(document, name, facts);
  const column = document.columnsByName.get(name)!, attribute = column.attributes.find(item => item.kind === 'auto-increment');
  if (Boolean(attribute) === enabled) throw Error('没有实际列自增属性变更');
  let definition: string;
  if (attribute) definition = column.raw.slice(0, attribute.range.start - column.range.start) + column.raw.slice(attribute.range.end - column.range.start);
  else {
    const at = column.attributes.find(item => item.kind === 'nullable')!.range.end - column.range.start;
    definition = column.raw.slice(0, at) + ' AUTO_INCREMENT' + column.raw.slice(at);
  }
  const clauses = [`MODIFY COLUMN ${definition}`, 'ALGORITHM=COPY', 'LOCK=EXCLUSIVE'];
  const sql = `ALTER TABLE ${qualified(database, document.table)}\n${clauses.join('\n,\n')}\n;`;
  if (Buffer.byteLength(sql) > 4 * 1024 * 1024 || new SqlScriptScanner(document.context.mode.noBackslashEscapes, document.context.mode.ansiQuotes).push(sql, true).length !== 1) throw Error('列自增计划必须为预算内单条ALTER');
  const refs = new Map([...facts.indexes.model.columns].map(([ref, value]) => [value.name, ref]));
  refs.set(name, columnRef);
  return { columnName: name, enabled, originalMode, executionMode: tableColumnAutoIncrementExecutionMode(originalMode), sql, clauses, requiredAcknowledgements: [columnAutoIncrementAcknowledgement], warnings: ['仅在独立结构会话追加并读回确认NO_AUTO_VALUE_ON_ZERO，保留原零值；不修改任何查询标签或全局模式。', '列自增切换明确使用ALGORITHM=COPY与LOCK=EXCLUSIVE，将复制重建表、等待并持有排他锁，影响读写并消耗磁盘；不承诺在线。', '请在维护窗口暂停外部写入和DDL。自增分配、回滚和下一计数受服务器控制，定义核验不承诺下一次插入的精确值。'], finalColumns: document.columns.map(item => ({ columnRef: refs.get(item.name)!, name: item.name })), preserved: { columns: document.columns.filter(item => item.name !== name).map(item => item.raw), constraints: document.items.filter(item => item.kind === 'constraint').map(item => item.raw), tail: document.tail.raw } };
}
/** 表尾只豁免真实顶层计数；列/注释中的AUTO_INCREMENT文字绝不能被剥离。 */
function tail(document: TableColumnDefinitionDocument): string | undefined {
  const parsed = readTableAutoIncrementDefinition(document.source, document.context);
  if (parsed.reasons.length) return;
  const [, preserved] = JSON.parse(parsed.preserved) as [string, unknown];
  return preserved === undefined ? undefined : JSON.stringify(preserved);
}
/** COPY允许新物理ID，其他实际映射、全部未改属性和关系目录仍须完整保持。 */
export function verifyTableColumnAutoIncrement(before: TableColumnAutoIncrementFacts, after: TableColumnAutoIncrementFacts, original: StructureDefinitionRead, current: StructureDefinitionRead, plan: TableColumnAutoIncrementPlan): boolean {
  const withoutId = ({ tableId: _tableId, ...value }: TableColumnAutoIncrementFacts['physical']) => value;
  if (JSON.stringify(withoutId(before.physical)) !== JSON.stringify(withoutId(after.physical)) || current.identity !== original.identity || current.originalMode !== current.normalizedMode || !sameTableColumnAutoIncrementMode(current.normalizedMode, plan.executionMode) || JSON.stringify(before.policy) !== JSON.stringify(after.policy)) return false;
  const beforeDoc = structureDocumentOf(original), afterDoc = structureDocumentOf(current);
  if (tail(beforeDoc) === undefined || tail(beforeDoc) !== tail(afterDoc) || JSON.stringify(beforeDoc.columns.map(column => column.name)) !== JSON.stringify(afterDoc.columns.map(column => column.name))) return false;
  const constraints = (document: TableColumnDefinitionDocument) => document.items.filter(item => item.kind === 'constraint').map(item => item.raw);
  const beforeConstraints = constraints(beforeDoc), afterConstraints = constraints(afterDoc);
  if (beforeConstraints.length !== afterConstraints.length || beforeConstraints.some((value, index) => !sameStructureFragment(value, afterConstraints[index], current.context))) return false;
  for (const column of beforeDoc.columns) {
    const other = afterDoc.columnsByName.get(column.name); if (!other) return false;
    if (column.name !== plan.columnName) { if (!sameStructureFragment(column.raw, other.raw, current.context)) return false; continue; }
    const strip = (value: typeof column): string => { const attribute = value.attributes.find(item => item.kind === 'auto-increment'); return attribute ? value.raw.slice(0, attribute.range.start - value.range.start) + value.raw.slice(attribute.range.end - value.range.start) : value.raw; };
    if (other.attributes.some(attribute => attribute.kind === 'auto-increment') !== plan.enabled || !sameStructureFragment(strip(column), strip(other), current.context)) return false;
  }
  if (before.columns.length !== after.columns.length) return false;
  for (let index = 0; index < before.columns.length; index++) {
    const left = before.columns[index], right = after.columns[index];
    if (left.name !== right.name) return false;
    if (left.name !== plan.columnName) { if (JSON.stringify(left) !== JSON.stringify(right)) return false; continue; }
    if (right.extra.toLowerCase() !== (plan.enabled ? 'auto_increment' : '') || JSON.stringify({ ...left, extra: right.extra }) !== JSON.stringify(right)) return false;
  }
  // 两次实际索引/依赖读取的稳定引用相同；只许可自增引用集合按请求变化。
  const leftDependencies = before.indexes.model.dependencies, rightDependencies = after.indexes.model.dependencies;
  const refs = [...after.indexes.model.columns].filter(([, column]) => column.name === plan.columnName);
  if (refs.length !== 1 || JSON.stringify({ ...leftDependencies, autoIncrementColumnRefs: plan.enabled ? [refs[0][0]] : [] }) !== JSON.stringify(rightDependencies)) return false;
  const indexes = (value: TableColumnAutoIncrementFacts) => [...value.indexes.model.indexes].map(([ref, index]) => [ref, { name: index.parsed.name, kind: index.parsed.kind, method: index.parsed.method, parts: index.parsed.parts.map(part => ({ columnName: part.columnName, prefixLength: part.prefixLength, direction: part.direction, expressionSql: part.expressionSql, opaqueReasons: part.opaqueReasons })), comment: index.parsed.comment, attributes: index.parsed.attributes.map(attribute => ({ kind: attribute.kind, rawSql: attribute.rawSql })), opaqueReasons: index.parsed.opaqueReasons, definition: index.definition, visible: index.visible, generated: index.generated }]);
  return JSON.stringify(indexes(before)) === JSON.stringify(indexes(after)) && JSON.stringify(before.indexes.options) === JSON.stringify(after.indexes.options);
}
