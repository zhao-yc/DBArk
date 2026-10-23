import type { ManagedConnection } from '../../src/engine/connection';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from './tableValueOptionsIntegration';

/** 本专项固定模板的独立词法审计；引号内JSON/关键字只是值，不会被误当副作用SQL。 */
export function tableFilteredExportSqlTokens(sql: string, mode = ''): string {
  if (typeof sql !== 'string' || !sql || sql.length > 2 * 1024 * 1024) throw Error('筛选导出审计SQL无效或超限');
  const noBackslash = mode.split(',').includes('NO_BACKSLASH_ESCAPES'), ansi = mode.split(',').includes('ANSI_QUOTES'), tokens: string[] = [];
  for (let index = 0; index < sql.length;) {
    const char = sql[index]; if (/\s/.test(char)) { index++; continue; }
    if (char === ';' || char === '#' || sql.startsWith('--', index) || sql.startsWith('/*', index)) throw Error('筛选导出审计拒绝多语句或注释');
    if (char === "'" || char === '"' || char === '`') {
      const identifier = char === '`' || char === '"' && ansi, start = index++; let closed = false, value = '';
      while (index < sql.length) {
        const next = sql[index++];
        if (next === char) { if (sql[index] === char) { value += char; index++; } else { closed = true; break; } }
        else if (next === '\\' && !noBackslash && !identifier) { if (index >= sql.length) throw Error('筛选导出审计字符串未闭合'); value += '\\' + sql[index++]; }
        else value += next;
      }
      if (!closed || index === start + 1) throw Error('筛选导出审计引用未闭合');
      tokens.push((identifier ? 'I:' : 'S:') + JSON.stringify(value)); continue;
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(sql.slice(index));
    if (word) { const value = word[0].toUpperCase(); if (['INTO', 'OUTFILE', 'DUMPFILE', 'GET_LOCK', 'RELEASE_LOCK', 'SLEEP', 'BENCHMARK'].includes(value)) throw Error('筛选导出审计拒绝SQL副作用'); tokens.push('W:' + value); index += word[0].length; continue; }
    if (!/[0-9.,?@=<>!()+*\-]/.test(char)) throw Error('筛选导出审计存在未知SQL符号');
    tokens.push(char); index++;
  }
  if (!tokens.length) throw Error('筛选导出审计缺少语句'); return JSON.stringify(tokens);
}

const columns = ['id', 'label', 'big_value', 'amount', 'at_value', 'payload', 'bit_value', 'approx_value', 'json_value', 'computed'];
const metadata = [
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];
const controls = ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY', 'ROLLBACK AND NO CHAIN NO RELEASE'];
type Params = readonly unknown[];
/** 只接受本轮三对象和固定合成谓词；模板由测试独立列举，不使用产品SQL生成器自证。 */
export function createTableFilteredExportSqlAudit(input: { database: string; fixtureStatements: readonly string[]; fixtureWrites: ReadonlySet<string>; isOwnedThread(id: number): boolean }) {
  if (!/^dbark_filteredexport_[a-f0-9]{32}$/.test(input.database)) throw Error('筛选导出审计缺少准确随机库');
  const database = input.database, db = '`' + database + '`', fixture = new Set(input.fixtureStatements), exact = new Map<string, { params(values: Params): boolean; scopes: readonly string[] }>();
  const key = (sql: string) => tableFilteredExportSqlTokens(sql), none = (values: Params) => values.length === 0;
  const add = (sql: string, params: (values: Params) => boolean = none, scopes: readonly string[] = ['table.exportFiltered']) => exact.set(key(sql), { params, scopes });
  const scalar = (value: string) => "_utf8mb4 X'" + Buffer.from(value).toString('hex') + "'", converted = (value: string) => "CONVERT(X'" + Buffer.from(value).toString('hex') + "' USING utf8mb4)";
  const targetParams = (values: Params) => values.length === 2 && values[0] === database && ['subject', 'subject_view'].includes(String(values[1]));
  for (const statement of metadata) add(statement, targetParams, ['metadata.table']);
  for (const table of ['subject', 'subject_view']) {
    const target = db + '.`' + table + '`';
    add(`SHOW CREATE ${table === 'subject' ? 'TABLE' : 'VIEW'} ${target}`, none, ['metadata.table', 'table.exportFiltered']);
    add(`SELECT 1 FROM ${target} LIMIT 0`);
    add(`SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${converted(database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${converted(table)} AS BINARY) LIMIT 2`);
    for (const statement of metadata) { const values = [scalar(database), scalar(table)]; let index = 0; add(statement.replace(/\?/g, () => values[index++]) + ' LIMIT 4097'); }
  }
  for (const statement of [...controls, 'SELECT @@SESSION.sql_mode AS sqlMode', 'SELECT @@SESSION.sql_mode AS mode LIMIT 4097', 'SHOW WARNINGS LIMIT 21']) add(statement);
  add('SELECT @@SESSION.sql_mode AS mode', none, ['metadata.table']);
  const projection = (generated: boolean) => columns.filter(column => generated || column !== 'computed').map(column => '`' + column + '`').join(', ');
  const range = "(((`id` >= CAST(_utf8mb4 X'31' AS DECIMAL(65,0)))) AND (`id` <= CAST(_utf8mb4 X'31313035' AS DECIMAL(65,0))))";
  const empty = "((`id` < CAST(_utf8mb4 X'30' AS DECIMAL(65,0))))", view = "((`label` IN (_utf8mb4 X'414c504841')))";
  for (const generated of [true, false]) {
    add(`SELECT ${projection(generated)} FROM ${db}.\`subject\` WHERE ${range} ORDER BY \`label\` ASC, \`id\` DESC`);
    add(`SELECT ${projection(generated)} FROM ${db}.\`subject\` WHERE ${empty} ORDER BY \`label\` ASC, \`id\` DESC`);
    add(`SELECT ${projection(generated)} FROM ${db}.\`subject_view\` WHERE ${view} ORDER BY \`label\` ASC, \`id\` DESC`);
  }
  const observer = new Map<string, (values: Params) => boolean>(), observe = (sql: string, params: (values: Params) => boolean = none) => observer.set(key(sql), params);
  observe('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'); observe('SELECT @@server_uuid AS uuid');
  observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', values => values.length === 1 && values[0] === database);
  observe('SHOW CREATE TABLE ' + db + '.`subject`'); observe('SELECT * FROM ' + db + '.`subject` WHERE id>=? ORDER BY label ASC,id DESC', values => values.length === 1 && values[0] === 1); observe('SELECT marker FROM ' + db + '.`__owner`');
  observe('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', values => values.length === 1 && values[0] === database);
  for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) observe('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', values => values.length === 1 && values[0] === database);
  observe('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', values => values.length === 1 && values[0] === database);
  observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', values => values.length === 1 && typeof values[0] === 'number' && Number.isSafeInteger(values[0]) && values[0] > 0 && input.isOwnedThread(values[0]));
  return {
    /** 原观察连接写入只认可预先构造且当前逐条登记的精确fixture语句。 */
    assert(sql: string, values: Params, scope: string, mode = ''): void {
      if (!Array.isArray(values)) throw Error('筛选导出审计参数不是原数组');
      if (Reflect.ownKeys(values).length !== values.length + 1) throw Error('筛选导出审计参数必须是稠密自有数据');
      for (let index = 0; index < values.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(values, String(index)) ?? {}, 'value')) throw Error('筛选导出审计参数必须是稠密自有数据');
      if (scope === 'observer' && fixture.has(sql) && input.fixtureWrites.has(sql) && !values.length) return;
      const fingerprint = tableFilteredExportSqlTokens(sql, mode);
      if (scope === 'observer') {
        if (observer.get(fingerprint)?.(values)) return;
      } else {
        const purpose = /^(metadata\.table|table\.exportFiltered):/.exec(scope)?.[1], rule = exact.get(fingerprint);
        if (purpose && rule?.scopes.includes(purpose) && rule.params(values)) return;
      }
      throw Error('筛选导出发送了本轮未登记的SQL模板、参数或目标');
    },
  };
}

/** 独立窄审计包裹原mysql2端口，保留原返回命令/回调/真实end与物理stream证据。 */
export function watchTableFilteredExportConnection(managed: ManagedConnection, scope: string, owner: TableValueOptionsLifetime, policy: ReturnType<typeof createTableFilteredExportSqlAudit>): TableValueOptionsConnectionFact {
  const native = managed.connection as any, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('筛选导出原物理连接身份未知');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: TableValueOptionsConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, commands: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check();
      try {
        if (managed.connection !== native || native.stream !== stream || native.threadId !== fact.id) throw Error('筛选导出原物理连接漂移');
        const input = args[0], sql = typeof input === 'string' ? input : input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'sql')?.value : undefined;
        const valuesDescriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'values') : undefined;
        if (valuesDescriptor && !Object.hasOwn(valuesDescriptor, 'value')) throw Error('筛选导出原参数不能是访问器');
        const explicit = valuesDescriptor?.value;
        const values = explicit ?? (Array.isArray(args[1]) ? args[1] : []);
        if (typeof sql !== 'string') throw Error('筛选导出原SQL不是自有文字'); policy.assert(sql, values, scope, managed.sqlMode);
        const callback = args.at(-1), streamed = typeof callback !== 'function', command = { sql, method, streamed, callbackReturned: streamed, terminal: false }; fact.commands.push(command); fact.pending++;
        let settled = false; const finish = () => { if (!settled && command.callbackReturned && command.terminal) { settled = true; fact.pending--; } };
        if (!streamed) args[args.length - 1] = function (this: unknown, ...result: unknown[]) { try { return (callback as (...values: unknown[]) => unknown).apply(this, result); } finally { command.callbackReturned = true; finish(); } };
        const result = original.apply(native, args); if (!result || typeof result.once !== 'function') throw Error('筛选导出原命令缺少可观察end'); result.once('end', () => { command.terminal = true; finish(); }); return result;
      } catch (reason) { owner.stop(); throw reason; }
    };
  }
  const originalClose = managed.close.bind(managed);
  managed.close = async options => { fact.closeCalls++; fact.strict = options?.strict === true; try { await originalClose(options); fact.closeReturned = true; } catch (reason) { fact.closeFailed = true; throw reason; } };
  return fact;
}

/** 每次原迭代器next均单独跨原owner门，不把整个CSV/XLSX循环包成一次宽泛await。 */
export async function collectTableFilteredExportRows<T>(source: AsyncIterable<T>, owner: Pick<TableValueOptionsLifetime, 'check' | 'step'>): Promise<T[]> {
  owner.check(); const iterator = source[Symbol.asyncIterator](), rows: T[] = [];
  for (;;) { const next = await owner.step(() => iterator.next()); owner.check(); if (next.done) return rows; rows.push(next.value); }
}
