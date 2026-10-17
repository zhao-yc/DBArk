import { identifier, qualified, SqlScriptScanner, stringLiteral } from './sql';
import { columnOnUpdateAccess, columnOnUpdateVersionSupported, readColumnOnUpdate, sameColumnOnUpdate } from '../shared/tableColumnPatches';
import { assertColumnAttributeReadable, tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import { columnRestateAccess, hasUnprovenBinaryDefault, readControlledTimestampDefault, tableColumnDefaultRisks, tableColumnDefaultRiskMessage, tableColumnPatchLimits, validateColumnPatches, type ColumnDefaultPatch, type ColumnPatch, type ColumnTypePatch, type DefinitionRange, type TableColumnDefinition, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';

export interface ColumnPatchPlanOptions {
  database: string; serverVersion: string;
  /** 必须覆盖完整快照；不透明引用由 get 会话生成，不来自客户端名称猜测。 */
  columnRefs: ReadonlyMap<string, string>;
}
export interface ColumnPatchSqlPlan {
  sql: string; clauses: string[]; warnings: string[]; requiredAcknowledgements: string[];
  finalColumns: { columnRef: string; name: string }[];
  /** 未改内容的原始证据，后续执行核验使用；不拼回 ALTER 造成整表重建。 */
  preserved: { columns: string[]; constraints: string[]; tail: string };
}
type Alter = Extract<ColumnPatch, { kind: 'alter' }>;
type Positioned = Exclude<ColumnPatch, { kind: 'drop' }>;
interface ColumnNode { ref: string; name: string; original?: TableColumnDefinition; }

/** 类型参数先经共享严格校验，只生成受控语法；枚举元素始终是字符串文字量。 */
function typeSql(type: ColumnTypePatch, noBackslashEscapes: boolean): string {
  switch (type.kind) {
    case 'integer': return type.type + (type.unsigned ? ' UNSIGNED' : '');
    case 'decimal': return `DECIMAL(${type.precision},${type.scale})` + (type.unsigned ? ' UNSIGNED' : '');
    case 'float': return type.type + (type.unsigned ? ' UNSIGNED' : '');
    case 'bit': return `BIT(${type.length})`;
    case 'string': return `${type.type}(${type.length})`;
    case 'large': return type.type;
    case 'temporal': return type.type + (type.precision === undefined ? '' : `(${type.precision})`);
    case 'enumeration': return `${type.type}(${type.values.map(value => stringLiteral(value, noBackslashEscapes)).join(',')})`;
  }
}

/** 默认值编码不使用 Number 舍入，也不把文字量 CURRENT_TIMESTAMP 自动识别成表达式。 */
function defaultSql(value: ColumnDefaultPatch, type: string, nullable: boolean | undefined, document: TableColumnDefinitionDocument, largeDefaultUnsupported: boolean): string | undefined {
  if (value.kind === 'none') return undefined;
  const base = /^[A-Za-z]+/.exec(type.trim())?.[0].toUpperCase() ?? '';
  if (value.kind === 'null') { if (nullable === false) throw new Error('NOT NULL 列不能设置 NULL 默认值'); return 'NULL'; }
  if (value.kind === 'expression') {
    if (!['TIMESTAMP', 'DATETIME'].includes(base)) throw new Error('首批 CURRENT_TIMESTAMP 默认表达式只适用于 TIMESTAMP/DATETIME');
    const precision = Number(/^[A-Za-z]+\s*\((\d+)\)/.exec(type.trim())?.[1] ?? 0);
    if (value.precision !== undefined && value.precision !== precision) throw new Error('默认时间表达式精度必须与列精度一致');
    return precision ? `CURRENT_TIMESTAMP(${precision})` : 'CURRENT_TIMESTAMP';
  }
  if (['JSON', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION'].includes(base)) throw new Error('首批不修改 JSON/空间类型的文字量默认值');
  let literal: string;
  if (value.valueType === 'text') literal = stringLiteral(value.value, document.context.mode.noBackslashEscapes);
  else if (value.valueType === 'boolean') literal = value.value === 'true' ? 'TRUE' : 'FALSE';
  else if (value.valueType === 'binary') {
    if (base === 'BIT') {
      const width = Number(/^BIT\s*\((\d+)\)/i.exec(type.trim())?.[1] ?? 1), integer = BigInt('0x' + (value.value || '0'));
      if (integer >= (1n << BigInt(width))) throw new Error('BIT 默认值超出声明位数');
      literal = `b'${integer.toString(2)}'`;
    } else literal = `X'${value.value}'`;
  } else literal = value.value;
  if (/^(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)$/.test(base)) {
    if (largeDefaultUnsupported) throw new Error('MySQL 5.7 或 8.0.13 之前不支持该大对象文字量默认值');
    if (document.context.dialect === 'mysql') return `(${literal})`;
  }
  return literal;
}

/** 只比较已知字段值，不重写未修改的默认值表达式或原片段。 */
function defaultUnchanged(column: TableColumnDefinition, value: ColumnDefaultPatch): boolean {
  if (hasUnprovenBinaryDefault(column)) return false;
  const before = column.default;
  if (before.kind === 'none' || before.kind === 'null') return before.kind === value.kind;
  if (before.kind === 'literal' && value.kind === 'literal') return before.valueType === value.valueType && before.value === value.value && before.encoding !== 'bits';
  if (before.kind === 'expression' && value.kind === 'expression') {
    const old = readControlledTimestampDefault(before.sql);
    const precision = value.precision ?? Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 0);
    return Boolean(old && old.precision === precision);
  }
  return false;
}

/** 词法比较忽略关键字大小写和普通注释，但不能改变 ENUM 字符串的大小写和值。 */
function sameType(left: string, right: string, document: TableColumnDefinitionDocument): boolean {
  const normalized = (source: string) => tableDefinitionTokens(source, document.context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

/** 通过同一词法层检查依赖；字符串和普通注释里的假列名不产生依赖。 */
function mentions(tokens: TableDefinitionToken[], name: string): boolean {
  return tokens.some(token => token.kind === 'executable' || ((token.kind === 'word' || token.kind === 'identifier') && token.value.toLowerCase() === name.toLowerCase()));
}

/** 识别无列依赖的普通表选项；未知尾部和分区不能被当成无依赖。 */
function tailUnknown(document: TableColumnDefinitionDocument): boolean {
  const tokens = tableDefinitionTokens(document.tail.raw, document.context); let cursor = 1;
  const keys = new Set(['ENGINE', 'AUTO_INCREMENT', 'CHARSET', 'COLLATE', 'COMMENT', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  while (cursor < tokens.length) {
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) return false;
    let key = tokens[cursor].kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++;
    if (key === 'DEFAULT') { key = tokens[cursor]?.value.toUpperCase() ?? ''; cursor++; }
    if (key === 'CHARACTER' && tokens[cursor]?.value.toUpperCase() === 'SET') { key = 'CHARSET'; cursor++; }
    if (!keys.has(key)) return true;
    if (tokens[cursor]?.value === '=') cursor++;
    if (!tokens[cursor] || !['word', 'number', 'string', 'identifier'].includes(tokens[cursor].kind)) return true; cursor++;
  }
  return false;
}

/** 删除、改名、类型/可空及位置不自动修复依赖；未知结构也不能被静默认定安全。 */
function assertDependencies(document: TableColumnDefinitionDocument, column: TableColumnDefinition, changes: Set<string>, unknownTail: boolean): void {
  const structural = [...changes].some(key => ['drop', 'name', 'type', 'nullable', 'position'].includes(key)); if (!structural) return;
  if (unknownTail) throw new Error('表尾含分区或尚未解析的定义，首批仅支持不涉及结构依赖的属性修改');
  for (const item of document.items) {
    if (item.kind === 'constraint' && mentions(tableDefinitionTokens(item.raw, document.context), column.name) && [...changes].some(key => key !== 'position')) throw new Error('目标列涉及索引、外键或约束，首批不自动修改依赖');
    if (item.kind === 'column') for (const attribute of item.attributes) {
      const relevant = ['generated', 'check', 'opaque'].includes(attribute.kind) || (attribute.kind === 'default' && ['expression', 'opaque'].includes(item.default.kind));
      if (relevant && (attribute.kind === 'opaque' || mentions(tableDefinitionTokens(attribute.raw, document.context), column.name))) throw new Error('目标列可能被生成列、表达式或未知属性引用，不能自动调整');
    }
  }
}

/** 同一位置插入先合并，现有属性按精确源范围逆序替换，保留其他原始文本。 */
function modifiedDefinition(column: TableColumnDefinition, changes: Alter['changes'], document: TableColumnDefinitionDocument, largeDefaultUnsupported: boolean): string {
  const replacements: { range: DefinitionRange; value: string }[] = [], insertions = new Map<number, string>();
  const insert = (at: number, value: string): void => { insertions.set(at, (insertions.get(at) ?? '') + value); };
  const last = column.attributes.at(-1)?.range.end ?? column.type.range.end;
  const attribute = (kind: 'nullable' | 'default' | 'comment' | 'on-update', value: string): void => {
    const existing = column.attributes.find(item => item.kind === kind);
    if (existing) replacements.push({ range: existing.range, value });
    else if (value) insert(kind === 'nullable' ? column.type.range.end : last, ' ' + value);
  };
  if (changes.name !== undefined) replacements.push({ range: column.nameRange, value: identifier(changes.name) });
  if (changes.type) replacements.push({ range: column.type.range, value: typeSql(changes.type, document.context.mode.noBackslashEscapes) });
  if (changes.nullable !== undefined) attribute('nullable', changes.nullable ? 'NULL' : 'NOT NULL');
  if (changes.default) {
    const sql = defaultSql(changes.default, changes.type ? typeSql(changes.type, document.context.mode.noBackslashEscapes) : column.type.raw, changes.nullable ?? column.nullable, document, largeDefaultUnsupported);
    attribute('default', sql === undefined ? '' : 'DEFAULT ' + sql);
  }
  if (changes.comment !== undefined) attribute('comment', 'COMMENT ' + stringLiteral(changes.comment, document.context.mode.noBackslashEscapes));
  if (Object.hasOwn(changes, 'onUpdate')) {
    const precision = Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 0);
    attribute('on-update', changes.onUpdate === null ? '' : 'ON UPDATE CURRENT_TIMESTAMP' + (precision ? `(${precision})` : ''));
  }
  for (const [at, value] of insertions) replacements.push({ range: { start: at, end: at }, value });
  replacements.sort((a, b) => b.range.start - a.range.start || b.range.end - a.range.end);
  let text = column.raw, previous = column.range.end;
  for (const item of replacements) {
    if (item.range.end > previous) throw new Error('列属性修改范围重叠');
    text = text.slice(0, item.range.start - column.range.start) + item.value + text.slice(item.range.end - column.range.start); previous = item.range.start;
  }
  return text;
}

/** 纯计划器只输出一个 ALTER；不连接数据库、不执行、也不在失败后退回另一种 SQL。 */
export function buildTableColumnPatchSql(document: TableColumnDefinitionDocument, input: unknown, options: ColumnPatchPlanOptions): ColumnPatchSqlPlan {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(options.serverVersion.replace(/^5\.5\.5-/, ''));
  if (!version || !(document.context.dialect === 'mysql' ? ['5.7', '8.0', '8.4'] : ['10.11', '11.4']).includes(`${version[1]}.${version[2]}`)) throw new Error('当前计划器尚未确认该服务器版本');
  const mysql57 = document.context.dialect === 'mysql' && version[1] === '5';
  const largeDefaultUnsupported = mysql57 || (document.context.dialect === 'mysql' && version[1] === '8' && version[2] === '0' && Number(version[3]) < 13);
  const patches = validateColumnPatches(input, document.context.dialect === 'mysql' ? 30 : 38);
  // 新配对绝不能落到旧属性重述路径而被忽略；须由专用事实/计划/后核闭环处理。
  if (patches.some(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'collation'))) throw new Error('列排序规则必须使用专用受控计划，旧字段计划器未发送DDL');
  if (document.database !== undefined && document.database !== options.database) throw new Error('表定义数据库与目标不一致');
  const target = qualified(options.database, document.table), nodes = new Map<string, ColumnNode>(), names = new Set<string>();
  for (const [ref, name] of options.columnRefs) {
    const original = document.columnsByName.get(name); if (!original || names.has(name)) throw new Error('字段快照引用无效');
    nodes.set(ref, { ref, name, original }); names.add(name);
  }
  if (names.size !== document.columns.length) throw new Error('字段快照引用不完整');
  // MariaDB 真实反例涵盖旁列 ALTER 和原生 RENAME：只有整批专用默认值修复且覆盖全部风险才可生成计划。
  const risks = tableColumnDefaultRisks(document);
  if (risks.length) {
    const removed = new Set<string>();
    const onlyDefaults = patches.every(patch => {
      if (patch.kind !== 'alter' || Object.keys(patch.changes).length !== 1 || !patch.changes.default) return false;
      const target = nodes.get(patch.columnRef); if (target) removed.add(target.name);
      return true;
    });
    if (!onlyDefaults || risks.some(name => !removed.has(name))) throw new Error(tableColumnDefaultRiskMessage(risks));
  }
  const originalRefs = new Set(nodes.keys());
  const byName = new Map([...nodes.values()].map(node => [node.name, node]));
  let order = document.columns.map(column => byName.get(column.name)!);
  const operations = new Map<string, Positioned>(), drops: string[] = [], changed = new Set<string>(), warnings: string[] = [], acknowledgements = new Set<string>();
  const unknownTail = tailUnknown(document);
  for (const patch of patches) {
    if (patch.kind === 'add') {
      if (Object.hasOwn(patch, 'onUpdate') && !columnOnUpdateVersionSupported(document.context.dialect, options.serverVersion)) throw new Error('当前版本尚未开放新增自动更新时间属性');
      if (originalRefs.has(patch.clientKey) || nodes.has(patch.clientKey)) throw new Error('新增字段引用与现有快照冲突');
      const node = { ref: patch.clientKey, name: patch.name }; nodes.set(node.ref, node); operations.set(node.ref, patch); continue;
    }
    const node = nodes.get(patch.columnRef); if (!node?.original) throw new Error('字段引用不存在于原始快照');
    const column = node.original;
    if (patch.kind === 'drop') {
      for (const key of ['name', 'type'] as const) assertColumnAttributeReadable(column, key);
      assertDependencies(document, column, new Set(['drop']), unknownTail);
      drops.push(`DROP COLUMN ${identifier(column.name)}`); order = order.filter(item => item !== node); nodes.delete(node.ref); changed.add(column.name); acknowledgements.add('drop-column-data'); continue;
    }
    const changes = { ...patch.changes };
    // 自动时间首片只修改本属性；不允许同列类型/默认值组合扩大重述语义。
    if (Object.hasOwn(changes, 'onUpdate')) {
      const access = columnOnUpdateAccess(column, document.context.dialect, options.serverVersion);
      if (!access.editable) throw new Error(access.reason);
      if (Object.keys(changes).length !== 1) throw new Error('自动更新时间不能与同一字段其他属性混合修改');
      const precision = Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 0);
      if (changes.onUpdate !== null && changes.onUpdate!.precision !== undefined && changes.onUpdate!.precision !== precision) throw new Error('自动更新时间精度必须与现有字段精度一致');
      if (sameColumnOnUpdate(readColumnOnUpdate(column), changes.onUpdate, column.type.raw)) delete changes.onUpdate;
    }
    if (changes.name === column.name) delete changes.name;
    if (changes.type && sameType(column.type.raw, typeSql(changes.type, document.context.mode.noBackslashEscapes), document)) delete changes.type;
    if (changes.nullable === column.nullable) delete changes.nullable;
    if (changes.comment === (column.comment ?? '')) delete changes.comment;
    if (changes.default && defaultUnchanged(column, changes.default)) delete changes.default;
    for (const key of Object.keys(changes) as (keyof Alter['changes'])[]) {
      if (key === 'collation') throw new Error('列排序规则必须使用专用受控计划');
      assertColumnAttributeReadable(column, key);
    }
    assertDependencies(document, column, new Set(Object.keys(changes)), unknownTail);
    if (changes.name !== undefined) { node.name = changes.name; acknowledgements.add('external-name-dependencies'); }
    if (changes.type || changes.nullable === false) acknowledgements.add('conversion-or-nullability');
    if (Object.keys(changes).length) operations.set(node.ref, { ...patch, changes });
  }
  if (!nodes.size) throw new Error('表至少需要一个字段');
  if (nodes.size > tableColumnPatchLimits.columns) throw new Error('修改后字段数量超过 4096');
  const finalNames = new Set<string>();
  for (const node of nodes.values()) {
    const folded = node.name.toLowerCase(); if (finalNames.has(folded)) throw new Error('最终字段名称重复或大小写不明确'); finalNames.add(folded);
    const occupied = document.columns.find(column => column.name.toLowerCase() === folded && column !== node.original);
    if (occupied) throw new Error('首批不复用同次删除或改名字段的旧名称，也不自动生成改名交换步骤');
  }
  const dependencies = new Map<string, Set<string>>();
  for (const [ref, operation] of operations) {
    const position = operation.kind === 'add' ? operation.position : operation.changes.position, waiting = new Set<string>();
    if (position?.kind === 'after') {
      if (position.columnRef === ref || !nodes.has(position.columnRef)) throw new Error('AFTER 引用不存在或指向自身');
      if (operations.has(position.columnRef)) waiting.add(position.columnRef);
    }
    if (position?.kind === 'last') for (const other of operations.keys()) if (other !== ref) waiting.add(other);
    if (unknownTail && operation.kind === 'add' && position?.kind !== 'last') throw new Error('未知表尾依赖下首批仅支持末尾新增字段');
    dependencies.set(ref, waiting);
  }
  const sorted: string[] = [];
  while (dependencies.size) {
    const ready = [...dependencies].find(([, waiting]) => !waiting.size);
    if (!ready) throw new Error('字段位次包含环或互相矛盾的末尾要求');
    const ref = ready[0]; sorted.push(ref); dependencies.delete(ref); for (const waiting of dependencies.values()) waiting.delete(ref);
  }
  const clauses = [...drops];
  for (const ref of sorted) {
    const operation = operations.get(ref)!, node = nodes.get(ref)!;
    const position = operation.kind === 'add' ? operation.position : operation.changes.position;
    let positionSql = '', moved = false;
    if (position) {
      const before = order.map(item => item.ref).join('\0'); order = order.filter(item => item.ref !== ref);
      const index = position.kind === 'first' ? 0 : position.kind === 'last' ? order.length : order.findIndex(item => item.ref === position.columnRef) + 1;
      if (position.kind === 'after' && index === 0) throw new Error('AFTER 引用尚未出现在字段序列');
      positionSql = index === 0 ? ' FIRST' : ` AFTER ${identifier(order[index - 1].name)}`; order.splice(index, 0, node); moved = before !== order.map(item => item.ref).join('\0');
    }
    if (operation.kind === 'add') {
      const type = typeSql(operation.type, document.context.mode.noBackslashEscapes), value = defaultSql(operation.default, type, operation.nullable, document, largeDefaultUnsupported);
      const precision = operation.type.kind === 'temporal' ? operation.type.precision ?? 0 : 0;
      const onUpdate = operation.onUpdate ? ' ON UPDATE CURRENT_TIMESTAMP' + (precision ? `(${precision})` : '') : '';
      clauses.push(`ADD COLUMN ${identifier(operation.name)} ${type} ${operation.nullable ? 'NULL' : 'NOT NULL'}${value === undefined ? '' : ' DEFAULT ' + value}${onUpdate} COMMENT ${stringLiteral(operation.comment, document.context.mode.noBackslashEscapes)}${positionSql}`); continue;
    }
    const column = node.original!, changes = { ...operation.changes }; if (!moved) delete changes.position;
    const keys = Object.keys(changes); if (!keys.length) continue;
    changed.add(column.name);
    if (keys.length === 1 && changes.default) {
      const value = defaultSql(changes.default, column.type.raw, column.nullable, document, largeDefaultUnsupported);
      const largeMysqlLiteral = document.context.dialect === 'mysql' && !largeDefaultUnsupported && changes.default.kind === 'literal' && /^(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)\b/i.test(column.type.raw);
      if ((changes.default.kind === 'expression' && mysql57) || largeMysqlLiteral) {
        // 5.7 时间表达式、8.x 大对象文字量的 setter 均不支持；预先只替换原 DEFAULT，不能失败后重放。
        const restate = columnRestateAccess(column, document.context.dialect); if (!restate.editable) throw new Error(restate.reason);
        clauses.push(`MODIFY COLUMN ${modifiedDefinition(column, changes, document, largeDefaultUnsupported)}`);
      } else {
        const expression = changes.default.kind === 'expression' && document.context.dialect === 'mysql' ? `(${value})` : value;
        clauses.push(`ALTER COLUMN ${identifier(column.name)} ${value === undefined ? 'DROP DEFAULT' : 'SET DEFAULT ' + expression}`);
      }
    } else if (keys.length === 1 && changes.name && !mysql57) clauses.push(`RENAME COLUMN ${identifier(column.name)} TO ${identifier(changes.name)}`);
    else {
      const restate = columnRestateAccess(column, document.context.dialect);
      if (!restate.editable) throw new Error(restate.reason);
      clauses.push(`${changes.name ? 'CHANGE COLUMN ' + identifier(column.name) : 'MODIFY COLUMN'} ${modifiedDefinition(column, changes, document, largeDefaultUnsupported)}\n${changes.position ? positionSql : ''}`);
    }
  }
  for (const [ref, operation] of operations) {
    const position = operation.kind === 'add' ? operation.position : operation.changes.position; if (!position) continue;
    const index = order.findIndex(item => item.ref === ref);
    if ((position.kind === 'first' && index !== 0) || (position.kind === 'last' && index !== order.length - 1) || (position.kind === 'after' && order[index - 1]?.ref !== position.columnRef)) throw new Error('字段位次要求互相冲突，无法在单条 ALTER 中明确表达');
  }
  if (!clauses.length) throw new Error('没有实际字段变更');
  // 每个子句前后有真实换行，原定义末尾的 --/# 注释不能吞掉逗号或语句结束符。
  const sql = `ALTER TABLE ${target}\n${clauses.join('\n,\n')}\n;`;
  if (new TextEncoder().encode(sql).length > tableColumnPatchLimits.ddlBytes) throw new Error('字段 DDL 超过 4 MiB');
  if (new SqlScriptScanner(document.context.mode.noBackslashEscapes, document.context.mode.ansiQuotes).push(sql, true).length !== 1) throw new Error('字段计划必须恰好为一条 ALTER');
  if (document.columns.some(hasUnprovenBinaryDefault)) warnings.push('表中二进制文本默认值的原始字节不可证明（字段：' + document.columns.filter(hasUnprovenBinaryDefault).map(column => JSON.stringify(column.name)).join('、') + '）；本次操作不自动重述这些旧值，结果仍须人工核对。');
  warnings.push('DDL 可能隐式提交，不能通过事务回滚恢复；本计划只供独立结构会话执行。', '执行前重核仍存在外部 DDL 的并发窗口，请在维护时段暂停并行结构修改。', '当前定义不包含全部外部视图、触发器、例程或入向外键依赖，执行前仍须核对。');
  return { sql, clauses, warnings, requiredAcknowledgements: [...acknowledgements], finalColumns: order.map(node => ({ columnRef: node.ref, name: node.name })), preserved: { columns: document.columns.filter(column => !changed.has(column.name)).map(column => column.raw), constraints: document.items.filter(item => item.kind === 'constraint').map(item => item.raw), tail: document.tail.raw } };
}
