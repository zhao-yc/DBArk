import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableForeignKeyPatchTasks, foreignKeyViews } from '../../src/engine/tableForeignKeyPatchTasks';
import { StructurePatchCache, structureCacheLimits, type StructureCacheBinding } from '../../src/engine/structurePatchCache';
import { structureTaskQuery, type StructureTaskContext, type StructureTaskHost, type StructureTaskOptions } from '../../src/engine/structureDefinition';
import { readForeignKeyStructure, type ForeignKeyStructureRead } from '../../src/engine/tableForeignKeyRead';
import { readForeignKeyNamespace, compareForeignKeyNames } from '../../src/engine/tableForeignKeyNamespaceRead';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition, editableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { readTableForeignKeyDefinition } from '../../src/engine/tableForeignKeyDefinition';
import type { IndexStructureRead } from '../../src/engine/tableIndexRead';
import type { ForeignKeyNameAvailability, ForeignKeyNamespaceEvidence } from '../../src/engine/tableForeignKeyNamespaceEvidence';
import type { ForeignKeyPatch, ForeignKeyPlanOptions, ForeignKeyPlanSnapshot, ForeignKeyTableSnapshot, TrustedForeignKey } from '../../src/shared/tableForeignKeyPatches';
import type { TrustedIndexColumn } from '../../src/shared/tableIndexPatches';
import type { TableForeignKeyApplyProgress, TableForeignKeyPreviewOutput } from '../../src/shared/tableForeignKeyTasks';

// 仅替换数据库 I/O 边界；真实校验、SQL 计划、旧定义重核及后核验函数始终参与测试。
vi.mock('../../src/engine/tableForeignKeyRead', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/engine/tableForeignKeyRead')>(), readForeignKeyStructure: vi.fn(),
}));
vi.mock('../../src/engine/tableForeignKeyNamespaceRead', () => ({ readForeignKeyNamespace: vi.fn(), compareForeignKeyNames: vi.fn() }));
vi.mock('../../src/engine/structureDefinition', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/engine/structureDefinition')>(), structureTaskQuery: vi.fn(),
}));

const target = { connectionId: 'connection-test', database: 'task_db', table: 'child' };
const options: ForeignKeyPlanOptions = { database: target.database, dialect: 'mysql', serverVersion: '8.4.11', sqlMode: { ansiQuotes: false, noBackslashEscapes: false }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } };
const childBody = '`id` int NOT NULL, `pid` int, `p2` int, PRIMARY KEY (`id`), KEY `support_child` (`pid`,`p2`), CONSTRAINT `positive` CHECK (`id` > 0)';
const parentBody = '`id` int NOT NULL, `a` int, `b` int, PRIMARY KEY (`id`), UNIQUE KEY `support_parent` (`a`,`b`)';
const oldForeign = 'CONSTRAINT `old_fk` FOREIGN KEY (`pid`,`p2`) REFERENCES `parent_old` (`a`,`b`) ON UPDATE RESTRICT ON DELETE RESTRICT';
const retainedForeign = 'CONSTRAINT `keep_fk` FOREIGN KEY (`pid`,`p2`) REFERENCES `parent_retained` (`a`,`b`) ON UPDATE RESTRICT ON DELETE RESTRICT';
const newForeign = oldForeign.replace('old_fk', 'new_fk').replace('parent_old', 'parent_new').replace('ON DELETE RESTRICT', 'ON DELETE CASCADE');
const replacement: ForeignKeyPatch = { op: 'alter', foreignKeyRef: 'fk:old_fk', changes: { name: 'new_fk', parentRef: 'parent_new', pairs: [{ childColumnRef: 'child:pid', parentColumnRef: 'parent_new:a' }, { childColumnRef: 'child:p2', parentColumnRef: 'parent_new:b' }], onDelete: 'CASCADE' } };
const acknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'drop-foreign-key', 'referential-action-change'];

/** 由真实解析器产生源码范围与稳定引用，目录真值是本单测显式提供的独立输入，不声称数据库已执行。 */
function table(name: string, body: string): ForeignKeyTableSnapshot {
  const definition = parseTableColumnDefinition(`CREATE TABLE \`${name}\` (${body}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, { dialect: options.dialect, mode: options.sqlMode });
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => [`${name}:${column.name}`, { name: column.name, nullable: column.nullable !== false, dataType: 'INT', columnType: column.type.raw, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '整数目录不接受前缀' } }]));
  const indexes = new Map(readTableIndexDefinition(definition).indexes.map(parsed => [`${name}:index:${parsed.name}`, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  return { target: { database: target.database, table: name }, identity: 'server-identity', definition, columns, indexes, engine: 'InnoDB', rowFormat: 'DYNAMIC', pageSize: 16384, isTemporary: false, catalogComplete: true, partition: 'none', metadataDigest: `catalog:${name}` };
}

/** 结构重读比较使用真实 IndexStructureRead 形状，原字段、目录摘要和 SQL 模式均可单独发生漂移。 */
function indexRead(value: ForeignKeyTableSnapshot): IndexStructureRead {
  return { source: value.definition.source, context: value.definition.context, originalMode: 'STRICT_TRANS_TABLES', normalizedMode: 'STRICT_TRANS_TABLES', identity: value.identity, serverVersion: options.serverVersion,
    nullability: [...value.columns.values()].map(column => [column.name, column.nullable]), encodings: [...value.columns.values()].map(column => ({ name: column.name, charset: null, collation: null })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' },
    model: { definition: value.definition, indexDocument: readTableIndexDefinition(value.definition), columns: value.columns, indexes: value.indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], autoIncrementColumnRefs: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } },
    warnings: [], catalogDigest: value.metadataDigest, dependencyDigest: `dependencies:${value.target.table}`, bytes: 1024 };
}

/** 三个父目标分别覆盖旧关系、新目标及原样保留关系，后读不能丢掉已删除关系的旧父。 */
function fixture(after = false): ForeignKeyStructureRead {
  const child = table('child', `${childBody}, ${after ? newForeign : oldForeign}, ${retainedForeign}`);
  const parents = new Map(['parent_old', 'parent_new', 'parent_retained'].map(name => [name, table(name, parentBody)]));
  const foreignKeys = new Map<string, TrustedForeignKey>();
  for (const parsed of readTableForeignKeyDefinition(child.definition, target.database, options.serverVersion).foreignKeys) {
    const parentRef = parsed.parentTarget!.table, parent = parents.get(parentRef)!;
    foreignKeys.set(`fk:${parsed.name}`, { name: parsed.name!, rawSql: parsed.rawSql, range: parsed.range, opaqueReasons: parsed.opaqueReasons,
      definition: { name: parsed.name!, parentRef, onUpdate: parsed.onUpdate!, onDelete: parsed.onDelete!, pairs: parsed.childColumnNames.map((name, index) => ({ childColumnRef: [...child.columns].find(([, column]) => column.name === name)![0], parentColumnRef: [...parent.columns].find(([, column]) => column.name === parsed.parentColumnNames[index])![0] })) } });
  }
  const snapshot: ForeignKeyPlanSnapshot = { child, parents, foreignKeys, outgoingComplete: true, incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, externalIncomingDigest: 'outside-stable', namespaceNames: { complete: true, names: ['old_fk', 'keep_fk'] } };
  const childRead = indexRead(child), parentReads = new Map([...parents].map(([ref, value]) => [ref, indexRead(value)]));
  return { target: { ...target }, snapshot, options: structuredClone(options), childRead, parentReads, warnings: [], bytes: 4096, outgoingDigest: 'outgoing-stable',
    refs: { parents: new Map([...parents].map(([ref, value]) => [ref, value.target])), foreignKeys: new Map([...foreignKeys].map(([ref, value]) => [ref, value.name])),
      tables: new Map([child, ...parents.values()].map(value => [JSON.stringify([value.target.database, value.target.table]), { columns: new Map([...value.columns].map(([ref, column]) => [ref, column.name])), indexes: new Map([...value.indexes].map(([ref, index]) => [ref, index.parsed.name])) }])) } };
}

/** 这里只模拟 reader 已完成的可信目录结果；名称实际比较 I/O 另有独立可变结果。 */
function namespace(): ForeignKeyNamespaceEvidence {
  return { kind: 'complete', facts: { dialect: 'mysql', serverVersion: '8.4.11', compileOs: 'Linux', lowerCaseTableNames: 0 }, digest: 'namespace-stable', bytes: 512,
    entries: [['old_fk', 'parent_old'], ['keep_fk', 'parent_retained']].map(([name, parent]) => ({ id: `${target.database}/${name}`, child: { database: target.database, table: 'child' }, parent: { database: target.database, table: parent }, name, childColumns: ['pid', 'p2'], parentColumns: ['a', 'b'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT', type: 0 })) };
}

/** 显式控制关闭完成边界，避免 sleep 或先返回结果再假装释放连接。 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class Host implements StructureTaskHost {
  calls: { connectionId: string; taskId: string; options: StructureTaskOptions; closed: boolean }[] = [];
  reports: TableForeignKeyApplyProgress[] = [];
  closeGate?: ReturnType<typeof deferred>;
  atClose = deferred();
  closeError?: Error;
  cancelled = false;
  /** 回调无论成功失败都先等待受控关闭，测试可观察此时调用方仍未得到令牌或 apply 结果。 */
  async run<T>(connectionId: string, taskId: string, action: (context: StructureTaskContext) => Promise<T>, taskOptions: StructureTaskOptions): Promise<T> {
    const call = { connectionId, taskId, options: taskOptions, closed: false }; this.calls.push(call);
    const context = { managed: {} as StructureTaskContext['managed'], checkCancelled: () => { if (this.cancelled) throw new Error('任务已取消'); }, report: () => { this.reports.push(structuredClone(taskOptions.progress)); }, commandStarted: () => () => undefined };
    try { return await action(context); }
    finally { this.atClose.resolve(); if (this.closeGate) await this.closeGate.promise; call.closed = true; if (this.closeError) throw this.closeError; }
  }
}

/** 每个用例创建独立缓存、时钟和数据库边界；默认后核验读取真实解析的预期最终定义。 */
function harness() {
  let clock = 1000, ddlSent = false;
  const before = fixture(), after = fixture(true), host = new Host(), cache = new StructurePatchCache(() => clock);
  const tasks = new TableForeignKeyPatchTasks(host, () => clock, cache);
  const state = { before, after, namespace: namespace(), availability: 'available' as ForeignKeyNameAvailability, warningStatus: 0, warningError: undefined as Error | undefined, afterError: undefined as Error | undefined, ddlError: undefined as Error | undefined, malformedOk: false };
  vi.mocked(readForeignKeyStructure).mockImplementation(async (_context, _target, request) => {
    if (ddlSent && state.afterError) throw state.afterError;
    const read = structuredClone(ddlSent ? state.after : state.before);
    if (request?.namespaceNames) read.snapshot.namespaceNames = structuredClone(request.namespaceNames);
    return read;
  });
  vi.mocked(readForeignKeyNamespace).mockImplementation(async () => ({ evidence: structuredClone(state.namespace), bytes: 512, warnings: [] }));
  vi.mocked(compareForeignKeyNames).mockImplementation(async (_context, _evidence, _database, names) => new Map(names.map(name => [name, state.availability])));
  const sent: string[] = [];
  vi.mocked(structureTaskQuery).mockImplementation(async (_context, sql, submitted) => {
    sent.push(sql);
    if (sql === 'SHOW WARNINGS LIMIT 20') { if (state.warningError) throw state.warningError; return { rows: [{ Code: 1000, Message: '自主测试警告' }], fields: [] }; }
    submitted?.(); ddlSent = true;
    if (state.ddlError) throw state.ddlError;
    return { rows: state.malformedOk ? {} : { affectedRows: 0, warningStatus: state.warningStatus }, fields: [] };
  });
  const get = () => tasks.get({ ...target, taskId: 'get', parentTargets: [{ database: target.database, table: 'parent_new' }] }, 7);
  const prepare = async () => { const value = await get(); return tasks.preview({ snapshotId: value.snapshotId, taskId: 'preview', patches: [structuredClone(replacement)] }, 7); };
  const apply = (preview: TableForeignKeyPreviewOutput, ack = preview.requiredAcknowledgements, revision: unknown = 7) => tasks.apply({ previewToken: preview.previewToken, acknowledgements: ack, taskId: 'apply' }, revision);
  return { host, cache, tasks, state, sent, get, prepare, apply, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('外键任务真实计划与后核验边界', () => {
  it('真实解析的旧 Unicode 外键名保留原文，但修改和删除投影一致只读', () => {
    const read = fixture(), name = '旧外键';
    const child = table('child', `${childBody}, ${oldForeign.replace('old_fk', name)}, ${retainedForeign}`);
    const old = read.snapshot.foreignKeys;
    read.snapshot.child = child; read.childRead = indexRead(child);
    // 修改自主输入后重新由生产解析器取得全部源码范围，不能只改展示名造成伪造快照。
    read.snapshot.foreignKeys = new Map(readTableForeignKeyDefinition(child.definition, target.database, options.serverVersion).foreignKeys.map(parsed => {
      const ref = parsed.name === name ? 'fk:old_fk' : `fk:${parsed.name}`, original = old.get(ref)!;
      return [ref, { ...original, name: parsed.name!, rawSql: parsed.rawSql, range: parsed.range, opaqueReasons: parsed.opaqueReasons, definition: { ...original.definition!, name: parsed.name! } }];
    }));
    const views = foreignKeyViews(read), unicode = views.find(value => value.foreignKeyRef === 'fk:old_fk')!;
    expect(unicode.name).toBe(name); expect(unicode.rawSql).toContain('CONSTRAINT `旧外键`');
    expect(unicode.editableDefinition?.name).toBe(name);
    expect(unicode.unsupportedReasons.join(' ')).toContain('名称尚未证明');
    expect(unicode.access).toMatchObject({ drop: { allowed: false }, replace: { allowed: false } });
    expect(unicode.access.replace.reasons.join(' ')).toContain('名称尚未证明');
    expect(views.find(value => value.name === 'keep_fk')?.access).toMatchObject({ drop: { allowed: true }, replace: { allowed: true } });
    expect(structureTaskQuery).not.toHaveBeenCalled();
  });

  it('读取和预览零 ALTER；异名替换只执行一次单条 SQL，保留所有列、索引和保留关系', async () => {
    const h = harness(), preview = await h.prepare();
    expect(h.sent).toEqual([]); expect(preview.requiredAcknowledgements).toEqual(acknowledgements);
    expect(preview.sql).toContain('DROP FOREIGN KEY `old_fk`, ADD CONSTRAINT `new_fk`');
    expect(preview.sql).not.toMatch(/ADD (?:INDEX|KEY)|DROP (?:INDEX|KEY)|MODIFY|INSERT/i);
    const result = await h.apply(preview);
    expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
    expect(result.after?.foreignKeys.map(value => value.name)).toEqual(['new_fk', 'keep_fk']);
    expect(h.sent).toEqual([preview.sql]); expect(h.host.calls.every(value => value.closed)).toBe(true);
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([preview.sql]);
  });

  it('执行租约包含子表、旧父、新父及保留父；后读保持旧父和稳定引用', async () => {
    const h = harness(), preview = await h.prepare(); await h.apply(preview);
    const targets = h.host.calls.at(-1)!.options.executionTargets!;
    expect(targets.map(value => [value.database, value.table])).toEqual(['child', 'parent_old', 'parent_new', 'parent_retained'].map(name => [target.database, name]));
    const requests = vi.mocked(readForeignKeyStructure).mock.calls;
    expect(requests[0][2]?.additionalParents).toEqual([{ database: target.database, table: 'parent_new' }]);
    for (const [, , request] of requests.slice(1)) expect(request?.retainedParents?.map(value => value.table)).toEqual(['parent_old', 'parent_new', 'parent_retained']);
    expect(requests.at(-1)![2]?.refs?.foreignKeys).toEqual(new Map([['fk:old_fk', 'new_fk'], ['fk:keep_fk', 'keep_fk']]));
  });

  it.each(['列', '索引', '父表', '入向完整性'] as const)('成功包后的%s变化仍明确 DDL 已完成，但不假称完整核验', async kind => {
    const h = harness(), preview = await h.prepare();
    if (kind === '列') h.state.after.snapshot.child.definition = table('child', `${childBody.replace('`p2` int', '`p2` bigint')}, ${newForeign}, ${retainedForeign}`).definition;
    if (kind === '索引') h.state.after.snapshot.child.indexes = new Map([...h.state.after.snapshot.child.indexes].filter(([, value]) => value.parsed.name !== 'support_child'));
    if (kind === '父表') h.state.after.snapshot.parents.get('parent_old')!.metadataDigest = 'changed-parent';
    if (kind === '入向完整性') h.state.after.snapshot.incomingCoverage = { kind: 'partial', reason: 'permission' };
    const result = await h.apply(preview);
    expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(result.verificationError).toContain('不要重复');
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([preview.sql]);
  });

  it.each(['警告读取失败', '后读失败'] as const)('%s不抹掉已经收到的 DDL 成功事实，原令牌不可重试', async kind => {
    const h = harness(), preview = await h.prepare();
    if (kind === '警告读取失败') { h.state.warningStatus = 1; h.state.warningError = new Error('读取被取消'); }
    else h.state.afterError = new Error('连接断开');
    const result = await h.apply(preview);
    expect(result.ddlCompleted).toBe(true);
    if (kind === '警告读取失败') { expect(result.warnings.join(' ')).toContain('警告读取失败'); expect(result.definitionVerified).toBe(true); }
    else { expect(result.definitionVerified).toBe(false); expect(result.verificationError).toContain('成功响应'); }
    expect(h.host.reports.at(-1)).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' });
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent.filter(sql => sql.startsWith('ALTER'))).toEqual([preview.sql]);
  });

  it.each(['断线', '无 OK 包'] as const)('%s时保持已发送/结果未知，不把缺少成功包当作回滚或可重试', async kind => {
    const h = harness(), preview = await h.prepare();
    if (kind === '断线') h.state.ddlError = new Error('发送后断线'); else h.state.malformedOk = true;
    await expect(h.apply(preview)).rejects.toThrow();
    expect(h.host.calls.at(-1)!.options.progress).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' });
    expect(h.host.calls.at(-1)!.closed).toBe(true); await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([preview.sql]);
  });
});

describe('外键任务授权、重核与一次性令牌', () => {
  it.each(['add', 'drop'] as const)('%s 的确认集仅来自实际计划，不把替换确认项强加给其他操作', async operation => {
    const h = harness(), value = await h.get();
    const patch: ForeignKeyPatch = operation === 'drop' ? { op: 'drop', foreignKeyRef: 'fk:old_fk' } : { op: 'add', clientKey: 'added', definition: { ...h.state.before.snapshot.foreignKeys.get('fk:old_fk')!.definition!, name: 'added_fk' } };
    const preview = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [patch], taskId: operation }, 7);
    expect(preview.requiredAcknowledgements).toEqual(operation === 'add' ? acknowledgements.slice(0, 2) : acknowledgements.slice(0, 3));
    expect(h.sent).toEqual([]);
  });

  it('命名空间 partial 保留读取及独立 DROP，但不能猜测新增名称可用', async () => {
    const h = harness(); h.state.namespace = { kind: 'partial', reason: 'incomplete', warnings: ['目录未闭合'], bytes: 128 }; h.state.availability = 'unknown';
    const value = await h.get(); expect(value.namespaceCoverage).toBe('partial');
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'replace' }, 7)).rejects.toThrow();
    const preview = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [{ op: 'drop', foreignKeyRef: 'fk:old_fk' }], taskId: 'drop' }, 7);
    expect(preview.sql).toBe('ALTER TABLE `task_db`.`child` DROP FOREIGN KEY `old_fk`;'); expect(h.sent).toEqual([]);
  });

  it('能力未知时仅展示定义，不发布伪造能力或可执行预览', async () => {
    const h = harness(); delete h.state.before.options;
    const value = await h.get(); expect(value.writable).toBe(false); expect(value.capabilities).toBeUndefined();
    expect(value.foreignKeys.every(key => !key.access.drop.allowed && !key.access.replace.allowed)).toBe(true);
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'preview' }, 7)).rejects.toThrow('仅可查看'); expect(h.sent).toEqual([]);
  });

  it.each(['缺少', '额外', '重复'] as const)('确认项%s时零 DDL且立即消费令牌', async kind => {
    const h = harness(), preview = await h.prepare();
    const ack = kind === '缺少' ? acknowledgements.slice(1) : kind === '额外' ? [...acknowledgements, 'unknown-ack'] : [...acknowledgements.slice(0, -1), acknowledgements[0]];
    await expect(h.apply(preview, ack)).rejects.toThrow('确认项');
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([]); expect(h.host.calls).toHaveLength(2);
  });

  it('预览和执行修订必须精确相同，执行修订失败也消费令牌', async () => {
    const h = harness(), value = await h.get();
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'changed' }, 8)).rejects.toThrow('连接配置');
    const preview = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'valid' }, 7);
    await expect(h.apply(preview, acknowledgements, 8)).rejects.toThrow('连接配置');
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([]);
  });

  it.each([undefined, -1, 1.5, '7'])('可信修订 %s 非法时读取前拒绝', async revision => {
    const h = harness(); await expect(h.tasks.get({ ...target, taskId: 'get' }, revision)).rejects.toThrow('可信');
    expect(readForeignKeyStructure).not.toHaveBeenCalled(); expect(h.host.calls).toEqual([]);
  });

  it.each(['名称 SQL', '额外 SQL', '伪名称可用性'] as const)('不可信%s不能进入数据库执行边界', async kind => {
    const h = harness(), value = await h.get();
    const patch = kind === '名称 SQL' ? { ...replacement, changes: { name: 'fk`;DROP TABLE x' } } : { ...replacement, [kind === '额外 SQL' ? 'sql' : 'nameAvailable']: kind === '额外 SQL' ? 'ALTER TABLE other DROP PRIMARY KEY' : true };
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [patch as ForeignKeyPatch], taskId: 'invalid' }, 7)).rejects.toThrow();
    expect(h.host.calls).toHaveLength(1); expect(compareForeignKeyNames).not.toHaveBeenCalled(); expect(h.sent).toEqual([]);
  });

  it.each(['unknown', 'conflict'] as const)('服务器比较 %s 时预览和已预览后的执行均零 DDL', async availability => {
    const h = harness(), value = await h.get(); h.state.availability = availability;
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'unavailable' }, 7)).rejects.toThrow();
    h.state.availability = 'available'; const preview = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'valid' }, 7);
    h.state.availability = availability; await expect(h.apply(preview)).rejects.toThrow('名称可用性');
    expect(h.sent).toEqual([]); await expect(h.apply(preview)).rejects.toThrow('已使用');
  });

  it.each(['全局命名空间', '子目录摘要', '父目录摘要', '原始依赖摘要', '父源码'] as const)('%s漂移在 apply 前被真实重核拒绝', async kind => {
    const h = harness(), preview = await h.prepare();
    if (kind === '全局命名空间' && h.state.namespace.kind === 'complete') h.state.namespace.digest = 'changed-global';
    if (kind === '子目录摘要') h.state.before.childRead.catalogDigest = 'changed-child';
    if (kind === '父目录摘要') h.state.before.parentReads.get('parent_old')!.catalogDigest = 'changed-parent';
    if (kind === '原始依赖摘要') h.state.before.parentReads.get('parent_old')!.dependencyDigest = 'changed-native';
    if (kind === '父源码') h.state.before.parentReads.get('parent_old')!.source += " COMMENT='external-change'";
    await expect(h.apply(preview)).rejects.toThrow(/变化/); expect(h.sent).toEqual([]);
    await expect(h.apply(preview)).rejects.toThrow('已使用');
  });

  it('快照和预览各自到期后失效，过期记录不继续占用共享额度', async () => {
    const h = harness(), value = await h.get(); h.advance(structureCacheLimits.ttlMs);
    await expect(h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'expired' }, 7)).rejects.toThrow('失效');
    const preview = await h.prepare(); h.advance(structureCacheLimits.ttlMs);
    await expect(h.apply(preview)).rejects.toThrow('失效'); expect(h.sent).toEqual([]);
    expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow();
  });

  it('取消在最终发送检查前生效且不生成 ALTER，不恢复被消费令牌', async () => {
    const h = harness(), preview = await h.prepare(); h.host.cancelled = true;
    await expect(h.apply(preview)).rejects.toThrow('取消'); expect(h.sent).toEqual([]);
    await expect(h.apply(preview)).rejects.toThrow('已使用');
  });
});

describe('外键任务关闭、释放和共享缓存额度', () => {
  it('get 只在主机实际关闭完成后发布快照，关闭失败不留快照', async () => {
    const h = harness(); h.host.closeGate = deferred();
    let settled = false; const result = h.get().finally(() => { settled = true; });
    await h.host.atClose.promise;
    expect(settled).toBe(false); expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow();
    h.host.closeError = new Error('关闭未确认'); h.host.closeGate.resolve();
    await expect(result).rejects.toThrow('关闭未确认'); expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow();
  });

  it('内部 release 只清现有记录；在途 get 完成后再次释放才能回收，不冒充公开关闭流程', async () => {
    const h = harness(); h.host.closeGate = deferred();
    const result = h.get(); await h.host.atClose.promise;
    h.tasks.release(target.connectionId); h.host.closeGate.resolve();
    // 此处是类内部边界观测，并非产品缺陷断言：renderer 此时尚无 snapshotId；
    // Engine.close 等待独立任务结束后再释放共享缓存，不能用一次提前 release 假装完整关闭。
    await result; expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).toThrow('上限');
    h.tasks.release(target.connectionId);
    expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow();
    expect(h.sent).toEqual([]);
  });

  it('预览在真实关闭阶段跨过快照 TTL 时拒绝发布，缓存额度同时回收', async () => {
    const h = harness(), value = await h.get(); h.host.atClose = deferred(); h.host.closeGate = deferred();
    const result = h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'preview' }, 7);
    await h.host.atClose.promise; h.advance(structureCacheLimits.ttlMs); h.host.closeGate.resolve();
    await expect(result).rejects.toThrow('过期'); expect(h.sent).toEqual([]);
    expect(() => h.cache.capacity(structureCacheLimits.bytes, 'preview')).not.toThrow();
  });

  it('apply 准备期间跨过预览 TTL 必须再次拒绝，不能因入口时有效就发送 DDL', async () => {
    const h = harness(), preview = await h.prepare();
    vi.mocked(compareForeignKeyNames).mockImplementationOnce(async (_context, _evidence, _database, names) => {
      h.advance(structureCacheLimits.ttlMs);
      return new Map(names.map(name => [name, 'available' as const]));
    });
    await expect(h.apply(preview)).rejects.toThrow('过期'); expect(h.sent).toEqual([]);
    await expect(h.apply(preview)).rejects.toThrow('失效');
  });

  it('预览回调完成后但连接仍在关闭时释放快照，迟到结果不得产生执行令牌', async () => {
    const h = harness(), value = await h.get(); h.host.atClose = deferred(); h.host.closeGate = deferred();
    let settled = false;
    const result = h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'preview' }, 7).finally(() => { settled = true; });
    await h.host.atClose.promise; expect(settled).toBe(false);
    h.tasks.releaseTokens({ snapshotId: value.snapshotId }); h.host.closeGate.resolve();
    await expect(result).rejects.toThrow('释放'); expect(h.sent).toEqual([]);
    expect(() => h.cache.capacity(structureCacheLimits.bytes, 'preview')).not.toThrow();
  });

  it('apply 发送和核验成功仍等待真实关闭；第二次并发调用立即拒绝而不会重放', async () => {
    const h = harness(), preview = await h.prepare(); h.host.atClose = deferred(); h.host.closeGate = deferred();
    let settled = false; const result = h.apply(preview).finally(() => { settled = true; });
    await h.host.atClose.promise;
    expect(h.host.calls.at(-1)!.closed).toBe(false); expect(settled).toBe(false);
    await expect(h.apply(preview)).rejects.toThrow('已使用'); expect(h.sent).toEqual([preview.sql]);
    h.host.closeGate.resolve(); await expect(result).resolves.toMatchObject({ definitionVerified: true });
    expect(h.host.calls.at(-1)!.closed).toBe(true);
  });

  it('显式 releaseTokens 同时释放快照关联预览，单独预览释放仍保留原快照', async () => {
    const h = harness(), value = await h.get();
    const preview = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'first' }, 7);
    h.tasks.releaseTokens({ previewToken: preview.previewToken }); await expect(h.apply(preview)).rejects.toThrow('失效');
    const second = await h.tasks.preview({ snapshotId: value.snapshotId, patches: [replacement], taskId: 'second' }, 7);
    h.tasks.releaseTokens({ snapshotId: value.snapshotId }); await expect(h.apply(second)).rejects.toThrow('失效');
    expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow(); expect(h.sent).toEqual([]);
  });

  it('字段、索引与外键共用数量/字节上限；跨用途真实释放后才可继续读取', async () => {
    const h = harness();
    const columns = h.cache.scope<StructureCacheBinding>('columns', 'snapshot', value => value), indexes = h.cache.scope<StructureCacheBinding>('indexes', 'snapshot', value => value);
    const entry = { connectionId: target.connectionId, expires: h.now() + structureCacheLimits.ttlMs, bytes: 64 };
    for (let index = 0; index < 16; index++) { columns.set(`c${index}`, entry); indexes.set(`i${index}`, entry); }
    await expect(h.get()).rejects.toThrow('上限'); expect(columns.size + indexes.size).toBe(32);
    columns.delete('c0'); const value = await h.get();
    expect(() => h.cache.capacity(1, 'snapshot')).toThrow('上限'); h.tasks.releaseTokens({ snapshotId: value.snapshotId });
    h.cache.release(target.connectionId); expect(columns.size + indexes.size).toBe(0);
    columns.set('large', { ...entry, bytes: structureCacheLimits.bytes - 1 });
    await expect(h.get()).rejects.toThrow('上限'); columns.delete('large'); await expect(h.get()).resolves.toMatchObject({ writable: true });
  });

  it('DDL 成功后同时清除该连接字段/索引/外键实际记录，其他连接记录保留', async () => {
    const h = harness(), preview = await h.prepare();
    const columns = h.cache.scope<StructureCacheBinding>('columns', 'snapshot', value => value), indexes = h.cache.scope<StructureCacheBinding>('indexes', 'preview', value => value);
    const entry = { connectionId: target.connectionId, expires: h.now() + structureCacheLimits.ttlMs, bytes: 64 };
    columns.set('column', entry); indexes.set('index', entry); columns.set('other', { ...entry, connectionId: 'other-connection' });
    await h.apply(preview);
    expect(columns.has('column')).toBe(false); expect(indexes.has('index')).toBe(false); expect(columns.has('other')).toBe(true);
    expect(columns.size).toBe(1); expect(indexes.size).toBe(0);
    h.cache.release('other-connection'); expect(() => h.cache.capacity(structureCacheLimits.bytes, 'snapshot')).not.toThrow();
  });
});
