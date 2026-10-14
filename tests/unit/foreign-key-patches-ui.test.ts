import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ForeignKeyDefinition, ForeignKeyPatch } from '../../src/shared/tableForeignKeyPatches';
import type { TableForeignKeyApplyProgress, TableForeignKeyGetOutput, TableForeignKeyView } from '../../src/shared/tableForeignKeyTasks';
import { ForeignKeyRequestFence, ForeignKeyResourceLedger, addForeignKeyParentTarget, assertForeignKeyResponse, changeForeignKeyParent, foreignKeyAcknowledgementLabel, foreignKeyAcknowledgementsComplete, foreignKeyActionLabel, foreignKeyColumnSelectable, foreignKeyEditable, foreignKeyExecutionEffect, foreignKeyFailureState, foreignKeyProtectedTargets, foreignKeyTokenCurrent, makeForeignKeyAlter, moveForeignKeyPair, sameForeignKeyTarget, setForeignKeyPatch, validateForeignKeyDrafts } from '../../src/renderer/foreignKeyPatches';
import { assertForeignKeyTargetsAvailable, foreignKeyPatchServices, type ForeignKeyTargetWorkspace } from '../../src/renderer/foreignKeyPatchServices';

/** 合成的 opaque 引用故意与显示名称无关，不能冒充服务器兼容性验收。 */
function definition(name = 'fk_original'): ForeignKeyDefinition { return { name, parentRef: 'parent:one', pairs: [{ childColumnRef: 'child:a', parentColumnRef: 'parent:a' }], onUpdate: 'NO ACTION', onDelete: 'RESTRICT' }; }
/** 原始片段只供展示，前端不能通过它构建 SQL。 */
function original(): TableForeignKeyView { return { foreignKeyRef: 'ref:original', name: 'fk_original', rawSql: 'CONSTRAINT `fk_original` FOREIGN KEY (`__proto__`) REFERENCES `父` (`constructor`)', editableDefinition: definition(), childColumnNames: ['__proto__'], parentColumnNames: ['constructor'], parentTarget: { database: '库', table: '父' }, unsupportedReasons: [], access: { drop: { allowed: true, reasons: [] }, replace: { allowed: true, reasons: [] } } }; }
/** 同时包含重复显示名、跨表字段引用和复合唯一键的最小真实形状快照。 */
function snapshot(): TableForeignKeyGetOutput {
  const columns = [{ columnRef: 'child:a', name: '__proto__', typeSql: 'INT', nullable: false, generated: false, hidden: false, prefix: { kind: 'forbidden' as const, reason: '整数' } }, { columnRef: 'child:b', name: 'constructor', typeSql: 'INT', nullable: true, generated: false, hidden: false, prefix: { kind: 'forbidden' as const, reason: '整数' } }];
  return { target: { connectionId: 'conn', database: '库', table: '子' }, snapshotId: 'snapshot', expiresAt: '2030-01-01T00:00:00Z', ddlHash: 'hash', writable: true, warnings: [], namespaceCoverage: 'complete', incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, capabilities: { dialect: 'mysql', serverVersion: '8.4.11', defaultAction: 'NO ACTION' }, columns,
    parents: [{ parentRef: 'parent:one', target: { database: '库', table: '父' }, columns: columns.map((value, i) => ({ ...value, columnRef: `parent:${i ? 'b' : 'a'}` })), keys: [{ name: 'pk', kind: 'primary', columnRefs: ['parent:a', 'parent:b'] }] }, { parentRef: 'parent:two', target: { database: '另库', table: '父' }, columns: [{ ...columns[0], columnRef: 'other:a' }], keys: [] }], foreignKeys: [original()] };
}
/** 新增定义带独立 clientKey，永远不以 SQL 字符串执行。 */
function add(value = definition('fk_new')): ForeignKeyPatch { return { op: 'add', clientKey: 'client:new', definition: value }; }
/** 可控 Promise 用于确认取消、迟到响应及释放失败真实顺序，不使用延时猜测。 */
function deferred<T>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 各表标签可隐藏，保护逻辑仍按完整目标识别。 */
function workspace(): ForeignKeyTargetWorkspace { return { settings: { tabs: [{ id: 'child', kind: 'table', title: '子', connectionId: 'conn', database: '库', table: '子' }, { id: 'parent', kind: 'table', title: '父', connectionId: 'conn', database: '库', table: '父' }, { id: 'other', kind: 'table', title: '其他连接同名表', connectionId: 'other', database: '库', table: '父' }] }, dirtyTabs: {}, activeJobs: {} }; }

afterEach(() => { vi.unstubAllGlobals(); });

describe('外键草稿与有序引用', () => {
  it('只移动完整父子元组，原输入与列引用不被修改', () => {
    const pairs = [...definition().pairs, { childColumnRef: 'child:b', parentColumnRef: 'parent:b' }];
    expect(moveForeignKeyPair(pairs, 1, 0)).toEqual([pairs[1], pairs[0]]); expect(pairs[0].childColumnRef).toBe('child:a');
    expect(moveForeignKeyPair(moveForeignKeyPair(pairs, 0, 1), 1, 0)).toEqual(pairs);
  });
  it('移动负数、越界与非整数不丢失任何映射', () => {
    const pairs = definition().pairs;
    for (const [from, to] of [[-1, 0], [0, 2], [0.5, 0], [0, Number.NaN]]) expect(moveForeignKeyPair(pairs, from, to)).toEqual(pairs);
  });
  it('属性插入顺序不同不是差异，原值恢复返回空补丁', () => {
    const value = definition(); value.pairs = [{ parentColumnRef: 'parent:a', childColumnRef: 'child:a' }];
    expect(makeForeignKeyAlter(original(), value)).toBeNull();
    const source = original(); source.name = '旧外键'; source.editableDefinition!.name = '旧外键';
    expect(makeForeignKeyAlter(source, structuredClone(source.editableDefinition!))).toBeNull();
  });
  it('同名改动作及仅变大小写均拒绝，明确新名才产生替换差异', () => {
    expect(() => makeForeignKeyAlter(original(), { ...definition(), onDelete: 'CASCADE' })).toThrow('同名');
    expect(() => makeForeignKeyAlter(original(), definition('FK_ORIGINAL'))).toThrow('同名');
    expect(makeForeignKeyAlter(original(), { ...definition('fk_replacement'), onDelete: 'CASCADE' })).toEqual({ op: 'alter', foreignKeyRef: 'ref:original', changes: { name: 'fk_replacement', onDelete: 'CASCADE' } });
  });
  it('复合映射换序是实际差异，不能被集合排序抹掉', () => {
    const source = original(); source.editableDefinition!.pairs.push({ childColumnRef: 'child:b', parentColumnRef: 'parent:b' });
    const next = { ...source.editableDefinition!, name: 'fk_replacement', pairs: [...source.editableDefinition!.pairs].reverse() };
    expect(makeForeignKeyAlter(source, next)).toMatchObject({ changes: { pairs: next.pairs } });
  });
  it('未知原定义或不支持原因即使 access 允许也不能编辑', () => {
    const source = original(); source.unsupportedReasons = ['原始定义有未知属性'];
    expect(foreignKeyEditable(source)).toBe(false); expect(() => makeForeignKeyAlter(source, definition('new'))).toThrow('未知属性');
    source.unsupportedReasons = []; delete source.editableDefinition; expect(foreignKeyEditable(source)).toBe(false);
  });
  it('新增与旧引用同字面时，撤销或替换只影响指定来源', () => {
    const patches: ForeignKeyPatch[] = [{ op: 'drop', foreignKeyRef: 'shared' }, { ...add(), clientKey: 'shared' } as ForeignKeyPatch];
    expect(setForeignKeyPatch(patches, 'shared', null, 'added')).toEqual([patches[0]]);
    expect(setForeignKeyPatch(patches, 'shared', null)).toEqual([patches[1]]);
    expect(patches).toHaveLength(2);
  });
  it('切换父表不会保留上一父表引用，不足字段明确留空等待选择', () => {
    const old = definition(); old.pairs.push({ childColumnRef: 'child:b', parentColumnRef: 'parent:b' });
    const next = changeForeignKeyParent(old, 'parent:two', snapshot());
    expect(next.pairs).toEqual([{ childColumnRef: 'child:a', parentColumnRef: 'other:a' }, { childColumnRef: 'child:b', parentColumnRef: '' }]);
    expect(old.pairs[0].parentColumnRef).toBe('parent:a');
    expect(() => validateForeignKeyDrafts(snapshot(), [add({ ...next, name: 'fk_new' })])).toThrow();
  });
  it('父表切换只接受快照 opaque ref，不按显示名猜测', () => { expect(() => changeForeignKeyParent(definition(), '父', snapshot())).toThrow('引用'); });
  it('原型同名显示列正常形成草稿，列名不能替代引用', () => {
    expect(validateForeignKeyDrafts(snapshot(), [add(definition('__proto__'))])).toHaveLength(1);
    const value = definition('fk_new'); value.pairs[0].childColumnRef = '__proto__';
    expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow('引用');
  });
  it('父列必须属于选定父表，跨表同名列不能混入映射', () => {
    const value = definition('fk_new'); value.pairs[0].parentColumnRef = 'other:a';
    expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow('引用');
  });
  it('任何一侧的重复引用都拒绝，不能形成歧义元组', () => {
    const value = definition('fk_new'); value.pairs.push({ childColumnRef: 'child:a', parentColumnRef: 'parent:b' });
    expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow('重复');
    value.pairs[1] = { childColumnRef: 'child:b', parentColumnRef: 'parent:a' }; expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow('重复');
  });
  it('字段 32 项上限与未知引用都在预览请求前拒绝', () => {
    const value = definition('fk_new'); value.pairs = Array.from({ length: 33 }, (_, i) => ({ childColumnRef: `c${i}`, parentColumnRef: `p${i}` }));
    expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow();
    expect(() => validateForeignKeyDrafts(snapshot(), [{ op: 'drop', foreignKeyRef: 'constructor' }])).toThrow('引用');
  });
  it('未知写能力或无版本默认动作不开放草稿预览', () => {
    const state = snapshot(); state.writable = false; expect(() => validateForeignKeyDrafts(state, [add()])).toThrow('尚未证明');
    state.writable = true; delete state.capabilities; expect(() => validateForeignKeyDrafts(state, [add()])).toThrow('尚未证明');
  });
  it('生成列与隐藏列两侧都禁用，普通未知键能力由服务器计划', () => {
    const state = snapshot(); expect(foreignKeyColumnSelectable(state.columns[0])).toBe(true);
    state.columns[0].generated = true; expect(() => validateForeignKeyDrafts(state, [add()])).toThrow('生成字段');
    state.columns[0].generated = false; state.parents[0].columns[0].hidden = true; expect(() => validateForeignKeyDrafts(state, [add()])).toThrow('隐藏字段');
  });
  it('SET NULL 要求所有子字段允许空值，但不擅自改字段', () => {
    const value = { ...definition('fk_new'), onDelete: 'SET NULL' as const };
    expect(() => validateForeignKeyDrafts(snapshot(), [add(value)])).toThrow('NULL');
    value.pairs = [{ childColumnRef: 'child:b', parentColumnRef: 'parent:a' }]; expect(validateForeignKeyDrafts(snapshot(), [add(value)])).toHaveLength(1);
  });
  it('四种动作保持独立，服务器默认值不被前端折叠', () => {
    expect(foreignKeyActionLabel('RESTRICT')).not.toBe(foreignKeyActionLabel('NO ACTION'));
    for (const onUpdate of ['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'] as const) expect(validateForeignKeyDrafts(snapshot(), [add({ ...definition('fk_new'), onUpdate, pairs: [{ childColumnRef: 'child:b', parentColumnRef: 'parent:a' }] })])).toHaveLength(1);
  });
  it('新增或修改只允许受控 ASCII 名称，不 trim 静默改名', () => {
    for (const name of ['中文', '1first', ' name', 'name ', 'a'.repeat(65), 'a`b']) expect(() => validateForeignKeyDrafts(snapshot(), [add(definition(name))])).toThrow();
    expect(validateForeignKeyDrafts(snapshot(), [add(definition('A'.repeat(64)))])).toHaveLength(1);
  });
  it('同批删旧再同名新增仍拒绝，不能绕过同名替换边界', () => {
    expect(() => validateForeignKeyDrafts(snapshot(), [{ op: 'drop', foreignKeyRef: 'ref:original' }, add(definition('FK_ORIGINAL'))])).toThrow('同名');
    expect(() => validateForeignKeyDrafts(snapshot(), [{ op: 'alter', foreignKeyRef: 'ref:original', changes: { onDelete: 'CASCADE' } }])).toThrow('同名');
  });
  it('两个新名保守检查冲突，opaque 来源键无法掩盖一个最终名称', () => {
    const state = snapshot(); state.foreignKeys[0].foreignKeyRef = 'added:client:new';
    expect(() => validateForeignKeyDrafts(state, [add(), { op: 'add', clientKey: 'other', definition: definition('FK_NEW') }])).toThrow('重复');
    expect(validateForeignKeyDrafts(state, [add()])).toHaveLength(1);
  });
  it('服务端 drop 限制不绕过，replace allowed 仍必须完整校验草稿', () => {
    const state = snapshot(); state.foreignKeys[0].access.drop = { allowed: false, reasons: ['外部依赖未证明'] };
    expect(() => validateForeignKeyDrafts(state, [{ op: 'drop', foreignKeyRef: 'ref:original' }])).toThrow('外部依赖');
    expect(() => validateForeignKeyDrafts(state, [{ op: 'alter', foreignKeyRef: 'ref:original', changes: { name: 'fk_new', parentRef: 'fake' } }])).toThrow('引用');
  });
  it('名称空间 partial 与父唯一键不足不被本地伪装为授权或自动修复', () => {
    const state = snapshot(); state.namespaceCoverage = 'partial'; state.parents[0].keys = [];
    const patches = validateForeignKeyDrafts(state, [add()]); expect(patches).toEqual([add()]); expect(state.parents[0].keys).toEqual([]);
  });
  it('空补丁、重复引用、超预算及 SQL 属性拒绝，不读取 getter', () => {
    expect(() => validateForeignKeyDrafts(snapshot(), [])).toThrow('没有实际');
    expect(() => validateForeignKeyDrafts(snapshot(), [add(), add()])).toThrow('重复');
    expect(() => validateForeignKeyDrafts(snapshot(), Array.from({ length: 101 }, (_, i) => ({ ...add(), clientKey: `${i}` })))).toThrow();
    const getter = vi.fn(() => 'DROP TABLE x'), value = add(); Object.defineProperty(value, 'sql', { get: getter, enumerable: true });
    expect(() => validateForeignKeyDrafts(snapshot(), [value])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

describe('额外父表与执行前工作区保护', () => {
  it('明确父表输入保持空格、特殊字符和大小写，并复制输入', () => {
    const input = { database: ' 库`甲 ', table: '父/表' }, result = addForeignKeyParentTarget([], input); input.table = '后来修改';
    expect(result).toEqual([{ database: ' 库`甲 ', table: '父/表' }]);
    expect(addForeignKeyParentTarget([{ database: 'db', table: 'A' }], { database: 'db', table: 'a' })).toHaveLength(2);
  });
  it('16 个额外父目标是明确上限，重复或无效目标不会改原列表', () => {
    const targets = Array.from({ length: 16 }, (_, i) => ({ database: 'db', table: `${i}` }));
    expect(() => addForeignKeyParentTarget(targets, { database: 'db', table: '17' })).toThrow('16');
    expect(() => addForeignKeyParentTarget(targets, targets[0])).toThrow('已在'); expect(targets).toHaveLength(16);
    for (const table of ['', 'a\0b', '界'.repeat(65)]) expect(() => addForeignKeyParentTarget([], { database: 'db', table })).toThrow('有效');
  });
  it('父目标长度与 IPC 的 UTF-16 边界一致，避免释放旧快照后才发现参数超长', () => {
    expect(addForeignKeyParentTarget([], { database: '库'.repeat(64), table: '𠮷'.repeat(32) })).toHaveLength(1);
    expect(() => addForeignKeyParentTarget([], { database: 'db', table: '𠮷'.repeat(33) })).toThrow('有效');
  });
  it('保护目标包括所有已加载父表、继承连接并精确去重自引用', () => {
    const state = snapshot(); state.parents.push({ ...state.parents[0], parentRef: 'self', target: { database: '库', table: '子' } }, { ...state.parents[0], parentRef: 'duplicate' });
    const targets = foreignKeyProtectedTargets(state); expect(targets).toHaveLength(3); expect(targets.every(value => value.connectionId === 'conn')).toBe(true);
    targets[0].table = '改副本'; expect(state.target.table).toBe('子');
  });
  it('隐藏父表未提交数据也阻止 apply；其他连接同名表不受影响', () => {
    const state = workspace(), targets = foreignKeyProtectedTargets(snapshot()); state.dirtyTabs.other = true;
    expect(() => assertForeignKeyTargetsAvailable(targets, state)).not.toThrow();
    state.dirtyTabs.parent = true; expect(() => assertForeignKeyTargetsAvailable(targets, state)).toThrow('父表');
  });
  it('子表或父表忙碌阻止执行，继承的原型属性不冒充活跃任务', () => {
    const state = workspace(), targets = foreignKeyProtectedTargets(snapshot()); state.activeJobs = Object.create({ parent: true });
    expect(() => assertForeignKeyTargetsAvailable(targets, state)).not.toThrow();
    state.activeJobs.child = true; expect(() => assertForeignKeyTargetsAvailable(targets, state)).toThrow('活动操作');
  });
  it('数据库大小写、表名分隔符和连接 ID 均精确匹配', () => {
    const state = workspace(); state.dirtyTabs.parent = true;
    expect(() => assertForeignKeyTargetsAvailable([{ connectionId: 'conn', database: '库/父', table: '' }], state)).not.toThrow();
    expect(sameForeignKeyTarget({ connectionId: 'c', database: 'db', table: 'A' }, { connectionId: 'c', database: 'db', table: 'a' })).toBe(false);
  });
  it('工作区及父子目标预算超限直接拒绝而非漏查后半部分', () => {
    const state = workspace(); state.settings.tabs = Array.from({ length: 1001 }, () => state.settings.tabs[0]);
    expect(() => assertForeignKeyTargetsAvailable([], state)).toThrow('预算');
    expect(() => assertForeignKeyTargetsAvailable(Array.from({ length: 33 }, () => snapshot().target), workspace())).toThrow('预算');
  });
});

describe('固定预览、任务事实和异步资源责任', () => {
  it('四项风险精确勾选，缺失、重复、未知及原型同名不得执行', () => {
    const ids = ['ddl-implicit-commit', 'external-ddl-window', 'drop-foreign-key', 'referential-action-change'];
    expect(foreignKeyAcknowledgementsComplete(ids, new Set(ids))).toBe(true);
    for (const id of ids) expect(foreignKeyAcknowledgementLabel(id)).toMatch(/[\u4e00-\u9fff]/);
    for (const required of [[], ids.slice(1), [...ids, ids[0]], [...ids, '__proto__'], [...ids, 'constructor']]) expect(foreignKeyAcknowledgementsComplete(required, new Set(required))).toBe(false);
    expect(foreignKeyAcknowledgementsComplete(ids, new Set(ids.slice(0, -1)))).toBe(false);
    expect(foreignKeyAcknowledgementsComplete(ids.slice(0, 2), new Set(ids))).toBe(false);
  });
  it('到期边界和无效期限直接拒绝，响应目标或哈希失配不能使用', () => {
    const now = Date.parse('2030-01-01T00:00:00Z'), value = snapshot();
    expect(foreignKeyTokenCurrent(value.expiresAt, now - 1)).toBe(true); expect(foreignKeyTokenCurrent(value.expiresAt, now)).toBe(false); expect(foreignKeyTokenCurrent('invalid', now)).toBe(false);
    expect(() => assertForeignKeyResponse(value, value.target, value.ddlHash, now - 1)).not.toThrow();
    expect(() => assertForeignKeyResponse(value, value.target, 'changed', now - 1)).toThrow('不一致');
    expect(() => assertForeignKeyResponse(value, { ...value.target, connectionId: 'other' }, undefined, now - 1)).toThrow('不一致');
    expect(() => assertForeignKeyResponse(value, value.target, undefined, now)).toThrow('过期');
  });
  it('同步围栏拒绝同一轮双击，原请求结束前取消返回不能解锁', async () => {
    const guard = new ForeignKeyRequestFence(), originalRequest = deferred<void>(), token = guard.begin('get:1')!;
    const running = originalRequest.promise.finally(() => guard.finish(token));
    expect(guard.begin('get:2')).toBeUndefined(); expect(guard.cancel()).toBe('get:1');
    await Promise.resolve(); expect(guard.busy).toBe(true); expect(guard.cancel()).toBeUndefined(); expect(guard.accepts(token)).toBe(false);
    originalRequest.resolve(); await running; expect(guard.busy).toBe(false); expect(guard.begin('get:3')).toBeDefined();
  });
  it('取消后的迟到快照需要真正释放完毕，期间不能重读或关闭', async () => {
    const guard = new ForeignKeyRequestFence(), reply = deferred<string>(), closing = deferred<void>(), release = vi.fn(() => closing.promise), ledger = new ForeignKeyResourceLedger(release), operation = guard.begin('read')!;
    const run = (async () => { try { const id = await reply.promise; ledger.track('snapshotId', id); if (!guard.accepts(operation)) await ledger.release('snapshotId', id); } finally { guard.finish(operation); } })();
    guard.cancel(); reply.resolve('late'); await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledWith({ snapshotId: 'late' }); expect(guard.busy).toBe(true); expect(ledger.size).toBe(1); expect(guard.begin('again')).toBeUndefined();
    closing.resolve(); await run; expect(guard.busy).toBe(false); expect(ledger.size).toBe(0);
  });
  it('卸载后的迟到预览拒绝投影，释放失败保留责任而非丢 token', async () => {
    const guard = new ForeignKeyRequestFence(), reply = deferred<string>(), release = vi.fn().mockRejectedValueOnce(new Error('断线')).mockResolvedValue(undefined), ledger = new ForeignKeyResourceLedger(release), operation = guard.begin('preview')!;
    const received = reply.promise.then(async id => { ledger.track('previewToken', id); if (!guard.accepts(operation)) await ledger.release('previewToken', id); });
    expect(guard.dispose()).toBe('preview'); reply.resolve('late-preview'); await expect(received).rejects.toThrow('断线');
    expect(ledger.size).toBe(1); expect(guard.begin('after-unmount')).toBeUndefined();
    await ledger.releaseAll(true); expect(ledger.size).toBe(0); expect(release).toHaveBeenCalledTimes(2);
  });
  it('旧 finally 不能结束新请求，任务之间与窗口之间不共享围栏', () => {
    const first = new ForeignKeyRequestFence(), second = new ForeignKeyRequestFence(), old = first.begin('old')!; first.finish(old);
    const current = first.begin('new')!; first.finish(old); expect(first.taskId).toBe('new');
    const other = second.begin('other')!; first.cancel(); expect(second.accepts(other)).toBe(true); expect(first.accepts(current)).toBe(false);
  });
  it('并发释放同一令牌只有一个服务请求，释放结果之前责任仍在', async () => {
    const done = deferred<void>(), release = vi.fn(() => done.promise), ledger = new ForeignKeyResourceLedger(release);
    const first = ledger.release('previewToken', 'same'), second = ledger.release('previewToken', 'same'); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1); expect(ledger.size).toBe(1); done.resolve(); await Promise.all([first, second]); expect(ledger.size).toBe(0);
  });
  it('预览释放失败仍尝试快照，旧责任清完之前调用者不能开始新 get', async () => {
    const release = vi.fn().mockRejectedValueOnce(new Error('预览释放失败')).mockResolvedValue(undefined), ledger = new ForeignKeyResourceLedger(release), get = vi.fn();
    ledger.track('snapshotId', 'old'); ledger.track('previewToken', 'plan');
    await expect(ledger.releaseAll(true).then(get)).rejects.toThrow('释放失败'); expect(get).not.toHaveBeenCalled(); expect(ledger.size).toBe(1);
    expect(release.mock.calls).toEqual([[{ previewToken: 'plan' }], [{ snapshotId: 'old' }]]);
    await ledger.releaseAll(true); expect(ledger.size).toBe(0);
  });
  it('返回编辑只释放预览，快照与同字符串 token 保持不同身份', async () => {
    const release = vi.fn().mockResolvedValue(undefined), ledger = new ForeignKeyResourceLedger(release);
    ledger.track('snapshotId', '__proto__'); ledger.track('previewToken', '__proto__'); await ledger.releaseAll(false);
    expect(release.mock.calls).toEqual([[{ previewToken: '__proto__' }]]); expect(ledger.size).toBe(1);
    await ledger.releaseAll(true); expect(release.mock.calls[1]).toEqual([{ snapshotId: '__proto__' }]);
  });
  it('releaseAll 执行中后到令牌不会被旧一轮清理误删', async () => {
    const done = deferred<void>(), release = vi.fn().mockImplementationOnce(() => done.promise).mockResolvedValue(undefined), ledger = new ForeignKeyResourceLedger(release);
    ledger.track('snapshotId', 'old'); const pending = ledger.releaseAll(true); await Promise.resolve(); ledger.track('previewToken', 'late');
    done.resolve(); await pending; expect(ledger.size).toBe(1); await ledger.releaseAll(true); expect(release).toHaveBeenLastCalledWith({ previewToken: 'late' });
  });
  it('未知执行结果保留草稿并标旧，明确未发送不误报数据已改变', () => {
    expect(foreignKeyExecutionEffect({ kind: 'rejected', progress: null, attempted: false })).toEqual({ clearDrafts: false, page: 'none' });
    expect(foreignKeyExecutionEffect({ kind: 'rejected', progress: null, attempted: true })).toEqual({ clearDrafts: false, page: 'stale' });
    const progress: TableForeignKeyApplyProgress = { phase: 'releasing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' };
    expect(foreignKeyFailureState(progress)).toBe('notSent'); expect(foreignKeyExecutionEffect({ kind: 'rejected', progress, attempted: true }).page).toBe('none');
    progress.outcome = 'failed'; expect(foreignKeyFailureState(progress)).toBe('failed');
  });
  it('DDL 已完成但核验或释放失败仍清结构草稿，绝不当作未执行重放', () => {
    const progress: TableForeignKeyApplyProgress = { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'unknown' };
    expect(foreignKeyFailureState(progress)).toBe('verificationFailed'); expect(foreignKeyExecutionEffect({ kind: 'rejected', progress, attempted: true })).toEqual({ clearDrafts: true, page: 'stale' });
    progress.definitionVerified = true; expect(foreignKeyFailureState(progress)).toBe('succeeded');
    expect(foreignKeyExecutionEffect({ kind: 'resolved', result: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] } })).toEqual({ clearDrafts: true, page: 'refresh' });
    expect(foreignKeyExecutionEffect({ kind: 'resolved', result: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: ['核验不足'] } })).toEqual({ clearDrafts: true, page: 'stale' });
  });
  it('生产适配器只调用四个外键命令和取消，不执行原始 SQL', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('window', { dbark: { invoke } });
    const get = { ...snapshot().target, taskId: 'get', parentTargets: [{ database: 'other', table: '父' }] }, preview = { snapshotId: 's', patches: [add()], taskId: 'preview' }, apply = { previewToken: 'p', acknowledgements: ['ddl-implicit-commit'], taskId: 'apply' };
    await foreignKeyPatchServices.get(get); await foreignKeyPatchServices.preview(preview); await foreignKeyPatchServices.apply(apply); await foreignKeyPatchServices.release({ snapshotId: 's' }); await foreignKeyPatchServices.cancel({ taskId: 'apply' });
    expect(invoke.mock.calls).toEqual([['schema.foreignKeys.get', get], ['schema.foreignKeys.preview', preview], ['schema.foreignKeys.apply', apply], ['schema.foreignKeys.release', { snapshotId: 's' }], ['query.cancel', { taskId: 'apply' }]]);
  });
  it('任务订阅只接收外键属性，退订使用真实清理函数', () => {
    let send!: (event: unknown) => void; const unsubscribe = vi.fn(), listener = vi.fn();
    vi.stubGlobal('window', { dbark: { onTask: (callback: (event: unknown) => void) => { send = callback; return unsubscribe; } } });
    const stop = foreignKeyPatchServices.subscribe!(listener), progress = { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' };
    send({ taskId: 'other', indexPatch: progress }); expect(listener).not.toHaveBeenCalled();
    send({ taskId: 'fk', foreignKeyPatch: progress }); expect(listener).toHaveBeenCalledWith({ taskId: 'fk', progress }); stop(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
