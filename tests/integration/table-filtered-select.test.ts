import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, TableInfo, TablePage } from '../../src/shared/contracts';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => Promise<void>) }));
/** 透传真实驱动，先登记原命令/流再配置本例session；不改全局、不替换结果或关闭参数。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('筛选SELECT实库缺少原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); await audit.watch(managed, scope); return managed;
  } };
});

/** list先短路，再检查双门；缺门时不导入helper、Engine、mysql或读取认证。 */
export function tableFilteredSelectEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_FILTERED_SELECT_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('当前筛选生成SELECT六实例真实服务器语义（默认关闭）', () => {
  it('新SELECT与实际表页四模式逐值一致，原prepared额外对照仅记账精确既有LIKE差异', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableFilteredSelectEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('筛选SELECT原验收保留现场，不自动重跑');
    const helper = await import('../helpers/tableFilteredSelectIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindTableFilteredSelectTarget(() => process.env, 'filtered-select-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], writes = new Set<string>();
    let observer: ManagedConnection | undefined, databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent', database = '', marker = '', mode = '', completedCases = 0;
    let comparison: Record<string, unknown> | undefined;
    const scopes: { mode: string; name: string; rows: number }[] = [];
    const preparedLikeDivergences: import('../helpers/tableFilteredSelectIntegration').TableFilteredSelectPreparedLikeDivergence[] = [];
    audit.check = owner.check;
    try {
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      const sqlModule = await owner.step(() => import('../../src/engine/sql')), compiler = await owner.step(() => import('../../src/shared/tableReadSql'));
      const observerAudit = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      database = 'dbark_filteredselect_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-filtered-select:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planTableFilteredSelectFixture(database, marker), cases = helper.tableFilteredSelectCases();
      const policy = helper.createTableFilteredSelectAudit(plan, cases, writes, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      let connectionEncoding: unknown;
      const normalizedModes = (value: string) => value.split(',').filter(Boolean).sort();
      audit.watch = async (managed, scope) => {
        facts.push(observerAudit.watchTableFilteredExportConnection(managed, scope, owner, policy));
        // 观察者与每条产品物理连接执行相同的SESSION模式，随后读取实际值再用于语义对照。
        await modules.connection.execute(managed, "SET SESSION sql_mode = '" + mode + "'"); owner.check();
        const actual = (await modules.connection.execute<{ mode: string }[]>(managed, 'SELECT @@SESSION.sql_mode AS mode')).rows;
        expect(actual).toHaveLength(1); expect(normalizedModes(actual[0].mode)).toEqual(normalizedModes(mode)); managed.sqlMode = actual[0].mode;
        const encoding = (await modules.connection.execute(managed, 'SELECT @@SESSION.character_set_connection AS charset,@@SESSION.collation_connection AS collation')).rows;
        if (connectionEncoding === undefined) connectionEncoding = encoding; else expect(encoding).toEqual(connectionEncoding);
      };
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, values, 'observer');
        return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      process.stdout.write(JSON.stringify({ 专项: '筛选生成SELECT', 阶段: '原资源计划', 数据库: database, 标记: marker, 端口: binding.profile.port, 对象: plan.objects, 行数: plan.rows.length, 模式: helper.filteredSelectModes, 字符集: connectionEncoding }) + '\n');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) {
        writes.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed';
      }
      for (const statement of plan.seeds) { writes.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      const originalDdl = await sql('SHOW CREATE TABLE ' + plan.table), originalRows = await sql('SELECT * FROM ' + plan.table + ' ORDER BY `id` ASC');
      expect(originalRows).toEqual(plan.rows);
      const engine = new modules.engine.Engine(() => undefined);
      /** 普通Engine页沿用原close参数，仍等待原callback/end与物理stream close，不能以closeAll替代。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>) => {
        audit.scope = command + ':' + crypto.randomUUID(); const offset = facts.length;
        const result = await owner.step(() => engine.handle(command, input) as Promise<T>);
        const actual = facts.slice(offset); expect(actual).toHaveLength(1);
        for (const fact of actual) await owner.step(() => fact.closed);
        life.assertTableValueOptionsReleased(actual, false); return result;
      };
      await invoke('connections.open', { id: binding.profile.id, profile: binding.profile });
      const target = { connectionId: binding.profile.id, database, table: helper.filteredSelectTable };
      const info = await invoke<TableInfo>('metadata.table', target); expect(info.columns.map(column => column.name)).toEqual(helper.filteredSelectColumns); expect(info.editableKey).toEqual(['id']);
      const serialize = (rows: Record<string, unknown>[]) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlModule.serializeCell(value)]))) as DataRow[];
      for (mode of helper.filteredSelectModes) {
        await sql("SET SESSION sql_mode = '" + mode + "'");
        const actualMode = await sql<{ mode: string }[]>('SELECT @@SESSION.sql_mode AS mode'); expect(normalizedModes(actualMode[0].mode)).toEqual(normalizedModes(mode)); observer.sqlMode = actualMode[0].mode;
        for (const item of cases) {
          const expected = helper.filteredSelectCaseSql(database, item);
          comparison = { 模式: mode, 用例: item.name, 阶段: '原prepared基线', preparedSQL: expected.prepared, 原参数: item.values };
          const prepared = sqlModule.buildPageSql(info, 1, 1000, item.filters, item.sort, item.filterMode, item.filterGroup);
          // 独立手工模板和原prepared值必须先完全相等，才允许真实执行，避免产品生成器自证授权。
          expect(prepared).toEqual({ sql: expected.prepared, params: item.values });
          const baseline = serialize(await sql(expected.prepared, item.values));
          comparison.原prepared结果 = baseline;
          if (item.expectedIds) expect(baseline.map(row => row.id).sort((left, right) => Number(left) - Number(right))).toEqual(item.expectedIds);
          comparison.阶段 = '核对实际Engine表页的既有语义';
          const page = await invoke<TablePage>('table.page', { ...target, page: 1, pageSize: 1000, filters: item.filters, filterMode: item.filterMode, filterGroup: item.filterGroup, sort: item.sort });
          comparison.实际Engine页结果 = page.rows;
          const divergence = helper.assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: baseline, actualPageRows: page.rows, fixtureRows: plan.rows });
          if (divergence) { preparedLikeDivergences.push(divergence); comparison.已登记原prepared差异 = divergence; }
          else expect(page.rows, '未登记为准确既有LIKE差异的原prepared结果必须仍与实际页全字段全序相等').toEqual(baseline);
          expect(page.hasMore).toBe(false);
          // 本地生成的数据库执行门槛：编译前后原命令和原连接数不能增长；GUI打开另行验收。
          const commands = facts.reduce((sum, fact) => sum + fact.commands.length, 0), connections = facts.length;
          const generated = compiler.buildFilteredTableSelect({ info, filters: item.filters, filterMode: item.filterMode, filterGroup: item.filterGroup, sort: item.sort, columns: item.columns, limit: item.limit });
          comparison.阶段 = '核对新生成SELECT'; comparison.生成SQL = generated.sql;
          expect(generated).toEqual({ sql: expected.generated, parameters: 0 }); expect(facts).toHaveLength(connections); expect(facts.reduce((sum, fact) => sum + fact.commands.length, 0)).toBe(commands);
          const result = serialize(await sql(generated.sql));
          comparison.新SELECT结果 = result;
          expect(result, '新SELECT必须与实际inline原页逐字段及原顺序一致，包括已登记prepared差异用例').toEqual(page.rows.slice(0, item.limit).map(row => Object.fromEntries(item.columns.map(column => [column, row[column]]))));
          if (result.length) expect(Object.keys(result[0])).toEqual(item.columns);
          if (!item.filters.length) {
            const later = await invoke<TablePage>('table.page', { ...target, page: 2, pageSize: 3, filters: [], sort: item.sort });
            expect(later.rows).toEqual(page.rows.slice(3, 6)); expect(result.map(row => row.id)).toEqual(page.rows.slice(0, 3).map(row => row.id)); expect(result.map(row => row.id)).not.toEqual(later.rows.map(row => row.id));
          }
          completedCases++; scopes.push({ mode, name: item.name, rows: result.length }); comparison.阶段 = '本用例完成';
        }
      }
      // 恢复原定义读取的SESSION模式，按原内容与对象目录核对后才删除本例准确库。
      mode = ''; await sql("SET SESSION sql_mode = ''"); observer.sqlMode = '';
      expect(await sql('SHOW CREATE TABLE ' + plan.table)).toEqual(originalDdl); expect(await sql('SELECT * FROM ' + plan.table + ' ORDER BY `id` ASC')).toEqual(originalRows);
      expect(await sql('SELECT marker FROM `' + database + '`.`__owner`')).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]);
      const owned = facts.filter(fact => fact.managed !== observer); for (const fact of owned) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      writes.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed);
      life.assertTableValueOptionsReleased(facts, false); life.assertTableValueOptionsReleased(facts.filter(fact => fact.managed === observer), true); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '筛选生成SELECT', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 完成用例: completedCases, 验收语义: '新SELECT与实际inline表页全字段全序相等；原prepared额外对照仅记账准确既有LIKE差异', knownBaselineDivergences: preparedLikeDivergences.length, preparedLikeDivergences, 明细: scopes, 原任务连接数: owned.length, 本地生成数据库执行: 0, 产品数据库写入: 0, 原callback及end及物理流结束: true, 观察连接严格关闭: true, 产品原关闭方式: '普通表页原close不传strict，原样观察且等待物理close', 数据库及资源残留: 0, 未验: ['GUI打开草稿及运行按钮', '安装包', 'Mac', '真实取消和断线', '100000行性能'] }) + '\n');
    } catch (error) {
      retained = true; owner.stop();
      process.stdout.write(JSON.stringify({ 专项: '筛选生成SELECT', 阶段: '停链保留', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 当前模式: mode, 已完成用例: completedCases, knownBaselineDivergences: preparedLikeDivergences.length, preparedLikeDivergences, 语义诊断: comparison, 原资源: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })), 自动重跑: false, 自动清理: false }) + '\n'); throw error;
    }
  });
});
