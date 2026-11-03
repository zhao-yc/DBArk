import type { FieldPacket, Query } from 'mysql2';
import type { ManagedConnection } from './connection';
import { sessionObjectIdentity } from './sessionObjectRead';
import { objectDefinitionDdl, objectDefinitionIdentifier, objectDefinitionLimits, type ObjectDefinitionInput, type ObjectDefinitionOutput } from '../shared/objectDefinition';

export interface ObjectDefinitionControl { start(): void; check(): void; finish(): Promise<void>; }

/** 每段分别反引号编码，名称中的点、反引号和SQL正文都只能成为一个名称。 */
export function objectDefinitionSql(database: string, table: string): string {
  if (!objectDefinitionIdentifier(database) || !objectDefinitionIdentifier(table)) throw Error('对象定义名称无效');
  const quote = (name: string) => '`' + name.replaceAll('`', '``') + '`';
  return 'SHOW CREATE TABLE ' + quote(database) + '.' + quote(table);
}

/** 只收一条完整SHOW行；超限后丢弃内容但仍等待驱动真实终态，不在原会话发送附加SQL。 */
export async function readObjectDefinition(managed: ManagedConnection, request: ObjectDefinitionInput, database: string, control: ObjectDefinitionControl): Promise<ObjectDefinitionOutput> {
  const sql = objectDefinitionSql(database, request.table);
  control.check(); control.start();
  let row: Record<string, unknown> | undefined;
  let failure: Error | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false, count = 0, fields: FieldPacket[] | undefined;
      /** 原查询、连接终态负责释放占位，预算失败不会提前放开同一物理连接。 */
      function done(error?: Error): void {
        if (settled) return; settled = true;
        managed.connection.removeListener('error', failed); managed.connection.removeListener('end', ended);
        managed.signal?.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      }
      function failed(error: Error): void { done(error); }
      function ended(): void { done(Error('对象定义连接在读取完成前断开')); }
      function aborted(): void { done(Error('对象定义连接已在取消收尾阶段终止')); }
      managed.connection.once('error', failed); managed.connection.once('end', ended);
      // 控制器只在KILL原命令终态后，或本地销毁并保留失败资源账本后终止signal。
      managed.signal?.addEventListener('abort', aborted, { once: true });
      let query: Query;
      try { query = managed.connection.query({ sql, rowsAsArray: true }); }
      catch (error) { done(error instanceof Error ? error : Error('对象定义读取未能开始')); return; }
      query.on('fields', (value: FieldPacket[] | undefined) => {
        if (!value || fields || value.length < 2 || value.length > 4 || value.some(field => typeof field.name !== 'string' || field.name.length > 512) || new Set(value.map(field => field.name)).size !== value.length) failure = Error('对象定义字段格式无效');
        else fields = value;
      });
      query.on('result', (raw: unknown) => {
        if (settled || failure) return;
        if (++count !== 1 || !Array.isArray(raw) || !fields || raw.length !== fields.length) { failure = Error('对象定义没有唯一完整行'); row = undefined; return; }
        let bytes = 0;
        for (const cell of raw) {
          if (typeof cell !== 'string') { failure = Error('对象定义单元格格式无效'); break; }
          bytes += Buffer.byteLength(cell);
          if (bytes > objectDefinitionLimits.rowBytes) { failure = Error('对象完整定义超过读取预算'); break; }
        }
        if (!failure) row = Object.fromEntries(fields.map((field, index) => [field.name, raw[index]]));
      });
      query.once('error', failed).once('end', () => done());
    });
    control.check();
    if (failure) throw failure;
    if (!row) throw Error('服务器未返回完整对象定义');
    const identity = sessionObjectIdentity(row);
    const definitions = Object.entries(row).filter(([key]) => ['create table', 'create view'].includes(key.toLowerCase()));
    const ddl = definitions[0]?.[1];
    if (!objectDefinitionDdl(ddl)) throw Error('对象完整定义含无效Unicode或超过2MiB预算');
    if (identity === 'temporary' && !request.sessionId) throw Error('独立读取不能确认原查询的临时表');
    const objectName = Object.entries(row).find(([key]) => key.toLowerCase() === (identity === 'view' ? 'view' : 'table'))?.[1];
    if (!objectDefinitionIdentifier(objectName)) throw Error('服务器未返回有效对象名称');
    const caseMode = managed.sessionObjects?.caseMode;
    if (caseMode ? objectName.toLowerCase() !== request.table.toLowerCase() : objectName !== request.table) throw Error('服务器对象名称与原请求不符');
    // 名称大小写由服务器目录规则决定，响应保留用户原目标，不以独立目录覆盖临时对象。
    return { request: { ...request }, database, name: request.table, kind: identity === 'view' ? 'view' : 'table', temporary: identity === 'temporary', ddl, ...(request.sessionId && managed.sessionObjects ? { revision: managed.sessionObjects.revision } : {}) };
  } finally { await control.finish(); }
}
