import { createHash } from 'node:crypto';
import { defaultForeignKeyAction, type ForeignKeyAction } from '../shared/tableForeignKeyPatches';

export const foreignKeyNamespaceLimits = { foreignKeys: 1000, parts: 32000, bytes: 4 * 1024 * 1024, candidates: 100, candidateBatch: 16, existingBatch: 64 } as const;
export interface ForeignKeyNamespaceFacts { dialect: 'mysql' | 'mariadb'; serverVersion: string; compileOs: string; lowerCaseTableNames: number; }
type Row = Record<string, unknown>;
export interface ForeignKeyNamespaceInput {
  facts: ForeignKeyNamespaceFacts;
  readComplete: { headers: boolean; nativeColumns: boolean; rc: boolean; kcu: boolean };
  headers: readonly Row[]; nativeColumns: readonly Row[]; rc: readonly Row[]; kcu: readonly Row[];
}
export interface CanonicalNamespaceForeignKey {
  id: string; child: { database: string; table: string }; parent: { database: string; table: string }; name: string;
  childColumns: readonly string[]; parentColumns: readonly string[]; onUpdate: ForeignKeyAction; onDelete: ForeignKeyAction; type: number;
}
export type ForeignKeyNamespaceEvidence =
  | { kind: 'partial'; reason: 'capability' | 'incomplete' | 'budget' | 'inconsistent'; warnings: readonly string[]; bytes: number }
  | { kind: 'complete'; facts: ForeignKeyNamespaceFacts; entries: readonly CanonicalNamespaceForeignKey[]; digest: string; bytes: number };
export interface ForeignKeyNameComparisonQuery { id: string; sql: string; candidateOrdinals: readonly number[]; existingCount: number; }
export type ForeignKeyNameComparisonPlan =
  | { kind: 'unknown'; candidates: readonly string[]; reason: string }
  | { kind: 'ready'; candidates: readonly string[]; evidenceDigest: string; initial: ReadonlyMap<string, 'available'>; queries: readonly ForeignKeyNameComparisonQuery[] };
export interface ForeignKeyNameComparisonReply { id: string; rows: unknown; }
export type ForeignKeyNameAvailability = 'available' | 'conflict' | 'unknown';

const ascii = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
class EvidenceError extends Error { constructor(readonly reason: 'capability' | 'incomplete' | 'budget' | 'inconsistent', message: string) { super(message); } }
/** 所有判断按已证版本和构建精确收窄，不从任意 linux 子串或相似版本扩展权限证明。 */
function family(facts: ForeignKeyNamespaceFacts): 'mysql8' | 'sys' {
  try { defaultForeignKeyAction(facts); } catch { throw new EvidenceError('capability', '当前版本尚无外键目录及名称比较规则证明'); }
  const version = /^(\d+\.\d+\.\d+)(?:$|-)/.exec(facts.serverVersion)?.[1];
  const linux = facts.compileOs === 'Linux' || (facts.dialect === 'mariadb' && ['10.11.19', '11.4.13'].includes(version ?? '') && facts.compileOs === 'debian-linux-gnu');
  if (!linux || facts.lowerCaseTableNames !== 0) throw new EvidenceError('capability', '操作系统或标识符大小写规则尚未证明');
  return facts.dialect === 'mysql' && version !== '5.7.44' ? 'mysql8' : 'sys';
}
/** 不读取访问器；目录由引擎提供，但异常行不得补造缺省属性。 */
function own(row: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(row, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new EvidenceError('inconsistent', '目录字段缺失或不是自有数据属性');
  return descriptor.value;
}
function name(row: object, key: string): string {
  const value = own(row, key);
  if (typeof value !== 'string' || !ascii.test(value)) throw new EvidenceError('inconsistent', '目录含未证明的非 ASCII 库、表、列或约束名称');
  return value;
}
function scalarText(row: object, key: string): string {
  const value = own(row, key);
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new EvidenceError('inconsistent', '目录文本字段无效');
  return value;
}
/** 仅有界目录序号转换为整数，不涉及业务行精度。 */
function ordinal(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value))) throw new EvidenceError('inconsistent', '目录计数或序号无效');
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < minimum || integer > maximum) throw new EvidenceError('inconsistent', '目录计数或序号超界');
  return integer;
}
function action(row: Row, key: string): ForeignKeyAction {
  const value = scalarText(row, key);
  if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(value)) throw new EvidenceError('inconsistent', '外键动作包含未证明属性');
  return value as ForeignKeyAction;
}
/** run05 固定源码公式；不是 run01/02 的现场 TYPE 采集值，不容忍同方向多位或未知高位。 */
function actionType(onDelete: ForeignKeyAction, onUpdate: ForeignKeyAction): number {
  const deleteBits = { RESTRICT: 0, CASCADE: 1, 'SET NULL': 2, 'NO ACTION': 16 };
  const updateBits = { RESTRICT: 0, CASCADE: 4, 'SET NULL': 8, 'NO ACTION': 32 };
  return deleteBits[onDelete] | updateBits[onUpdate];
}
const headerFields = ['ID', 'FOR_NAME', 'REF_NAME', 'N_COLS', 'TYPE'];
const nativeFields = ['ID', 'FOR_COL_NAME', 'REF_COL_NAME', 'POS'];
const rcFields = ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_NAME', 'UNIQUE_CONSTRAINT_SCHEMA', 'REFERENCED_TABLE_NAME', 'MATCH_OPTION', 'UPDATE_RULE', 'DELETE_RULE', 'UNIQUE_CONSTRAINT_NAME'];
const kcuFields = ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'REFERENCED_TABLE_SCHEMA', 'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME', 'POSITION_IN_UNIQUE_CONSTRAINT'];

/** 四套目录须逐项形成双向闭合；全局读取完整性由可信主机提供，不能由 RC 空集替代。 */
export function buildForeignKeyNamespaceEvidence(input: ForeignKeyNamespaceInput): ForeignKeyNamespaceEvidence {
  let bytes = 0;
  try {
    const kind = family(input.facts);
    if (['headers', 'nativeColumns', 'rc', 'kcu'].some(key => own(input.readComplete, key) !== true)) throw new EvidenceError('incomplete', '全局外键目录未全部读取完成，不能确认名称可用');
    /** 先按行计数和 JSON 转义字节拒绝，禁止先 stringify 整个未知巨型目录。 */
    const rows = (values: readonly Row[], fields: readonly string[], maximum: number): void => {
      if (!Array.isArray(values)) throw new EvidenceError('inconsistent', '目录结果不是数组');
      if (values.length > maximum) throw new EvidenceError('budget', '全局外键目录超过数量预算');
      bytes += 2;
      for (let index = 0; index < values.length; index++) {
        const row = own(values, String(index));
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new EvidenceError('inconsistent', '目录行无效');
        bytes += 3;
        for (const key of Reflect.ownKeys(row)) {
          if (typeof key !== 'string' || !fields.includes(key)) throw new EvidenceError('inconsistent', '目录含未解释字段');
          const value = own(row, key);
          if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new EvidenceError('inconsistent', '目录含非法标量值');
          if (typeof value === 'string' && Buffer.byteLength(value) > foreignKeyNamespaceLimits.bytes - bytes) throw new EvidenceError('budget', '全局外键目录超过 4 MiB');
          bytes += Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(value)) + 2;
          if (bytes > foreignKeyNamespaceLimits.bytes) throw new EvidenceError('budget', '全局外键目录超过 4 MiB');
        }
      }
    };
    rows(input.headers, headerFields, 1000); rows(input.nativeColumns, nativeFields, 32000); rows(input.rc, rcFields, 1000); rows(input.kcu, kcuFields, 32000);
    const headers = new Map<string, Row>(), native = new Map<string, Row[]>();
    for (const row of input.headers) {
      const id = scalarText(row, 'ID'); if (headers.has(id)) throw new EvidenceError('inconsistent', '原生外键头 ID 重复');
      scalarText(row, 'FOR_NAME'); scalarText(row, 'REF_NAME'); ordinal(own(row, 'N_COLS'), 1, 32); ordinal(own(row, 'TYPE'), 0, 63); headers.set(id, row);
    }
    for (const row of input.nativeColumns) {
      const id = scalarText(row, 'ID'); if (!headers.has(id)) throw new EvidenceError('inconsistent', '原生列目录存在孤立 ID');
      const values = native.get(id) ?? []; values.push(row); native.set(id, values);
    }
    const rules = new Map<string, Row>(), logical = new Map<string, Row[]>();
    for (const row of input.rc) {
      const schema = name(row, 'CONSTRAINT_SCHEMA'), constraint = name(row, 'CONSTRAINT_NAME'), table = name(row, 'TABLE_NAME');
      const key = JSON.stringify([schema, table, constraint]); if (rules.has(key)) throw new EvidenceError('inconsistent', '逻辑规则目录身份重复'); rules.set(key, row);
      name(row, 'UNIQUE_CONSTRAINT_SCHEMA'); name(row, 'REFERENCED_TABLE_NAME');
      if (Object.hasOwn(row, 'UNIQUE_CONSTRAINT_NAME') && own(row, 'UNIQUE_CONSTRAINT_NAME') !== null) name(row, 'UNIQUE_CONSTRAINT_NAME');
      if (scalarText(row, 'MATCH_OPTION') !== 'NONE') throw new EvidenceError('inconsistent', '未证明 MATCH 属性不能纳入完整命名空间');
      action(row, 'UPDATE_RULE'); action(row, 'DELETE_RULE');
    }
    for (const row of input.kcu) {
      const schema = name(row, 'CONSTRAINT_SCHEMA'), table = name(row, 'TABLE_NAME'), constraint = name(row, 'CONSTRAINT_NAME');
      if (name(row, 'TABLE_SCHEMA') !== schema) throw new EvidenceError('inconsistent', 'KCU 表与约束库身份不一致');
      const key = JSON.stringify([schema, table, constraint]); if (!rules.has(key)) throw new EvidenceError('inconsistent', '逻辑字段目录不存在对应规则');
      const values = logical.get(key) ?? []; values.push(row); logical.set(key, values);
    }
    const used = new Set<string>(), entries: CanonicalNamespaceForeignKey[] = [];
    for (const [key, rule] of rules) {
      const child = { database: name(rule, 'CONSTRAINT_SCHEMA'), table: name(rule, 'TABLE_NAME') }, parent = { database: name(rule, 'UNIQUE_CONSTRAINT_SCHEMA'), table: name(rule, 'REFERENCED_TABLE_NAME') }, constraint = name(rule, 'CONSTRAINT_NAME');
      // 从逻辑 ASCII 身份构造预期值，再精确查 Map；绝不 split/substring opaque ID 或解码文件名。
      const id = child.database + '/' + constraint, header = headers.get(id), parts = native.get(id), mapped = logical.get(key);
      if (!header || !parts || !mapped || used.has(id) || scalarText(header, 'FOR_NAME') !== child.database + '/' + child.table || scalarText(header, 'REF_NAME') !== parent.database + '/' + parent.table) throw new EvidenceError('inconsistent', '原生与逻辑外键对象身份未形成唯一对应');
      const count = ordinal(own(header, 'N_COLS'), 1, 32);
      if (parts.length !== count || mapped.length !== count) throw new EvidenceError('inconsistent', '原生与逻辑字段数不一致或遗漏');
      const zero = kind === 'mysql8' ? 1 : 0;
      const ordered = [...parts].sort((a, b) => ordinal(own(a, 'POS'), zero, 32) - ordinal(own(b, 'POS'), zero, 32));
      const mappedOrdered = [...mapped].sort((a, b) => ordinal(own(a, 'ORDINAL_POSITION'), 1, 32) - ordinal(own(b, 'ORDINAL_POSITION'), 1, 32));
      const childColumns: string[] = [], parentColumns: string[] = [];
      for (let index = 0; index < count; index++) {
        const a = ordered[index], b = mappedOrdered[index];
        if (ordinal(own(a, 'POS'), zero, 32) !== index + zero || ordinal(own(b, 'ORDINAL_POSITION'), 1, 32) !== index + 1) throw new EvidenceError('inconsistent', '目录字段序号重复、缺失或基数错误');
        if (Object.hasOwn(b, 'POSITION_IN_UNIQUE_CONSTRAINT') && own(b, 'POSITION_IN_UNIQUE_CONSTRAINT') !== null) ordinal(own(b, 'POSITION_IN_UNIQUE_CONSTRAINT'), 1, 32);
        const childColumn = name(b, 'COLUMN_NAME'), parentColumn = name(b, 'REFERENCED_COLUMN_NAME');
        if (name(b, 'REFERENCED_TABLE_SCHEMA') !== parent.database || name(b, 'REFERENCED_TABLE_NAME') !== parent.table || name(a, 'FOR_COL_NAME') !== childColumn || name(a, 'REF_COL_NAME') !== parentColumn) throw new EvidenceError('inconsistent', '原生与逻辑目录有序映射不一致');
        childColumns.push(childColumn); parentColumns.push(parentColumn);
      }
      if (new Set(childColumns).size !== count || new Set(parentColumns).size !== count) throw new EvidenceError('inconsistent', '外键任一侧字段重复，不能证明映射');
      const onDelete = action(rule, 'DELETE_RULE'), onUpdate = action(rule, 'UPDATE_RULE'), type = ordinal(own(header, 'TYPE'), 0, 63);
      if (type !== actionType(onDelete, onUpdate)) throw new EvidenceError('inconsistent', '原生 TYPE 与逻辑动作不一致或含未知动作位');
      used.add(id); entries.push({ id, child, parent, name: constraint, childColumns, parentColumns, onUpdate, onDelete, type });
    }
    if (used.size !== headers.size || logical.size !== rules.size || native.size !== headers.size) throw new EvidenceError('inconsistent', '全局目录存在未解释占用、不可见规则或孤立记录');
    entries.sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
    const facts = { ...input.facts };
    return { kind: 'complete', facts, entries, digest: hash({ facts, entries }), bytes };
  } catch (error) {
    const value = error instanceof EvidenceError ? error : new EvidenceError('inconsistent', '外键目录无法可靠解释');
    return { kind: 'partial', reason: value.reason, warnings: [value.message], bytes };
  }
}

/** ASCII 值由 hex 常量传递；字符集/排序规则只能来自精确版本分支，不能接用户 SQL。 */
function literal(value: string, modern: boolean): string {
  return `CONVERT(X'${Buffer.from(value, 'ascii').toString('hex')}' USING ${modern ? 'utf8mb3' : 'latin1'}) COLLATE ${modern ? 'utf8mb3_general_ci' : 'latin1_swedish_ci'}`;
}
/** 有界交叉表只读比较：包括本批候选之间的比较，但排除候选自身。 */
export function planForeignKeyNameComparisons(evidence: ForeignKeyNamespaceEvidence, database: string, names: readonly string[]): ForeignKeyNameComparisonPlan {
  if (typeof database !== 'string' || !ascii.test(database) || !Array.isArray(names) || !names.length || names.length > 100) throw new Error('外键候选库名、名称或数量不符合受控 ASCII 预算');
  const candidates: string[] = [];
  for (let index = 0; index < names.length; index++) {
    const value = own(names, String(index));
    if (typeof value !== 'string' || !ascii.test(value) || candidates.includes(value)) throw new Error('外键候选名称必须是唯一的受控 ASCII 标识符');
    candidates.push(value);
  }
  if (evidence.kind !== 'complete') return { kind: 'unknown', candidates, reason: '全局外键命名空间尚未形成完整证据' };
  const modern = family(evidence.facts) === 'mysql8';
  const valueOf = (name: string) => modern ? name : database + '/' + name;
  const existing = evidence.entries.filter(entry => !modern || entry.child.database === database).map(entry => ({ value: modern ? entry.name : entry.id, ordinal: -1 }));
  const initial = new Map<string, 'available'>(), queries: ForeignKeyNameComparisonQuery[] = [];
  if (!existing.length && candidates.length === 1) { initial.set(candidates[0], 'available'); return { kind: 'ready', candidates, evidenceDigest: evidence.digest, initial, queries }; }
  const comparisons = [...existing, ...candidates.map((name, ordinal) => ({ value: valueOf(name), ordinal }))];
  let bytes = 0;
  for (let from = 0; from < candidates.length; from += 16) {
    const chosen = candidates.slice(from, from + 16), ordinals = chosen.map((_, index) => from + index);
    const candidateSql = chosen.map((name, index) => `SELECT ${from + index} AS candidateOrdinal, ${literal(valueOf(name), modern)} AS candidateValue`).join(' UNION ALL ');
    for (let start = 0; start < comparisons.length; start += 64) {
      const batch = comparisons.slice(start, start + 64);
      const existingSql = batch.map(entry => `SELECT ${entry.ordinal} AS candidateOrdinal, ${literal(entry.value, modern)} AS existingValue`).join(' UNION ALL ');
      const sql = `SELECT c.candidateOrdinal AS candidateOrdinal, MAX(IF(c.candidateOrdinal <> e.candidateOrdinal AND c.candidateValue = e.existingValue, 1, 0)) AS matched FROM (${candidateSql}) c CROSS JOIN (${existingSql}) e GROUP BY c.candidateOrdinal ORDER BY c.candidateOrdinal`;
      bytes += Buffer.byteLength(sql); if (bytes > foreignKeyNamespaceLimits.bytes) return { kind: 'unknown', candidates, reason: '名称比较 SQL 超过总字节预算' };
      queries.push({ id: `name-comparison-${queries.length}`, sql, candidateOrdinals: ordinals, existingCount: batch.length });
    }
  }
  return { kind: 'ready', candidates, evidenceDigest: evidence.digest, initial, queries };
}

/** 逐批、逐候选严格合并服务器 0/1；任何回复缺失/重复/越界均不能成为 available。 */
export function mergeForeignKeyNameComparisons(plan: ForeignKeyNameComparisonPlan, replies: readonly ForeignKeyNameComparisonReply[]): ReadonlyMap<string, ForeignKeyNameAvailability> {
  const result = new Map<string, ForeignKeyNameAvailability>(plan.candidates.map(name => [name, 'unknown']));
  if (plan.kind !== 'ready' || !Array.isArray(replies)) return result;
  const expected = new Map(plan.queries.map(query => [query.id, query])), received = new Map<string, ForeignKeyNameComparisonReply>();
  for (const reply of replies) {
    if (!reply || typeof reply !== 'object' || Reflect.ownKeys(reply).some(key => key !== 'id' && key !== 'rows')) return result;
    let id: unknown; try { id = own(reply, 'id'); } catch { return result; }
    if (typeof id !== 'string' || !expected.has(id) || received.has(id)) return result;
    received.set(id, reply);
  }
  const values = new Map<number, number[]>(), invalid = new Set<number>();
  for (const query of plan.queries) {
    const local = new Map<number, number>();
    try {
      const reply = received.get(query.id); if (!reply) throw new Error('缺少比较回复');
      const rows = own(reply, 'rows');
      if (!Array.isArray(rows) || rows.length !== query.candidateOrdinals.length) throw new Error('比较行数不一致');
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Reflect.ownKeys(row).some(key => key !== 'candidateOrdinal' && key !== 'matched')) throw new Error('比较回复含额外字段');
        const position = ordinal(own(row, 'candidateOrdinal'), 0, plan.candidates.length - 1), matched = own(row, 'matched');
        if (!query.candidateOrdinals.includes(position) || local.has(position) || ![0, 1, '0', '1'].includes(matched as number)) throw new Error('比较序号或0/1结果无效');
        local.set(position, Number(matched));
      }
      for (const position of query.candidateOrdinals) { if (!local.has(position)) throw new Error('缺少比较候选'); const list = values.get(position) ?? []; list.push(local.get(position)!); values.set(position, list); }
    } catch { query.candidateOrdinals.forEach(position => invalid.add(position)); }
  }
  for (const [index, name] of plan.candidates.entries()) {
    if (invalid.has(index)) continue;
    const list = values.get(index);
    if (list?.length) result.set(name, list.some(value => value === 1) ? 'conflict' : 'available');
    else if (plan.initial.get(name) === 'available') result.set(name, 'available');
  }
  return result;
}
