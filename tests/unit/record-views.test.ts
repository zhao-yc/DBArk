import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, DataRow, TableInfo } from '../../src/shared/contracts';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { ownCell } from '../../src/renderer/lib';
import { acceptGridDrafts, adjacentRecordId, assertRecordDraftCurrent, beginRecordDraft, captureRecordPagePreview, consumeRecordPagePreview, editRecordInput, initialRecordInput, recordBinaryBytes, recordFieldOrder, recordFieldTooLarge, recordInputDirty, recordInputLimits, recordReadonlyReason, recordTargetKey, RecordLeaveGuard, stageRecordDraft, type RecordContext } from '../../src/renderer/recordViews';

/** 建立符合真实表页契约的最小快照，不引入数据库或渲染器桩写接口。 */
function column(name: string, patch: Partial<ColumnInfo> = {}): ColumnInfo { return { name, type: 'varchar(100)', nullable: true, defaultValue: null, extra: '', generated: false, comment: '', ...patch }; }
/** original 与 data 分别持有完整原型安全记录，用于验证更新定位和值保留。 */
function row(id: string, data: DataRow, inserted = false): DraftRow { return { id, data: { ...data }, original: inserted ? undefined : { ...data }, inserted, deleted: false }; }
/** 元数据包含隐藏列与完整可靠键，作用域使用真实有序目标元组。 */
function context(columns = [column('id', { nullable: false }), column('text'), column('hidden')]): RecordContext {
  const info: TableInfo = { database: '数据库', name: '记录', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns };
  return { target: { connectionId: '连接', database: info.database, table: info.name }, connectionVersion: 4, generation: 9, info, loaded: true, stale: false, busy: false };
}
/** 使用真实列元数据修改一个缓冲字段，未触碰的列保持原始类型。 */
function changed(source: DraftRow, ctx: RecordContext, key: string, text: string, mode: 'text' | 'json' | 'binary' | 'null' | 'default' = 'text') { return editRecordInput(beginRecordDraft(source, ctx), ctx.info!.columns.find(item => item.name === key)!, { mode, text }); }

describe('普通记录表单共享草稿与精确值', () => {
  it('相同显示值与主键不混淆本地 UUID，改主键仍携带原完整旧值', () => {
    const ctx = context(); const a = row('a', { id: '1', text: '同值', hidden: '隐藏' }); const b = row('b', { id: '1', text: '同值', hidden: '另行' });
    const result = stageRecordDraft([a, b], changed(a, ctx, 'id', '9007199254740993'), ctx);
    expect(result[1]).toBe(b); expect(result[0].original).toBe(a.original); expect(result[0].data.hidden).toBe('隐藏');
    expect(collectChanges(result)).toEqual([{ kind: 'update', before: a.original, values: { id: '9007199254740993' } }]);
  });
  it('新行 DEFAULT、空文本、文字 NULL、NULL、空二进制保持五种独立语义', () => {
    const ctx = context(['default', 'empty', 'word', 'null', 'blob'].map(name => column(name))); const a = row('new', { default: '先前草稿' }, true);
    let draft = beginRecordDraft(a, ctx);
    for (const [key, mode, value] of [['default', 'default', '保留的缓冲文字'], ['empty', 'text', ''], ['word', 'text', 'NULL'], ['null', 'null', '不作为值'], ['blob', 'binary', '']] as const) draft = editRecordInput(draft, ctx.info!.columns.find(item => item.name === key)!, { mode, text: value });
    const [next] = stageRecordDraft([a], draft, ctx);
    expect(Object.hasOwn(next.data, 'default')).toBe(false); expect(next.data).toEqual({ empty: '', word: 'NULL', null: null, blob: { type: 'binary', base64: '' } });
    expect(collectChanges([{ ...next, deleted: true }])).toEqual([]);
  });
  it('已有行不能以删除键冒充 UPDATE DEFAULT，失败不改变旧草稿', () => {
    const ctx = context(); const a = row('a', { id: '1', text: '已暂存' }); const rows = [a];
    expect(() => stageRecordDraft(rows, changed(a, ctx, 'text', '', 'default'), ctx)).toThrow('已有记录'); expect(rows[0]).toBe(a); expect(a.data.text).toBe('已暂存');
  });
  it('非空字段拒绝 NULL，但空字符串仍是明确值', () => {
    const ctx = context(); const a = row('a', { id: '1' });
    expect(() => stageRecordDraft([a], changed(a, ctx, 'id', '', 'null'), ctx)).toThrow('不允许 NULL');
    expect(stageRecordDraft([a], changed(a, ctx, 'id', ''), ctx)[0].data.id).toBe('');
  });
  it.each(['__proto__', 'constructor', 'toString', '名 字', '反`引号'])('原型或特殊名称 %s 始终是自有字段', key => {
    const ctx = context([column('id'), column(key)]); const a = row('a', Object.fromEntries([['id', '1'], [key, '原值']]));
    const [next] = stageRecordDraft([a], changed(a, ctx, key, '新值'), ctx);
    expect(Object.hasOwn(next.data, key)).toBe(true); expect(ownCell(next.data, key)).toBe('新值'); expect(Object.getPrototypeOf(next.data)).toBe(Object.prototype); expect(ownCell(a.original!, key)).toBe('原值');
  });
  it.each(['900719925474099312345', '12345678901234567890.120000', '2026-10-14 01:02:03.123456'])('文本编辑原样保留精度：%s', value => {
    const ctx = context(); const a = row('a', { id: '1', text: '旧值', hidden: 123 }); const [next] = stageRecordDraft([a], changed(a, ctx, 'text', value), ctx);
    expect(next.data.text).toBe(value); expect(next.data.hidden).toBe(123);
  });
  it('仅打开数字或布尔字段不将其转换为字符串补丁', () => {
    const ctx = context(); const a = row('a', { id: 2, text: true }); const draft = editRecordInput(beginRecordDraft(a, ctx), ctx.info!.columns[1]);
    expect(recordInputDirty(draft, ctx.info)).toBe(false); expect(stageRecordDraft([a], draft, ctx)[0]).toBe(a);
  });
  it('JSON 语法验证保留大数字、重复成员、原型成员和空白原文', () => {
    const ctx = context([column('id'), column('json', { type: 'json' })]); const a = row('a', { id: '1', json: '{}' });
    const input = ' {"n":9007199254740993,"n":1e999,"__proto__":{"x":1}}\n';
    expect(stageRecordDraft([a], changed(a, ctx, 'json', input, 'json'), ctx)[0].data.json).toBe(input);
  });
  it('两个字段任一校验失败，首个合法字段也不部分写入', () => {
    const ctx = context(); const a = row('a', { id: '1', text: '原始' }); let draft = changed(a, ctx, 'id', '2');
    draft = editRecordInput(draft, ctx.info!.columns[1], { mode: 'json', text: '{' });
    expect(recordInputDirty(draft, ctx.info)).toBe(true); expect(() => stageRecordDraft([a], draft, ctx)).toThrow('text'); expect(a.data.id).toBe('1'); expect(draft.fields.get('text')?.text).toBe('{');
  });
  it('二进制保留首尾零与高位字节，奇数 HEX 保留输入并拒绝暂存', () => {
    const ctx = context(); const a = row('a', { id: '1', text: null });
    expect(stageRecordDraft([a], changed(a, ctx, 'text', '0x00 ff 80 00', 'binary'), ctx)[0].data.text).toEqual({ type: 'binary', base64: 'AP+AAA==' });
    const draft = changed(a, ctx, 'text', '0x001', 'binary'); expect(() => stageRecordDraft([a], draft, ctx)).toThrow(); expect(draft.fields.get('text')?.text).toBe('0x001');
  });
});

describe('目标代次、本地竞争与只读边界', () => {
  it('迟到网格整页回调不能覆盖表单暂存，也不能移植刷新后的相同行号', () => {
    const a = row('a', { id: '1', text: '原值' }); const captured = [a]; const changedGrid = [{ ...a, data: { ...a.data, text: '网格' } }];
    expect(acceptGridDrafts(captured, captured, changedGrid)).toBe(changedGrid);
    expect(() => acceptGridDrafts([{ ...a, data: { ...a.data, text: '表单已暂存' } }], captured, changedGrid)).toThrow('草稿');
    expect(() => acceptGridDrafts(captured, captured, [{ ...a, id: '新 UUID' }])).toThrow('代次');
    expect(() => acceptGridDrafts(captured, captured, [{ ...a, original: { ...a.original } }])).toThrow('草稿');
  });
  it.each(['connectionId', 'database', 'table'] as const)('目标 %s 改变不能复用同一行 UUID', field => {
    const ctx = context(); const a = row('a', { id: '1' }); const draft = changed(a, ctx, 'id', '2');
    expect(() => stageRecordDraft([a], draft, { ...ctx, target: { ...ctx.target, [field]: `${ctx.target[field]}新` } })).toThrow('目标');
  });
  it.each(['generation', 'connectionVersion'] as const)('%s 变化拒绝迟到字段输入', field => {
    const ctx = context(); const a = row('a', { id: '1' }); expect(() => stageRecordDraft([a], changed(a, ctx, 'id', '2'), { ...ctx, [field]: ctx[field] + 1 })).toThrow('代次');
  });
  it('相同内容的新行对象和新的 original 也不能替代已捕获修订', () => {
    const ctx = context(); const a = row('a', { id: '1' }); const draft = changed(a, ctx, 'id', '2');
    expect(() => stageRecordDraft([{ ...a, data: { ...a.data } }], draft, ctx)).toThrow('草稿');
    expect(() => stageRecordDraft([{ ...a, original: { ...a.original } }], draft, ctx)).toThrow('草稿');
  });
  it('同一行先被粘贴修改，旧表单拒绝覆盖；无关行的新草稿仍保留', () => {
    const ctx = context(); const a = row('a', { id: '1', text: '原始' }); const b = row('b', { id: '2' }); const draft = changed(a, ctx, 'text', '表单');
    expect(() => stageRecordDraft([{ ...a, data: { ...a.data, hidden: '粘贴' } }, b], draft, ctx)).toThrow('草稿');
    const newB = { ...b, data: { ...b.data, text: '另一行草稿' } }; expect(stageRecordDraft([a, newB], draft, ctx)[1]).toBe(newB);
  });
  it('同坐标新 UUID、待删除行、可靠键/字段类型漂移都拒绝旧缓冲', () => {
    const ctx = context(); const a = row('a', { id: '1' }); const draft = changed(a, ctx, 'id', '2');
    expect(() => assertRecordDraftCurrent([{ ...a, id: 'new' }], draft, ctx)).toThrow();
    expect(() => stageRecordDraft([{ ...a, deleted: true }], draft, ctx)).toThrow();
    expect(() => stageRecordDraft([a], draft, { ...ctx, info: { ...ctx.info!, editableKey: ['text'] } })).toThrow();
    expect(() => stageRecordDraft([a], draft, { ...ctx, info: { ...ctx.info!, columns: [column('id', { type: 'binary(8)' })] } })).toThrow();
  });
  it.each([
    [{ loaded: false }, '加载'], [{ stale: true }, '变化'], [{ busy: true }, '结束'],
    [{ info: { objectKind: 'view' } }, '视图'], [{ info: { objectKind: undefined } }, '基本表'],
    [{ info: { engine: 'MyISAM' } }, 'InnoDB'], [{ info: { editableKey: [] } }, '可靠'],
  ])('统一表级只读原因 %j', (patch, expected) => {
    const ctx = context(); const next = { ...ctx, ...patch, info: 'info' in patch ? { ...ctx.info!, ...patch.info } : ctx.info } as RecordContext;
    expect(recordReadonlyReason(next)).toContain(expected);
  });
  it('生成列、待删除行和未知列各有明确原因且均不可暂存', () => {
    const ctx = context([column('id'), column('computed', { generated: true })]); const a = row('a', { id: '1', computed: '2' });
    expect(recordReadonlyReason(ctx, a, 'computed')).toContain('生成列'); expect(recordReadonlyReason(ctx, { ...a, deleted: true })).toContain('待删除'); expect(recordReadonlyReason(ctx, a, 'missing')).toContain('字段');
    expect(() => stageRecordDraft([a], changed(a, ctx, 'computed', '3'), ctx)).toThrow('生成列');
  });
  it('目标名字含分隔符不碰撞，页内导航包含待删除与新增且不跨边界', () => {
    expect(recordTargetKey({ connectionId: 'a/b', database: 'c', table: 'd' })).not.toBe(recordTargetKey({ connectionId: 'a', database: 'b/c', table: 'd' }));
    const rows = [row('a', {}), { ...row('b', {}), deleted: true }, row('c', {}, true)];
    expect(adjacentRecordId(rows, 'a', -1)).toBeUndefined(); expect(adjacentRecordId(rows, 'a', 1)).toBe('b'); expect(adjacentRecordId(rows, 'b', 1)).toBe('c'); expect(adjacentRecordId(rows, 'c', 1)).toBeUndefined(); expect(adjacentRecordId(rows, 'unknown', 1)).toBeUndefined();
  });
  it('隐藏列切换仅影响展示顺序，不修改源偏好、完整 data 或原值', () => {
    const cols = [column('id'), column('__proto__'), column('hidden')]; const visible = ['__proto__', 'id'];
    expect(recordFieldOrder(cols, visible, false)).toEqual(visible); expect(recordFieldOrder(cols, visible, true)).toEqual(['__proto__', 'id', 'hidden']); expect(visible).toEqual(['__proto__', 'id']);
  });
});

describe('输入预算与离开确认', () => {
  it('文本完整编辑预算恰好通过，超过一字符拒绝且不截断', () => {
    const ctx = context(); const a = row('a', { id: '1', text: 'x'.repeat(recordInputLimits.field) }); const draft = beginRecordDraft(a, ctx);
    expect(initialRecordInput(draft, ctx.info!.columns[1]).text).toHaveLength(recordInputLimits.field);
    expect(() => editRecordInput(draft, ctx.info!.columns[1], { mode: 'text', text: 'x'.repeat(recordInputLimits.field + 1) })).toThrow('完整编辑上限'); expect(draft.fields.size).toBe(0);
  });
  it('二进制预算在完整解码前判断，首尾 padding 字节数正确', () => {
    expect(recordBinaryBytes('')).toBe(0); expect(recordBinaryBytes('AA==')).toBe(1); expect(recordBinaryBytes('AP8=')).toBe(2); expect(recordBinaryBytes('AP+A')).toBe(3);
    const base64 = Buffer.alloc((recordInputLimits.field - 2) / 2 + 1).toString('base64'); expect(recordFieldTooLarge({ type: 'binary', base64 })).toBe(true);
  });
  it('整行多个字段累计预算按输入总量检查；替换一个字段不重复计费', () => {
    const ctx = context(Array.from({ length: 9 }, (_, i) => column(String(i)))); const a = row('a', {}, true); let draft = beginRecordDraft(a, ctx);
    for (let i = 0; i < 8; i++) draft = editRecordInput(draft, ctx.info!.columns[i], { mode: 'text', text: 'x'.repeat(recordInputLimits.field) });
    expect(() => editRecordInput(draft, ctx.info!.columns[8], { mode: 'text', text: 'x' })).toThrow('总量');
    expect(editRecordInput(draft, ctx.info!.columns[0], { mode: 'text', text: 'y'.repeat(recordInputLimits.field) }).fields.size).toBe(8);
  });
  it('首次离开目标不会被连续点击替换，留在当前编辑不暂存不放弃', () => {
    const guard = new RecordLeaveGuard(), first = vi.fn(), second = vi.fn(), stage = vi.fn(() => true), discard = vi.fn();
    expect(guard.request(true, first)).toBe(false); expect(guard.request(true, second)).toBe(false); guard.resolve('stay', stage, discard);
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled(); expect(stage).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  });
  it('非法输入暂存失败保留确认和原意图，修正后只执行首次目标一次', () => {
    const guard = new RecordLeaveGuard(), action = vi.fn(), discard = vi.fn(); guard.request(true, action);
    expect(guard.resolve('stage', () => false, discard)).toBe(false); expect(action).not.toHaveBeenCalled();
    expect(guard.resolve('stage', () => true, discard)).toBe(true); guard.resolve('stage', () => true, discard); expect(action).toHaveBeenCalledTimes(1); expect(discard).not.toHaveBeenCalled();
  });
  it('放弃只调用本地缓冲回调，明确清页后旧待处理意图不会复活', () => {
    const guard = new RecordLeaveGuard(), action = vi.fn(), stage = vi.fn(() => true), discard = vi.fn(); guard.request(true, action); guard.resolve('discard', stage, discard);
    expect(discard).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1); expect(stage).not.toHaveBeenCalled();
    guard.request(true, action); guard.reset(); guard.resolve('discard', stage, discard); expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('整页提交快照同步防重放', () => {
  it('预览固定实际 changes，消费后第二次调用拒绝，异常也不恢复机会', () => {
    const ctx = context(); const rows = [row('new', { id: '1' }, true)]; const preview = captureRecordPagePreview(rows, ctx);
    const changes = consumeRecordPagePreview(preview, rows, ctx); expect(changes).toBe(preview.changes); expect(changes[0]).toEqual({ kind: 'insert', values: rows[0].data });
    expect(() => consumeRecordPagePreview(preview, rows, ctx)).toThrow('已经投递');
  });
  it.each(['rows', 'generation', 'connectionVersion', 'target', 'stale', 'loaded'] as const)('确认时 %s 已变化不能提交预览外的内容', change => {
    const ctx = context(); const rows = [row('new', { id: '1' }, true)]; const preview = captureRecordPagePreview(rows, ctx); const next = { ...ctx };
    if (change === 'generation' || change === 'connectionVersion') next[change]++;
    if (change === 'target') next.target = { ...ctx.target, table: '另一表' }; if (change === 'stale') next.stale = true; if (change === 'loaded') next.loaded = false;
    expect(() => consumeRecordPagePreview(preview, change === 'rows' ? [...rows] : rows, next)).toThrow('预览'); expect(preview.attempted).toBe(false);
  });
});
