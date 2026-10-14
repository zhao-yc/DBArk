import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ColumnInfo, DataRow, TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { RecordReadonlyProjection } from '../../src/renderer/components/RecordReadonlyProjection';
import { lexicalNodeAtPath, lexicalToken, parseJsonLexicalTree, type ReadyLexicalDocument } from '../../src/renderer/jsonLexicalTree';
import { lexicalViewWindow, projectionPreview, projectionViewLimits } from '../../src/renderer/recordProjectionView';
import { beginRecordDraft, editRecordInput, RecordLeaveGuard, stageRecordDraft, type RecordContext } from '../../src/renderer/recordViews';

/** 测试只接受词法模型完整通过的文档，不构造绕过预算的伪树。 */
function ready(text: string): ReadyLexicalDocument { const result = parseJsonLexicalTree(text); if (result.status !== 'ready') throw new Error(result.reason); return result; }
/** 元数据与数据均遵守真实单元格契约，原型同名字段由自有属性持有。 */
function sample(names = ['id', 'payload'], data: DataRow = { id: '1', payload: '{}' }) {
  const columns: ColumnInfo[] = names.map(name => ({ name, type: name === 'payload' ? 'json' : 'longtext', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }));
  const info: TableInfo = { database: '库', name: '表', columns, objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '' };
  const context: RecordContext = { target: { connectionId: '连接', database: '库', table: '表' }, generation: 1, connectionVersion: 1, info, loaded: true, stale: false, busy: false };
  const row: DraftRow = { id: '本地行', data, original: { ...data }, inserted: false, deleted: false };
  return { context, row, draft: beginRecordDraft(row, context), visibleKeys: names, showHidden: false, onEdit: vi.fn() };
}

describe('只读树显示窗口', () => {
  it('折叠节点不在可见窗口，展开仍按原文成员顺序而非数字键枚举顺序', () => {
    const document = ready('{"20":[],"2":{"x":1},"1":3}');
    expect(lexicalViewWindow(document, new Set()).rows).toHaveLength(1);
    const window = lexicalViewWindow(document, new Set([document.root]));
    expect(window.rows.map(row => row.segment?.kind === 'member' ? row.segment.key : null)).toEqual([null, '20', '2', '1']);
  });
  it('重复键、转义同名键及原型键的路径分别定位精确数字 token', () => {
    const document = ready('{"a.b":9007199254740993,"a\\u002eb":1.2300,"__proto__":-0,"constructor":1e+09}');
    const window = lexicalViewWindow(document, new Set([document.root]));
    expect(window.rows.slice(1).map(row => lexicalToken(document, lexicalNodeAtPath(document, { document, segments: row.path })!))).toEqual(['9007199254740993', '1.2300', '-0', '1e+09']);
    expect(window.rows[1].path).toEqual([{ kind: 'member', memberIndex: 0, key: 'a.b' }]); expect(window.rows[2].path).toEqual([{ kind: 'member', memberIndex: 1, key: 'a.b' }]);
  });
  it('数组与对象混合深度保留完整结构路径，不把点号斜线解释为层级', () => {
    const document = ready('{"a/b~":[{"x.y":1}]}');
    const window = lexicalViewWindow(document, new Set(document.nodes.map((_, id) => id)));
    expect(window.rows.at(-1)?.path).toEqual([{ kind: 'member', memberIndex: 0, key: 'a/b~' }, { kind: 'element', index: 0 }, { kind: 'member', memberIndex: 0, key: 'x.y' }]);
    expect(window.rows.at(-1)?.depth).toBe(3);
  });
  it('2048 元素容器逐段浏览不越过 480 节点，完整遍历没有遗漏或重复', () => {
    const document = ready(JSON.stringify(Array.from({ length: 2048 }, (_, i) => i))), expanded = new Set([document.root]);
    const ids: number[] = [];
    for (let offset = 0; offset < 2049; offset += projectionViewLimits.nodes) {
      const window = lexicalViewWindow(document, expanded, offset); expect(window.rows.length).toBeLessThanOrEqual(480); expect(window.total).toBe(2049); ids.push(...window.rows.map(row => row.id));
    }
    expect(ids).toHaveLength(2049); expect(new Set(ids).size).toBe(2049); expect(ids.at(-1)).toBe(2048);
    expect(projectionViewLimits.nodes + projectionViewLimits.fields).toBe(512);
  });
  it('后续页收起根后夹回唯一有效窗口，不空白也不遗留旧页节点', () => {
    const document = ready(JSON.stringify(Array.from({ length: 600 }, (_, i) => i)));
    const before = lexicalViewWindow(document, new Set([document.root]), 480); expect(before.rows).toHaveLength(121);
    expect(lexicalViewWindow(document, new Set(), 480)).toMatchObject({ offset: 0, total: 1, previous: false, next: false, rows: [{ id: document.root }] });
  });
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('非法窗口偏移 %s 明确拒绝', offset => { expect(() => lexicalViewWindow(ready('null'), new Set(), offset)).toThrow('窗口'); });
  it.each([0, 481, -1])('调用方不能放宽或清空节点预算 %s', limit => { expect(() => lexicalViewWindow(ready('0'), new Set(), 0, limit)).toThrow('窗口'); });
  it('有界摘要明确标记截断且不改变原文，也不对数字做 Number 转换', () => {
    const source = '9'.repeat(241); expect(projectionPreview(source)).toEqual({ text: '9'.repeat(240), truncated: true }); expect(source).toHaveLength(241);
    expect(projectionPreview('1.2300e+09')).toEqual({ text: '1.2300e+09', truncated: false });
  });
});

describe('只读组件的静态输出边界', () => {
  it('树初始静态输出只有32个字段摘要且不提前显示JSON解析结果', () => {
    const names = Array.from({ length: 100 }, (_, i) => `字段${i}`), props = sample(names, Object.fromEntries(names.map(name => [name, '{invalid}'])));
    const output = renderToStaticMarkup(<RecordReadonlyProjection {...props} mode="tree"/>);
    expect((output.match(/class="record-projection-entry"/g) ?? []).length).toBe(32); expect(output).toContain('下一组字段'); expect(output).not.toContain('字段99'); expect(output).not.toContain('原文不是有效 JSON');
  });
  it('BLOB默认只有Base64前缀与字节说明，不构建全量HEX或二进制输入控件', () => {
    const base64 = Buffer.alloc(512, 255).toString('base64'); const props = sample(['id', 'blob'], { id: '1', blob: { type: 'binary', base64 } });
    const output = renderToStaticMarkup(<RecordReadonlyProjection {...props} mode="tree"/>);
    expect(output).toContain('512 字节'); expect(output).not.toContain(base64); expect(output).not.toContain('textarea'); expect(output).toContain('仅显示摘要');
  });
  it('完整JSON包括隐藏原型字段，当前值而非original或未暂存缓冲进入输出', () => {
    const props = sample(['id', '__proto__', 'payload'], Object.fromEntries([['id', '1'], ['__proto__', '隐藏新草稿'], ['payload', ' {"n":9007199254740993,"n":1.2300} ']]));
    props.visibleKeys = ['id']; props.row.original = { ...props.row.data, id: '不应显示的原值' }; props.draft = beginRecordDraft(props.row, props.context);
    props.draft = editRecordInput(props.draft, props.context.info!.columns[0], { mode: 'text', text: '不应显示的未暂存输入' });
    const output = renderToStaticMarkup(<RecordReadonlyProjection {...props} mode="json"/>);
    expect(output).toContain('__proto__'); expect(output).toContain('隐藏新草稿'); expect(output).toContain('&quot;hidden&quot;:true'); expect(output).toMatch(/<textarea\b[^>]*\breadonly=""/i); expect(output).toContain('不是可导入或可恢复格式');
    expect(output).not.toContain('不应显示的原值'); expect(output).not.toContain('不应显示的未暂存输入'); expect(output).not.toContain('暂存本行');
  });
  it.each(['generation', 'connectionVersion'] as const)('旧%s的面板不发布上一快照JSON', key => {
    const props = sample(); props.context[key]++; const output = renderToStaticMarkup(<RecordReadonlyProjection {...props} mode="json"/>);
    expect(output).toContain('已失效'); expect(output).not.toContain('textarea');
  });
  it('完整投影超过输出预算时没有可复制的部分全文控件', () => {
    const props = sample(['id', 'payload'], { id: '1', payload: '\u0001'.repeat(400000) });
    const output = renderToStaticMarkup(<RecordReadonlyProjection {...props} mode="json"/>);
    expect(output).toContain('已超过显示预算'); expect(output).not.toContain('textarea');
  });
});

describe('模式离开与原草稿守卫协作', () => {
  it('非法输入切只读树暂存失败保留首次目标、稀疏输入、旧值，后续切行不覆盖', () => {
    const props = sample(), guard = new RecordLeaveGuard(); let draft = editRecordInput(props.draft, props.context.info!.columns[1], { mode: 'json', text: '{' });
    const tree = vi.fn(), nextRow = vi.fn(); guard.request(true, tree); guard.request(true, nextRow);
    const stage = () => { try { stageRecordDraft([props.row], draft, props.context); return true; } catch { return false; } };
    expect(guard.resolve('stage', stage, () => {})).toBe(false); expect(tree).not.toHaveBeenCalled(); expect(nextRow).not.toHaveBeenCalled(); expect(draft.fields.get('payload')?.text).toBe('{'); expect(props.row.original?.payload).toBe('{}');
    expect(guard.resolve('stay', stage, () => {})).toBe(true); expect(tree).not.toHaveBeenCalled(); expect(draft.fields.get('payload')?.text).toBe('{');
  });
  it('显式暂存后继续仍写同一页草稿，投影读到新data但original不被改写', () => {
    const props = sample(), guard = new RecordLeaveGuard(); const draft = editRecordInput(props.draft, props.context.info!.columns[1], { mode: 'json', text: '{"n":9007199254740993}' });
    let rows = [props.row]; const display = vi.fn(() => rows[0].data.payload);
    guard.request(true, display); expect(guard.resolve('stage', () => { rows = stageRecordDraft(rows, draft, props.context); return true; }, () => {})).toBe(true);
    expect(display).toHaveReturnedWith('{"n":9007199254740993}'); expect(rows[0].original).toBe(props.row.original); expect(rows[0].original?.payload).toBe('{}');
  });
});
