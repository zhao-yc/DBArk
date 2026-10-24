import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadStream } from 'node:fs';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as (() => void) | undefined, watch: undefined as ((managed: ManagedConnection, scope: string) => void) | undefined, file: undefined as ((path: unknown, stream?: ReadStream) => void) | undefined }));
/** 仅观察原驱动/流，不改变产品SQL、返回包、事务状态或关闭严格参数。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { if (!audit.check || !audit.watch || !audit.scope) throw Error('文件导入事务缺少原owner'); audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed; } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { if (!audit.check || !audit.file) throw Error('文件导入事务缺少原文件owner'); audit.check(); audit.file(args[0]); const stream = actual.createReadStream(...args); audit.file(args[0], stream); return stream; } };
});
/** 默认和list不读取认证、不加载helper/Engine；仅独立双门进入真实案例。 */
export function fileImportTransactionIntegrationEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_FILE_IMPORT_TRANSACTION_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });
describe.sequential('文件导入事务六实例真实Engine专项（默认关闭）', () => {
  it('CSV/JSON整文件失败/成功/重复键、默认500行提交与真实取消', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!fileImportTransactionIntegrationEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('文件导入事务保留原现场，禁止自动重跑');
    const helper = await import('../helpers/fileImportTransactionIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindFileImportTransactionTarget(() => process.env, 'file-import-transaction-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], writes = new Set<string>(), events: TaskEvent[] = [], files = new Map<string, { name: string; bytes: Buffer }>(), streams: { path: string; scope: string; stream: ReadStream; closed: Promise<void>; sawClose: boolean }[] = [];
    let observer: ManagedConnection | undefined, database = '', marker = '', directory = '', phase = '初始化', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    let sqlDiagnostic = () => ({ 已拒绝SQL: [] as { sql: string; scope: string }[], 末尾原SQL: [] as { sql: string; scope: string }[] });
    audit.check = owner.check; audit.file = (path, stream) => {
      if (typeof path !== 'string' || !files.has(path)) { owner.stop(); throw Error('事务专项打开未登记文件'); }
      if (stream) { let resolve!: () => void; const fact = { path, scope: audit.scope, stream, closed: new Promise<void>(yes => { resolve = yes; }), sawClose: false }; stream.once('close', () => { fact.sawClose = true; resolve(); }); streams.push(fact); }
    };
    try {
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto')), fs = await owner.step(() => import('node:fs/promises')), path = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os'));
      const sqlModule = await owner.step(() => import('../../src/engine/sql')), auditModule = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      database = 'dbark_fileimporttx_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-file-import-transaction:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planFileImportTransactionFixture(database, marker), policy = helper.createFileImportTransactionSqlAudit(plan, writes, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      sqlDiagnostic = () => ({ 已拒绝SQL: policy.rejected, 末尾原SQL: policy.sent.slice(-8).map(({ sql, scope }) => ({ sql, scope })) }); audit.watch = (managed, scope) => facts.push(auditModule.watchTableFilteredExportConnection(managed, scope, owner, policy));
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => { owner.check(); policy.assert(statement, values, 'observer'); return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows; };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      process.stdout.write(JSON.stringify({ 专项: '文件导入事务', 阶段: '原资源计划', 端口: binding.profile.port, 数据库: database, 标记: marker, 对象: plan.objects, 案例数: plan.cases.length, INSERT尝试: plan.cases.reduce((sum, item) => sum + item.inserts, 0) }) + '\n');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) { writes.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed'; }
      for (const statement of plan.seeds) { writes.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      const readRows = async (table: string) => (await sql('SELECT * FROM ' + plan.table(table) + ' ORDER BY `id` ASC')).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlModule.serializeCell(value)]))) as DataRow[];
      const definitions = new Map<string, unknown>(); for (const name of plan.objects) { definitions.set(name, await sql('SHOW CREATE TABLE ' + plan.table(name))); if (name !== '__owner') expect(await readRows(name)).toEqual([]); }
      directory = await owner.step(() => fs.mkdtemp(path.join(os.tmpdir(), 'dbark-fileimporttx-')));
      for (const item of plan.cases) { const original = path.join(directory, item.name + '.' + item.format), bytes = Buffer.from(item.text, 'utf8'); await owner.step(() => fs.writeFile(original, bytes, { flag: 'wx' })); files.set(original, { name: item.name, bytes }); }
      let cancelTaskId = '', cancelCalls = 0, cancelPromise: Promise<unknown> | undefined;
      const engine = new modules.engine.Engine(event => { events.push(event); if (event.taskId === cancelTaskId && event.status === 'running' && event.rows === 0 && event.message === '已写入 500 行，整文件仍待提交；尚未确认任何行提交') { if (++cancelCalls !== 1) throw Error('原500行取消触发重复'); owner.check(); cancelPromise = engine.handle('query.cancel', { taskId: cancelTaskId }); void cancelPromise.catch(() => undefined); } });
      /** 原RPC、取消ACK、callback/end、物理socket和文件close全部结算后才继续原observer。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, label: string, connections: number, fileCount: number, strict = false) => {
        audit.scope = command + ':' + label; const offset = facts.length, fileOffset = streams.length, scope = audit.scope;
        const result = await owner.step(async () => { try { return { value: await engine.handle(command, input) as T }; } catch (error) { return { error }; } }); if (cancelPromise) { await owner.step(() => cancelPromise!); cancelPromise = undefined; }
        const current = facts.slice(offset); expect(current).toHaveLength(connections); for (const fact of current) await owner.step(() => fact.closed); life.assertTableValueOptionsReleased(current, strict); expect(current.every(fact => fact.strict === strict)).toBe(true);
        const opened = streams.slice(fileOffset); expect(opened).toHaveLength(fileCount); for (const fact of opened) { await owner.step(() => fact.closed); expect(fact.sawClose && fact.stream.closed).toBe(true); }
        return { ...result, sent: policy.sent.filter(item => item.scope === scope) };
      };
      expect((await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }, 'profile', 1, 0)).error).toBeUndefined();
      for (const item of plan.cases) {
        phase = item.name; const original = [...files].find(([, entry]) => entry.name === item.name)![0], input = { fileToken: 'file-import-transaction-' + item.name, filePath: original, format: item.format, encoding: 'utf8' };
        expect(await owner.step(() => fs.readFile(original))).toEqual(files.get(original)!.bytes);
        expect(await readRows(item.table)).toEqual([]);
        const taskId = crypto.randomUUID(); if (item.kind === 'cancel') cancelTaskId = taskId;
        const result = await invoke<{ rows: number; errors: string[] }>('files.import', { ...input, connectionId: binding.profile.id, database, table: item.table, mapping: { id: 'id', amount: 'amount', note: 'note', payload: 'payload' }, ...(item.transactionMode ? { transactionMode: item.transactionMode } : {}), taskId }, item.name, 1, 1, item.transactionMode === 'atomic');
        const insert = `INSERT INTO ${plan.table(item.table)} (\`id\`, \`amount\`, \`note\`, \`payload\`) VALUES (?, ?, ?, ?)`;
        expect(result.sent.filter(row => row.sql === insert)).toHaveLength(item.inserts); expect(result.sent.filter(row => row.sql === 'COMMIT')).toHaveLength(item.commits); expect(result.sent.filter(row => row.sql === 'START TRANSACTION')).toHaveLength(item.starts); expect(result.sent.filter(row => row.sql === 'ROLLBACK')).toHaveLength(item.rollbacks);
        expect(await readRows(item.table)).toEqual(item.expected); expect(await sql('SHOW CREATE TABLE ' + plan.table(item.table))).toEqual(definitions.get(item.table));
        if (item.kind === 'cancel') { expect(result.error).toBeInstanceOf(Error); expect(String(result.error)).toContain('整文件目标表事务已确认回滚'); expect(cancelCalls).toBe(1); expect(events.filter(event => event.taskId === taskId && event.status === 'cancelled')).toHaveLength(1); }
        else { expect(result.error).toBeUndefined(); expect(result.value?.rows).toBe(item.expected.length); expect(result.value?.errors).toHaveLength(item.kind === 'success' ? 0 : 1); if (item.kind !== 'success') { expect(result.value!.errors[0]).toContain('第 502 条记录导入失败'); expect(result.value!.errors[0]).toContain(item.kind === 'batch' ? '已确认提交 500 行，当前批 1 行已回滚' : '已确认提交 0 行，整文件目标表事务已确认回滚'); if (item.kind === 'invalid' || item.kind === 'batch') expect(result.value!.errors[0]).toContain('不能无损导入'); if (item.kind === 'duplicate') expect(result.value!.errors[0]).toMatch(/duplicate|重复/iu); } }
        expect(events.filter(event => event.taskId === taskId && event.status === (item.kind === 'cancel' ? 'cancelled' : item.kind === 'success' ? 'completed' : 'failed'))).toHaveLength(1);
        if (item.transactionMode) expect(result.sent.filter(row => row.sql === 'SELECT 1 FROM ' + plan.table(item.table) + ' LIMIT 0')).toHaveLength(1);
      }
      phase = '精确核对原资源并清理'; const connectionCount = facts.length; await owner.step(() => engine.closeAll()); expect(facts).toHaveLength(connectionCount);
      for (const item of plan.cases) { expect(await readRows(item.table)).toEqual(item.expected); expect(await sql('SHOW CREATE TABLE ' + plan.table(item.table))).toEqual(definitions.get(item.table)); }
      expect(await sql('SELECT marker FROM ' + plan.table('__owner'))).toEqual([{ marker }]); expect(await sql('SHOW CREATE TABLE ' + plan.table('__owner'))).toEqual(definitions.get('__owner'));
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]); const owned = facts.filter(fact => fact.managed !== observer);
      expect(owned).toHaveLength(10); expect(streams).toHaveLength(9); expect(cancelCalls).toBe(1);
      for (const fact of owned) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      for (const fact of owned) { life.assertTableValueOptionsReleased([fact], fact.scope.startsWith('files.import:') && !fact.scope.includes('default_batch')); expect(fact.strict).toBe(fact.scope.startsWith('files.import:') && !fact.scope.includes('default_batch')); }
      expect(streams.every(fact => fact.sawClose && fact.stream.closed)).toBe(true); expect((await owner.step(() => fs.readdir(directory))).sort()).toEqual([...files.keys()].map(file => path.basename(file)).sort()); for (const [original, entry] of files) expect(await owner.step(() => fs.readFile(original))).toEqual(entry.bytes);
      writes.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      for (const original of files.keys()) await owner.step(() => fs.unlink(original)); expect(await owner.step(() => fs.readdir(directory))).toEqual([]); await owner.step(() => fs.rmdir(directory));
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); life.assertTableValueOptionsReleased(facts.filter(fact => fact.managed === observer), true); expect(policy.rejected).toEqual([]); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '文件导入事务', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 标记: marker, 案例数: plan.cases.length, INSERT尝试: plan.cases.reduce((sum, item) => sum + item.inserts, 0), 独立已提交行: plan.cases.reduce((sum, item) => sum + item.expected.length, 0), 原取消调用: cancelCalls, 原文件流: streams.length, 原产品连接: owned.length, 原子严格关闭: true, 默认批次严格参数: false, 原callback及end及socket及文件close: true, 数据库及文件残留: 0, 未验: ['Main文件选择授权', 'GUI', '真实COMMIT断线或未知结果', '触发器外部副作用', '安装包', 'Mac'] }) + '\n');
    } catch (error) { retained = true; owner.stop(); process.stdout.write(JSON.stringify({ 专项: '文件导入事务', 阶段: '停链保留', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 当前阶段: phase, 临时目录: directory, SQL审计: sqlDiagnostic(), 原连接: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })), 原文件流: streams.map(fact => ({ path: fact.path, scope: fact.scope, sawClose: fact.sawClose, closed: fact.stream.closed })), 自动清理: false, 自动重跑: false }) + '\n'); throw error; }
  });
});
