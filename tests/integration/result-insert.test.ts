import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DataRow, EngineCommand, ResultExportData, TaskEvent } from '../../src/shared/contracts';
import type { ResultInsertApplyOutput, ResultInsertPreviewOutput } from '../../src/shared/resultInsert';
import type { TableValueOptionsConnectionFact, TableValueOptionsLifetime } from '../helpers/tableValueOptionsIntegration';

const audit = vi.hoisted(() => ({ scope: '', check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void) }));
/** 观察真实驱动的原参数、callback/end与物理流，不替换响应或注入产品SQL。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.check || !audit.watch || !audit.scope) throw Error('结果直接插入实库缺少原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

/** list先短路，再核独立双门；默认不读取认证、不导入helper、Engine或mysql。 */
export function resultInsertIntegrationEnabled(env: Record<string, string | undefined>, args: readonly string[]) {
  return !args.some(value => value === 'list' || value === '--list' || value.startsWith('--list=')) && env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_RESULT_INSERT_TEST === '1';
}
let lifetime: TableValueOptionsLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('已返回结果直接写入已有表六实例真实事务（默认关闭）', () => {
  it('预览零写入、精确整批提交、失败整批回滚、定义漂移和单次令牌', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!resultInsertIntegrationEnabled(process.env, process.argv)) { context.skip(); return; }
    if (retained) throw Error('结果直接插入原验收保留现场，不自动重跑');
    const helper = await import('../helpers/resultInsertIntegration'), life = await import('../helpers/tableValueOptionsIntegration');
    const binding = helper.bindResultInsertTarget(() => process.env, 'result-insert-' + context.task.id), owner = lifetime = life.tableValueOptionsLifetime(context, binding, () => { retained = true; });
    const facts: TableValueOptionsConnectionFact[] = [], writes = new Set<string>(), events: TaskEvent[] = [];
    let sqlDiagnostic = () => ({ 已拒绝SQL: [] as { sql: string; scope: string }[], 末尾原SQL: [] as { sql: string; scope: string }[] });
    let observer: ManagedConnection | undefined, database = '', marker = '', databaseState: 'absent' | 'unknown' | 'confirmed' = 'absent', phase = '初始化';
    audit.check = owner.check;
    try {
      const modules = await owner.step(life.loadTableValueOptionsModules), crypto = await owner.step(() => import('node:crypto'));
      const sqlModule = await owner.step(() => import('../../src/engine/sql')), auditModule = await owner.step(() => import('../helpers/tableFilteredExportSqlAudit'));
      database = 'dbark_resultinsert_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-result-insert:' + crypto.randomUUID().replaceAll('-', '');
      const plan = helper.planResultInsertFixture(database, marker), precise = helper.resultInsertPrecisionData();
      const policy = helper.createResultInsertSqlAudit(plan, writes, id => facts.some(fact => fact.id === id && fact.managed !== observer));
      sqlDiagnostic = () => ({ 已拒绝SQL: policy.rejected, 末尾原SQL: policy.sent.slice(-8).map(({ sql, scope }) => ({ sql, scope })) });
      audit.watch = (managed, scope) => facts.push(auditModule.watchTableFilteredExportConnection(managed, scope, owner, policy));
      const sql = async <T = Record<string, unknown>[]>(statement: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        owner.check(); policy.assert(statement, values, 'observer'); return (await owner.step(() => modules.connection.execute<T>(observer!, statement, values))).rows;
      };
      audit.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
      life.assertTableValueOptionsIdentity(await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), binding, observer.status, binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined);
      const initialMode = await sql<{ sqlMode: string }[]>('SELECT @@SESSION.sql_mode AS sqlMode'); expect(initialMode).toHaveLength(1); expect(typeof initialMode[0].sqlMode).toBe('string'); policy.bindInitialSqlMode(initialMode[0].sqlMode);
      process.stdout.write(JSON.stringify({ 专项: '结果直接插入', 阶段: '原资源计划', 端口: binding.profile.port, 数据库: database, 标记: marker, 对象: plan.objects, 精度行数: precise.data.rows.length, 源: '固定RAM已返回结果，无来源SQL' }) + '\n');
      const exists = 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?'; expect(await sql(exists, [database])).toEqual([]);
      for (const [index, statement] of plan.creates.entries()) {
        writes.add(statement); if (!index) databaseState = 'unknown'; expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); if (!index) databaseState = 'confirmed';
      }
      for (const statement of plan.seeds) { writes.add(statement); expect((await sql<{ warningStatus: number }>(statement)).warningStatus).toBe(0); }
      await sql("SET SESSION time_zone = '+00:00'"); expect(await sql('SELECT @@SESSION.time_zone AS timeZone')).toEqual([{ timeZone: '+00:00' }]);
      const readRows = async (table: string) => (await sql('SELECT * FROM ' + plan.table(table) + ' ORDER BY `' + (table === 'nokey' ? 'value' : 'id') + '` ASC')).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqlModule.serializeCell(value)]))) as DataRow[];
      const before = new Map<string, DataRow[]>(), definitions = new Map<string, unknown>();
      for (const table of ['precise', 'nokey', 'conflict', 'drift']) { before.set(table, await readRows(table)); definitions.set(table, await sql('SHOW CREATE TABLE ' + plan.table(table))); }
      expect(before.get('precise')).toEqual([]); expect(before.get('nokey')).toEqual([]); expect(before.get('drift')).toEqual([]); expect(before.get('conflict')).toEqual([{ id: 9, label: 'occupied' }]);
      const engine = new modules.engine.Engine(event => events.push(event));
      /** 每条真实Engine调用保留原错误，待原命令及严格物理关闭后再断言预期业务结果。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, label: string, count: number) => {
        audit.scope = command + ':' + label; const offset = facts.length;
        const trusted = command === 'result.insertPreview' || command === 'result.insertApply' ? { ...input, profile: binding.profile, connectionRevision: 0 } : input;
        const result = await owner.step(async () => { try { return { value: await engine.handle(command, trusted) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(offset); expect(actual).toHaveLength(count); for (const fact of actual) await owner.step(() => fact.closed);
        life.assertTableValueOptionsReleased(actual, true); return { ...result, facts: actual, taskId: typeof input.taskId === 'string' ? input.taskId : undefined };
      };
      const target = (table: string) => ({ connectionId: binding.profile.id, database, table });
      const preview = async (table: string, data: ResultExportData, mapping: { source: string; target: string }[], label: string) => {
        phase = '预览:' + label; const original = await readRows(table), sent = policy.sent.length;
        const result = await invoke<ResultInsertPreviewOutput>('result.insertPreview', { ...target(table), taskId: crypto.randomUUID(), data, mapping, timeZone: '+00:00' }, label, 1);
        expect(result.error).toBeUndefined(); expect(result.value!.target).toEqual(target(table)); expect(result.value!.rows).toBe(data.rows.length); expect(result.value!.mapping).toEqual(mapping); expect(result.value!.sourceTruncated).toBe(data.truncated); expect(result.value!.timeZone).toBe('+00:00');
        expect(result.value!.shownRows).toBe(Math.min(20, data.rows.length)); expect(result.value!.definitionDigest).toMatch(/^[a-f0-9]{64}$/); expect(result.value!.previewToken).toMatch(/^[a-f0-9-]{36}$/); expect(Date.parse(result.value!.expiresAt)).toBeGreaterThan(Date.now());
        expect(policy.sent.slice(sent).filter(item => item.sql.startsWith('INSERT '))).toEqual([]); expect(await readRows(table)).toEqual(original); return result.value!;
      };
      const apply = (table: string, token: string, label: string, count = 1) => {
        phase = '执行:' + label; return invoke<ResultInsertApplyOutput>('result.insertApply', { connectionId: binding.profile.id, taskId: crypto.randomUUID(), previewToken: token, confirmation: database + '.' + table, acknowledged: true }, label, count);
      };

      const precisePreview = await preview('precise', precise.data, precise.mapping, 'precise');
      // 预览后的调用方RAM变化不能改写引擎持有的原快照，也不能引发来源SQL重跑。
      precise.data.rows[0].source_unsigned = '1'; precise.data.rows[1].source_text = '预览后调用方修改';
      const preciseStart = policy.sent.length, inserted = await apply('precise', precisePreview.previewToken, 'precise');
      expect(inserted.error).toBeUndefined(); expect(inserted.value).toEqual({ target: target('precise'), rows: 3, outcome: 'committed', commitAcknowledged: true }); expect(await readRows('precise')).toEqual(precise.expectedRows);
      expect(policy.sent.slice(preciseStart).filter(item => item.sql === 'COMMIT')).toHaveLength(1);
      expect(policy.sent.slice(preciseStart).filter(item => item.sql.startsWith('INSERT '))).toHaveLength(3); expect(policy.sent.slice(preciseStart).filter(item => item.sql === 'ROLLBACK')).toEqual([]);
      expect(events.filter(event => event.taskId === inserted.taskId && event.status === 'completed' && event.resultInsert?.commitAcknowledged && event.resultInsert.outcome === 'committed')).toHaveLength(1);
      const replayStart = policy.sent.length, replay = await apply('precise', precisePreview.previewToken, 'replay', 0); expect(replay.error).toBeInstanceOf(Error); expect(policy.sent).toHaveLength(replayStart);

      const nokeyData: ResultExportData = { columns: [{ key: 'v', name: '无可靠键字段' }], rows: [{ v: '无主键也可插入' }], truncated: false };
      const nokeyPreview = await preview('nokey', nokeyData, [{ source: 'v', target: 'value' }], 'nokey'), nokey = await apply('nokey', nokeyPreview.previewToken, 'nokey');
      expect(nokey.error).toBeUndefined(); expect(nokey.value).toEqual({ target: target('nokey'), rows: 1, outcome: 'committed', commitAcknowledged: true }); expect(await readRows('nokey')).toEqual([{ value: '无主键也可插入' }]);

      phase = '生成列映射拒绝'; const generatedStart = policy.sent.length, generated = await invoke<ResultInsertPreviewOutput>('result.insertPreview', { ...target('precise'), taskId: crypto.randomUUID(), data: helper.resultInsertPrecisionData().data, mapping: [{ source: 'source_decimal', target: 'computed' }], timeZone: '+00:00' }, 'generated', 1);
      expect(generated.error).toBeInstanceOf(Error); expect(policy.sent.slice(generatedStart).filter(item => item.sql.startsWith('INSERT '))).toEqual([]); expect(await readRows('precise')).toEqual(precise.expectedRows);

      const conflictData: ResultExportData = { columns: [{ key: 'i', name: '编号' }, { key: 'label', name: '标签' }], rows: [{ i: '1', label: 'fresh' }, { i: '2', label: 'occupied' }], truncated: false };
      const conflictPreview = await preview('conflict', conflictData, [{ source: 'i', target: 'id' }, { source: 'label', target: 'label' }], 'conflict'), conflictStart = policy.sent.length;
      const conflict = await apply('conflict', conflictPreview.previewToken, 'conflict'); expect(conflict.error).toBeInstanceOf(Error); expect(await readRows('conflict')).toEqual(before.get('conflict'));
      expect(policy.sent.slice(conflictStart).filter(item => item.sql.startsWith('INSERT '))).toHaveLength(2); expect(policy.sent.slice(conflictStart).filter(item => item.sql === 'COMMIT')).toEqual([]); expect(policy.sent.slice(conflictStart).filter(item => item.sql.startsWith('ROLLBACK'))).toHaveLength(1);
      const conflictTerminal = events.filter(event => event.taskId === conflict.taskId && event.status === 'failed'); expect(conflictTerminal).toHaveLength(1);
      expect(conflictTerminal[0].resultInsert).toMatchObject({ rows: 1, totalRows: 2, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true, outcome: 'rolled-back' });

      const driftData: ResultExportData = { columns: [{ key: 'i', name: '编号' }, { key: 'v', name: '内容' }], rows: [{ i: '1', v: '定义漂移不写入' }], truncated: false };
      const driftMapping = [{ source: 'i', target: 'id' }, { source: 'v', target: 'value' }], driftPreview = await preview('drift', driftData, driftMapping, 'drift');
      writes.add(plan.drift); expect((await sql<{ warningStatus: number }>(plan.drift)).warningStatus).toBe(0); definitions.set('drift', await sql('SHOW CREATE TABLE ' + plan.table('drift')));
      const driftStart = policy.sent.length, drift = await apply('drift', driftPreview.previewToken, 'drift'); expect(drift.error).toBeInstanceOf(Error); expect(policy.sent.slice(driftStart).filter(item => item.sql.startsWith('INSERT '))).toEqual([]); expect(await readRows('drift')).toEqual([]);
      const releasePreview = await preview('drift', driftData, driftMapping, 'release'); expect((await invoke('result.insertRelease', { connectionId: binding.profile.id, previewToken: releasePreview.previewToken }, 'release', 0)).error).toBeUndefined();
      const releasedStart = policy.sent.length, released = await apply('drift', releasePreview.previewToken, 'released', 0); expect(released.error).toBeInstanceOf(Error); expect(policy.sent).toHaveLength(releasedStart);

      phase = '核原定义行和准确资源';
      for (const table of ['precise', 'nokey', 'conflict', 'drift']) {
        const actual = await sql('SHOW CREATE TABLE ' + plan.table(table));
        // 插入自增值只允许下一计数变化；其它定义必须与原完整DDL一致，drift仅接受本例明确ALTER后的定义。
        const normalize = (value: unknown) => JSON.stringify(value).replace(/ AUTO_INCREMENT=\d+/g, ''); expect(normalize(actual)).toBe(normalize(definitions.get(table)));
      }
      expect(await readRows('precise')).toEqual(precise.expectedRows); expect(await readRows('nokey')).toEqual([{ value: '无主键也可插入' }]); expect(await readRows('conflict')).toEqual(before.get('conflict')); expect(await readRows('drift')).toEqual([]);
      expect(await sql('SELECT marker FROM ' + plan.table('__owner'))).toEqual([{ marker }]);
      expect(await sql('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [database])).toEqual(plan.objects.map(name => ({ name })));
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [database])).toEqual([]);
      expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [database])).toEqual([]); const owned = facts.filter(fact => fact.managed !== observer);
      for (const fact of owned) expect(await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      writes.add(plan.drop); await sql(plan.drop); databaseState = 'absent'; expect(await sql(exists, [database])).toEqual([]);
      await owner.step(() => life.closeTableValueOptionsObserver(observer!)); await owner.step(() => facts.find(fact => fact.managed === observer)!.closed);
      life.assertTableValueOptionsReleased(facts, true); complete = true;
      process.stdout.write(JSON.stringify({ 专项: '结果直接插入', 阶段: '完成', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 精确提交行: 3, 无主键提交行: 1, 唯一冲突整批回滚: true, 预览INSERT: 0, 定义漂移INSERT: 0, 来源SQL重跑: 0, replay及release后数据库执行: 0, 原callback及end及严格物理流结束: true, 原产品连接数: owned.length, 数据库及资源残留: 0, 事件数: events.length, 未验: ['真实取消和断线', '取消控制连接实际触发', 'GUI', '安装包', 'Mac', '10万行性能', '触发器及外部副作用回滚'] }) + '\n');
    } catch (error) {
      retained = true; owner.stop(); process.stdout.write(JSON.stringify({ 专项: '结果直接插入', 阶段: '停链保留', 端口: binding.profile.port, 数据库: database, 标记: marker, 数据库状态: databaseState, 当前阶段: phase, SQL审计: sqlDiagnostic(), 原资源: facts.map(fact => ({ id: fact.id, scope: fact.scope, pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose })), 自动重跑: false, 自动清理: false }) + '\n'); throw error;
    }
  });
});
