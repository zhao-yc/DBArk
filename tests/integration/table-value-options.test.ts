import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, FilterRule, TablePage, TaskEvent } from '../../src/shared/contracts';
import type { TableValueOptionsOutput } from '../../src/shared/tableValueOptions';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void) }));
/** 真实connect及其资源回调原样透传；只在原连接返回后被动记录原生句柄。 */
vi.mock('../../src/engine/connection', async importOriginal => { const actual = await importOriginal<typeof import('../../src/engine/connection')>(); return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { if (!audit.watch || !audit.check || !audit.scope) throw Error('不同值实库缺少原owner'); audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed; } }; });
/** 默认及list只登记测试，不读取认证、不载入真实驱动模块。 */
export function tableValueOptionsEnabled(env: Record<string, string | undefined>, args: readonly string[]): boolean { return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_TABLE_VALUE_OPTIONS_TEST === '1'; }
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('服务器不同值六实例真实Engine（默认关闭）', () => {
  it('全部服务器分组/LIKE超500搜索/精确数值/浮点原值回筛/预算与实际释放', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!tableValueOptionsEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('不同值实库原验收保留现场，不自动重跑');
    const helpers = await import('../helpers/tableValueOptionsIntegration'), binding = helpers.bindTableValueOptionsTarget(() => process.env, 'table-values-' + context.task.id), owner = lifetime = helpers.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], events: TaskEvent[] = [], fixtureWrites = new Set<string>(); let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent';
    audit.check = owner.check; audit.watch = (managed, scope) => { if (facts.some(fact => fact.managed === managed)) throw Error('不同值实库重复记录原物理连接'); facts.push(helpers.watchTableValueOptionsConnection(managed, scope, owner, fixtureWrites, (threadId, originalScope) => facts.some(fact => fact.scope === originalScope && fact.id === threadId && fact.commands.some(command => command.sql.startsWith('SELECT CASE') && command.streamed && !command.terminal)))); };
    try {
      const modules = await owner.step(helpers.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      database = 'dbark_tablevalues_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-table-value-options:' + crypto.randomUUID().replaceAll('-', ''); const plan = helpers.planTableValueOptionsFixture(database, marker), db = '`' + database + '`';
      process.stdout.write(JSON.stringify({ 专项: '服务器不同值', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port, 对象: plan.objects, subject行数: 9, candidates行数: 540, 超限单值字节: 262145 }) + '\n');
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => { if (!/^(?:SELECT|SHOW)\b/i.test(statement) && !fixtureWrites.has(statement)) throw Error('不同值observer写入未登记'); audit.scope = 'observer'; return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows; };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), uuidRows = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined; helpers.assertTableValueOptionsIdentity(identity, binding, observer.status, uuidRows);
      const observerId = observer.connection.threadId; if (!Number.isSafeInteger(observerId) || observerId! < 1) throw Error('不同值原观察线程未知'); engine = new modules.engine.Engine(event => events.push(event));
      /** 每次前台handle完成之后核原Query end及原物理流close，不以closeAll替代本次释放。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>) => { audit.scope = command + ':' + crypto.randomUUID(); const offset = facts.length, result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } }); const actual = facts.slice(offset); for (const fact of actual) await owner.step(() => fact.closed); helpers.assertTableValueOptionsReleased(actual, command === 'table.valueOptions'); return { ...result, facts: actual }; };
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) { fixtureWrites.add(statement); if (index === 0) databaseState = 'unknown'; const result = await sql<{ warningStatus: number }>(statement); expect(result.warningStatus).toBe(0); if (index === 0) databaseState = 'confirmed'; }
      for (const statement of plan.seeds) { fixtureWrites.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      expect(await sql(`SELECT marker FROM ${db}.\`__owner\``)).toEqual([{ marker }]);
      // 带实际参数强制原execute二进制协议，FLOAT基线不能由文本短串0.1代替真实FLOAT32宽化值。
      const baselineSql = `SELECT id,label,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,CAST(at_value AS CHAR) AS at_value,approx_value,double_value,color,tags,long_value FROM ${db}.\`subject\` WHERE id>=? ORDER BY id`, baseline = await sql(baselineSql, [1]);
      expect(baseline).toHaveLength(9); expect(baseline.map(row => row.label)).toEqual(plan.labels); expect(baseline.slice(0, 2)).toMatchObject([{ id: 1, big_value: '18446744073709551615', amount: '9007199254740993.123456789012', at_value: '2026-10-23 12:34:56.123456' }, { id: 2, big_value: '18446744073709551614', amount: '-9007199254740993.123456789011', at_value: '2026-10-23 12:34:56.123457' }]);
      expect(baseline[0].approx_value).toBe(Math.fround(0.1)); expect(baseline[1].approx_value).toBe(Math.fround(1e-30)); expect(baseline[2].approx_value).toBe(0); expect(baseline[0].double_value).toBe(9007199254740992); expect(baseline[1].double_value).toBe(9007199254740994);
      const base = { connectionId: binding.profile.id, database, table: 'subject', column: 'label', filters: [] };
      const values = (changes: Record<string, unknown> = {}) => invoke<TableValueOptionsOutput>('table.valueOptions', { ...base, taskId: crypto.randomUUID(), ...changes });
      const page = (filters: FilterRule[]) => invoke<TablePage>('table.page', { connectionId: binding.profile.id, database, table: 'subject', page: 1, pageSize: 100, filters, sort: [{ column: 'id', direction: 'ASC' }] });
      const full = await values(); expect(full.error).toBeUndefined(); const labels = full.value!; expect(labels.source).toMatchObject({ database, name: 'subject', objectKind: 'table' }); expect(labels.sourceDigest).toMatch(/^[a-f0-9]{64}$/); expect(labels.values).toHaveLength(7); expect(labels.truncated).toBe(false);
      const alpha = labels.values.find(item => typeof item.value === 'string' && item.value.trim().toLowerCase() === 'alpha'); expect(alpha?.count).toBe('3');
      for (const value of [null, '', 'NULL', '\n', 'line\nbreak', '尾部中文']) expect(labels.values.find(item => item.value === value)?.count).toBe('1');
      const alphaPage = await page([{ column: 'label', operator: 'IN', values: [String(alpha!.value)] }]); expect(alphaPage.error).toBeUndefined(); expect(alphaPage.value!.rows.map(row => row.id)).toEqual([1, 2, 8]);
      for (const column of ['big_value', 'amount', 'at_value']) {
        const result = await values({ column }); expect(result.error).toBeUndefined();
        for (const item of result.value!.values) {
          const matches = baseline.filter(row => row[column] === item.value); expect(item.count).toBe(String(matches.length));
          const filtered = await page(item.value === null ? [{ column, operator: 'IS NULL' }] : [{ column, operator: 'IN', values: [String(item.value)] }]); expect(filtered.error).toBeUndefined(); expect(filtered.value!.rows.map(row => row.id)).toEqual(matches.map(row => row.id));
        }
      }
      // 真实FLOAT32宽化数和DOUBLE大整数相邻值用产品返回原number回筛，不能拿CAST CHAR短串冒充已匹配。
      for (const column of ['approx_value', 'double_value']) {
        const result = await values({ column }); expect(result.error).toBeUndefined(); expect(result.value!.warnings.some(warning => warning.includes('浮点近似'))).toBe(true);
        for (const item of result.value!.values) {
          if (item.value !== null) expect(typeof item.value).toBe('number'); const matches = baseline.filter(row => row[column] === item.value); expect(item.count).toBe(String(matches.length));
          const filtered = await page(item.value === null ? [{ column, operator: 'IS NULL' }] : [{ column, operator: 'IN', values: [String(item.value)] }]); expect(filtered.error).toBeUndefined(); expect(filtered.value!.rows.map(row => row.id)).toEqual(matches.map(row => row.id));
        }
      }
      const enumValues = await values({ column: 'color' }); expect(enumValues.error).toBeUndefined(); expect(enumValues.value!.values).toEqual([{ value: null, count: '1' }, { value: 'z', count: '4' }, { value: 'a', count: '4' }]);
      const setValues = await values({ column: 'tags' }); expect(setValues.error).toBeUndefined(); expect(setValues.value!.values).toEqual([{ value: null, count: '1' }, { value: '', count: '2' }, { value: 'z', count: '2' }, { value: 'a', count: '2' }, { value: 'z,a', count: '2' }]);
      // 超过默认1024字节且仅在1501st不同的TEXT必须两组，并能分别回筛；禁止前缀误并count2。
      const longValues = await values({ column: 'long_value' }); expect(longValues.error).toBeUndefined(); expect(longValues.value!.values).toEqual([{ value: null, count: '7' }, { value: 'a'.repeat(1500) + 'X', count: '1' }, { value: 'a'.repeat(1500) + 'Y', count: '1' }]);
      for (const item of longValues.value!.values) { const matches = baseline.filter(row => row.long_value === item.value), filtered = await page(item.value === null ? [{ column: 'long_value', operator: 'IS NULL' }] : [{ column: 'long_value', operator: 'IN', values: [String(item.value)] }]); expect(filtered.error).toBeUndefined(); expect(filtered.value!.rows.map(row => row.id)).toEqual(matches.map(row => row.id)); expect(item.count).toBe(String(matches.length)); }
      const grouped = await values({ filters: [{ column: 'id', operator: '=', value: '1' }, { column: 'id', operator: '=', value: '2' }, { column: 'id', operator: '>', value: '0' }, { column: 'label', operator: '=', value: '永不匹配', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, 2, 3] } }); expect(grouped.error).toBeUndefined(); expect(grouped.value!.values).toHaveLength(1); expect(grouped.value!.values[0].count).toBe('2');
      const searched = await values({ searchPattern: '%ALPHA%' }); expect(searched.error).toBeUndefined(); expect(searched.value!.searchPattern).toBe('%ALPHA%'); expect(searched.value!.values).toHaveLength(1); expect(searched.value!.values[0].count).toBe('3');
      const empty = await values({ filters: [{ column: 'id', operator: '<', value: '0' }] }); expect(empty.error).toBeUndefined(); expect(empty.value!.values).toEqual([]);
      const beyond = await values({ table: 'candidates' }); expect(beyond.error).toBeUndefined(); expect(beyond.value!.values).toHaveLength(500); expect(beyond.value!.truncated).toBe(true); expect(beyond.value!.values.some(item => item.value === 'g_0529')).toBe(false); expect(beyond.value!.values.every(item => item.count === '1')).toBe(true);
      const beyondSearch = await values({ table: 'candidates', searchPattern: '%0529' }); expect(beyondSearch.error).toBeUndefined(); expect(beyondSearch.value!.values).toEqual([{ value: 'g_0529', count: '1' }]); expect(beyondSearch.value!.truncated).toBe(false);
      const oversized = await values({ table: 'large_value' }); expect(oversized.error).toBeInstanceOf(Error); expect(String(oversized.error)).toContain('预算'); expect(oversized.value).toBeUndefined(); expect(oversized.facts.filter(fact => fact.commands.some(command => command.sql.startsWith('SELECT CASE')))).toHaveLength(1);
      const viewed = await values({ table: 'subject_view' }); expect(viewed.error).toBeUndefined(); expect(viewed.value!.source.objectKind).toBe('view'); expect(viewed.value!.values).toHaveLength(7);
      expect(await sql(baselineSql, [1])).toEqual(baseline); expect(await sql(`SELECT CAST(COUNT(*) AS CHAR) AS count FROM ${db}.\`candidates\``)).toEqual([{ count: '540' }]); expect(await sql(`SELECT CAST(OCTET_LENGTH(label) AS CHAR) AS bytes FROM ${db}.\`large_value\` ORDER BY id`)).toEqual([{ bytes: '262144' }, { bytes: '262145' }]);
      await owner.step(() => engine!.closeAll()); const tasks = facts.filter(fact => fact.scope !== 'observer'); for (const fact of tasks) await owner.step(() => fact.closed); helpers.assertTableValueOptionsReleased(tasks, false);
      const threadIds = [...new Set(tasks.map(fact => fact.id))]; expect(threadIds.length).toBeGreaterThan(1); expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + threadIds.join(',') + ')')).toEqual([]);
      const actualObjects = await sql('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS marker FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database]);
      expect(actualObjects).toEqual(plan.objects.map(name => ({ name, kind: name === 'subject_view' ? 'VIEW' : 'BASE TABLE', marker: name === 'subject_view' ? 'VIEW' : marker + ':' + (name === '__owner' ? 'owner' : name) })));
      for (const statement of ['SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ?', 'SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA=BINARY ?', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA=BINARY ?']) expect(await sql(statement, [database])).toEqual([]);
      expect(await sql(`SELECT marker FROM ${db}.\`__owner\``)).toEqual([{ marker }]);
      if (databaseState !== 'confirmed') throw Error('不同值本例库归属未确认，不执行清理'); fixtureWrites.add(plan.drop); await sql(plan.drop); expect(await sql(exists, [database])).toEqual([]); databaseState = 'absent';
      const aggregateCommands = tasks.flatMap(fact => fact.commands.filter(command => command.sql.startsWith('SELECT CASE'))); expect(aggregateCommands.length).toBeGreaterThan(10); expect(aggregateCommands.every(command => command.method === 'execute' && command.streamed && command.terminal)).toBe(true);
      const valuesFacts = tasks.filter(fact => fact.scope.startsWith('table.valueOptions:')); expect(valuesFacts.every(fact => fact.strict)).toBe(true); expect(valuesFacts.filter(fact => fact.commands.some(command => command.sql.startsWith('SELECT CASE'))).every(fact => fact.commands.slice(0, 4).map(command => command.sql).join('\n') === ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SET SESSION max_sort_length = 262144', 'SET SESSION sort_buffer_size = 8388608', 'START TRANSACTION READ ONLY'].join('\n'))).toBe(true);
      await owner.step(() => helpers.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed); helpers.assertTableValueOptionsReleased(facts, false); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '服务器不同值', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 原观察线程: observerId, 原任务线程: threadIds, 实际分组执行: aggregateCommands.length, 产品写入: 0, 原任务线程残留: 0, 数据库残留: 0, 原命令及原流全部关闭: true, 浮点binary回筛: true, 超500LIKE: true, 未验: ['本模块未执行原生GUI', '安装包', 'Mac', '取消/警告/目录漂移仅RAM覆盖，未实库注入'] }) + '\n');
    } catch (error) { retained = true; owner.stop(); throw error; }
  });
});
