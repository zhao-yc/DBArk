import { describe, expect, it } from 'vitest';
import type { IndexDefinition, IndexPatch, TableIndexView } from '../../src/shared/tableIndexPatches';
import type { TableIndexApplyProgress, TableIndexGetOutput } from '../../src/shared/tableIndexTasks';
import { IndexRequestFence, indexAcknowledgementLabel, indexAcknowledgementsComplete, indexColumnSelectable, indexDraftPermission, indexExecutionEffect, indexFailureState, indexNameDraftPermission, indexTokenCurrent, makeIndexAlter, moveIndexPart, sameIndexTarget, setIndexPatch, setIndexPrefix, validateIndexDrafts } from '../../src/renderer/indexPatches';
import { assertIndexTargetAvailable, indexPageRefreshAction, indexTargetKey, type IndexTargetWorkspace } from '../../src/renderer/indexPatchServices';

/** 自主前端模型与稳定引用，不以测试中的固定能力冒充真实服务器能力。 */
function definition(name = 'idx', refs = ['ref:a']): IndexDefinition { return { kind: 'ordinary', name, method: 'BTREE', comment: '原注释', keyParts: refs.map(columnRef => ({ columnRef, direction: 'asc' })) }; }
function index(indexRef = 'ref:idx', name = 'idx'): TableIndexView { return { indexRef, name, rawSql: `KEY \`${name}\`(\`__proto__\`) COMMENT '原注释'`, kind: 'ordinary', editableDefinition: definition(name), unsupportedReasons: [], access: { drop: { allowed: true, reasons: [] }, rename: { allowed: true, reasons: [] }, replace: { allowed: true, reasons: [] } } }; }
/** 快照中的原型同名列只是数据库名称，所有匹配均采用另发的引用。 */
function snapshot(): TableIndexGetOutput {
  return {
    target: { connectionId: 'conn', database: '库', table: '表' }, snapshotId: 'snapshot', expiresAt: '2030-01-01T00:00:00Z', ddlHash: 'hash',
    columns: [
      { columnRef: 'ref:a', name: '__proto__', typeSql: 'INT', nullable: false, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '整数' } },
      { columnRef: 'ref:b', name: 'constructor', typeSql: 'VARCHAR(20)', nullable: false, generated: false, hidden: false, fullKeyBytes: 80, prefix: { kind: 'allowed', unit: 'characters', maxLength: 20 } },
      { columnRef: 'ref:c', name: '可空列', typeSql: 'VARBINARY(20)', nullable: true, generated: false, hidden: false, fullKeyBytes: 20, prefix: { kind: 'allowed', unit: 'bytes', maxLength: 20 } },
    ],
    indexes: [index()], warnings: [], writable: true, incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' },
    capabilities: { dialect: 'mysql', serverVersion: '8.4.11', renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 },
  };
}
/** 新增补丁不携带 SQL 或服务端令牌之外的执行参数。 */
function add(value = definition('new', ['ref:b'])): IndexPatch { return { op: 'add', clientKey: 'client:new', definition: value }; }

describe('索引差异前端纯模型及请求围栏', () => {
  it('风险 ID 只映射已固定四项，未知/原型同名不得授权', () => {
    for (const id of ['ddl-implicit-commit', 'external-ddl-window', 'drop-unique-constraint', 'primary-key-change']) expect(indexAcknowledgementLabel(id)).toMatch(/[\u4e00-\u9fff]/);
    for (const id of ['external-name-dependencies', '__proto__', 'constructor', 'new-risk']) expect(indexAcknowledgementLabel(id)).toBeUndefined();
    const required = ['ddl-implicit-commit', 'external-ddl-window'];
    expect(indexAcknowledgementsComplete(required, new Set(required))).toBe(true);
    for (const missing of [[], required.slice(0, 1), [...required, 'new-risk'], [...required, required[0]]]) expect(indexAcknowledgementsComplete(missing, new Set(missing))).toBe(false);
    expect(indexAcknowledgementsComplete(required, new Set([...required, 'primary-key-change']))).toBe(false);
    expect(indexAcknowledgementsComplete(required, new Set(required.slice(0, 1)))).toBe(false);
  });

  it('原值恢复不留 alter，只发送真正改变的属性', () => {
    const original = index(); expect(makeIndexAlter(original, definition())).toBeNull();
    expect(makeIndexAlter(original, { ...definition(), comment: '新注释' })).toEqual({ op: 'alter', indexRef: original.indexRef, changes: { comment: '新注释' } });
    expect(makeIndexAlter(original, { ...definition(), name: 'IDX' })).toEqual({ op: 'alter', indexRef: original.indexRef, changes: { name: 'IDX' } });
  });

  it('仅改名与重建分别遵守服务端 access，未知完整定义一律只读', () => {
    const original = index(); original.access.replace = { allowed: false, reasons: ['外键支持键不能重建'] };
    expect(makeIndexAlter(original, { ...definition(), name: 'new' })).toMatchObject({ changes: { name: 'new' } });
    expect(() => makeIndexAlter(original, { ...definition(), name: 'new', comment: '变化' })).toThrow('不能重建');
    original.access.rename = { allowed: false, reasons: ['改名未证明'] };
    expect(() => makeIndexAlter(original, { ...definition(), name: 'new' })).toThrow('改名未证明');
    delete original.editableDefinition; expect(() => makeIndexAlter(original, definition())).toThrow('只读');
  });

  it('清空前缀删除 optional 自有键，属性插入顺序不会形成伪差异', () => {
    const old = { columnRef: 'ref:b', direction: 'asc' as const, prefixLength: 3 }, cleared = setIndexPrefix(old, '');
    expect(cleared).toEqual({ columnRef: 'ref:b', direction: 'asc' }); expect(Object.hasOwn(cleared, 'prefixLength')).toBe(false);
    const original = index(); original.editableDefinition = definition('idx', ['ref:b']); original.editableDefinition.keyParts = [old];
    expect(makeIndexAlter(original, { ...original.editableDefinition, keyParts: [{ prefixLength: 3, direction: 'asc', columnRef: 'ref:b' }] })).toBeNull();
    expect(makeIndexAlter(original, { ...original.editableDefinition, keyParts: [cleared] })).toMatchObject({ changes: { keyParts: [cleared] } });
    expect(() => validateIndexDrafts(snapshot(), [add({ ...definition('new', ['ref:b']), keyParts: [{ ...cleared, prefixLength: undefined }] })])).toThrow();
  });

  it('复合字段移动保留引用、前缀和方向，原数组不被改变', () => {
    const first = { columnRef: 'ref:b', direction: 'desc' as const, prefixLength: 2 }, second = { columnRef: 'ref:a', direction: 'asc' as const }, parts = [first, second];
    expect(moveIndexPart(parts, 1, 0)).toEqual([second, first]); expect(parts).toEqual([first, second]);
    expect(moveIndexPart(parts, 0, -1)).toEqual(parts); expect(moveIndexPart(parts, 0, 2)).toEqual(parts);
    expect(moveIndexPart(moveIndexPart(parts, 0, 1), 1, 0)).toEqual(parts);
  });

  it('同一旧引用或新增 clientKey 的撤销不会抹掉其他键', () => {
    const patches: IndexPatch[] = [{ op: 'alter', indexRef: 'ref:idx', changes: { comment: '变化' } }, add()];
    const next = setIndexPatch(patches, 'ref:idx', { op: 'drop', indexRef: 'ref:idx' });
    expect(next).toEqual([patches[1], { op: 'drop', indexRef: 'ref:idx' }]); expect(setIndexPatch(next, 'ref:idx', null)).toEqual([patches[1]]);
    expect(patches[0]).toMatchObject({ op: 'alter' });
  });

  it('未知写能力/缺 capabilities 不能伪造默认可编辑服务器', () => {
    const state = snapshot(); state.writable = false; expect(() => validateIndexDrafts(state, [add()])).toThrow('尚未证明');
    state.writable = true; delete state.capabilities; expect(() => validateIndexDrafts(state, [add()])).toThrow('尚未证明');
  });

  it('原型同名列按 ref 验证；悬空引用和重复字段在预览前拒绝', () => {
    expect(validateIndexDrafts(snapshot(), [add(definition('constructor', ['ref:a', 'ref:b']))])).toHaveLength(1);
    expect(() => validateIndexDrafts(snapshot(), [add(definition('new', ['__proto__']))])).toThrow('引用');
    expect(() => validateIndexDrafts(snapshot(), [add(definition('new', ['ref:a', 'ref:a']))])).toThrow();
    expect(() => validateIndexDrafts(snapshot(), [{ op: 'drop', indexRef: '__proto__' }])).toThrow('引用');
  });

  it('前缀只接受明确的单位/长度能力，空前缀必须有完整键能力', () => {
    const state = snapshot(), prefixed = { ...definition('new', ['ref:b']), keyParts: [setIndexPrefix({ columnRef: 'ref:b', direction: 'asc' }, '3')] };
    expect(validateIndexDrafts(state, [add(prefixed)])).toHaveLength(1);
    for (const length of ['0', '1.5', '21']) expect(() => validateIndexDrafts(state, [add({ ...prefixed, keyParts: [setIndexPrefix(prefixed.keyParts[0], length)] })])).toThrow();
    state.columns[1].prefix = { kind: 'unknown', reason: '目录不完整' }; expect(() => validateIndexDrafts(state, [add(prefixed)])).toThrow('前缀');
    delete state.columns[1].fullKeyBytes; expect(indexColumnSelectable(state.columns[1])).toBe(false);
    state.columns[1].prefix = { kind: 'allowed', unit: 'characters', maxLength: 20 };
    expect(indexColumnSelectable(state.columns[1])).toBe(true); expect(() => validateIndexDrafts(state, [add()])).toThrow('前缀');
    expect(validateIndexDrafts(state, [add(prefixed)])).toHaveLength(1);
  });

  it('DESC 和生成/隐藏字段能力未知时不能通过输入绕过禁用选项', () => {
    const state = snapshot(), descending = definition('new', ['ref:b']); descending.keyParts[0].direction = 'desc'; state.capabilities!.descendingIndexes = false;
    expect(() => validateIndexDrafts(state, [add(descending)])).toThrow('DESC');
    state.columns[1].generated = true; expect(indexColumnSelectable(state.columns[1])).toBe(false); expect(() => validateIndexDrafts(state, [add()])).toThrow('能力');
    state.columns[1].generated = false; state.columns[1].hidden = true; expect(indexColumnSelectable(state.columns[1])).toBe(false);
  });

  it('主键固定名称且要求已 NOT NULL 完整字段，不自动改可空性或去掉前缀', () => {
    const primary = { ...definition('PRIMARY'), kind: 'primary' as const };
    expect(validateIndexDrafts(snapshot(), [add(primary)])).toHaveLength(1);
    expect(() => validateIndexDrafts(snapshot(), [add({ ...primary, name: 'other' })])).toThrow();
    expect(() => validateIndexDrafts(snapshot(), [add({ ...primary, keyParts: [{ columnRef: 'ref:c', direction: 'asc' }] })])).toThrow('NOT NULL');
    expect(() => validateIndexDrafts(snapshot(), [add({ ...primary, keyParts: [{ columnRef: 'ref:b', direction: 'asc', prefixLength: 2 }] })])).toThrow('NOT NULL');
  });

  it('最终名称冲突、超预算和超长注释拒绝，但不使用 JS 校验数据库唯一值', () => {
    const state = snapshot(); expect(() => validateIndexDrafts(state, [add(definition('IDX', ['ref:b']))])).toThrow('重复');
    state.capabilities!.maxKeyParts = 1; expect(() => validateIndexDrafts(state, [add(definition('new', ['ref:a', 'ref:b']))])).toThrow('数量');
    expect(() => validateIndexDrafts(state, [add({ ...definition('new'), comment: '中'.repeat(342) })])).toThrow('字节');
    expect(() => validateIndexDrafts(state, [])).toThrow('没有实际');
    expect(() => validateIndexDrafts(state, Array.from({ length: 101 }, (_, n) => ({ op: 'drop', indexRef: String(n) })))).toThrow();
  });

  it('readonly 投影拒绝删除；删除再同名新增只形成草稿，实际依赖仍交后端', () => {
    const state = snapshot(); expect(validateIndexDrafts(state, [{ op: 'drop', indexRef: 'ref:idx' }, add(definition('idx', ['ref:b']))])).toHaveLength(2);
    state.indexes[0].access.drop = { allowed: false, reasons: ['依赖未证明'] };
    expect(() => validateIndexDrafts(state, [{ op: 'drop', indexRef: 'ref:idx' }])).toThrow('依赖未证明');
  });

  it('最后自增支持键单项不可删除，但新增替代键后可将受控整批草稿送审', () => {
    const state = snapshot(), ref = state.indexes[0].indexRef, reason = '最后自增支持键不能单独删除';
    state.indexes[0].access.drop = { allowed: false, reasons: [reason] };
    const replacement = add(definition('replacement', ['ref:a'])), drop: IndexPatch = { op: 'drop', indexRef: ref };
    expect(indexDraftPermission(state, ref, 'drop', [])).toEqual({ allowed: false, requiresBatchPreview: false, reasons: [reason] });
    expect(indexDraftPermission(state, ref, 'drop', [replacement])).toEqual({ allowed: true, requiresBatchPreview: true, reasons: [reason] });
    expect(validateIndexDrafts(state, [drop, replacement])).toEqual([drop, replacement]);
    expect(validateIndexDrafts(state, [replacement, drop])).toEqual([replacement, drop]);
    // 撤销替代键后不能留下可预览的单独删除，不依赖草稿数组的先后顺序。
    expect(() => validateIndexDrafts(state, setIndexPatch([replacement, drop], 'client:new', null))).toThrow(reason);
  });

  it('组合入口不由自身 alter 或其他 drop 自我放开，另一个受控 alter 可以送审', () => {
    const state = snapshot(), original = state.indexes[0]; original.access.drop = { allowed: false, reasons: ['依赖限制'] };
    state.indexes.push(index('ref:second', 'second'));
    const own: IndexPatch = { op: 'alter', indexRef: original.indexRef, changes: { comment: '自身草稿' } };
    expect(indexDraftPermission(state, original.indexRef, 'drop', [own])).toMatchObject({ allowed: false });
    expect(indexDraftPermission(state, original.indexRef, 'drop', [{ op: 'drop', indexRef: 'ref:second' }])).toMatchObject({ allowed: false });
    const other: IndexPatch = { op: 'alter', indexRef: 'ref:second', changes: { keyParts: [{ columnRef: 'ref:a', direction: 'asc' }] } };
    expect(indexDraftPermission(state, original.indexRef, 'drop', [other])).toMatchObject({ allowed: true, requiresBatchPreview: true });
  });

  it('编辑器 rename 与 replace 使用同一整批草稿权限，未知原生改名能力仍拒绝', () => {
    const state = snapshot(), original = state.indexes[0], patches = [add()];
    original.access.rename = { allowed: false, reasons: ['单项改名依赖未证明'] }; original.access.replace = { allowed: false, reasons: ['单项重建依赖未证明'] };
    expect(() => makeIndexAlter(original, { ...definition(), comment: '新值' }, { snapshot: state, patches: [] })).toThrow('单项重建');
    const changed = makeIndexAlter(original, { ...definition(), comment: '新值' }, { snapshot: state, patches })!;
    expect(changed).toMatchObject({ changes: { comment: '新值' } }); expect(validateIndexDrafts(state, [...patches, changed])).toHaveLength(2);
    expect(makeIndexAlter(original, { ...definition(), name: 'renamed' }, { snapshot: state, patches })).toMatchObject({ changes: { name: 'renamed' } });
    state.capabilities!.renameIndex = false;
    expect(indexDraftPermission(state, original.indexRef, 'rename', patches)).toMatchObject({ allowed: false, requiresBatchPreview: false });
    expect(() => makeIndexAlter(original, { ...definition(), name: 'renamed' }, { snapshot: state, patches })).toThrow('原生改名');
  });

  it('组合草稿不能解锁不透明/隐藏/生成索引或未知表能力，具体只读原因保持', () => {
    for (const reason of ['不透明原定义', '隐藏索引', '生成索引']) {
      const state = snapshot(), original = state.indexes[0]; original.unsupportedReasons = [reason];
      for (const action of ['drop', 'rename', 'replace'] as const) expect(indexDraftPermission(state, original.indexRef, action, [add()])).toEqual({ allowed: false, requiresBatchPreview: false, reasons: [reason] });
      expect(() => validateIndexDrafts(state, [add(), { op: 'drop', indexRef: original.indexRef }])).toThrow(reason);
      expect(() => makeIndexAlter(original, { ...definition(), comment: '新值' }, { snapshot: state, patches: [add()] })).toThrow(reason);
    }
    const state = snapshot(), original = state.indexes[0]; delete original.editableDefinition;
    expect(indexDraftPermission(state, original.indexRef, 'drop', [add()])).toMatchObject({ allowed: false });
    state.writable = false; expect(indexDraftPermission(state, original.indexRef, 'drop', [add()])).toMatchObject({ allowed: false });
    state.writable = true; delete state.capabilities; expect(indexDraftPermission(state, original.indexRef, 'drop', [add()])).toMatchObject({ allowed: false });
  });

  it('主键转普通键的名称属于显式重建，不误用 PRIMARY 原生改名限制', () => {
    const state = snapshot(), original = state.indexes[0]; original.kind = 'primary'; original.name = 'PRIMARY'; original.editableDefinition = { ...definition('PRIMARY'), kind: 'primary' };
    original.access.rename = { allowed: false, reasons: ['主键不可原生改名'] }; state.capabilities!.renameIndex = false;
    expect(indexNameDraftPermission(state, original.indexRef, original.editableDefinition, [])).toMatchObject({ allowed: false });
    const ordinary = { ...original.editableDefinition, kind: 'ordinary' as const, name: 'replacement' };
    expect(indexNameDraftPermission(state, original.indexRef, ordinary, [])).toMatchObject({ allowed: true });
    const patch = makeIndexAlter(original, ordinary, { snapshot: state, patches: [] })!;
    expect(patch).toMatchObject({ changes: { kind: 'ordinary', name: 'replacement' } });
    expect(validateIndexDrafts(state, [patch])).toHaveLength(1);
  });

  it('精确目标元组不碰撞，库表大小写变化必须失效', () => {
    const a = { connectionId: 'x', database: 'a/b', table: 'c' }, b = { connectionId: 'x', database: 'a', table: 'b/c' };
    expect(indexTargetKey(a)).not.toBe(indexTargetKey(b)); expect(sameIndexTarget(a, { ...a })).toBe(true);
    expect(sameIndexTarget(a, { ...a, table: 'C' })).toBe(false); expect(sameIndexTarget(a, { ...a, connectionId: 'y' })).toBe(false);
  });

  it('TTL 非法或正好到期即拒绝，不能把无效日期当永久有效', () => {
    expect(indexTokenCurrent('2030-01-01T00:00:00Z', Date.parse('2029-12-31T23:59:59Z'))).toBe(true);
    expect(indexTokenCurrent('2030-01-01T00:00:00Z', Date.parse('2030-01-01T00:00:00Z'))).toBe(false);
    expect(indexTokenCurrent('invalid', 0)).toBe(false);
  });

  it('同步锁拒绝双击，真实 finally 前取消不能解除 busy 或接受迟到结果', async () => {
    const guard = new IndexRequestFence(), first = guard.begin('task1')!;
    expect(guard.begin('task2')).toBeUndefined(); expect(guard.accepts(first)).toBe(true);
    expect(guard.cancel()).toBe('task1'); expect(guard.cancel()).toBeUndefined(); expect(guard.busy).toBe(true); expect(guard.accepts(first)).toBe(false);
    let complete!: () => void; const request = new Promise<void>(resolve => { complete = resolve; });
    const settled = request.finally(() => guard.finish(first)); expect(guard.begin('task3')).toBeUndefined();
    complete(); await settled; expect(guard.busy).toBe(false);
    const next = guard.begin('task4')!; expect(guard.accepts(next)).toBe(true); expect(guard.accepts(first)).toBe(false);
    guard.finish(first); expect(guard.busy).toBe(true); guard.finish(next); expect(guard.busy).toBe(false);
  });

  it('卸载后旧请求只允许外部释放，不能复活旧代次或开启新请求', () => {
    const guard = new IndexRequestFence(), pending = guard.begin('task')!;
    expect(guard.dispose()).toBe('task'); expect(guard.accepts(pending)).toBe(false); expect(guard.begin('after-unmount')).toBeUndefined();
    guard.finish(pending); expect(guard.busy).toBe(false); expect(guard.begin('still-unmounted')).toBeUndefined();
  });

  it('失败 Promise 没有证明时 unknown；DDL OK 后核验/清理失败仍保完成事实', () => {
    const proof: TableIndexApplyProgress = { phase: 'rechecking', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' };
    expect(indexFailureState(null)).toBe('unknown'); expect(indexFailureState(proof)).toBe('notSent');
    expect(indexFailureState({ ...proof, ddlSubmitted: true })).toBe('unknown');
    expect(indexFailureState({ ...proof, ddlSubmitted: true, outcome: 'failed' })).toBe('failed');
    expect(indexFailureState({ ...proof, ddlSubmitted: true, ddlCompleted: true, phase: 'verifying', outcome: 'succeeded' })).toBe('verificationFailed');
    expect(indexFailureState({ ...proof, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, phase: 'releasing', outcome: 'succeeded' })).toBe('succeeded');
  });

  it('只有完整核验才能刷新，unknown 保结构草稿与表页数据草稿', () => {
    expect(indexExecutionEffect({ kind: 'rejected', progress: null, attempted: true })).toEqual({ clearDrafts: false, page: 'stale' });
    expect(indexExecutionEffect({ kind: 'rejected', progress: null, attempted: false })).toEqual({ clearDrafts: false, page: 'none' });
    expect(indexExecutionEffect({ kind: 'resolved', result: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [] } })).toEqual({ clearDrafts: true, page: 'stale' });
    expect(indexExecutionEffect({ kind: 'resolved', result: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] } })).toEqual({ clearDrafts: true, page: 'refresh' });
  });

  it('隐藏同目标表页仍参与 dirty/busy 保护，查询和其他表不混用', () => {
    const target = snapshot().target;
    const workspace: IndexTargetWorkspace = { settings: { tabs: [
      { id: '__proto__', kind: 'table', title: '表', ...target },
      { id: 'query', kind: 'query', title: '查询', connectionId: target.connectionId, database: target.database, sql: '' },
      { id: 'other', kind: 'table', title: '其他', ...target, table: '另表' },
    ] }, dirtyTabs: Object.fromEntries([['query', true], ['other', true]]), activeJobs: {} };
    expect(() => assertIndexTargetAvailable(target, workspace)).not.toThrow();
    workspace.dirtyTabs = Object.fromEntries([['__proto__', true]]); expect(() => assertIndexTargetAvailable(target, workspace)).toThrow('数据草稿');
    workspace.activeJobs = Object.fromEntries([['__proto__', true]]); expect(() => assertIndexTargetAvailable(target, workspace)).toThrow('活动操作');
  });

  it('刷新版本不抢走忙任务或未提交数据草稿，未知结果只能标过期', () => {
    expect(indexPageRefreshAction(1, 1, true, false, false)).toBe('ignore');
    expect(indexPageRefreshAction(1, 2, true, true, false)).toBe('wait');
    expect(indexPageRefreshAction(1, 2, true, false, true)).toBe('stale');
    expect(indexPageRefreshAction(1, 2, false, false, false)).toBe('stale');
    expect(indexPageRefreshAction(1, 2, true, false, false)).toBe('reload');
  });
});
