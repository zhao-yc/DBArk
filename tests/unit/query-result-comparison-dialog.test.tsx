import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRow, QueryResult, ResultColumn } from '../../src/shared/contracts';
import { QueryResultComparisonDialog } from '../../src/renderer/components/QueryResultComparisonDialog';
import { QueryResultComparisonScan } from '../../src/renderer/queryResultComparison';
import { snapshotQueryResult, type PinnedQueryResult } from '../../src/renderer/queryPins';
import { queryResultComparisonZh as text } from '../../src/renderer/locales/queryResultComparison.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); }
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', String(value)) });
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => {
        selected = !!value;
        if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false;
      } });
    }
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined;
  document.body.textContent = ''; delete (window as any).dbark; vi.restoreAllMocks(); vi.useRealTimers();
});
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 固定源走已有真实snapshot入口，完整精度、NULL和字节包装都来自独立只读快照。 */
function fixture() {
  const columns: ResultColumn[] = [
    { key: 'id', name: '编号', type: 'CHAR' }, { key: 'huge', name: '重复名称', type: 'BIGINT' },
    { key: 'amount', name: '重复名称', type: 'DECIMAL(30,20)' }, { key: 'nullable', name: '可空', type: 'VARCHAR' },
    { key: 'bytes', name: '字节', type: 'BLOB' }, { key: 'f', name: '浮点', type: 'DOUBLE' },
  ];
  const leftRows: DataRow[] = [
    { id: '1', huge: '9007199254740993', amount: '0.12345678901234567890', nullable: null, bytes: { type: 'binary', base64: 'AP8=' }, f: 0.1 },
    { id: '2', huge: '18446744073709551615', amount: '1.00000000000000000001', nullable: null, bytes: { type: 'binary', base64: 'AA==' }, f: 0.2 },
    { id: '3', huge: '7', amount: '2.00000000000000000000', nullable: '删除原值', bytes: { type: 'binary', base64: '' }, f: 0.3 },
  ];
  const rightRows: DataRow[] = [
    { ...leftRows[1], huge: '18446744073709551614', amount: '1.00000000000000000002', nullable: '', bytes: { type: 'binary', base64: 'AQ==' } },
    { ...leftRows[0] }, { ...leftRows[2], id: '4', nullable: null },
  ];
  const left: QueryResult = { columns, rows: leftRows, truncated: false, elapsedMs: 1, statement: 'SELECT 不应出现在界面或重发的原SQL' };
  const right: QueryResult = { ...left, columns: columns.map(column => ({ ...column })), rows: rightRows };
  const pins: PinnedQueryResult[] = [];
  pins.push(snapshotQueryResult(pins, left, 'left', '左源'));
  pins.push(snapshotQueryResult(pins, left, 'middle', '中间源'));
  pins.push(snapshotQueryResult(pins, right, 'right', '右源'));
  return pins;
}
/** 真组件、真扫描器和真固定快照；仅时间与父层身份端口可控，外界IPC一律失败。 */
async function mount(pins = fixture(), patch: Partial<ComponentProps<typeof QueryResultComparisonDialog>> = {}) {
  let live = true; const invoke = vi.fn(() => { throw Error('对比不得调用外界命令'); }); (window as any).dbark = { invoke };
  let props: ComponentProps<typeof QueryResultComparisonDialog> = { pins, owner: 'ram-comparison-owner', isCurrent: () => live, onClose: vi.fn(), ...patch };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<QueryResultComparisonDialog {...props}/>));
  return { pins, props, invoke, invalidate: () => { live = false; }, restore: () => { live = true; },
    async update(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; await act(async () => root!.render(<QueryResultComparisonDialog {...props}/>)); } };
}
function node(label: string) { const value = document.querySelector(`[aria-label="${label}"]`); expect(value, label).not.toBeNull(); return value!; }
function button(label: string) { const value = document.querySelectorAll('button').find(item => item.textContent === label || item.getAttribute('aria-label') === label); expect(value, label).toBeDefined(); return value!; }
function counts() { return (['added', 'removed', 'changed', 'equal'] as const).map(kind => document.querySelectorAll('output').find(item => item.getAttribute('aria-label') === text[kind])?.textContent); }
function hasCounts() { return document.querySelectorAll('output').length > 0; }
/** 旧事件用真实React闭包重放，不伪造组件内部状态或统计结果。 */
function reactProps(value: ReturnType<typeof node>) { const key = Object.keys(value).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (value as any)[key]; }
async function click(label: string) { const value = button(label); expect(value.disabled, label).toBe(false); await act(async () => value.dispatchEvent(new MemoryEvent('click'))); }
async function choose(label: string, value: string) { const select = node(label); expect(select.disabled, label).toBe(false); await act(async () => { select.value = value; select.dispatchEvent(new MemoryEvent('change')); }); }
async function key(column = 'id', checked = true) { const input = node(text.key(column)); expect(input.disabled, column).toBe(false); await act(async () => reactProps(input).onChange({ target: { checked } })); }
async function finish() { await act(async () => { vi.runAllTimers(); }); }
async function batch() { await act(async () => { vi.advanceTimersToNextTimer(); }); }
async function compare() { await key(); await click(text.start); expect(hasCounts()).toBe(false); await finish(); }
function detail(side: 'left' | 'right', column: string) { return node(`${side === 'left' ? text.leftValue : text.rightValue} ${column}`).textContent; }
/** 构造仅发生预期行变化的大快照，用于真实分批和50行分页，不虚拟化对比算法。 */
function many(count: number) {
  const pins = fixture();
  pins[0].result.rows = Array.from({ length: count }, (_, index) => ({ ...pins[0].result.rows[0], id: String(index), nullable: '旧' }));
  pins[2].result.rows = pins[0].result.rows.map(row => ({ ...row, nullable: '新' }));
  return pins;
}

describe('两份固定查询结果的真实只读对话框', () => {
  it('默认首末两源，必须显式选键后开始，不自动扫描或投递SQL', async () => {
    const step = vi.spyOn(QueryResultComparisonScan.prototype, 'step'), f = await mount();
    expect(node(text.title).getAttribute('role')).toBe('dialog'); expect(document.querySelector('[data-query-result-comparison-owner="ram-comparison-owner"]')).not.toBeNull();
    expect(node(text.left).value).toBe('left'); expect(node(text.right).value).toBe('right'); expect(button(text.start).disabled).toBe(true);
    expect(document.body.textContent).toContain(text.notice); expect(document.body.textContent).toContain(text.keysHint); expect(document.body.textContent).not.toContain('不应出现在界面');
    await finish(); expect(step).not.toHaveBeenCalled(); expect(hasCounts()).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('显式对比真实发布新增删除变化相同四计数，默认只列差异且按匹配键对应原行号', async () => {
    const f = await mount(); await compare(); expect(counts()).toEqual(['1', '1', '1', '1']); expect(node(text.filter).value).toBe('differences');
    const rows = document.querySelectorAll('tbody')[0].querySelectorAll('tr'); expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('重复名称'); expect(rows[0].querySelectorAll('td').slice(1, 3).map(cell => cell.textContent)).toEqual(['2', '1']);
    expect(document.querySelectorAll('button').some(item => item.getAttribute('aria-label') === text.details(0))).toBe(false); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('变化行详情保留大整数20位小数、NULL空串及原字节base64，不做数值或空值猜测', async () => {
    await mount(); await compare(); await click(text.details(1));
    expect(detail('left', 'huge')).toContain('18446744073709551615'); expect(detail('right', 'huge')).toContain('18446744073709551614');
    expect(detail('left', 'amount')).toContain('1.00000000000000000001'); expect(detail('right', 'amount')).toContain('1.00000000000000000002');
    expect(detail('left', 'nullable')).toContain(text.nullValue); expect(detail('right', 'nullable')).toContain('""'); expect(detail('right', 'nullable')).toContain(text.emptyString);
    expect(detail('left', 'bytes')).toContain(text.binary); expect(detail('left', 'bytes')).toContain('AA=='); expect(detail('right', 'bytes')).toContain('AQ==');
  });

  it('新增与删除详情分别区分缺少整行和源NULL，不能用NULL占位缺失的一侧', async () => {
    await mount(); await compare(); await click(text.details(2)); expect(detail('right', 'id')).toContain(text.missing); expect(detail('left', 'id')).toContain('"3"');
    await click(text.details(3)); expect(detail('left', 'nullable')).toContain(text.missing); expect(detail('right', 'nullable')).toContain(text.nullValue); expect(detail('right', 'nullable')).not.toContain(text.missing);
  });

  it('相同记录可显式浏览，切筛选清详情并保留全结果序号用于查看', async () => {
    await mount(); await compare(); await choose(text.filter, 'equal'); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(1);
    await click(text.details(0)); expect(detail('left', 'bytes')).toContain('AP8='); expect(detail('right', 'amount')).toContain('0.12345678901234567890');
    await choose(text.filter, 'all'); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(4); expect(document.querySelectorAll('dd')).toHaveLength(0);
  });

  it('文本详情显式字符串引号、空格和换行，不把文字NULL当成NULL', async () => {
    const pins = fixture(); pins[0].result.rows[1].nullable = 'NULL'; pins[2].result.rows[0].nullable = ' 甲,乙\n"引号" ';
    await mount(pins); await compare(); await click(text.details(1)); expect(detail('left', 'nullable')).toContain('"NULL"'); expect(detail('right', 'nullable')).toContain(JSON.stringify(' 甲,乙\n"引号" '));
  });

  it('两侧空结果也需明确键并给真实四零，不伪造差异行', async () => {
    const pins = fixture(); pins[0].result.rows = []; pins[2].result.rows = []; await mount(pins); await compare();
    expect(counts()).toEqual(['0', '0', '0', '0']); expect(document.body.textContent).toContain(text.noRows); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(0);
  });

  it('任一侧截断明确提示仅返回部分，切换源后键需重新明确选择', async () => {
    const pins = fixture(); pins[2].result.truncated = true; await mount(pins); expect(document.body.textContent).toContain(text.truncated); await key();
    await choose(text.right, 'middle'); expect(node(text.key('id')).checked).toBe(false); expect(button(text.start).disabled).toBe(true); expect(hasCounts()).toBe(false);
    expect(document.body.textContent).not.toContain(text.truncated);
  });

  it('左右同一源禁止开始，恢复另一源仍不沿用之前的键勾选', async () => {
    await mount(); await key(); await choose(text.right, 'left'); expect(button(text.start).disabled).toBe(true);
    await key(); expect(button(text.start).disabled).toBe(true); await choose(text.right, 'right'); expect(node(text.key('id')).checked).toBe(false);
  });

  it('浮点和字节匹配键有明确禁用理由，伪造勾选不会扩大键集合', async () => {
    await mount(); expect(node(text.key('bytes')).disabled).toBe(true); expect(node(text.key('f')).disabled).toBe(true); expect(document.body.textContent).toContain(text.keyUnsupported);
    await act(async () => reactProps(node(text.key('bytes'))).onChange({ target: { checked: true } })); expect(node(text.key('bytes')).checked).toBe(false); expect(button(text.start).disabled).toBe(true);
  });

  it('最多8个显式键，禁止第9个及伪造越限；取消其中一个后可选替代键', async () => {
    const pins = fixture(); const columns = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, name: `列${index}`, type: 'CHAR' }));
    const row = Object.fromEntries(columns.map(column => [column.key, column.key]));
    for (const pin of pins) { pin.result.columns = columns.map(column => ({ ...column })); pin.result.rows = [{ ...row }]; }
    await mount(pins); for (let index = 0; index < 8; index++) await key(`k${index}`);
    expect(node(text.key('k8')).disabled).toBe(true); await act(async () => reactProps(node(text.key('k8'))).onChange({ target: { checked: true } })); expect(node(text.key('k8')).checked).toBe(false);
    await key('k0', false); await key('k8'); await click(text.start); await finish(); expect(counts()).toEqual(['0', '0', '0', '1']);
  });

  it.each(['left', 'right'] as const)('%s侧NULL匹配键拒绝整次结果，改选可靠键后可手动重试', async side => {
    const pins = fixture(), source = pins[side === 'left' ? 0 : 2].result; source.rows[0].id = null;
    await mount(pins); await key(); await click(text.start); await finish(); expect(hasCounts()).toBe(false); expect(document.body.textContent).toContain(text.keyNull(side));
    await key('id', false); await key('huge'); await click(text.start); await finish(); expect(hasCounts()).toBe(true);
  });

  it.each(['left', 'right'] as const)('%s侧重复匹配键不能发部分计数，追加第二可靠键可解除歧义', async side => {
    const pins = fixture(), source = pins[side === 'left' ? 0 : 2].result; source.rows[1].id = source.rows[0].id;
    await mount(pins); await key(); await click(text.start); await finish(); expect(hasCounts()).toBe(false); expect(document.body.textContent).toContain(text.keyDuplicate(side));
    await key('huge'); await click(text.start); await finish(); expect(hasCounts()).toBe(true);
  });

  it.each(['name', 'type', 'order'] as const)('两侧完整列metadata的%s不同必须拒绝，不降级按同名部分列比较', async field => {
    const pins = fixture();
    if (field === 'order') pins[2].result.columns.reverse(); else pins[2].result.columns[1][field] = field === 'name' ? '另一名称' : 'VARCHAR';
    await mount(pins); await key(); await click(text.start); await finish(); expect(hasCounts()).toBe(false); expect(document.body.textContent).toContain(text.identity);
  });

  it('组合键保留空格及分隔符边界，显式两键能对应准确原行', async () => {
    const pins = fixture(), columns = [{ key: 'a', name: '甲', type: 'CHAR' }, { key: 'b', name: '乙', type: 'CHAR' }];
    for (const pin of pins) { pin.result.columns = columns.map(column => ({ ...column })); pin.result.rows = [{ a: 'a|b', b: ' c' }, { a: 'a', b: 'b| c' }]; }
    pins[2].result.rows.reverse(); await mount(pins); await key('a'); await key('b'); await click(text.start); await finish(); expect(counts()).toEqual(['0', '0', '0', '2']);
  });

  it('101条差异每页最多50条，按钮保持全结果编号，筛选切换回第一页', async () => {
    await mount(many(101)); await compare(); expect(counts()).toEqual(['0', '0', '101', '0']); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(50);
    expect(document.body.textContent).toContain(text.page(0, 3)); await click(text.next); expect(button(text.details(50))).toBeDefined(); expect(document.body.textContent).toContain(text.page(1, 3));
    await click(text.next); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(1); await click(text.details(100)); expect(detail('left', 'id')).toContain('"100"');
    await choose(text.filter, 'equal'); expect(document.body.textContent).toContain(text.noRows); expect(button(text.previous).disabled).toBe(true);
    await choose(text.filter, 'changed'); expect(document.body.textContent).toContain(text.page(0, 3)); expect(document.querySelectorAll('tbody')[0].querySelectorAll('tr')).toHaveLength(50);
  });

  it('停止多批扫描清空部分结果且保留窗口，手动重试不被旧停止按钮取消', async () => {
    const f = await mount(many(1400)); await key(); await click(text.start); await batch(); expect(hasCounts()).toBe(false);
    const oldStop = reactProps(button(text.stop)).onClick; await click(text.stop); expect(document.body.textContent).toContain(text.stopped); expect(vi.getTimerCount()).toBe(0); expect(f.props.onClose).not.toHaveBeenCalled();
    await click(text.start); await act(async () => oldStop()); await finish(); expect(counts()).toEqual(['0', '0', '1400', '0']); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('改键同步撤销旧timer和已完成值，旧selector及旧开始回调不能操作新草稿', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout'); await mount(); await key(); const oldStart = reactProps(button(text.start)).onClick; await click(text.start); const oldTick = timer.mock.calls.at(-1)![0] as () => void;
    const oldSource = reactProps(node(text.right)).onChange; await key('huge'); await act(async () => { oldTick(); oldStart(); oldSource({ target: { value: 'middle' } }); });
    expect(hasCounts()).toBe(false); expect(node(text.right).value).toBe('right'); expect(vi.getTimerCount()).toBe(0); await click(text.start); await finish(); expect(hasCounts()).toBe(true);
  });

  it('先前扫描行原值在后批漂移，最终整份拒绝且恢复原文后不能复活', async () => {
    const pins = many(1300), f = await mount(pins); await key(); await click(text.start); await batch(); pins[0].result.rows[0].nullable = '漂移'; await finish();
    expect(hasCounts()).toBe(false); expect(document.body.textContent).toContain(text.stale); pins[0].result.rows[0].nullable = '旧'; await f.update(); expect(button(text.start).disabled).toBe(true); expect(hasCounts()).toBe(false);
  });

  it('完成后原值或字节字段原地漂移，外部渲染立即清除计数和已打开详情', async () => {
    const f = await mount(); await compare(); await click(text.details(1)); (f.pins[2].result.rows[0].bytes as { type: 'binary'; base64: string }).base64 = 'AP8='; await f.update();
    expect(hasCounts()).toBe(false); expect(document.querySelectorAll('dd')).toHaveLength(0); expect(document.body.textContent).toContain(text.stale);
  });

  it('准确pin数组更换即使成员相同也撤销，owner或父身份ABA不能恢复旧对比', async () => {
    const f = await mount(); await compare(); await f.update({ pins: [...f.pins] }); expect(hasCounts()).toBe(false); await f.update({ pins: f.pins }); expect(hasCounts()).toBe(false); expect(button(text.start).disabled).toBe(true);
  });

  it('父当前门曾失效后永久隐藏，正在排队回调不能跨工作区恢复继续', async () => {
    const f = await mount(); await key(); await click(text.start); f.invalidate(); await batch(); f.restore(); await f.update(); await finish();
    expect(hasCounts()).toBe(false); expect(document.body.textContent).toContain(text.stale); expect(button(text.start).disabled).toBe(true);
  });

  it('扫描中关闭可立即撤销，重复旧关闭只通知一次且不展示迟到结果', async () => {
    const f = await mount(many(1300)); await key(); await click(text.start); const oldClose = reactProps(button(text.close)).onClick; await act(async () => { oldClose(); oldClose(); }); await finish();
    expect(f.props.onClose).toHaveBeenCalledOnce(); expect(hasCounts()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('卸载清理真实扫描器与timer，手工投递旧timer不能再执行一批', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout'), step = vi.spyOn(QueryResultComparisonScan.prototype, 'step'); await mount(); await key(); await click(text.start);
    const oldTick = timer.mock.calls.at(-1)![0] as () => void; await act(async () => root!.unmount()); root = undefined;
    await act(async () => { oldTick(); vi.runAllTimers(); }); expect(step).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('已消费的源或键事件不改草稿，字段getter在真实准入时零调用且不发布结果', async () => {
    const pins = fixture(), getter = vi.fn(() => '泄漏值'); Object.defineProperty(pins[0].result.rows[0], 'huge', { enumerable: true, get: getter }); await mount(pins);
    await act(async () => { reactProps(node(text.right)).onChange({ defaultPrevented: true, target: { value: 'middle' } }); reactProps(node(text.key('id'))).onChange({ defaultPrevented: true, target: { checked: true } }); });
    expect(node(text.right).value).toBe('right'); expect(node(text.key('id')).checked).toBe(false); await key(); await click(text.start); await finish(); expect(getter).not.toHaveBeenCalled(); expect(hasCounts()).toBe(false);
  });
});
