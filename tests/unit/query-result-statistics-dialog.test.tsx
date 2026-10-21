import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { QueryResultStatisticsDialog } from '../../src/renderer/components/QueryResultStatisticsDialog';
import { QueryResultStatisticsScan } from '../../src/renderer/queryResultStatistics';
import { queryResultStatisticsZh as text } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
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
  document.body.textContent = ''; vi.restoreAllMocks(); vi.useRealTimers();
});
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 真实扫描器消费RAM原值，测试只控制定时器与父层当前身份，不替换统计逻辑。 */
function fixture() {
  const columns: ResultColumn[] = [
    { key: 'n', name: '重复名称', type: 'BIGINT' }, { key: 'd', name: '重复名称', type: 'DECIMAL(30,3)' },
    { key: 'word', name: '文本', type: 'VARCHAR' }, { key: 'bytes', name: '字节', type: 'BLOB' },
    { key: 'unknown', name: '未知', type: 'GEOMETRY' }, { key: 'f', name: '浮点', type: 'DOUBLE' },
  ];
  const rows: DataRow[] = [
    { n: '9007199254740993', d: '0.10', word: '', bytes: { type: 'binary', base64: 'AA==' }, unknown: '未知原值', f: 0.1 },
    { n: '9007199254740995', d: '0.20', word: 'NULL', bytes: null, unknown: null, f: 0.2 },
    { n: null, d: '0.30', word: '甲,乙\n下一行', bytes: { type: 'binary', base64: 'AQ==' }, unknown: null, f: 0.3 },
  ];
  return { columns, rows };
}
/** 真实Modal与select走React委派；scope所用选择保持首次打开时的独立副本。 */
async function mount(patch: Partial<ComponentProps<typeof QueryResultStatisticsDialog>> = {}) {
  const data = fixture(); let live = true;
  let props: ComponentProps<typeof QueryResultStatisticsDialog> = { ...data, initialColumn: data.columns[0], selectedIndices: new Set(), truncated: false, owner: 'ram-statistics-owner', isCurrent: () => live, onClose: vi.fn(), ...patch };
  if (patch.columns && !patch.initialColumn) props.initialColumn = patch.columns[0];
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<QueryResultStatisticsDialog {...props}/>));
  return { props, invalidate: () => { live = false; }, restore: () => { live = true; },
    async update(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; await act(async () => root!.render(<QueryResultStatisticsDialog {...props}/>)); } };
}
function node(label: string) { const value = document.querySelector(`[aria-label="${label}"]`); expect(value, label).not.toBeNull(); return value!; }
function metric(label: string) { const value = document.querySelectorAll('dd').find(item => item.getAttribute('aria-label') === label); expect(value, label).toBeDefined(); return value!.textContent; }
function hasMetrics() { return document.querySelectorAll('dd').length > 0; }
function button(label: string) { const value = document.querySelectorAll('button').find(item => item.textContent === label); expect(value, label).toBeDefined(); return value!; }
/** 只取得真实旧事件闭包，断言其不能越过组件的同步请求身份门。 */
function reactProps(value: ReturnType<typeof node>) { const key = Object.keys(value).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (value as any)[key]; }
async function change(label: string, value: string) { const select = node(label); expect(select.disabled).toBe(false); await act(async () => { select.value = value; select.dispatchEvent(new MemoryEvent('change')); }); }
async function finish() { await act(async () => { vi.runAllTimers(); }); }
async function batch() { await act(async () => { vi.advanceTimersToNextTimer(); }); }

describe('查询结果列统计的真实对话框', () => {
  it('挂载显示来源范围及截断提示，完成前无部分指标，BIGINT合计和平均值精确', async () => {
    await mount({ truncated: true });
    expect(node(text.title).getAttribute('role')).toBe('dialog'); expect(document.querySelector('[data-query-result-statistics-owner="ram-statistics-owner"]')).not.toBeNull();
    expect(document.body.textContent).toContain(text.notice); expect(document.body.textContent).toContain(text.truncated); expect(hasMetrics()).toBe(false);
    await finish(); expect(metric(text.count)).toBe('3'); expect(metric(text.nonNull)).toBe('2'); expect(metric(text.nulls)).toBe('1');
    expect(metric(text.distinct)).toBe('2'); expect(metric(text.min)).toBe('9007199254740993'); expect(metric(text.max)).toBe('9007199254740995');
    expect(metric(text.sum)).toBe('18014398509481988'); expect(metric(text.average)).toBe('9007199254740994'); expect(document.body.textContent).not.toContain(text.approximate);
  });

  it('非空勾选默认selected，不连续索引按原行统计，后来的勾选不能改写scope快照', async () => {
    const selected = new Set([2, 0]); const f = await mount({ selectedIndices: selected });
    expect(node(text.scope).value).toBe('selected'); selected.clear(); selected.add(1); await f.update({ selectedIndices: new Set([1]) });
    await finish(); expect(metric(text.count)).toBe('2'); expect(metric(text.nonNull)).toBe('1'); expect(metric(text.sum)).toBe('9007199254740993');
    await change(text.scope, 'all'); expect(hasMetrics()).toBe(false); await finish(); expect(metric(text.count)).toBe('3');
    await change(text.scope, 'selected'); await finish(); expect(metric(text.count)).toBe('2'); expect(metric(text.sum)).toBe('9007199254740993');
  });

  it('空选择默认all且selected选项禁用，伪造selected事件不能启动空选统计', async () => {
    await mount(); expect(node(text.scope).value).toBe('all'); expect(node(text.scope).querySelectorAll('option').find(option => option.value === 'selected')?.disabled).toBe(true);
    await act(async () => reactProps(node(text.scope)).onChange({ target: { value: 'selected' } })); await finish(); expect(metric(text.count)).toBe('3'); expect(node(text.scope).value).toBe('all');
  });

  it('列按内部key选择，重复名称不串列，DECIMAL保持精确十进制统计', async () => {
    await mount(); await finish(); await change(text.column, 'd'); expect(hasMetrics()).toBe(false); await finish();
    expect(metric(text.sum)).toBe('0.60'); expect(metric(text.average)).toBe('0.20'); expect(metric(text.distinct)).toBe('3');
    expect(node(text.column).querySelectorAll('option').slice(0, 2).map(option => option.value)).toEqual(['n', 'd']);
  });

  it('文本空串、文字NULL、逗号换行逐字保留，NULL和不同值计数不混淆', async () => {
    const data = fixture(); data.rows.push({ ...data.rows[0], word: null });
    await mount({ ...data, initialColumn: data.columns[2] }); await finish();
    expect(metric(text.count)).toBe('4'); expect(metric(text.nonNull)).toBe('3'); expect(metric(text.nulls)).toBe('1'); expect(metric(text.distinct)).toBe('3');
    expect(metric(text.min)).toBe(''); expect(metric(text.max)).toBe('甲,乙\n下一行'); expect(metric(text.sum)).toBe(text.unavailable);
  });

  it('空结果与全NULL只显示真实零计数，不填虚构最小值或平均值', async () => {
    const data = fixture(); await mount({ ...data, rows: [] }); await finish();
    expect(metric(text.count)).toBe('0'); expect(metric(text.nonNull)).toBe('0'); expect(metric(text.nulls)).toBe('0'); expect(metric(text.min)).toBe(text.unavailable); expect(metric(text.average)).toBe(text.unavailable);
  });

  it('未知类型全NULL可计数和distinct0，含字节值只给计数并解释不支持值指标', async () => {
    const data = fixture(); data.rows = data.rows.map(row => ({ ...row, unknown: null })); await mount({ ...data, initialColumn: data.columns[4] }); await finish();
    expect(metric(text.count)).toBe('3'); expect(metric(text.nonNull)).toBe('0'); expect(metric(text.nulls)).toBe('3'); expect(metric(text.distinct)).toBe('0');
    await change(text.column, 'bytes'); await finish(); expect(metric(text.count)).toBe('3'); expect(metric(text.nonNull)).toBe('2');
    expect(metric(text.distinct)).toBe(text.unavailable); expect(metric(text.min)).toBe(text.unavailable); expect(metric(text.sum)).toBe(text.unavailable); expect(document.body.textContent).toContain(text.unsupported);
  });

  it('浮点来源与AVG舍入分别明确标注近似，不把近似合计伪称精确', async () => {
    const data = fixture(); await mount({ ...data, initialColumn: data.columns[5] }); await finish();
    expect(document.body.textContent).toContain(text.approximate); expect(document.body.textContent).toContain(text.floatInput);
    await change(text.column, 'n'); await finish(); expect(document.body.textContent).not.toContain(text.floatInput);
  });

  it('整数三分之一按协议18位舍入且明确说明，合计仍精确', async () => {
    const data = fixture(); data.rows = [0, 0, 1].map(n => ({ ...data.rows[0], n: String(n) })); await mount({ ...data, initialColumn: data.columns[0] }); await finish();
    expect(metric(text.sum)).toBe('1'); expect(metric(text.average)).toBe('0.333333333333333333'); expect(document.body.textContent).toContain(text.averageRounded); expect(document.body.textContent).not.toContain(text.floatInput);
  });

  it('一列含不合类型原值时保留全部计数，不能发布前面几行算出的部分值指标', async () => {
    const data = fixture(); data.rows[1].n = '无效数字'; await mount({ ...data, initialColumn: data.columns[0] }); await finish();
    expect(metric(text.count)).toBe('3'); expect(metric(text.nonNull)).toBe('2'); expect(metric(text.sum)).toBe(text.unavailable); expect(metric(text.distinct)).toBe(text.unavailable); expect(document.body.textContent).toContain(text.value);
  });

  it('多批处理中立即取消清理timer，父层尚未卸载也不显示迟到结果或重复关闭', async () => {
    const data = fixture(); data.rows = Array.from({ length: 1300 }, () => ({ ...data.rows[0] })); const step = vi.spyOn(QueryResultStatisticsScan.prototype, 'step');
    const f = await mount({ ...data, initialColumn: data.columns[0] }); await batch(); expect(step).toHaveBeenCalledTimes(1); expect(hasMetrics()).toBe(false);
    const cancel = reactProps(button(text.cancel)).onClick; await act(async () => { cancel(); cancel(); }); await finish();
    expect(f.props.onClose).toHaveBeenCalledOnce(); expect(step).toHaveBeenCalledTimes(1); expect(hasMetrics()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('切列撤销旧定时回调与旧selector，后来完成结果不能被旧回调替换', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout'); await mount(); const oldTick = timer.mock.calls.at(-1)![0] as () => void;
    const oldColumn = reactProps(node(text.column)).onChange; await change(text.column, 'd');
    await act(async () => { oldTick(); oldColumn({ target: { value: 'word' } }); }); expect(hasMetrics()).toBe(false); await finish(); expect(metric(text.sum)).toBe('0.60');
    await act(async () => oldTick()); expect(metric(text.sum)).toBe('0.60'); expect(node(text.column).value).toBe('d');
  });

  it('来源身份失效后即使恢复也不复活，卸载清理所有尚未执行的批次', async () => {
    const f = await mount(); f.invalidate(); await batch(); f.restore(); await f.update(); await finish();
    expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale); expect(node(text.column).disabled).toBe(true); expect(vi.getTimerCount()).toBe(0);
    await act(async () => root!.unmount()); root = undefined; await finish(); expect(vi.getTimerCount()).toBe(0);
  });

  it('已扫描行原值在后批前漂移，最终拒绝整份且恢复原文也不能重启', async () => {
    const data = fixture(); data.rows = Array.from({ length: 1025 }, () => ({ ...data.rows[0] })); const f = await mount({ ...data, initialColumn: data.columns[0] });
    await batch(); data.rows[0].n = '2'; await finish(); expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale);
    data.rows[0].n = '9007199254740993'; await f.update(); await finish(); expect(hasMetrics()).toBe(false); expect(node(text.column).disabled).toBe(true);
  });

  it('完成后原地修改元数据或原值的外部重渲染立即隐藏旧指标', async () => {
    const f = await mount(); await finish(); expect(hasMetrics()).toBe(true); f.props.rows[0].n = '7'; await f.update();
    expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale); f.props.rows[0].n = '9007199254740993'; await f.update(); expect(hasMetrics()).toBe(false);
  });

  it('元数据原地更名即使随后恢复，也不能让完成指标复活', async () => {
    const f = await mount(); await finish(); f.props.columns[0].name = '后来名称'; await f.update();
    expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale);
    f.props.columns[0].name = '重复名称'; await f.update(); expect(hasMetrics()).toBe(false); expect(node(text.column).disabled).toBe(true);
  });

  it('扫描前卸载取消真实扫描器，手工投递已经取出的旧timer也没有后续批次', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout'), step = vi.spyOn(QueryResultStatisticsScan.prototype, 'step'); await mount();
    const oldTick = timer.mock.calls.at(-1)![0] as () => void; await act(async () => root!.unmount()); root = undefined;
    await act(async () => { oldTick(); vi.runAllTimers(); }); expect(step).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(hasMetrics()).toBe(false);
  });

  it('切换前完整复核上一capture，不能用新scope重捕获追认已经漂移的源', async () => {
    const f = await mount({ selectedIndices: new Set([0]) }); f.props.rows[0].n = '7'; await change(text.scope, 'all'); await finish();
    expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale); expect(node(text.scope).disabled).toBe(true);
  });

  it('更换rows数组或owner使旧扫描失效，不隐式统计后继结果', async () => {
    const f = await mount(); await f.update({ rows: f.props.rows.map(row => ({ ...row })), owner: 'another-owner' }); await finish();
    expect(hasMetrics()).toBe(false); expect(document.body.textContent).toContain(text.stale); expect(vi.getTimerCount()).toBe(0);
  });
});
