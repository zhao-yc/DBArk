import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TableInfo, TaskEvent } from '../../src/shared/contracts';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void) }));
/** 透传真实驱动与原资源回调；只观察命令、严格close和原物理stream，不替换SQL结果。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('筛选导出实库缺少原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

/** list/default不读取认证，不载入真实连接或文件模块。 */
export function tableFilteredExportEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_FILTERED_EXPORT_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('当前筛选完整流式导出六实例真实Engine（默认关闭）', () => {
  it('四格式原值、多列排序、完整嵌套停用、超过1000行、视图及原目标保护', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableFilteredExportEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('筛选导出原验收保留现场，不自动重跑');
    const helper = await import('../helpers/tableFilteredExportIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindTableFilteredExportTarget(() => process.env, 'filtered-export-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], events: TaskEvent[] = [], fixtureWrites = new Set<string>();
    let observer: ManagedConnection | undefined, databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check;
    try {
      const sqlAudit = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      const fs = await owner.step(() => import('node:fs/promises')), path = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os'));
      const files = await owner.step(() => import('../../src/engine/files')), excel = await owner.step(() => import('../../src/engine/excelFiles'));
      const { tableCopyMetadataKey } = await owner.step(() => import('../../src/shared/tableCopySource'));
      const { serializeCell } = await owner.step(() => import('../../src/engine/sql'));
      const database = 'dbark_filteredexport_' + crypto.randomUUID().replaceAll('-', ''), marker = 'dbark-filtered-export:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planTableFilteredExportFixture(database, marker), db = '`' + database + '`';
      const policy = sqlAudit.createTableFilteredExportSqlAudit({ database, fixtureStatements: [...plan.creates, ...plan.seeds, plan.drop], fixtureWrites, isOwnedThread: id => facts.some(fact => fact.id === id && fact.managed !== observer) });
      audit.watch = (managed, scope) => facts.push(sqlAudit.watchTableFilteredExportConnection(managed, scope, owner, policy));
      process.stdout.write(JSON.stringify({ 专项: '筛选完整导出', 阶段: '原资源计划', 数据库: database, 标记: marker, 端口: binding.profile.port, 对象: plan.objects, 行数: plan.rows }) + '\n');
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, values, 'observer', observer?.sqlMode);
        audit.scope = 'observer'; return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      const engine = new modules.engine.Engine(event => events.push(event));
      /** 原handle完成后再次等待每个原物理stream close，不能用closeAll替代本次释放。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>) => {
        audit.scope = command + ':' + crypto.randomUUID(); const offset = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(offset); for (const fact of actual) await owner.step(() => fact.closed);
        life.assertTableValueOptionsReleased(actual, command === 'table.exportFiltered');
        return { ...result, facts: actual };
      };
      expect((await invoke('connections.open', { id: binding.profile.id, profile: binding.profile })).error).toBeUndefined();
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) {
        fixtureWrites.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed';
      }
      for (const statement of plan.seeds) { fixtureWrites.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      const directory = await owner.step(() => fs.mkdtemp(path.join(os.tmpdir(), 'dbark-filtered-export-')));
      const target = { connectionId: binding.profile.id, database, table: 'subject' };
      const info = await invoke<TableInfo>('metadata.table', target); expect(info.error).toBeUndefined();
      const beforeDdl = await sql('SHOW CREATE TABLE ' + db + '.`subject`');
      const original = await sql('SELECT * FROM ' + db + '.`subject` WHERE id>=? ORDER BY label ASC,id DESC', [1]);
      expect(original).toHaveLength(plan.rows); const baseline = original.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializeCell(value)]))) as DataRow[];
      expect(baseline[0].big_value).toBe('18446744073709551615'); expect(baseline[0].amount).toBe('9007199254740993.123456789012'); expect(baseline[0].at_value).toBe('2026-10-23 12:34:56.123456'); expect(baseline[0].approx_value).toBe(Math.fround(0.1));
      const scope = { metadataKey: tableCopyMetadataKey(info.value!), filters: [{ column: 'id', operator: '>=', value: '1' }, { column: 'id', operator: '<', value: '0', enabled: false }, { column: 'id', operator: '<=', value: '1105' }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2] }, sort: [{ column: 'label', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] };
      const expectedText = (rows: DataRow[], binary: boolean) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null || typeof value === 'object' && binary ? value : typeof value === 'object' ? 'base64:' + value.base64 : String(value)])));
      const outputs: string[] = [];
      for (const format of ['csv', 'json', 'sql', 'xlsx'] as const) {
        const filePath = path.join(directory, 'filtered.' + format), taskId = crypto.randomUUID(); outputs.push(filePath); await owner.step(() => fs.writeFile(filePath, '原目标文件'));
        const result = await invoke<{ rows: number; fileCommitted: true }>('table.exportFiltered', { ...target, ...scope, taskId, fileToken: crypto.randomUUID(), filePath, format, encoding: 'utf8', ...(format === 'csv' ? { csvDelimiter: ';' } : {}) });
        expect(result.error).toBeUndefined(); expect(result.value).toEqual({ rows: plan.rows, fileCommitted: true }); expect(result.facts).toHaveLength(1);
        const selects = result.facts[0].commands.filter(command => command.streamed); expect(selects).toHaveLength(1); expect(selects[0].method).toBe('execute'); expect(selects[0].sql).not.toMatch(/\bLIMIT\s+\d+|\bOFFSET\s+\d+/i);
        const raw = await owner.step(() => fs.readFile(filePath));
        if (format === 'json') expect(JSON.parse(raw.toString('utf8'))).toEqual(baseline);
        if (format === 'csv') { const rows = await sqlAudit.collectTableFilteredExportRows(files.readRecords(filePath, 'csv', 'utf8', ';'), owner); expect(rows).toEqual(expectedText(baseline, false)); }
        if (format === 'xlsx') { const sheets = await owner.step(() => excel.listExcelSheets({ filePath, checkCancelled: owner.check })); expect(sheets).toHaveLength(1); const rows = await sqlAudit.collectTableFilteredExportRows(excel.readExcelRows({ filePath, sheetId: sheets[0].id, protocol: 'dbark-v1', checkCancelled: owner.check }), owner); expect(rows).toEqual(expectedText(baseline, true)); }
        if (format === 'sql') { const text = raw.toString('utf8'); expect(text.match(/^INSERT INTO /gm)).toHaveLength(plan.rows); for (const exact of ['18446744073709551615', '9007199254740993.123456789012', '2026-10-23 12:34:56.123456']) expect(text).toContain(Buffer.from(exact).toString('hex')); expect(text).not.toMatch(/CREATE TABLE|DROP TABLE|`computed`/); }
        expect(events.filter(event => event.taskId === taskId && event.status === 'completed')).toHaveLength(1);
      }
      const viewed = await invoke<TableInfo>('metadata.table', { ...target, table: 'subject_view' }); expect(viewed.error).toBeUndefined();
      const viewPath = path.join(directory, 'view.json'); outputs.push(viewPath);
      const viewedExport = await invoke<{ rows: number }>('table.exportFiltered', { ...target, ...scope, table: 'subject_view', metadataKey: tableCopyMetadataKey(viewed.value!), fileToken: crypto.randomUUID(), filePath: viewPath, taskId: crypto.randomUUID(), format: 'json', encoding: 'utf8', filters: [{ column: 'label', operator: 'IN', values: ['ALPHA'] }], filterGroup: undefined });
      expect(viewedExport.error).toBeUndefined(); const viewRows = JSON.parse(await owner.step(() => fs.readFile(viewPath, 'utf8'))); expect(viewRows).toEqual(baseline.filter(row => typeof row.label === 'string' && row.label.trim().toLowerCase() === 'alpha')); expect(viewedExport.value!.rows).toBe(viewRows.length);
      const emptyPath = path.join(directory, 'empty.json'); outputs.push(emptyPath);
      const empty = await invoke<{ rows: number }>('table.exportFiltered', { ...target, ...scope, fileToken: crypto.randomUUID(), filePath: emptyPath, taskId: crypto.randomUUID(), format: 'json', encoding: 'utf8', filters: [{ column: 'id', operator: '<', value: '0' }], filterGroup: undefined }); expect(empty.error).toBeUndefined(); expect(empty.value!.rows).toBe(0); expect(JSON.parse(await owner.step(() => fs.readFile(emptyPath, 'utf8')))).toEqual([]);
      const protectedPath = path.join(directory, 'stale.json'); outputs.push(protectedPath); await owner.step(() => fs.writeFile(protectedPath, '原文件不应改变'));
      const stale = await invoke('table.exportFiltered', { ...target, ...scope, metadataKey: scope.metadataKey + 'changed', fileToken: crypto.randomUUID(), filePath: protectedPath, taskId: crypto.randomUUID(), format: 'json', encoding: 'utf8' }); expect(stale.error).toBeInstanceOf(Error); expect(await owner.step(() => fs.readFile(protectedPath, 'utf8'))).toBe('原文件不应改变');
      expect((await owner.step(() => fs.readdir(directory))).sort()).toEqual(outputs.map(file => path.basename(file)).sort());
      expect(await sql('SHOW CREATE TABLE ' + db + '.`subject`')).toEqual(beforeDdl); expect(await sql('SELECT * FROM ' + db + '.`subject` WHERE id>=? ORDER BY label ASC,id DESC', [1])).toEqual(original);
      expect(await sql('SELECT marker FROM ' + db + '.`__owner`')).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]);
      const ownedIds = facts.filter(fact => fact.managed !== observer).map(fact => fact.id); for (const id of ownedIds) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [id])).toEqual([]);
      fixtureWrites.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      for (const file of outputs) await owner.step(() => fs.unlink(file)); await owner.step(() => fs.rmdir(directory));
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); life.assertTableValueOptionsReleased(facts, false); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '筛选完整导出', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 数据库状态: databaseState, 四格式完整行数: plan.rows, 原任务连接数: ownedIds.length, 产品数据库写入: 0, 原命令与原物理流均结束: true, 数据库及输出残留: 0, 未验: ['GUI及安装包', 'Mac', '真实取消和断线', 'SQL再次导入', '百万行性能'] }) + '\n');
    } catch (error) { retained = true; owner.stop(); process.stdout.write(JSON.stringify({ 专项: '筛选完整导出', 阶段: '停链保留', 数据库状态: databaseState, 自动重跑: false, 自动清理: false }) + '\n'); throw error; }
  });
});
