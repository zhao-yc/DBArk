import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadStream } from 'node:fs';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), file: undefined as undefined | ((path: unknown, stream?: ReadStream) => void) }));
/** 原驱动和原文件流只加观察，不替换数据、解析器、参数或关闭实现。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('无标题CSV缺少原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    if (!audit.check || !audit.file) throw Error('无标题CSV缺少原文件owner');
    audit.check(); audit.file(args[0]); const stream = actual.createReadStream(...args); audit.file(args[0], stream); return stream;
  } };
});

/** list先短路，不读取认证；缺任一门不加载helper、Engine或mysql。 */
export function csvHeaderIntegrationEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_CSV_HEADER_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('无标题CSV六实例真实文件及分批导入（默认关闭）', () => {
  it('首条数据、精度映射、原表头兼容和当前批回滚', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!csvHeaderIntegrationEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('无标题CSV保留原现场，禁止自动重跑');
    const helper = await import('../helpers/csvHeaderIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindCsvHeaderTarget(() => process.env, 'csv-header-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], writes = new Set<string>(), events: TaskEvent[] = [];
    const files = new Map<string, string>(), streams: { path: string; scope: string; stream: ReadStream; closed: Promise<void>; sawClose: boolean }[] = [];
    let observer: ManagedConnection | undefined, database = '', marker = '', directory = '', phase = '初始化', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    let sqlDiagnostic = () => ({ 已拒绝SQL: [] as { sql: string; scope: string }[], 末尾原SQL: [] as { sql: string; scope: string }[] });
    audit.check = owner.check;
    audit.file = (path, stream) => {
      if (typeof path !== 'string' || !files.has(path)) { owner.stop(); throw Error('CSV打开了未登记的真实合成文件'); }
      if (stream) { let ended!: () => void; const fact = { path, scope: audit.scope, stream, closed: new Promise<void>(resolve => { ended = resolve; }), sawClose: false }; stream.once('close', () => { fact.sawClose = true; ended(); }); streams.push(fact); }
    };
    try {
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      const fs = await owner.step(() => import('node:fs/promises')), path = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os')), iconv = await owner.step(() => import('iconv-lite'));
      const sqlModule = await owner.step(() => import('../../src/engine/sql')), auditModule = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      database = 'dbark_csvheader_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-csv-header:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planCsvHeaderFixture(database, marker), policy = helper.createCsvHeaderSqlAudit(plan, writes, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      sqlDiagnostic = () => ({ 已拒绝SQL: policy.rejected, 末尾原SQL: policy.sent.slice(-8).map(({ sql, scope }) => ({ sql, scope })) });
      audit.watch = (managed, scope) => facts.push(auditModule.watchTableFilteredExportConnection(managed, scope, owner, policy));
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, values, 'observer'); return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      process.stdout.write(JSON.stringify({ 专项: '无标题CSV', 阶段: '原资源计划', 端口: binding.profile.port, 数据库: database, 标记: marker, 对象: plan.objects, 成功案例数: plan.cases.length, 跨批输入行: plan.bad.parameters.length }) + '\n');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) { writes.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed'; }
      for (const statement of plan.seeds) { writes.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      const readRows = async (table: string) => (await sql('SELECT * FROM ' + plan.table(table) + ' ORDER BY `id` ASC')).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlModule.serializeCell(value)]))) as DataRow[];
      const definitions = new Map<string, unknown>();
      for (const table of plan.objects) { definitions.set(table, await sql('SHOW CREATE TABLE ' + plan.table(table))); if (table !== '__owner') expect(await readRows(table)).toEqual([]); }
      directory = await owner.step(() => fs.mkdtemp(path.join(os.tmpdir(), 'dbark-csvheader-')));
      /** 独立编码写入wx文件；路径仅来自本次临时目录，不读取用户或项目配置。 */
      const makeFile = async (name: string, text: string, encoding: 'utf8' | 'utf16le' | 'gb18030') => {
        const filePath = path.join(directory, name + '.csv'); await owner.step(() => fs.writeFile(filePath, iconv.default.encode(text, encoding), { flag: 'wx' })); files.set(filePath, name); return filePath;
      };
      for (const item of plan.cases) await makeFile(item.name, item.text, item.encoding);
      await makeFile('bad-batch', plan.bad.text, 'utf8'); await makeFile('bad-columns', plan.badColumns.text, 'utf8');
      const filePath = (name: string) => { const value = [...files].find(([, label]) => label === name)?.[0]; if (!value) throw Error('CSV计划文件未登记'); return value; };
      const engine = new modules.engine.Engine(event => events.push(event));
      /** 真实Engine调用后等待原callback/end、socket和文件close，保留产品原非strict关闭参数。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, label: string, connectionCount: number, fileCount: number) => {
        audit.scope = command + ':' + label; const offset = facts.length, fileOffset = streams.length;
        const result = await owner.step(async () => { try { return { value: await engine.handle(command, input) as T }; } catch (error) { return { error }; } });
        const connections = facts.slice(offset); expect(connections).toHaveLength(connectionCount); for (const fact of connections) await owner.step(() => fact.closed);
        life.assertTableValueOptionsReleased(connections, false); expect(connections.every(fact => !fact.strict)).toBe(true);
        const opened = streams.slice(fileOffset); expect(opened).toHaveLength(fileCount); for (const fact of opened) { await owner.step(() => fact.closed); expect(fact.sawClose && fact.stream.closed).toBe(true); }
        return { ...result, taskId: input.taskId, sent: policy.sent.filter(item => item.scope === audit.scope) };
      };
      expect((await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }, 'profile', 1, 0)).error).toBeUndefined();
      const source = (name: string, encoding: string, delimiter: string, hasHeader?: boolean) => ({ fileToken: 'csv-header-' + name, filePath: filePath(name), format: 'csv', encoding, csvDelimiter: delimiter, ...(hasHeader === undefined ? {} : { csvHasHeader: hasHeader }) });
      let successfulRows = 0;
      for (const item of plan.cases) {
        phase = '首行及精度:' + item.name; const input = source(item.name, item.encoding, item.delimiter, item.csvHasHeader), before = policy.sent.length;
        const preview = await invoke<{ columns: string[]; rows: DataRow[] }>('files.preview', input, item.name, 0, 1); expect(preview.error).toBeUndefined(); expect(preview.value).toEqual(item.preview); expect(policy.sent).toHaveLength(before); expect(await readRows(item.table)).toEqual([]);
        if (item.name === 'default-header') { const explicit = await invoke('files.preview', { ...input, csvHasHeader: true }, 'default-header-explicit', 0, 1); expect(explicit.error).toBeUndefined(); expect(explicit.value).toEqual(item.preview); }
        const taskId = crypto.randomUUID(), imported = await invoke<{ rows: number; errors: string[] }>('files.import', { ...input, connectionId: binding.profile.id, database, table: item.table, mapping: item.mapping, taskId }, item.name, 1, 1);
        expect(imported.error).toBeUndefined(); expect(imported.value).toEqual({ rows: item.expected.length, errors: [] }); expect(await readRows(item.table)).toEqual(item.expected);
        expect(imported.sent.filter(item => item.sql === 'COMMIT')).toHaveLength(1); expect(imported.sent.filter(item => item.sql === 'ROLLBACK')).toEqual([]); expect(imported.sent.filter(item => item.sql.startsWith('INSERT INTO '))).toHaveLength(item.expected.length);
        expect(events.filter(event => event.taskId === taskId && event.status === 'completed')).toHaveLength(1); successfulRows += item.expected.length;
      }
      phase = '真实第二批唯一冲突';
      const badInput = source('bad-batch', 'utf8', ',', false), badPreviewStart = policy.sent.length, badPreview = await invoke('files.preview', badInput, 'bad-batch', 0, 1);
      expect(badPreview.error).toBeUndefined(); expect(badPreview.value).toEqual(plan.bad.preview); expect(policy.sent).toHaveLength(badPreviewStart); expect(await readRows(plan.bad.table)).toEqual([]);
      const batchTask = crypto.randomUUID(), bad = await invoke<{ rows: number; errors: string[] }>('files.import', { ...badInput, connectionId: binding.profile.id, database, table: plan.bad.table, mapping: plan.bad.mapping, taskId: batchTask }, 'bad-batch', 1, 1);
      expect(bad.error).toBeUndefined(); expect(bad.value?.rows).toBe(500); expect(bad.value?.errors).toHaveLength(1); expect(bad.value!.errors[0]).toContain('已确认提交 500 行，当前批 1 行已回滚'); expect(await readRows(plan.bad.table)).toEqual(plan.bad.expected);
      expect(bad.sent.filter(item => item.sql === 'COMMIT')).toHaveLength(1); expect(bad.sent.filter(item => item.sql === 'START TRANSACTION')).toHaveLength(2); expect(bad.sent.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(bad.sent.filter(item => item.sql.startsWith('INSERT INTO '))).toHaveLength(502);
      expect(events.some(event => event.taskId === batchTask && event.rows === 500 && event.status === 'running')).toBe(true); expect(events.filter(event => event.taskId === batchTask && event.status === 'failed')).toHaveLength(1);
      phase = '真实坏列数当前批回滚';
      const columnsInput = source('bad-columns', 'utf8', ',', false), columnsPreviewStart = policy.sent.length, columnsPreview = await invoke('files.preview', columnsInput, 'bad-columns', 0, 1);
      expect(columnsPreview.error).toBeInstanceOf(Error); expect(policy.sent).toHaveLength(columnsPreviewStart); expect(await readRows(plan.badColumns.table)).toEqual([]);
      const columnsTask = crypto.randomUUID(), columns = await invoke<{ rows: number; errors: string[] }>('files.import', { ...columnsInput, connectionId: binding.profile.id, database, table: plan.badColumns.table, mapping: plan.badColumns.mapping, taskId: columnsTask }, 'bad-columns', 1, 1);
      const columnsInserts = columns.sent.filter(item => item.sql.startsWith('INSERT INTO ')).length;
      expect(columns.error).toBeUndefined(); expect(columns.value?.rows).toBe(0); expect(columns.value?.errors).toHaveLength(1); expect(columnsInserts).toBeLessThanOrEqual(2); expect(columns.value!.errors[0]).toContain(`已确认提交 0 行，当前批 ${columnsInserts} 行已回滚`); expect(await readRows(plan.badColumns.table)).toEqual([]);
      expect(columns.sent.filter(item => item.sql === 'COMMIT')).toEqual([]); expect(columns.sent.filter(item => item.sql === 'ROLLBACK')).toHaveLength(1); expect(events.filter(event => event.taskId === columnsTask && event.status === 'failed')).toHaveLength(1);
      phase = '核原定义全值及资源';
      for (const table of plan.objects) {
        // 仅允许插入导致表尾下一自增计数变化，不忽略字段或其它DDL内容。
        const normalize = (value: unknown) => JSON.stringify(value).replace(/ AUTO_INCREMENT=\d+/g, ''); expect(normalize(await sql('SHOW CREATE TABLE ' + plan.table(table)))).toBe(normalize(definitions.get(table)));
      }
      for (const item of plan.cases) expect(await readRows(item.table)).toEqual(item.expected);
      expect(await readRows(plan.bad.table)).toEqual(plan.bad.expected); expect(await readRows(plan.badColumns.table)).toEqual([]);
      expect(await sql('SELECT marker FROM ' + plan.table('__owner'))).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]); const owned = facts.filter(fact => fact.managed !== observer);
      for (const fact of owned) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      expect((await owner.step(() => fs.readdir(directory))).sort()).toEqual([...files.keys()].map(value => path.basename(value)).sort());
      writes.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      for (const original of files.keys()) await owner.step(() => fs.unlink(original)); expect(await owner.step(() => fs.readdir(directory))).toEqual([]); await owner.step(() => fs.rmdir(directory));
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed);
      life.assertTableValueOptionsReleased(owned, false); life.assertTableValueOptionsReleased(facts.filter(fact => fact.managed === observer), true); expect(policy.rejected).toEqual([]); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '无标题CSV', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 成功案例数: plan.cases.length, 成功提交行: successfulRows, 编码数: 3, 分隔符数: 3, 默认表头回归: true, 预览数据库执行: 0, 跨批输入行: 502, 跨批已提交: 500, 跨批当前回滚: 1, 坏列数已提交: 0, 坏列数回滚前INSERT: columnsInserts, 原callback及end及物理流结束: true, 观察连接严格关闭: true, 产品连接严格参数: false, 原产品连接数: owned.length, 文件流数: streams.length, 数据库及文件残留: 0, 未验: ['Main文件对话框授权', 'GUI显式映射交互', '真实取消及断线', '安装包', 'Mac', '全文件原子性（原产品每500行提交）'] }) + '\n');
    } catch (error) {
      retained = true; owner.stop(); process.stdout.write(JSON.stringify({ 专项: '无标题CSV', 阶段: '停链保留', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 当前阶段: phase, 临时目录: directory, SQL审计: sqlDiagnostic(), 原连接: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })), 原文件流: streams.map(fact => ({ path: fact.path, scope: fact.scope, sawClose: fact.sawClose, closed: fact.stream.closed })), 自动重跑: false, 自动清理: false }) + '\n'); throw error;
    }
  });
});
