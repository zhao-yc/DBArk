import { TextDecoder } from 'node:util';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { objectDefinitionOutputSchema, type ObjectDefinitionInput, type ObjectDefinitionOutput } from '../shared/objectDefinition';

const definitionBytes = 2 * 1024 * 1024;
const chunkBytes = 256 * 1024;
interface DefinitionControl { check(): void; revision?: number; }

/** 输入为已解码标识符；只折叠SQLite原生ASCII大小写，不解释SQL引用、路径或附加库。 */
export function sqliteObjectDefinitionDatabase(database: string | undefined): 'main' | 'temp' | undefined {
  if (database === undefined) return undefined;
  const value = database.replace(/[A-Z]/g, character => character.toLowerCase());
  if (value !== 'main' && value !== 'temp') throw Error('SQLite对象定义只允许main或temp数据库');
  return value;
}

/** 固定短读必须完整终态后才检查取消；消费者不抛异常，避免中断借用的用户事务。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], control: DefinitionControl): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: 2, maxBytes: 2 * 1024 * 1024, onBatch: batch => { rows.push(...batch.rows); } });
  control.check();
  if (result.statements.length !== 1 || result.statements[0].truncated || rows.length > 1) throw Error('SQLite对象定义读取未返回完整准确终态');
  return rows;
}

/** BLOB来自原生目录，按数据库声明编码严格解码，不能将非法字节替换为相似文本。 */
function decode(value: SqliteValue | undefined, encoding: string): string {
  if (!value || typeof value !== 'object' || value.type !== 'binary') throw Error('SQLite对象定义目录编码无效');
  try { return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(Buffer.from(value.base64, 'base64')); }
  catch { throw Error('SQLite对象定义含无效文本编码，未返回替换或截断内容'); }
}

/** schema只来自main/temp白名单；对象名及分块偏移全部绑定，不拼接任何用户标识符。 */
async function stamp(driver: SqliteDriverSession, schema: 'main' | 'temp', control: DefinitionControl): Promise<string> {
  const value = (await read(driver, 'PRAGMA ' + schema + '.schema_version', [], control))[0]?.[0];
  if (!value || typeof value !== 'object' || value.type !== 'integer' || !/^-?\d{1,10}$/.test(value.value)) throw Error('SQLite对象定义目录版本无效');
  return value.value;
}

/** 原session沿用已有事务；仅独立物理只读连接建立并回滚自己的准确目录快照。 */
export async function readSqliteObjectDefinition(driver: SqliteDriverSession, input: ObjectDefinitionInput, control: DefinitionControl): Promise<ObjectDefinitionOutput> {
  const database = sqliteObjectDefinitionDatabase(input.database);
  if (!input.sessionId && database === 'temp') throw Error('SQLite临时对象必须从原查询会话读取');
  let began = false, failed = false, failure: unknown, output: ObjectDefinitionOutput | undefined;
  try {
    if (!input.sessionId) { if (!driver.readOnly) throw Error('SQLite独立对象定义读取要求物理只读连接'); began = true; await read(driver, 'BEGIN', [], control); }
    const encodingValue = (await read(driver, 'PRAGMA encoding', [], control))[0]?.[0];
    const encoding = encodingValue === 'UTF-8' ? 'utf-8' : encodingValue === 'UTF-16le' ? 'utf-16le' : encodingValue === 'UTF-16be' ? 'utf-16be' : undefined;
    if (!encoding) throw Error('SQLite对象定义数据库编码未知');
    const schemas: ('main' | 'temp')[] = database ? [database] : input.sessionId ? ['temp', 'main'] : ['main'];
    const versions: [schema: 'main' | 'temp', version: string][] = [];
    for (const schema of schemas) versions.push([schema, await stamp(driver, schema, control)]);
    let target: { schema: 'main' | 'temp'; name: string; kind: 'table' | 'view'; bytes: number } | undefined;
    for (const schema of schemas) {
      const row = (await read(driver, 'SELECT CAST(name AS BLOB),type,length(CAST(sql AS BLOB)) FROM ' + schema + ".sqlite_schema WHERE name = ? COLLATE NOCASE ORDER BY CASE WHEN type IN ('table','view') THEN 0 ELSE 1 END LIMIT 1", [input.table], control))[0];
      if (!row) continue;
      const name = decode(row[0], encoding), kind = row[1], size = row[2];
      if (kind !== 'table' && kind !== 'view') throw Error('SQLite对象定义只支持表和视图，索引及触发器不能作为目标');
      if (!size || typeof size !== 'object' || size.type !== 'integer' || !/^\d+$/.test(size.value) || Number(size.value) === 0) throw Error('SQLite系统对象没有可读取的完整SQL定义');
      // UTF16的ASCII原文可能占用两倍磁盘字节，公共2MiB预算仍按最终UTF8完整DDL检查。
      const bytes = Number(size.value); if (bytes > definitionBytes * (encoding === 'utf-8' ? 1 : 2)) throw Error('SQLite对象定义超过2MiB，未截断返回');
      target = { schema, name, kind, bytes }; break;
    }
    if (!target) {
      if (/^sqlite_(?:schema|master|temp_schema|temp_master)$/i.test(input.table)) throw Error('SQLite系统对象没有可读取的完整SQL定义');
      throw Error('SQLite原目录中不存在指定表或视图');
    }
    const chunks: Buffer[] = [];
    // 每个原生单值不超过256KiB；完整DDL按字节拼接后统一严格解码，允许多字节字符跨块。
    for (let offset = 1; offset <= target.bytes; offset += chunkBytes) {
      const value = (await read(driver, 'SELECT substr(CAST(sql AS BLOB),?,?) FROM ' + target.schema + '.sqlite_schema WHERE name = ? COLLATE BINARY AND type = ?', [offset, chunkBytes, target.name, target.kind].map(value => typeof value === 'number' ? { type: 'integer' as const, value: String(value) } : value), control))[0]?.[0];
      if (!value || typeof value !== 'object' || value.type !== 'binary') throw Error('SQLite对象定义分块目录已失效');
      const chunk = Buffer.from(value.base64, 'base64'); if (chunk.length !== Math.min(chunkBytes, target.bytes - offset + 1)) throw Error('SQLite对象定义分块不完整'); chunks.push(chunk);
    }
    const ddl = decode({ type: 'binary', base64: Buffer.concat(chunks).toString('base64') }, encoding);
    if (ddl.includes('\0') || Buffer.byteLength(ddl, 'utf8') > definitionBytes) throw Error('SQLite对象定义包含无效NUL或超过2MiB，未返回部分内容');
    for (const [schema, version] of versions) if (await stamp(driver, schema, control) !== version) throw Error('SQLite目录在对象定义读取期间变化，请重新请求');
    control.check();
    output = objectDefinitionOutputSchema.parse({ request: input, database: target.schema, name: target.name, kind: target.kind, temporary: target.schema === 'temp', ddl, ...(control.revision === undefined ? {} : { revision: control.revision }) });
  } catch (reason) { failed = true; failure = reason; }
  if (began && driver.isUsable && driver.transaction) {
    // 取消后仍必须回滚自己的快照；借用原session的分支永远不会进入此路径。
    try { const result = await driver.execute('ROLLBACK', { parameters: [], maxRows: 1 }); if (result.statements.length !== 1 || result.transaction) throw Error('SQLite对象定义独立快照回滚未确认'); }
    catch (reason) { failure = failed ? new AggregateError([failure, reason], 'SQLite对象定义读取及独立快照回滚失败') : reason; failed = true; }
  }
  if (failed) throw failure; control.check(); return output!;
}
