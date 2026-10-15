import { createServer, type AddressInfo, type Socket } from 'node:net';
import mysql from 'mysql2';

/** 离线协议夹具只监听回环临时端口；真实驱动/主进程/IPC 执行生产代码，不代表实库验收。 */
export async function comparisonProtocol() {
  const sockets = new Map<number, Socket>(), queries: string[] = [];
  let nextId = 100, held: (() => void) | undefined, holdNext = false, denyCancel = false;
  const server = createServer(socket => {
    const id = ++nextId; sockets.set(id, socket); socket.on('close', () => sockets.delete(id));
    const connection = mysql.createConnection({ stream: socket, isServer: true, connectTimeout: 0 }) as ReturnType<typeof mysql.createConnection> & { _resetSequenceId(): void; writeColumns(columns: unknown[]): void; writeTextRow(row: unknown[]): void; writeEof(): void; };
    connection.on('error', error => queries.push('夹具协议错误：' + String(error)));
    let quoted = 0, charset = 'utf8mb4', collation = 'utf8mb4_general_ci';
    /** 手工写协议行，避免测试服务器辅助函数改变空值或精度。 */
    const rows = (values: Record<string, unknown>[]) => {
      const names = Object.keys(values[0] ?? { empty: '' });
      connection.writeColumns(names.map(name => ({ name, columnType: mysql.Types.VAR_STRING, characterSet: 45, columnLength: 4096, flags: 0, decimals: 0, catalog: 'def', schema: '', table: '', orgTable: '', orgName: '' })));
      for (const value of values) connection.writeTextRow(names.map(name => value[name] === null ? null : String(value[name])));
      connection.writeEof(); connection._resetSequenceId();
    };
    const ok = () => { connection.writeOk(); connection._resetSequenceId(); };
    const handle = (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('KILL CONNECTION')) {
        if (denyCancel) { connection.writeError({ code: 1227, message: '离线夹具拒绝取消权限' }); connection._resetSequenceId(); return; }
        sockets.get(Number(sql.split(' ').at(-1)))?.destroy(); ok(); return;
      }
      if (sql.startsWith('SELECT VERSION()')) { rows([{ version: '8.4.11', sqlMode: '', currentDatabase: null, identifierCase: '0' }]); return; }
      if (sql.includes('@@hostname')) { rows([{ sqlMode: '', hostname: '离线协议夹具', port: '3306', serverId: '1', currentUser: 'test@localhost', connectionId: String(id) }]); return; }
      if (sql.includes('AS quoteShowCreate')) { rows([{ sqlMode: '', quoteShowCreate: quoted, charset, collation }]); return; }
      if (sql.includes('@@server_uuid')) { rows([{ uuid: 'offline-protocol' }]); return; }
      if (sql.includes(' AS visible')) { rows([{ visible: '1' }]); return; }
      if (sql.startsWith('SHOW CREATE')) {
        const source = sql.includes('`source`'), name = source ? 'source' : 'target';
        const reply = () => rows([{ Table: name, 'Create Table': `CREATE TABLE \`${name}\` (\`id\` int${source ? ",\`extra\` decimal(30,8) DEFAULT 1234567890123456789012.12345678,KEY \`extra_idx\` (\`extra\`)" : ''}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` }]);
        if (holdNext) { holdNext = false; held = reply; } else reply(); return;
      }
      if (sql.includes('FROM information_schema.TABLES')) { rows([{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }]); return; }
      if (sql.includes('FROM information_schema.COLUMNS')) {
        const source = sql.includes(Buffer.from('source').toString('hex'));
        rows((source ? ['id', 'extra'] : ['id']).map(name => ({ name, nullable: 'YES', extra: '', charset: null, collation: null }))); return;
      }
      if (sql.startsWith('SET ')) { if (sql.includes('sql_quote_show_create')) quoted = 1; if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; } ok(); return; }
      connection.writeError({ code: 1142, message: '离线夹具拒绝未定义或写入命令' });
    };
    connection.on('query', handle); connection.on('stmt_prepare', handle);
    connection.serverHandshake({ protocolVersion: 10, serverVersion: '8.4.11', connectionId: id, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088200, authCallback(_params: unknown, done: () => void) { done(); connection._resetSequenceId(); } });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: (server.address() as AddressInfo).port, queries, hold() { holdNext = true; }, denyCancellation() { denyCancel = true; }, get waiting() { return !!held; }, get active() { return sockets.size; },
    async close() { for (const socket of sockets.values()) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
