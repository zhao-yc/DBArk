import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { sqliteCompletionLimits, sqliteCompletionOutputSchema, type SqliteCompletionEntry, type SqliteCompletionLookup, type SqliteCompletionOutput } from '../shared/sqliteCompletion';

interface CompletionControl { check(): void; sessionRevision?: number; }
/** 元数据读完和取消检查共用原driver，绝不创建查询任务、触碰事务边界或读取用户行值。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], control: CompletionControl, maxRows: number): Promise<{ rows: SqliteValue[][]; truncated: boolean }> {
  control.check(); const rows: SqliteValue[][] = [];
  // 原会话消费者不能抛取消异常：driver会把消费者失败翻译为interrupt；仅在完整短读终态后检查边界。
  const result = await driver.execute(sql, { parameters, maxRows, maxBytes: sqliteCompletionLimits.outputBytes, onBatch: batch => { rows.push(...batch.rows); } });
  control.check();
  if (result.statements.length !== 1) throw Error('SQLite补全固定读取未返回准确单语句终态');
  return { rows, truncated: result.statements.some(statement => statement.truncated) };
}
/** 原生schema cookie取前后两次；目录变化必须由调用方重新请求，不发布混合目录。 */
async function stamp(driver: SqliteDriverSession, control: CompletionControl): Promise<string> {
  const values: string[] = [];
  for (const schema of ['main', 'temp'] as const) {
    const result = await read(driver, 'PRAGMA ' + schema + '.schema_version', [], control, 1), value = result.rows[0]?.[0];
    if (result.truncated || result.rows.length !== 1 || !value || typeof value !== 'object' || value.type !== 'integer' || !/^-?\d{1,10}$/.test(value.value)) throw Error('SQLite补全schema版本无效');
    values.push(value.value);
  }
  return values.join(':');
}
/** 前缀用substr与绑定参数作字面比较；百分号、下划线及引号均没有模式或SQL语义。 */
const prefixSql = 'substr(name,1,length(?)) = ? COLLATE NOCASE';
const visibleSql = "type IN ('table','view','virtual') AND substr(name,1,7) COLLATE NOCASE <> 'sqlite_'";
/** 仅暴露main/temp用户关系；table_list的shadow标记不能靠名称猜测，temp命名空间优先遮蔽main。 */
export async function readSqliteCompletion(driver: SqliteDriverSession, input: SqliteCompletionLookup, control: CompletionControl): Promise<SqliteCompletionOutput> {
  const before = await stamp(driver, control), entries: SqliteCompletionEntry[] = []; let incomplete = false;
  let bytes = Buffer.byteLength(JSON.stringify({ entries: [], incomplete: false, stamp: before, ...(control.sessionRevision === undefined ? {} : { sessionRevision: control.sessionRevision }) }));
  /** 输出包装与UTF8转义也计入预算；字节先满时明确incomplete，不截断任何字段或谎报完整。 */
  const append = (entry: SqliteCompletionEntry): boolean => {
    const size = Buffer.byteLength(JSON.stringify(entry)) + (entries.length ? 1 : 0);
    if (bytes + size > sqliteCompletionLimits.outputBytes) { incomplete = true; return false; }
    bytes += size; entries.push(entry); return true;
  };
  if (input.kind === 'relations') {
    const scope = input.schema ? 'schema = ?' : "schema IN ('main','temp') AND (schema = 'temp' OR NOT EXISTS (SELECT 1 FROM pragma_table_list() t WHERE t.schema = 'temp' AND t.name = p.name COLLATE NOCASE))";
    const result = await read(driver, 'SELECT name,type,schema FROM pragma_table_list() p WHERE ' + scope + ' AND ' + visibleSql + ' AND ' + prefixSql + " ORDER BY schema DESC,name COLLATE NOCASE,name LIMIT 257", [...(input.schema ? [input.schema] : []), input.prefix, input.prefix], control, 257);
    incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
    for (const row of result.rows.slice(0, sqliteCompletionLimits.entries)) {
      if (typeof row[0] !== 'string' || !['table', 'view', 'virtual'].includes(row[1] as string) || !['main', 'temp'].includes(row[2] as string)) throw Error('SQLite补全关系目录无效');
      if (!append({ name: row[0], kind: row[1] === 'view' ? 'view' : 'table', schema: row[2] as 'main' | 'temp' })) break;
    }
  } else if (input.kind === 'columns') {
    // 先按原生命名空间规则定位，排除系统及shadow后才读取xinfo；显式schema永不查另一库。
    const scope = input.schema ? 'schema = ?' : "schema IN ('main','temp')";
    const found = await read(driver, 'SELECT name,schema,type FROM pragma_table_list() WHERE ' + scope + " AND name = ? COLLATE NOCASE ORDER BY schema DESC LIMIT 1", [...(input.schema ? [input.schema] : []), input.table], control, 1);
    const target = found.rows[0];
    if (target && typeof target[0] === 'string' && !/^sqlite_/i.test(target[0]) && ['table', 'view', 'virtual'].includes(target[2] as string)) {
      const schema = target[1]; if (schema !== 'main' && schema !== 'temp') throw Error('SQLite补全字段所属库无效');
      const result = await read(driver, 'SELECT name,type,hidden FROM pragma_table_xinfo(?,?) WHERE ' + prefixSql + ' ORDER BY cid LIMIT 257', [target[0], schema, input.prefix, input.prefix], control, 257);
      incomplete = result.truncated || result.rows.length > sqliteCompletionLimits.entries;
      for (const row of result.rows.slice(0, sqliteCompletionLimits.entries)) {
        const hidden = row[2];
        if (typeof row[0] !== 'string' || typeof row[1] !== 'string' || !hidden || typeof hidden !== 'object' || hidden.type !== 'integer' || !['0', '1', '2', '3'].includes(hidden.value)) throw Error('SQLite补全字段目录无效');
        if (!append({ name: row[0], kind: 'column', schema, table: target[0], declaredType: row[1], generated: hidden.value === '2' || hidden.value === '3', hidden: hidden.value === '1' })) break;
      }
    }
  }
  const after = await stamp(driver, control); control.check();
  if (before !== after) throw Error('SQLite目录在补全读取期间变化，请重新触发');
  return sqliteCompletionOutputSchema.parse({ entries, incomplete, stamp: after, ...(control.sessionRevision === undefined ? {} : { sessionRevision: control.sessionRevision }) });
}
