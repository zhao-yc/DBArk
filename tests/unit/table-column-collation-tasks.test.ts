import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { collationFacts } from '../fixtures/column-collation-facts';
import type { StructureDefinitionRead, StructureTaskContext } from '../../src/engine/structureDefinition';
import type { IndexReferenceNames } from '../../src/engine/tableIndexRead';
import type { ColumnTaskHost, ColumnTaskOptions } from '../../src/engine/tableColumnPatchTasks';
import type { TableColumnGetOutput, TableColumnPatchTarget, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';
const ports = vi.hoisted(() => ({ definition: vi.fn(), facts: vi.fn() }));
// 仅完整定义/索引准备reader使用合成目录；物理reader、共用查询、Tasks和execution模块均为真实代码。
vi.mock('../../src/engine/structureDefinition', async () => ({ ...await vi.importActual<any>('../../src/engine/structureDefinition'), readStructureDefinition: ports.definition }));
vi.mock('../../src/engine/tableColumnCollationRead', async () => ({ ...await vi.importActual<any>('../../src/engine/tableColumnCollationRead'), readColumnCollationFacts: ports.facts }));
import { TableColumnPatchTasks } from '../../src/engine/tableColumnPatchTasks';
import { StructurePatchCache, structureCacheLimits } from '../../src/engine/structurePatchCache';
import { readColumnCollationTaskFacts } from '../../src/engine/tableColumnCollationTaskRead';
import * as collationProjection from '../../src/engine/tableColumnCollationTaskRead';

/** 可变源仅代表RAM目录观测；不触及账号、连接配置、认证、环境变量或真实数据库。 */
function makeFacts(collation = 'utf8mb4_bin') {
  return collationFacts(`VARCHAR(20) CHARACTER SET utf8mb4 COLLATE ${collation} DEFAULT 'AbC' COMMENT '保留COLLATE字样'`, collation);
}
function fixture() {
  const state = {
    current: makeFacts(), after: makeFacts('utf8mb4_unicode_ci'), id: '19611', postId: '19611', version: '8.4.11', now: 0,
    warnings: 0, closed: 0, failClose: false, invalidAck: false, holdAlter: false, held: undefined as (() => void) | undefined,
    error: undefined as Error | undefined, failSql: undefined as RegExp | undefined,
    sqlHook: undefined as ((sql: string) => void) | undefined,
    closing: undefined as ((value: unknown) => void | Promise<void>) | undefined,
    factHook: undefined as ((value: ReturnType<typeof makeFacts>) => void) | undefined,
  };
  const sent: string[] = [], options: ColumnTaskOptions[] = [], controllers: AbortController[] = [], contexts: StructureTaskContext[] = [];
  ports.definition.mockImplementation(async () => { sent.push('读取完整定义'); return structuredClone(state.current.base); });
  ports.facts.mockImplementation(async (_context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead, refs: IndexReferenceNames) => {
    const facts = structuredClone(state.current), byName = new Map([...refs.columns].map(([ref, name]) => [name, ref]));
    const oldColumns = facts.indexes.model.columns;
    const oldNames = new Map([...oldColumns].map(([ref, column]) => [ref, column.name]));
    facts.indexes.model.columns = new Map([...oldColumns].map(([_ref, column]) => [byName.get(column.name)!, column]));
    const pk = refs.indexes.keys().next().value ?? 'pk-ref';
    const index = facts.indexes.model.indexes.values().next().value!;
    for (const part of index.definition!.keyParts) part.columnRef = byName.get(oldNames.get(part.columnRef)!)!;
    facts.indexes.model.indexes = new Map([[pk, index]]);
    Object.assign(facts, { target: { ...target }, base: structuredClone(base), references: { columns: new Map(refs.columns), indexes: new Map([[pk, 'PRIMARY']]) } });
    Object.assign(facts.indexes, structuredClone(base), { originalMode: base.normalizedMode });
    state.factHook?.(facts);
    return { status: 'preparation', facts };
  });
  const host: ColumnTaskHost = { async run(_connectionId, _taskId, action, option) {
    options.push(option); const controller = new AbortController(); controllers.push(controller);
    const connection = Object.assign(new EventEmitter(), { query: vi.fn() });
    const context = { managed: { connection, broken: false, signal: controller.signal, status: { dialect: 'mysql', version: state.version } }, checkCancelled() { if (controller.signal.aborted) throw controller.signal.reason; }, commandStarted: () => vi.fn(), report: vi.fn() } as unknown as StructureTaskContext;
    contexts.push(context);
    connection.query.mockImplementation((sql: string, callback: Function) => {
      sent.push(sql);
      const complete = () => queueMicrotask(() => {
        state.sqlHook?.(sql);
        if (state.failSql?.test(sql)) { callback(state.error ?? new Error('合成驱动错误')); return; }
        // 本旧夹具只授权列排序规则目录；新增生成列全字段查询经真实driver回调明确拒绝，不能在微任务中throw而悬空原命令。
        if (sql.startsWith('SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal, COLUMN_TYPE AS typeSql, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression, ') && sql.includes('FROM information_schema.COLUMNS WHERE ')) { callback(Object.assign(new Error('RAM生成列目录不在本用途权限内'), { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR', fatal: false })); return; }
        let rows: unknown;
        if (sql.startsWith('SELECT VERSION()')) rows = [{ version: state.version, os: 'Linux', lowerNames: 0 }];
        else if (sql.includes('FROM information_schema.TABLES')) rows = [{ databaseName: 'ram_db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB' }];
        else if (sql.includes('FROM information_schema.PARTITIONS')) rows = [{ name: null }];
        else if (sql.includes('FROM information_schema.INNODB_TABLES')) rows = [{ id: state.id, name: 'ram_db/subject' }];
        else if (sql.startsWith('ALTER TABLE')) { state.current = structuredClone(state.after); state.id = state.postId; rows = state.invalidAck ? undefined : { affectedRows: 0, warningStatus: state.warnings }; }
        else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Level: 'Warning', Code: 1265, Message: '合成服务器警告' }];
        else throw new Error('未登记的RAM查询：' + sql);
        callback(null, rows, []);
      });
      if (state.holdAlter && sql.startsWith('ALTER TABLE')) state.held = complete; else complete();
    });
    try { const value = await action(context); await state.closing?.(value); return value; }
    finally { state.closed++; if (state.failClose) throw new Error('合成严格关闭未知'); }
  } };
  const cache = new StructurePatchCache(() => state.now), tasks = new TableColumnPatchTasks(host, () => state.now, cache);
  const target = { ...state.current.target };
  const get = (revision = 1) => tasks.get({ ...target, taskId: 'get' }, revision);
  const preview = (snapshot: TableColumnGetOutput, pair = { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }, revision = 1) => tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview', patches: [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes: { collation: pair } }] }, revision);
  const apply = (value: TableColumnPreviewOutput, acknowledgements = value.requiredAcknowledgements, revision = 1) => tasks.apply({ previewToken: value.previewToken, acknowledgements, taskId: 'apply' }, revision);
  const scope = (kind: 'snapshot' | 'preview') => cache.scope('columns', kind, () => ({ connectionId: target.connectionId, bytes: 0, expires: 1 }));
  return { state, sent, options, controllers, contexts, cache, tasks, target, get, preview, apply, scope };
}
beforeEach(() => { ports.definition.mockReset(); ports.facts.mockReset(); });

it.each([false, true])('真实物理/专用execution与Tasks闭环，postID变化=%s不单独判失败', async changed => {
  const f = fixture(); if (changed) f.state.postId = '19612';
  const snapshot = await f.get(); expect(f.state.closed).toBe(1); expect(snapshot.collationCatalog).toHaveLength(3);
  expect(snapshot.generatedAccess).toMatchObject({ editable: false, reason: expect.any(String) }); expect(snapshot.columns.every(column => column.generatedReference !== true)).toBe(true);
  expect(snapshot.columns[0].collation).toBeUndefined(); expect(snapshot.columns[1].collation).toEqual({ current: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, access: { editable: true } });
  expect(JSON.stringify(snapshot)).not.toMatch(/19611|tableId|serverIdentity|references|directAlterProven/);
  const value = await f.preview(snapshot); expect(f.state.closed).toBe(2); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
  expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'column-collation-semantics', 'column-collation-default-algorithm']);
  expect(value.warnings.join('')).toMatch(/比较、排序、分组及连接/); expect(value.warnings.join('')).toMatch(/重建或复制/);
  expect(value.sql).toContain('MODIFY COLUMN'); expect(value.sql).not.toMatch(/ALGORITHM|LOCK=|CONVERT TO/);
  const output = await f.apply(value); expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
  expect(f.options.at(-1)?.executionTarget).toEqual(f.target); expect(f.state.closed).toBe(3);
  expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1); expect(f.scope('snapshot').size).toBe(0); expect(f.scope('preview').size).toBe(0);
  expect(output.warnings.some(message => message.includes('物理表编号已变化'))).toBe(changed);
  await expect(f.apply(value)).rejects.toThrow('已使用');
});
it('公开候选/能力副本被改不能污染私有事实或扩展可执行候选', async () => {
  const f = fixture(), snapshot = await f.get(); snapshot.collationCatalog![0].collation = 'forged'; snapshot.columns[1].collation!.current.collation = 'forged';
  expect((await f.preview(snapshot)).sql).toContain('utf8mb4_unicode_ci');
  await expect(f.preview(snapshot, { charset: 'utf8mb4', collation: 'forged' })).rejects.toThrow(); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it.each(['ddl-implicit-commit', 'external-ddl-window', 'column-collation-semantics', 'column-collation-default-algorithm'])('缺少%s也先消费令牌，零DDL', async missing => {
  const f = fixture(), value = await f.preview(await f.get());
  await expect(f.apply(value, value.requiredAcknowledgements.filter(ack => ack !== missing))).rejects.toThrow('确认');
  await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it.each(['preview', 'apply'])('%s前真实ID漂移必须拒绝，apply令牌不复活', async phase => {
  const f = fixture(), snapshot = await f.get();
  if (phase === 'preview') { f.state.id = '19612'; await expect(f.preview(snapshot)).rejects.toThrow('物理'); }
  else { const value = await f.preview(snapshot); f.state.id = '19612'; await expect(f.apply(value)).rejects.toThrow('物理'); await expect(f.apply(value)).rejects.toThrow('已使用'); }
  expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it('同轮物理夹读ID变化不返回get快照', async () => {
  const f = fixture(); let count = 0; f.state.sqlHook = sql => { if (sql.includes('INNODB_TABLES') && ++count === 2) f.state.id = '19612'; };
  await expect(f.get()).rejects.toThrow('物理'); expect(f.scope('snapshot').size).toBe(0);
});
it.each([1142, 1143, 1227])('明确附加目录权限%s只关闭新能力，旧comment路径继续', async errno => {
  const f = fixture(); f.state.failSql = /^SELECT VERSION/; f.state.error = Object.assign(new Error('合成权限'), { errno });
  const snapshot = await f.get(); expect(snapshot.collationCatalog).toBeUndefined(); expect(snapshot.columns[1].collation).toBeUndefined();
  f.state.failSql = undefined; await expect(f.preview(snapshot)).rejects.toThrow('原快照');
  const value = await f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'legacy', patches: [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes: { comment: '新' } }] }, 1);
  f.state.after = makeFacts(); f.state.after.base.source = f.state.after.base.source.replace("COMMENT '保留COLLATE字样'", "COMMENT '新'");
  expect(await f.apply(value)).toMatchObject({ ddlCompleted: true, definitionVerified: true });
});
it('准确旧版本仍沿原get并保留七属性，不查询物理目录', async () => {
  const f = fixture(); f.state.version = '8.0.46'; f.state.current.base.serverVersion = '8.0.46';
  const snapshot = await f.get(); expect(snapshot.collationCatalog).toBeUndefined(); expect(Object.keys(snapshot.columns[1].access)).toEqual(['name', 'type', 'nullable', 'default', 'comment', 'position', 'onUpdate']); expect(f.sent.filter(sql => sql.startsWith('SELECT'))).toHaveLength(0);
});
it.each([1045, 1054, 1146, 2013, undefined])('附加读取的认证/未知/断线%s不能吞为普通get成功', async errno => {
  const f = fixture(), error = Object.assign(new Error('原始驱动错误'), { errno }); f.state.failSql = /^SELECT VERSION/; f.state.error = error;
  await expect(f.get()).rejects.toBe(error); expect(f.scope('snapshot').size).toBe(0); expect(f.state.closed).toBe(1);
});
it('准备reader未知错误与原定义漂移仍整次失败', async () => {
  const f = fixture(), error = new Error('准备目录未知错误'); ports.facts.mockRejectedValueOnce(error);
  await expect(f.get()).rejects.toBe(error); expect(f.scope('snapshot').size).toBe(0);
  const other = fixture(), snapshot = await other.get(); other.state.current.base.source = other.state.current.base.source.replace("DEFAULT 'AbC'", "DEFAULT 'changed'");
  await expect(other.preview(snapshot)).rejects.toThrow('定义'); expect(other.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it('真实索引/FK范围门决定access，目标被索引不能用directAlter布尔放行', async () => {
  const f = fixture(); f.state.factHook = facts => { facts.indexes.model.indexes.values().next().value!.definition!.keyParts[0].columnRef = [...facts.references.columns].find(([, name]) => name === 'note')![0]; };
  const snapshot = await f.get(); expect(snapshot.columns[1].collation?.access.editable).toBe(false);
  await expect(f.preview(snapshot)).rejects.toThrow('索引'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it.each([{ charset: 'latin1', collation: 'latin1_swedish_ci' }, { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'utf8mb4', collation: 'unknown' }])('跨charset、同值、非实际目录配对%j在预览拒绝', async pair => {
  const f = fixture(); await expect(f.preview(await f.get(), pair)).rejects.toThrow(); expect(f.scope('preview').size).toBe(0);
});
it('未知ref和混合属性不进入旧planner，也不发DDL', async () => {
  const f = fixture(), snapshot = await f.get();
  await expect(f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'bad-ref', patches: [{ kind: 'alter', columnRef: 'forged', changes: { collation: { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' } } }] }, 1)).rejects.toThrow();
  await expect(f.tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'mixed', patches: [{ kind: 'alter', columnRef: snapshot.columns[1].columnRef, changes: { collation: { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }, comment: '混合' } }] }, 1)).rejects.toThrow('单属性');
});
it('警告读取必须紧随单次ALTER的OK，早于后续完整定义或物理读取', async () => {
  const f = fixture(); f.state.warnings = 1; const value = await f.preview(await f.get()), output = await f.apply(value);
  const index = f.sent.findIndex(sql => sql.startsWith('ALTER')); expect(f.sent[index + 1]).toBe('SHOW WARNINGS LIMIT 20'); expect(f.sent[index + 2]).toBe('读取完整定义'); expect(output.warnings.join('')).toContain('1265');
});
it.each(['定义不符', '后核断线', '警告失败'])('已OK但%s保留completed，不自动重放', async kind => {
  const f = fixture(), value = await f.preview(await f.get());
  if (kind === '定义不符') f.state.after.base.source = f.state.after.base.source.replace("DEFAULT 'AbC'", "DEFAULT 'bad'");
  if (kind === '后核断线') f.state.sqlHook = sql => { if (sql.startsWith('ALTER')) { f.state.failSql = /^SELECT VERSION/; f.state.error = Object.assign(new Error('后核断线'), { errno: 2013 }); } };
  if (kind === '警告失败') { f.state.warnings = 1; f.state.failSql = /^SHOW WARNINGS/; }
  const output = await f.apply(value); expect(output.ddlCompleted).toBe(true); expect(output.ddlSubmitted).toBe(true);
  if (kind !== '警告失败') { expect(output.definitionVerified).toBe(false); expect(output.verificationError).toBeTruthy(); } else expect(output.warnings.join('')).toContain('警告读取失败');
  await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
});
it('单次ALTER驱动错误保持unknown且不重放', async () => {
  const f = fixture(), value = await f.preview(await f.get()), error = Object.assign(new Error('发送后断线'), { errno: 2013 });
  f.state.failSql = /^ALTER TABLE/; f.state.error = error; await expect(f.apply(value)).rejects.toBe(error);
  expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
});
it('在途ALTER取消沿共用查询终态，晚OK不能重放或改写unknown', async () => {
  const f = fixture(), value = await f.preview(await f.get()); f.state.holdAlter = true;
  const pending = f.apply(value), failure = expect(pending).rejects.toThrow('中止');
  await vi.waitFor(() => expect(f.state.held).toBeTypeOf('function'));
  f.controllers.at(-1)!.abort(new Error('合成取消')); await failure;
  f.state.held!(); await Promise.resolve();
  expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
  await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
});
it('已OK后的严格关闭未知仍保留可信completed进度，令牌不能再次执行', async () => {
  const f = fixture(), value = await f.preview(await f.get()); f.state.failClose = true;
  await expect(f.apply(value)).rejects.toThrow('严格关闭未知'); expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, outcome: 'succeeded' }); await expect(f.apply(value)).rejects.toThrow('已使用');
});
it.each(['get-release', 'get-close-fail', 'get-ttl', 'preview-release', 'preview-ttl'])('%s期间晚回包不能登记令牌', async phase => {
  const f = fixture();
  if (phase.startsWith('get')) {
    f.state.closing = () => { if (phase === 'get-release') f.tasks.release(f.target.connectionId); if (phase === 'get-ttl') f.state.now += structureCacheLimits.ttlMs; };
    if (phase === 'get-close-fail') f.state.failClose = true;
    await expect(f.get()).rejects.toThrow(); expect(f.scope('snapshot').size).toBe(0);
  } else {
    const snapshot = await f.get(); f.state.closing = () => { if (phase === 'preview-release') f.tasks.releaseTokens({ snapshotId: snapshot.snapshotId }); else f.state.now += structureCacheLimits.ttlMs; };
    await expect(f.preview(snapshot)).rejects.toThrow(); expect(f.scope('preview').size).toBe(0);
  }
});
it('其它连接release不影响在途get，精确snapshot释放其预览而不扩大清理', async () => {
  const f = fixture(); f.state.closing = () => f.tasks.release('other-connection'); const a = await f.get(); f.state.closing = undefined;
  const av = await f.preview(a), b = await f.get(), bv = await f.preview(b);
  f.tasks.releaseTokens({ snapshotId: a.snapshotId }); await expect(f.apply(av)).rejects.toThrow('已使用'); expect(f.scope('snapshot').size).toBe(1); expect(f.scope('preview').size).toBe(1);
  f.tasks.releaseTokens({ previewToken: bv.previewToken }); expect(f.scope('preview').size).toBe(0); expect(f.scope('snapshot').size).toBe(1);
});
it('revision变化和TTL均拒绝，apply失败也已消费token', async () => {
  const f = fixture(), snapshot = await f.get(); await expect(f.preview(snapshot, undefined, 2)).rejects.toThrow('配置'); const value = await f.preview(snapshot);
  await expect(f.apply(value, undefined, 2)).rejects.toThrow('配置'); await expect(f.apply(value)).rejects.toThrow('已使用');
  f.state.now += structureCacheLimits.ttlMs; await expect(f.preview(snapshot)).rejects.toThrow('失效'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it('仅附加事实超原总预算时关闭整份新能力，基础get和旧快照仍可使用', async () => {
  const f = fixture(), filler = f.cache.scope<{ bytes: number }>('indexes', 'snapshot', value => ({ connectionId: 'other', expires: 120000, bytes: value.bytes }));
  filler.set('occupied', { bytes: structureCacheLimits.bytes - 5000 }); const snapshot = await f.get();
  expect(snapshot.collationCatalog).toBeUndefined(); expect(snapshot.columns.every(column => !column.collation)).toBe(true); expect(f.scope('snapshot').size).toBe(1);
  filler.delete('occupied'); await expect(f.preview(snapshot)).rejects.toThrow('原快照');
});
it('关闭阶段新增共享占用时仍重新计量，不把未收费私有facts放进cache', async () => {
  const f = fixture(), filler = f.cache.scope<{ bytes: number }>('indexes', 'snapshot', value => ({ connectionId: 'other', expires: 120000, bytes: value.bytes }));
  f.state.closing = () => { filler.set('late', { bytes: structureCacheLimits.bytes - 5000 }); };
  const snapshot = await f.get(); expect(snapshot.collationCatalog).toBeUndefined(); expect(snapshot.columns.every(column => !column.collation)).toBe(true);
});
it('Map原始条目及执行计划保留的事实也收费，不能靠小bytes摘要绕过总预算', async () => {
  const f = fixture(), filler = f.cache.scope<{ bytes: number }>('indexes', 'snapshot', value => ({ connectionId: 'other', expires: 120000, bytes: value.bytes }));
  f.state.factHook = facts => { facts.indexes.model.columns.values().next().value!.prefix = { kind: 'forbidden', reason: '合'.repeat(70000) }; };
  filler.set('occupied', { bytes: structureCacheLimits.bytes - 500000 }); const snapshot = await f.get();
  expect(snapshot.columns[1].collation?.access.editable).toBe(true);
  await expect(f.preview(snapshot)).rejects.toThrow('缓存已达上限'); expect(f.scope('preview').size).toBe(0);
});
it('原基础容量不足不降级成功，32个snapshot总额度没有另开新池', async () => {
  const f = fixture(); const snapshots: TableColumnGetOutput[] = [];
  for (let index = 0; index < 32; index++) snapshots.push(await f.get());
  await expect(f.get()).rejects.toThrow('缓存已达上限'); expect(f.scope('snapshot').size).toBe(32);
  f.tasks.releaseTokens({ snapshotId: snapshots[0].snapshotId }); await f.get(); expect(f.scope('snapshot').size).toBe(32);
});
it('adapter读取未知目录错误不包装为能力关闭', async () => {
  const f = fixture(), context = { managed: { status: { version: '8.4.11', dialect: 'mysql' }, broken: false }, checkCancelled: () => undefined } as StructureTaskContext;
  // 没有伪造observed事实；真实共用查询因缺失传输端口抛错，adapter必须原样失败。
  await expect(readColumnCollationTaskFacts(context, f.target, f.state.current.base, f.state.current.references)).rejects.toThrow();
});
it('投影前真正Node事件循环已排队取消，get必须拒绝且不登记snapshot或preview', async () => {
  const f = fixture(), error = new Error('get投影排队取消');
  f.state.factHook = () => { setImmediate(() => f.controllers.at(-1)!.abort(error)); };
  await expect(f.get()).rejects.toBe(error);
  expect(f.sent.filter(sql => sql.includes('INNODB_TABLES'))).toHaveLength(2);
  expect(f.scope('snapshot').size).toBe(0); expect(f.scope('preview').size).toBe(0); expect(f.state.closed).toBe(1);
  expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(0);
});
it('后核投影排队取消保留OK完成但不伪核验，apply令牌已消费', async () => {
  const f = fixture(), value = await f.preview(await f.get());
  f.state.factHook = () => { if (f.state.current.base.encodings[1].collation === 'utf8mb4_unicode_ci') setImmediate(() => f.controllers.at(-1)!.abort(new Error('后核投影取消'))); };
  const output = await f.apply(value);
  expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }); expect(output.verificationError).toMatch(/取消/);
  expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
  await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
});
it.each(['cancel', 'aborted', 'broken', 'normal'] as const)('后核投影完成后恢复前%s须重新检查发布门，OK事实和一次性令牌保持', async mode => {
  const f = fixture(), value = await f.preview(await f.get()), original = collationProjection.columnCollationTaskViews;
  const error = new Error('发布前取消原件'); let boundaryRan = false;
  // 原投影/候选全部运行；then观察只构造精确Promise边界，不宣称真实IPC按此时序可达。
  const spy = vi.spyOn(collationProjection, 'columnCollationTaskViews').mockImplementation((...args) => original(...args).then(columns => {
    queueMicrotask(() => {
      boundaryRan = true; const context = f.contexts.at(-1)!;
      if (mode === 'aborted') context.checkCancelled = vi.fn();
      if (mode === 'cancel' || mode === 'aborted') f.controllers.at(-1)!.abort(error);
      if (mode === 'broken') context.managed.broken = true;
    });
    return columns;
  }));
  try {
    const output = await f.apply(value); expect(boundaryRan).toBe(true);
    expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: mode === 'normal' });
    if (mode === 'normal') { expect(output.after).toBeDefined(); expect(output.verificationError).toBeUndefined(); }
    else { expect(output.after).toBeUndefined(); expect(output.verificationError).toMatch(/取消、断线或读取失败/); }
    expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlCompleted: true, definitionVerified: mode === 'normal', outcome: 'succeeded' });
    await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
  } finally { spy.mockRestore(); }
});
it.each(['success', 'post-read-failure', 'driver-error', 'invalid-ack', 'strict-close-failure'] as const)('DDL结束%s撤销同连接在途旧get并清所有结构scope，不重登记旧能力', async mode => {
  const f = fixture(), snapshot = await f.get(), value = await f.preview(snapshot);
  let entered!: () => void, resume!: () => void;
  const closing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  f.state.closing = async output => { if ((output as TableColumnGetOutput).snapshotId) { entered(); await gate; } };
  const latePromise = f.get().then(output => ({ output, error: undefined }), error => ({ output: undefined, error }));
  await closing;
  const shared = f.cache.scope<{ connectionId: string }>('indexes', 'snapshot', item => ({ connectionId: item.connectionId, expires: 120000, bytes: 64 }));
  shared.set('same-connection-other-scope', { connectionId: f.target.connectionId });
  shared.set('other-connection-scope', { connectionId: 'OTHER' });
  if (mode === 'post-read-failure') f.state.sqlHook = sql => { if (sql.startsWith('ALTER')) { f.state.failSql = /^SELECT VERSION/; f.state.error = Object.assign(new Error('后核目录断线'), { errno: 2013 }); } };
  if (mode === 'driver-error') { f.state.failSql = /^ALTER TABLE/; f.state.error = Object.assign(new Error('发送结果未知'), { errno: 2013 }); }
  if (mode === 'invalid-ack') f.state.invalidAck = true;
  if (mode === 'strict-close-failure') f.state.failClose = true;
  let output: Awaited<ReturnType<typeof f.apply>> | undefined, applyError: unknown;
  try { output = await f.apply(value); } catch (error) { applyError = error; }
  const sameScopeAfterApply = shared.get('same-connection-other-scope'), otherScopeAfterApply = shared.get('other-connection-scope');
  f.state.failClose = false; resume(); const late = await latePromise;
  expect(sameScopeAfterApply).toBeUndefined(); expect(otherScopeAfterApply).toEqual({ connectionId: 'OTHER' });
  expect(late.output).toBeUndefined(); expect(late.error).toBeInstanceOf(Error); expect(late.error.message).toMatch(/已释放|过期/);
  expect(f.scope('snapshot').size).toBe(0);
  if (mode === 'success' || mode === 'post-read-failure') {
    expect(output).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: mode === 'success' }); expect(applyError).toBeUndefined();
  } else expect(applyError).toBeInstanceOf(Error);
  expect(f.options.at(-1)?.columnPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: ['success', 'post-read-failure', 'strict-close-failure'].includes(mode), outcome: ['success', 'post-read-failure', 'strict-close-failure'].includes(mode) ? 'succeeded' : 'unknown' });
  await expect(f.apply(value)).rejects.toThrow('已使用'); expect(f.sent.filter(sql => sql.startsWith('ALTER'))).toHaveLength(1);
});
it('同连接DDL只撤销本连接pendingReads，其它连接在途get及共享scope保持', async () => {
  const f = fixture(), value = await f.preview(await f.get());
  let entered!: () => void, resume!: () => void;
  const closing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  f.state.closing = async output => { if ((output as TableColumnGetOutput).target?.connectionId === 'OTHER') { entered(); await gate; } };
  const otherPromise = f.tasks.get({ ...f.target, connectionId: 'OTHER', taskId: 'other-get' }, 1);
  await closing; expect(await f.apply(value)).toMatchObject({ ddlCompleted: true }); resume();
  const other = await otherPromise; expect(f.scope('snapshot').has(other.snapshotId)).toBe(true); expect(other.target.connectionId).toBe('OTHER');
});
