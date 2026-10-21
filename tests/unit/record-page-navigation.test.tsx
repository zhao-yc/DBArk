import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecordPageNavigation, recordPageHasDrafts, recordPageScope, type RecordPageContext } from '../../src/renderer/recordPageNavigation';
import { beginRecordDraft, editRecordInput, recordInputDirty, stageRecordDraft, type RecordContext } from '../../src/renderer/recordViews';
import { beginRecordDocument, changeRecordDocument, recordDocumentDirty } from '../../src/renderer/recordInputDocument';
import { parseJsonLexicalTree } from '../../src/renderer/jsonLexicalTree';
import { beginRecordJsonNodeInput, changeRecordJsonNodeInput, recordJsonNodeDirty } from '../../src/renderer/recordJsonNodeInput';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';
import { RecordFormPanel } from '../../src/renderer/components/RecordFormPanel';
import type { RecordViewController } from '../../src/renderer/hooks/useRecordViews';
import { recordViewZh as text } from '../../src/renderer/locales/recordViews.zh-CN';

const scopeValue = { target: { connectionId: '连接', database: '库', table: '记录' }, connectionVersion: 2, refreshVersion: 0, pageSize: 50, filters: [], filterMode: 'all', sort: [{ column: 'id', direction: 'ASC' as const }] };
const scope = recordPageScope(scopeValue);
const context: RecordPageContext = { scope, page: 1, generation: 10, active: true, formOpen: true, stale: false };
/** 使用独立本地 UUID 与完整旧值，不用数据库键替代页内选择身份。 */
function rows(start = 1, count = 50): DraftRow[] { return Array.from({ length: count }, (_, index) => ({ id: `页内-${start + index}`, data: { id: String(start + index), payload: '{"n":9007199254740993}' }, original: { id: String(start + index), payload: '{"n":9007199254740993}' }, inserted: false, deleted: false })); }
function begin(gate: RecordPageNavigation, state = context, source = rows(), direction: -1 | 1 = 1, inputDirty = false) {
  return gate.begin(state, { rows: source, rowId: (direction === 1 ? source.at(-1) : source[0])?.id, key: 'payload', direction, hasMore: true, busy: false, inputDirty });
}
/** 只模拟异步返回时机；分页与选择判断全部调用生产 helper。 */
function loading() {
  const gate = new RecordPageNavigation(); const result = begin(gate); if (result.kind !== 'ready') throw Error('未获得跨页意图');
  const loaded = { ...context, page: 2, generation: 12 }; expect(gate.claim(loaded)).toBe(result.ticket);
  return { gate, ticket: result.ticket, loaded };
}
const info: TableInfo = { database: '库', name: '记录', objectKind: 'table', engine: 'InnoDB', columns: ['id', 'payload'].map(name => ({ name, type: name === 'id' ? 'bigint' : 'json', nullable: false, defaultValue: null, generated: false, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: '' };
const recordContext: RecordContext = { target: scopeValue.target, generation: 10, connectionVersion: 2, info, loaded: true, busy: false, stale: false };

describe('记录表单跨页意图', () => {
  it('同叶、同根模式但不同括号仍是新范围，不能兑换原页自动选行；旧缺省范围保持原序列化', () => {
    const filters = [{ column: 'id', operator: '=' as const, value: '1' }, { column: 'id', operator: '=' as const, value: '2' }, { column: 'payload', operator: 'IS NOT NULL' as const }];
    const first = recordPageScope({ ...scopeValue, filters, filterGroup: { mode: 'all', children: [2, { mode: 'any', children: [0, 1] }] } });
    const changed = recordPageScope({ ...scopeValue, filters, filterGroup: { mode: 'all', children: [0, { mode: 'any', children: [1, 2] }] } });
    expect(first).not.toBe(changed); expect(recordPageScope({ ...scopeValue, filterGroup: undefined })).toBe(scope);
    const gate = new RecordPageNavigation(); expect(begin(gate, { ...context, scope: first }).kind).toBe('ready');
    expect(gate.claim({ ...context, scope: changed, page: 2, generation: 12 })).toBeUndefined(); expect(gate.pending).toBe(false);
  });
  it('51条/50分页正向选新页首条，反向选前页末条；一次加载只兑换一次', () => {
    const { gate, ticket, loaded } = loading(), next = rows(51, 1);
    expect(gate.complete(ticket, loaded, next)).toBe(true);
    expect(gate.consume(loaded, next, false, true)).toBeUndefined();
    expect(gate.consume(loaded, next, false, false)).toEqual({ rowId: '页内-51', key: 'payload' });
    expect(gate.consume(loaded, next, false, false)).toBeUndefined();
    const back = begin(gate, loaded, next, -1); if (back.kind !== 'ready') throw Error('未获得反向意图');
    const previous = { ...loaded, page: 1, generation: 14 }, first = rows();
    expect(gate.claim(previous)).toBe(back.ticket); gate.complete(back.ticket, previous, first);
    expect(gate.consume(previous, first, false, false)).toEqual({ rowId: '页内-50', key: 'payload' });
  });
  it('第一页、最后一页和接口最大页码均不产生额外读取', () => {
    const gate = new RecordPageNavigation(), source = rows();
    expect(begin(gate, context, source, -1)).toEqual({ kind: 'boundary' });
    expect(gate.begin(context, { rows: source, rowId: source.at(-1)!.id, key: 'id', direction: 1, hasMore: false, busy: false, inputDirty: false })).toEqual({ kind: 'boundary' });
    expect(begin(gate, { ...context, page: 10_000_000 })).toEqual({ kind: 'boundary' });
  });
  it('空页结束意图，可明确返回前页，不自动循环向后找记录', () => {
    const { gate, ticket, loaded } = loading(); expect(gate.complete(ticket, loaded, [])).toBe(true); expect(gate.pending).toBe(false);
    expect(gate.consume(loaded, [], false, false)).toBeUndefined();
    expect(begin(gate, loaded, [], 1)).toEqual({ kind: 'boundary' }); expect(begin(gate, loaded, [], -1).kind).toBe('ready');
  });
  it('读取失败结束原意图，可明确重试；旧成功回包不能随后选行', () => {
    const { gate, ticket, loaded } = loading(); expect(gate.fail(ticket, loaded)).toBe(true);
    expect(gate.complete(ticket, loaded, rows(51, 1))).toBe(false); expect(gate.pending).toBe(false);
    expect(begin(gate, loaded, [], -1).kind).toBe('ready');
  });
  it('忙态或重复点击不重发、不替换首个目标', () => {
    const gate = new RecordPageNavigation(), source = rows();
    expect(gate.begin(context, { rows: source, rowId: source.at(-1)!.id, key: 'id', direction: 1, hasMore: true, busy: true, inputDirty: false }).kind).toBe('busy');
    const first = begin(gate); expect(begin(gate).kind).toBe('busy'); expect(gate.claim({ ...context, page: 2, generation: 11 })).toBe(first.kind === 'ready' ? first.ticket : null);
  });
  it.each([
    ['连接版本', recordPageScope({ ...scopeValue, connectionVersion: 3 })], ['结构刷新', recordPageScope({ ...scopeValue, refreshVersion: 1 })], ['对象', recordPageScope({ ...scopeValue, target: { ...scopeValue.target, table: '另一表' } })], ['筛选', recordPageScope({ ...scopeValue, filters: [{ column: 'id', operator: '=', value: '2' }] })], ['排序', recordPageScope({ ...scopeValue, sort: [{ column: 'id', direction: 'DESC' }] })], ['页大小', recordPageScope({ ...scopeValue, pageSize: 100 })], ['组合条件', recordPageScope({ ...scopeValue, filterMode: 'any' })]
  ])('%s变化后即使恢复原条件，旧意图也不能复活', (_, scope) => {
    const { gate, ticket, loaded } = loading(); gate.observe({ ...loaded, scope }); gate.observe(loaded);
    expect(gate.complete(ticket, loaded, rows(51, 1))).toBe(false); expect(gate.pending).toBe(false);
  });
  it.each([{ active: false }, { formOpen: false }, { stale: true }, { generation: 13 }, { page: 3 }])('切换/失效%j撤销旧意图', patch => {
    const { gate, ticket, loaded } = loading(); gate.observe({ ...loaded, ...patch }); gate.observe(loaded);
    expect(gate.complete(ticket, loaded, rows(51, 1))).toBe(false);
  });
  it('普通翻页/新用户选择显式取消，迟到请求不能覆盖新行或领取新意图', () => {
    const { gate, ticket, loaded } = loading(); gate.cancel(); const fresh = begin(gate, loaded, rows(51, 1), -1); expect(fresh.kind).toBe('ready');
    expect(gate.complete(ticket, loaded, rows(51, 1))).toBe(false);
    expect(gate.claim({ ...loaded, page: 1, generation: 14 })).toBe(fresh.kind === 'ready' ? fresh.ticket : null);
  });
  it('完成回调先看到连接变化，即使React尚未观察，恢复原版本也不能再兑换', () => {
    const { gate, ticket, loaded } = loading(), source = rows(51, 1);
    expect(gate.complete(ticket, { ...loaded, scope: recordPageScope({ ...scopeValue, connectionVersion: 3 }) }, source)).toBe(false);
    expect(gate.complete(ticket, loaded, source)).toBe(false); expect(gate.consume(loaded, source, false, false)).toBeUndefined();
  });
  it('重复 load、错误页码和旧加载代次均不能领取意图', () => {
    const gate = new RecordPageNavigation(); begin(gate); expect(gate.claim(context)).toBeUndefined();
    begin(gate); expect(gate.claim({ ...context, page: 2 })).toBeUndefined();
    const { gate: second, loaded } = loading(); expect(second.claim({ ...loaded, generation: 13 })).toBeUndefined(); expect(second.pending).toBe(false);
  });
  it('已读快照被替换或读取后新添草稿时，不重用 UUID，原值保持', () => {
    const { gate, ticket, loaded } = loading(), source = rows(51, 1); gate.complete(ticket, loaded, source);
    expect(gate.consume(loaded, source.slice(), false, false)).toBeUndefined();
    const again = loading(); again.gate.complete(again.ticket, again.loaded, source); source[0].data.payload = '新的草稿';
    expect(again.gate.consume(again.loaded, source, false, false)).toBeUndefined(); expect(source[0].original!.payload).toBe('{"n":9007199254740993}');
  });
  it('跨页后普通字段仍按新页本地UUID捕获完整旧值，不能借上一页主键形成草稿', () => {
    const { gate, ticket, loaded } = loading(), source = rows(51, 1); gate.complete(ticket, loaded, source);
    const selected = gate.consume(loaded, source, false, false)!;
    const current = { ...recordContext, generation: loaded.generation }, draft = beginRecordDraft(source.find(row => row.id === selected.rowId)!, current);
    const edited = stageRecordDraft(source, editRecordInput(draft, info.columns[1], { mode: 'json', text: '{"changed":1}' }), current);
    expect(edited[0].original).toBe(source[0].original); expect(edited[0].original!.id).toBe('51'); expect(edited[0].data.id).toBe('51');
    expect(() => stageRecordDraft(rows(), draft, current)).toThrow();
  });
});

describe('全部草稿与真实输入缓冲保护', () => {
  it.each(['修改非当前行', '新增', '删除', '新增后删除'])('%s也阻止跨页且保留同一数组和旧值', kind => {
    const source = rows(); if (kind === '修改非当前行') source[0].data.payload = '待提交';
    else { source[0].inserted = kind.includes('新增'); source[0].deleted = kind.includes('删除'); }
    const original = source[0].original, data = source[0].data, before = JSON.stringify(source);
    expect(begin(new RecordPageNavigation(), context, source).kind).toBe('dirty'); expect(JSON.stringify(source)).toBe(before); expect(source[0].original).toBe(original); expect(source[0].data).toBe(data);
  });
  it('合法及非法JSON字段缓冲均按真实dirty结果阻止，不解析或暂存到页面', () => {
    const source = rows(), initial = beginRecordDraft(source.at(-1)!, recordContext);
    for (const value of ['{"changed":1}', '{']) {
      const draft = editRecordInput(initial, info.columns[1], { mode: 'json', text: value });
      expect(begin(new RecordPageNavigation(), context, source, 1, recordInputDirty(draft, info)).kind).toBe('dirty');
      expect(draft.fields.get('payload')?.text).toBe(value); expect(source.at(-1)!.data.payload).toBe('{"n":9007199254740993}');
      if (value === '{') expect(() => stageRecordDraft(source, draft, recordContext)).toThrow();
    }
  });
  it('非法整行JSON原文不会因无法解析而漏掉保护，输入文本原样保留', () => {
    const source = rows(), draft = beginRecordDraft(source.at(-1)!, recordContext), input = changeRecordDocument(beginRecordDocument(source, draft, recordContext), '{');
    expect(begin(new RecordPageNavigation(), context, source, 1, recordDocumentDirty(input)).kind).toBe('dirty'); expect(input.text).toBe('{'); expect(recordPageHasDrafts(source, false)).toBe(false);
  });
  it('非法树节点输入使用真实dirty状态阻止跨页，节点原文和页面仍保留', () => {
    const source = rows(), row = source.at(-1)!, draft = beginRecordDraft(row, recordContext), document = parseJsonLexicalTree(row.data.payload as string);
    if (document.status !== 'ready') throw Error('夹具JSON应有效');
    const identity = { target: draft.target, metadata: draft.metadata, connectionVersion: draft.connectionVersion, generation: draft.generation, rowId: row.id, data: row.data, original: row.original, inserted: false, deleted: false };
    const input = changeRecordJsonNodeInput(beginRecordJsonNodeInput({ rows: source, draft, context: recordContext, columnName: 'payload', document, selection: { row, identity, columnName: 'payload', document, segments: [{ kind: 'member', memberIndex: 0, key: 'n' }] } }), '{');
    expect(begin(new RecordPageNavigation(), context, source, 1, recordJsonNodeDirty(input)).kind).toBe('dirty'); expect(input.value.text).toBe('{'); expect(row.data.payload).toBe('{"n":9007199254740993}');
  });
});

/** SSR 使用真实 React 与真实面板，控制器仅提供该次静态展示所需的现有接口。 */
function renderPanel(source: DraftRow[], index: number, previous: boolean, next: boolean, message = '', busy = false) {
  const editor = { draft: source[index] ? beginRecordDraft(source[index], recordContext) : null, formOpen: true, displayMode: 'form', dirty: false, pending: false, error: '', notice: '', focusKey: null, nodeInput: null, structureInput: null, closeForm: vi.fn(), stage: vi.fn(), discard: vi.fn(), changeDisplayMode: vi.fn() } as unknown as RecordViewController;
  return renderToStaticMarkup(<RecordFormPanel editor={editor} context={{ ...recordContext, busy }} rows={source} visibleKeys={['id', 'payload']} onSelect={vi.fn()} pageNavigation={{ previous, next, message, onNavigate: vi.fn() }}/>);
}
describe('真实记录面板静态输出', () => {
  it('页末下一条与页首上一条有跨页目标时可用，页内导航保留原位置', () => {
    const source = rows(); expect(renderPanel(source, 49, false, true)).toContain('<button>下一条</button>');
    expect(renderPanel(rows(51, 1), 0, true, false)).toContain('<button>上一条</button>');
    expect(renderPanel(source, 20, false, false)).toContain('本页第 21 / 50 条'); expect(renderPanel(source, 20, false, false)).toContain('<button>下一条</button>');
  });
  it('真实首尾及忙态按钮禁用，空页与失败状态仍可明确返回', () => {
    expect(renderPanel(rows(), 0, false, true)).toContain('<button disabled="">上一条</button>');
    expect(renderPanel(rows(51, 1), 0, true, false)).toContain('<button disabled="">下一条</button>');
    expect(renderPanel(rows(51, 1), 0, true, true, '', true)).toContain('<button disabled="">上一条</button>');
    const empty = renderPanel([], -1, true, false, text.pageEmpty.replace('{0}', '2'));
    expect(empty).toContain('<button>上一条</button>'); expect(empty).toContain('第 2 页没有记录'); expect(empty).not.toContain('9007199254740993');
  });
  it('新增只读状态提示不复用原暂存status角色，不产生编辑或数据库提交入口', () => {
    const html = renderPanel([], -1, true, false, text.pageFailed.replace('{0}', '2'));
    expect(html).toContain('role="note" aria-label="记录跨页状态" aria-live="polite"'); expect(html).toContain('旧页未保留为新页');
    expect((html.match(/role="status"/g) ?? []).length).toBe(1); expect(html).not.toContain('确认应用');
  });
});
