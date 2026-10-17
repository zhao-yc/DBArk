import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { IndexPatch } from '../../src/shared/tableIndexPatches';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import { assertPrefixReleased, bindFixedPrefixTarget, finishFixedPrefix, isPrefixDuplicate, watchPrefixConnection, type FixedPrefixCase, type FixedPrefixOwner, type PrefixConnectionFact } from '../helpers/indexFixedPrefixCore';

/** 每次只运行一个准确端口的一个case；模块被真正list收集时完全不会导入。 */
export async function runFixedPrefixCase(kind: FixedPrefixCase, owner: FixedPrefixOwner) {
  owner.check(); const binding = bindFixedPrefixTarget(() => process.env), facts: PrefixConnectionFact[] = [];
  owner.bind(() => {
    binding.assertCurrent();
    for (const fact of facts) if (fact.managed.connection !== fact.native || fact.native.stream !== fact.stream || fact.native.threadId !== fact.threadId || fact.managed.profile.id !== fact.profileId) throw Error('前缀case已捕获的原生归属变化');
  });
  const target = binding.target, connectionId = randomUUID(), schema = 'dbark_fixed_prefix_' + randomUUID().replaceAll('-', ''), table = 'prefix_core';
  try {
  const quoted = '`' + schema + '`.`' + table + '`';
  const profile: ConnectionProfile = { id: connectionId, name: '固定前缀本例连接', group: '', color: '#123456', dialect: target.dialect, host: target.host, port: target.port, user: target.user, password: target.password,
    ...(target.tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: target.ca } } : {}) };
  /** 原始配置与每次实际交给connect的profile精确一致，不能只核profile.id。 */
  const assertProfile = (actual: ConnectionProfile) => {
    owner.check();
    if (actual.id !== connectionId || actual.host !== target.host || actual.port !== target.port || actual.dialect !== target.dialect || actual.user !== target.user || actual.password !== target.password || actual.ssh || (target.tls ? actual.tls?.enabled !== true || actual.tls.rejectUnauthorized !== true || actual.tls.caPath !== target.ca || actual.tls.certPath || actual.tls.keyPath : actual.tls !== undefined)) throw Error('前缀case实际连接与本轮显式profile不一致');
  };
  assertProfile(profile);
  // 仅显式开启后才导入真实连接实现；不读.env，不配置SSH，不提供默认认证。
  const connectionModule = await owner.run(() => import('../../src/engine/connection'));
  const realConnect = connectionModule.connect;
  let activeTask: string | undefined, schemaAck = false, fingerprint: string | undefined;
  const events: TaskEvent[] = [], expectedTasks = new Map<string, 'completed' | 'blocked' | 'duplicate'>();
  const run = <T>(action: () => Promise<T>) => owner.run(action);
  const observe = (connection: ManagedConnection, sql: string, params: (string | number)[] = []) => connectionModule.execute<Record<string, unknown>[]>(connection, sql, params).then(value => value.rows);
  /** 只读事实先于隔离DDL；Maria不访问MySQL UUID/GIPK变量，5.7单独核large_prefix。 */
  const checkFacts = async (connection: ManagedConnection) => {
    const rows = await observe(connection, 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@innodb_page_size AS pageSize,@@hostname AS hostname,@@server_id AS serverId,@@port AS serverPort,@@SESSION.sql_mode AS mode,@@SESSION.autocommit AS autocommit,@@SESSION.foreign_key_checks AS foreignChecks,@@SESSION.unique_checks AS uniqueChecks,@@innodb_strict_mode AS innodbStrict,@@sql_quote_show_create AS quoteShowCreate'); owner.check();
    expect(rows).toHaveLength(1); const row = rows[0];
    expect(String(row.version)).toMatch(new RegExp('^' + target.version.replaceAll('.', '\\.') + '(?:$|-)')); expect(/mariadb/i.test(String(row.version))).toBe(target.dialect === 'mariadb'); expect(connection.status.dialect).toBe(target.dialect);
    expect(['linux', 'debian-linux-gnu']).toContain(String(row.os).toLowerCase()); expect(String(row.names)).toBe('0'); expect(String(row.pageSize)).toBe('16384');
    for (const key of ['autocommit', 'foreignChecks', 'uniqueChecks', 'innodbStrict', 'quoteShowCreate']) expect(String(row[key])).toBe('1');
    const modes = ['ONLY_FULL_GROUP_BY', 'STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES', 'NO_ZERO_IN_DATE', 'NO_ZERO_DATE', 'ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION', 'NO_AUTO_CREATE_USER', 'NO_BACKSLASH_ESCAPES'];
    expect(typeof row.mode).toBe('string'); expect(String(row.mode).split(',').filter(Boolean).every(mode => modes.includes(mode))).toBe(true);
    let identity: unknown;
    if (target.dialect === 'mysql') { const values = await observe(connection, 'SELECT @@server_uuid AS uuid'); owner.check(); expect(values).toEqual([{ uuid: target.uuid }]); identity = target.uuid; }
    else { expect(row.hostname).toBe(target.hostname); expect(String(row.serverId)).toBe(target.serverId); expect(String(row.serverPort)).toBe(target.serverPort); identity = [row.hostname, String(row.serverId), String(row.serverPort)]; }
    if (target.version === '5.7.44') { const values = await observe(connection, 'SELECT @@innodb_large_prefix AS largePrefix'); owner.check(); expect(values).toHaveLength(1); expect(String(values[0].largePrefix)).toBe('1'); }
    if (target.tls) { const values = await observe(connection, "SHOW SESSION STATUS LIKE 'Ssl_cipher'"); owner.check(); expect(values).toHaveLength(1); expect(typeof values[0].Value).toBe('string'); expect(String(values[0].Value).length).toBeGreaterThan(0); }
    const charset = await observe(connection, "SELECT MAXLEN FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME='utf8mb4'"); owner.check(); expect(charset).toHaveLength(1); expect(String(charset[0].MAXLEN)).toBe('4');
    const actual = JSON.stringify([row.version, row.os, row.names, row.pageSize, row.mode, identity]);
    if (fingerprint !== undefined) expect(actual).toBe(fingerprint); else fingerprint = actual;
  };
  /** 到达的句柄先记原生归属，再由run的返回门拒绝迟到，避免丢失迟到观察连接。 */
  const openObserver = (taskId: string) => run(async () => { const managed = await realConnect(profile); facts.push(watchPrefixConnection(managed, owner, taskId, connectionId, quoted)); return managed; });
  const preflight = await openObserver('preflight');
  await run(() => checkFacts(preflight)); await run(() => preflight.close({ strict: true })); assertPrefixReleased(facts, owner, 'preflight', true);
  const observer = await openObserver('observer');
  await run(() => checkFacts(observer));
  const sql = (text: string, params: (string | number)[] = []) => run(() => observe(observer, text, params));
  expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema])).toHaveLength(0);
  await run(async () => { const result = await connectionModule.execute<{ affectedRows: number; warningStatus: number }>(observer, 'CREATE DATABASE `' + schema + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); owner.check(); expect(result.rows.affectedRows).toBe(1); expect(result.rows.warningStatus).toBe(0); schemaAck = true; });
  await sql('CREATE TABLE ' + quoted + "(id INT NOT NULL,c CHAR(255) DEFAULT '原值' COMMENT '字符列',d CHAR(255),e CHAR(255),b BINARY(255),PRIMARY KEY(id),KEY old_c(c(2)) COMMENT '原索引',KEY spare(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='前缀夹具'");
  await sql('INSERT INTO ' + quoted + " VALUES(1,'甲A😀','一','二',X'00AA'),(2,'甲B😀','三','四',X'00BB')");
  /** 独立SHOW、目录和有序HEX快照，不借生产后核器为产品结果自证。 */
  const snapshot = async () => {
    const ddl = await sql('SHOW CREATE TABLE ' + quoted); expect(ddl).toHaveLength(1); expect(ddl[0].Table).toBe(table); expect(typeof ddl[0]['Create Table']).toBe('string');
    const indexes = await sql('SHOW INDEX FROM ' + quoted), fields = ['Non_unique', 'Key_name', 'Seq_in_index', 'Column_name', 'Collation', 'Sub_part', 'Null', 'Index_type', 'Comment', 'Index_comment', 'Visible', 'Ignored', 'Expression', 'Packed'];
    const stable = indexes.map(row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))).sort((a, b) => String(a.Key_name) < String(b.Key_name) ? -1 : String(a.Key_name) > String(b.Key_name) ? 1 : Number(a.Seq_in_index) - Number(b.Seq_in_index));
    const columns = await sql('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLLATION_NAME,EXTRA,COLUMN_COMMENT,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [schema, table]);
    const rows = await sql('SELECT id,HEX(c) AS c,HEX(d) AS d,HEX(e) AS e,HEX(b) AS b FROM ' + quoted + ' ORDER BY id'); expect(rows).toHaveLength(2); for (const row of rows) expect(String(row.b)).toHaveLength(510);
    return { ddl: ddl[0]['Create Table'] as string, indexes: stable, columns, rows };
  };
  const baseline = await snapshot();
  const tableFacts = await sql('SELECT ENGINE,ROW_FORMAT FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [schema, table]); expect(tableFacts).toEqual([{ ENGINE: 'InnoDB', ROW_FORMAT: 'Dynamic' }]);
  // 仅旁观真实connect返回的句柄；原连接、query回包及close失败全部透传。
  const spy = vi.spyOn(connectionModule, 'connect').mockImplementation(async (...args) => {
    owner.check(); const taskId = activeTask;
    if (!taskId || args[0].id !== connectionId) { owner.stop(); throw Error('前缀Engine建连没有准确任务归属'); }
    assertProfile(args[0]);
    const managed = await realConnect(...args); facts.push(watchPrefixConnection(managed, owner, taskId, connectionId, quoted)); owner.check(); assertProfile(managed.profile);
    await checkFacts(managed); return managed;
  });
  const { Engine } = await run(() => import('../../src/engine'));
  const engine = new Engine(event => { if (event.taskId !== activeTask || owner.state.retained || !owner.state.active) owner.stop(); events.push(structuredClone(event)); });
  /** 每次调用串行固定task；返回后独立核同一物理连接已关闭，错误不能遮住关闭未知。 */
  const call = <T>(id: string, action: () => Promise<T>, strict = true) => run(async () => {
    if (activeTask) throw Error('前缀核心case不允许并行任务'); activeTask = id;
    try {
      const result = await action();
      // connections.open沿原非strict关闭；只额外等待先前捕获的同一close事件，不改产品关闭选项。
      if (!strict) { const matches = facts.filter(value => value.taskId === id); expect(matches).toHaveLength(1); await matches[0].closeEvent; owner.check(); }
      assertPrefixReleased(facts, owner, id, strict); return result;
    }
    finally { activeTask = undefined; }
  });
  await call('profile-open', () => engine.handle('connections.open', { id: connectionId, profile }), false);
  const getId = randomUUID(); expectedTasks.set(getId, 'completed');
  const original: TableIndexGetOutput = await call(getId, () => engine.handle('schema.indexes.get', { connectionId, database: schema, table, connectionRevision: 1, taskId: getId }));
  expect(original.target).toEqual({ connectionId, database: schema, table });
  expect(original.writable).toBe(true); expect(original.capabilities?.maxKeyBytes).toBe(3072); expect(original.incomingCoverage.kind).toBe('complete');
  const part = (name: string, prefixLength: number) => { const column = original.columns.find(value => value.name === name); if (!column) throw Error('实际快照缺少字段'); expect(column.prefix).toEqual({ kind: 'allowed', unit: name === 'b' ? 'bytes' : 'characters', maxLength: 255 }); return { columnRef: column.columnRef, prefixLength, direction: 'asc' as const }; };
  const addition = (name: string, parts: ReturnType<typeof part>[], unique = false): IndexPatch => ({ op: 'add', clientKey: randomUUID(), definition: { name, kind: unique ? 'unique' : 'ordinary', method: 'BTREE', comment: '', keyParts: parts } });
  const alterCount = () => facts.filter(value => !['observer', 'preflight'].includes(value.taskId)).reduce((count, value) => count + value.alters, 0);
  const preview = async (patches: IndexPatch[]): Promise<TableIndexPreviewOutput> => { const id = randomUUID(); expectedTasks.set(id, 'completed'); return call(id, () => engine.handle('schema.indexes.preview', { snapshotId: original.snapshotId, patches, connectionRevision: 1, taskId: id })); };
  const apply = (value: TableIndexPreviewOutput, id: string) => engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, connectionRevision: 1, taskId: id });
  let value: TableIndexPreviewOutput;
  if (kind === 'units') {
    const old = original.indexes.find(index => index.name === 'old_c'); if (!old) throw Error('实际快照缺少原索引');
    value = await preview([{ op: 'alter', indexRef: old.indexRef, changes: { keyParts: [part('c', 3), part('b', 2)] } }]);
  } else if (kind === 'budget') {
    const id = randomUUID(); expectedTasks.set(id, 'blocked');
    await call(id, async () => { let blocked = false; try { await engine.handle('schema.indexes.preview', { snapshotId: original.snapshotId, patches: [addition('budget_key', [part('c', 255), part('d', 255), part('e', 255), part('b', 13)])], connectionRevision: 1, taskId: id }); } catch (error) { if (!(error instanceof Error) || !error.message.includes('最大键字节数')) throw error; blocked = true; } expect(blocked).toBe(true); });
    expect(alterCount()).toBe(0); expect(await snapshot()).toEqual(baseline);
    value = await preview([addition('budget_key', [part('c', 255), part('d', 255), part('e', 255), part('b', 12)])]);
  } else value = await preview([addition('unique_prefix', [part('c', 1), part('b', 1)], true)]);
  expect(alterCount()).toBe(0); expect(await snapshot()).toEqual(baseline);
  expect(value.target).toEqual({ connectionId, database: schema, table }); expect(value.sql.startsWith('ALTER TABLE ' + quoted + ' ')).toBe(true);
  const applyId = randomUUID(); expectedTasks.set(applyId, kind === 'duplicate' ? 'duplicate' : 'completed');
  if (kind === 'duplicate') {
    await call(applyId, async () => { let duplicate = false; try { await apply(value, applyId); } catch (error) { if (!isPrefixDuplicate(error)) throw error; duplicate = true; } expect(duplicate).toBe(true); });
    const record = facts.find(fact => fact.taskId === applyId)!; expect(record.alterErrors).toEqual([{ errno: 1062, code: 'ER_DUP_ENTRY', sqlState: '23000' }]); expect(await snapshot()).toEqual(baseline);
    const connections = facts.length, sent = alterCount(), replayId = randomUUID();
    await run(async () => { let rejected = false; try { await apply(value, replayId); } catch (error) { if (!(error instanceof Error) || !error.message.includes('已失效或已使用')) throw error; rejected = true; } expect(rejected).toBe(true); });
    expect(facts).toHaveLength(connections); expect(alterCount()).toBe(sent); expect(events.some(event => event.taskId === replayId)).toBe(false);
  } else {
    const output = await call(applyId, () => apply(value, applyId)); expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true }); expect(output.warnings).toEqual([]);
  }
  expect(alterCount()).toBe(1);
  const after = await snapshot();
  if (kind === 'units') {
    const removeTarget = (ddl: string) => ddl.replace(/^\s*KEY `old_c` .*$/m, '<本例唯一指定索引>');
    expect(removeTarget(after.ddl)).toBe(removeTarget(baseline.ddl)); expect(after.indexes.filter(index => index.Key_name !== 'old_c')).toEqual(baseline.indexes.filter(index => index.Key_name !== 'old_c'));
    expect(after.indexes.filter(index => index.Key_name === 'old_c').map(index => [index.Column_name, String(index.Sub_part), index.Index_comment])).toEqual([['c', '3', '原索引'], ['b', '2', '原索引']]);
  } else if (kind === 'budget') {
    expect(after.indexes.filter(index => index.Key_name !== 'budget_key')).toEqual(baseline.indexes); expect(after.indexes.filter(index => index.Key_name === 'budget_key').map(index => [index.Column_name, String(index.Sub_part)])).toEqual([['c', '255'], ['d', '255'], ['e', '255'], ['b', '12']]);
    expect(after.ddl.replace(/^\s*KEY `budget_key` .*\n/m, '').replace(/,\n\)/g, '\n)')).toBe(baseline.ddl);
  } else expect(after).toEqual(baseline);
  expect(after.columns).toEqual(baseline.columns); expect(after.rows).toEqual(baseline.rows);
  /** 清理许可独立于业务成功：1062仅是预设ERR，任何close未知仍在此门前sticky停止。 */
  await finishFixedPrefix(owner, {
    async resources() {
      if (activeTask || owner.state.pending !== 1) throw Error('前缀case还有活动任务或观察');
      for (const [id, expected] of expectedTasks) {
        assertPrefixReleased(facts, owner, id, true); const last = events.filter(event => event.taskId === id).at(-1);
        expect(last?.status).toBe(expected === 'completed' ? 'completed' : 'failed');
        expect(last?.indexPatch).toMatchObject(expected === 'duplicate' ? { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } : expected === 'blocked' ? { ddlSubmitted: false, ddlCompleted: false, outcome: 'not-sent' } : id === applyId ? { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' } : { ddlSubmitted: false });
      }
      assertPrefixReleased(facts, owner, 'profile-open', false); assertPrefixReleased(facts, owner, 'preflight', true);
    },
    closeEngine: () => engine.closeAll(),
    async verifyOwned() {
      if (!schemaAck || !/^dbark_fixed_prefix_[a-f0-9]{32}$/.test(schema)) throw Error('前缀case准确新库归属未知');
      await checkFacts(observer); const schemas = await observe(observer, 'SELECT SCHEMA_NAME,DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema]); owner.check(); expect(schemas).toEqual([{ SCHEMA_NAME: schema, DEFAULT_CHARACTER_SET_NAME: 'utf8mb4', DEFAULT_COLLATION_NAME: 'utf8mb4_bin' }]);
      const tables = await observe(observer, 'SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [schema]); owner.check(); expect(tables).toEqual([{ TABLE_NAME: table, TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB' }]); expect(await snapshot()).toEqual(after);
    },
    async drop() { const result = await connectionModule.execute<{ warningStatus: number }>(observer, 'DROP DATABASE `' + schema + '`'); owner.check(); expect(result.rows.warningStatus).toBe(0); },
    async absent() { expect(await observe(observer, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema])).toHaveLength(0); },
    async closeObserver() { await observer.close({ strict: true }); assertPrefixReleased(facts, owner, 'observer', true); },
    restore() { spy.mockRestore(); },
  });
  } catch (reason) { owner.stop(); throw reason; }
  finally {
    // 只输出归属/关闭事实；失败也保留迟到句柄映射，不输出认证、令牌、SQL或行正文。
    console.info(JSON.stringify({ 场景: kind, 绑定端口: target.port, 绑定版本: target.version, owner: owner.id, 状态: owner.state, ALTER次数: facts.filter(fact => !['preflight', 'observer'].includes(fact.taskId)).reduce((sum, fact) => sum + fact.alters, 0), 资源: facts.map(fact => ({ owner: fact.ownerId, task: fact.taskId, threadId: fact.threadId, 同native: fact.managed.connection === fact.native, 同stream: fact.native.stream === fact.stream, close次数: fact.closeCalls, strict: fact.strict, close返回: fact.closeReturned, close失败: fact.closeFailed, 实际close: fact.sawClose && fact.stream.closed === true, pending: fact.pending })) }));
  }
}
