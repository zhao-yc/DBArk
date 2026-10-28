import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TableInfo, TablePage, TaskEvent } from '../../src/shared/contracts';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void) }));
/** 只包裹真实连接入口，SQL、原结果、callback、end和物理stream全部透传。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('NULL排序实库缺少原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});
/** 默认和list先短路；缺双门不加载Engine、mysql或认证。 */
export function tableSortNullsEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_SORT_NULLS_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('表浏览NULL排序六实例真实Engine（默认关闭）', () => {
  it('三类原值四组合、跨1000行分页、独立SELECT和四格式真实文件保持同序', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableSortNullsEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('NULL排序原验收已保留现场，不自动重跑');
    const helper = await import('../helpers/tableSortNullsIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindTableSortNullsTarget(() => process.env, 'sort-nulls-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], events: TaskEvent[] = [], writes = new Set<string>();
    let observer: ManagedConnection | undefined, databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent', database = '', marker = '', currentCase = '', directory = '';
    const completed: string[] = [];
    audit.check = owner.check;
    try {
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      const fs = await owner.step(() => import('node:fs/promises')), path = await owner.step(() => import('node:path')), os = await owner.step(() => import('node:os'));
      const observerAudit = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      const sqlModule = await owner.step(() => import('../../src/engine/sql')), compiler = await owner.step(() => import('../../src/shared/tableReadSql'));
      const planner = await owner.step(() => import('../../src/engine/tableFilteredExport')), sourceKey = await owner.step(() => import('../../src/shared/tableCopySource'));
      const files = await owner.step(() => import('../../src/engine/files')), excel = await owner.step(() => import('../../src/engine/excelFiles'));
      database = 'dbark_sortnulls_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-sort-nulls:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planTableSortNullsFixture(database, marker), cases = helper.tableSortNullsCases();
      const policy = helper.createTableSortNullsAudit(plan, cases, writes, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      audit.watch = (managed, scope) => facts.push(observerAudit.watchTableFilteredExportConnection(managed, scope, owner, policy));
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, values, 'observer'); return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      process.stdout.write(JSON.stringify({ 专项: '表NULL排序', 阶段: '原资源计划', 数据库: database, 标记: marker, 端口: binding.profile.port, 行数: plan.rows.length, 用例: cases.map(item => item.name) }) + '\n');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) { writes.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed'; }
      for (const statement of plan.seeds) { writes.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      const originalDdl = await sql('SHOW CREATE TABLE ' + plan.table), rawSql = 'SELECT * FROM ' + plan.table + ' ORDER BY `tenant` ASC, `id` ASC';
      const originalRows = await sql(rawSql), digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const originalDigest = digest(originalRows), serialize = (rows: Record<string, unknown>[]) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlModule.serializeCell(value)]))) as DataRow[];
      expect(serialize(originalRows)).toEqual([...plan.rows].sort((a, b) => Number(a.tenant) - Number(b.tenant) || Number(a.id) - Number(b.id)));
      expect(plan.rows.some(row => row.label === null)).toBe(true); expect(plan.rows.some(row => row.label === '')).toBe(true);
      const engine = new modules.engine.Engine(event => events.push(event));
      /** 等待原handle和每个物理close，不用closeAll替代原page或export终态。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>) => {
        audit.scope = command + ':' + crypto.randomUUID(); const offset = facts.length;
        const result = await owner.step(() => engine.handle(command, input) as Promise<T>);
        const actual = facts.slice(offset); expect(actual).toHaveLength(1);
        for (const fact of actual) await owner.step(() => fact.closed);
        life.assertTableValueOptionsReleased(actual, command === 'table.exportFiltered'); return { result, facts: actual };
      };
      await invoke('connections.open', { id: binding.profile.id, profile: binding.profile });
      const target = { connectionId: binding.profile.id, database, table: 'subject' };
      const info = (await invoke<TableInfo>('metadata.table', target)).result;
      expect(info.columns.map(column => column.name)).toEqual(helper.sortNullsColumns); expect(info.editableKey).toEqual(['tenant', 'id']);
      const projected = (rows: readonly DataRow[]) => rows.map(row => Object.fromEntries(helper.sortNullsProjection.map(column => [column, row[column]])));
      for (const item of cases) {
        currentCase = item.name;
        const expected = helper.expectedTableSortNullsRows(plan.rows, item), manual = 'SELECT * FROM ' + plan.table + ' ORDER BY ' + item.order;
        // 手工SQL必须先符合独立明确row_no序列及全字段值，再比较产品页，避免生成器自证。
        const baseline = serialize(await sql(manual)); expect(baseline.map(row => row.row_no)).toEqual(expected.map(row => row.row_no)); expect(baseline).toEqual(expected);
        const joined: DataRow[] = [];
        for (const pageIndex of [1, 2]) {
          const expectedSql = manual + ' LIMIT 1001 OFFSET ' + (pageIndex - 1) * 1000;
          expect(sqlModule.buildPageSql(info, pageIndex, 1000, [], item.sort)).toEqual({ sql: expectedSql, params: [] });
          const page = (await invoke<TablePage>('table.page', { ...target, page: pageIndex, pageSize: 1000, filters: [], sort: item.sort })).result;
          expect(page.hasMore).toBe(pageIndex === 1); expect(page.rows).toEqual(expected.slice((pageIndex - 1) * 1000, pageIndex * 1000)); joined.push(...page.rows);
        }
        expect(joined).toEqual(expected); expect(new Set(joined.map(row => row.row_no)).size).toBe(1005);
        const generatedSql = 'SELECT ' + helper.sortNullsProjection.map(column => '`' + column + '`').join(', ') + ' FROM ' + plan.table + ' ORDER BY ' + item.order + ' LIMIT 1005;';
        const count = facts.length, commands = facts.reduce((sum, fact) => sum + fact.commands.length, 0);
        expect(compiler.buildFilteredTableSelect({ info, filters: [], sort: item.sort, columns: helper.sortNullsProjection, limit: 1005 })).toEqual({ sql: generatedSql, parameters: 0 });
        expect(facts).toHaveLength(count); expect(facts.reduce((sum, fact) => sum + fact.commands.length, 0)).toBe(commands);
        expect(serialize(await sql(generatedSql))).toEqual(projected(expected)); completed.push(item.name);
      }
      const composite = cases.find(item => item.name === '复合三列')!, expected = projected(helper.expectedTableSortNullsRows(plan.rows, composite));
      directory = await owner.step(() => fs.mkdtemp(path.join(os.tmpdir(), 'dbark-sort-nulls-'))); const outputs: string[] = [];
      const metadataKey = sourceKey.tableCopyMetadataKey(info), exportSql = 'SELECT ' + helper.sortNullsProjection.map(column => '`' + column + '`').join(', ') + ' FROM ' + plan.table + ' ORDER BY ' + composite.order;
      for (const format of ['csv', 'json', 'sql', 'xlsx'] as const) {
        currentCase = '四格式:' + format;
        const taskId = crypto.randomUUID(), filePath = path.join(directory, 'null-order.' + format); outputs.push(filePath);
        await owner.step(() => fs.writeFile(filePath, '原目标文件'));
        const input = { ...target, metadataKey, filters: [], sort: composite.sort, columns: helper.sortNullsProjection, format, encoding: 'utf8' as const, ...(format === 'csv' ? { csvDelimiter: ';' as const } : {}), taskId, fileToken: crypto.randomUUID(), filePath };
        expect(planner.planTableFilteredExport(info, input).sql).toBe(exportSql);
        const output = await invoke<{ rows: number; fileCommitted: true }>('table.exportFiltered', input);
        expect(output.result).toEqual({ rows: 1005, fileCommitted: true });
        const streams = output.facts[0].commands.filter(command => command.streamed); expect(streams).toHaveLength(1); expect(streams[0]).toMatchObject({ method: 'execute', sql: exportSql, terminal: true });
        const raw = await owner.step(() => fs.readFile(filePath));
        const textRows = expected.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : String(value)])));
        if (format === 'json') expect(JSON.parse(raw.toString('utf8'))).toEqual(expected);
        if (format === 'csv') { expect(raw.toString('utf8').split('\r\n')[0]).toBe(helper.sortNullsProjection.join(';')); expect(await observerAudit.collectTableFilteredExportRows(files.readRecords(filePath, 'csv', 'utf8', ';'), owner)).toEqual(textRows); }
        if (format === 'xlsx') {
          const sheets = await owner.step(() => excel.listExcelSheets({ filePath, checkCancelled: owner.check })); expect(sheets).toHaveLength(1);
          const options = { filePath, sheetId: sheets[0].id, protocol: 'dbark-v1' as const, checkCancelled: owner.check };
          expect((await owner.step(() => excel.previewExcelSheet(options))).columns).toEqual(helper.sortNullsProjection);
          expect(await observerAudit.collectTableFilteredExportRows(excel.readExcelRows(options), owner)).toEqual(textRows);
        }
        if (format === 'sql') {
          // 不执行导出SQL；逐行核INSERT列序、NULL及精确数原文，文件全序与独立基线相同。
          const prefix = 'INSERT INTO ' + plan.table + ' (' + helper.sortNullsProjection.map(column => '`' + column + '`').join(', ') + ') VALUES (';
          const cell = (value: DataRow[string]) => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "_utf8mb4 X'" + Buffer.from(String(value), 'utf8').toString('hex') + "'";
          expect(raw.toString('utf8').split('\n').filter(line => line.startsWith('INSERT INTO '))).toEqual(expected.map(row => prefix + helper.sortNullsProjection.map(column => cell(row[column])).join(', ') + ');'));
          expect(raw.toString('utf8')).not.toMatch(/CREATE TABLE|DROP TABLE|`label`/);
        }
        expect(events.filter(event => event.taskId === taskId && event.status === 'completed')).toHaveLength(1);
        expect((await owner.step(() => fs.readdir(directory))).sort()).toEqual(outputs.map(file => path.basename(file)).sort());
      }
      expect(await sql('SHOW CREATE TABLE ' + plan.table)).toEqual(originalDdl); const afterRows = await sql(rawSql); expect(afterRows).toEqual(originalRows); expect(digest(afterRows)).toBe(originalDigest);
      expect(await sql('SELECT marker FROM ' + plan.db + '.`__owner`')).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]);
      for (const fact of facts.filter(fact => fact.managed !== observer)) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      writes.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      for (const file of outputs) await owner.step(() => fs.unlink(file)); await owner.step(() => fs.rmdir(directory));
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed);
      life.assertTableValueOptionsReleased(facts, false); life.assertTableValueOptionsReleased(facts.filter(fact => fact.managed === observer), true); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '表NULL排序', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 数据库状态: databaseState, 完成用例: completed, 原行摘要: originalDigest, 行数: 1005, 四格式原子提交: true, 产品数据库写入: 0, 原命令及物理流终态: true, 数据库及输出残留: 0, 未验: ['GUI和安装包', 'Mac', '真实取消和断线', 'SQL再次导入', '大数据性能', '四格式各自完整12组合矩阵'] }) + '\n');
    } catch (error) {
      retained = true; owner.stop(); process.stdout.write(JSON.stringify({ 专项: '表NULL排序', 阶段: '停链保留', 数据库: database, 标记: marker, 数据库状态: databaseState, 输出目录: directory, 当前用例: currentCase, 已完成: completed, 原资源: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })), 自动重跑: false, 自动清理: false }) + '\n'); throw error;
    }
  });
});
