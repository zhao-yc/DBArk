import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueryParameter, QueryParameterNames } from '../../src/shared/queryParameters';
import type { QueryParameterReusePort } from '../../src/renderer/queryParameterReusePort';
import { parameterZh as text } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryParameterReuseZh as reuseText } from '../../src/renderer/locales/queryParameterReuse.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

/** 仅预览编辑器替换为RAM纯显示端口；不加载Monaco或执行生产IPC。 */
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value }: { value: string }) => <pre data-ram-sql-preview="true">{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let flushSync: typeof import('react-dom')['flushSync'];
let Dialog: typeof import('../../src/renderer/components/QueryParametersDialog')['QueryParametersDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  const create = document.createElement.bind(document);
  /** 只补HTML属性和select端口，组件/Modal/React事件/异步状态使用真实代码。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, {
      options: { configurable: true, get: () => node.querySelectorAll('option') },
      value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } },
    });
    if (name === 'option') {
      let selected = false, dirty = false;
      Object.defineProperties(node, {
        value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) },
        selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; if (selected) { let parent = node.parentNode; while (parent && parent.tagName !== 'SELECT') parent = parent.parentNode; if (parent) for (const option of parent.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } } },
        defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } },
      });
    }
    return node;
  };
  ({ flushSync } = await import('react-dom')); ({ createRoot } = await import('react-dom/client')); ({ QueryParametersDialog: Dialog } = await import('../../src/renderer/components/QueryParametersDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const names = (): QueryParameterNames => ({ names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 30, allowTimeEndpointFraction: false });
const copy = (parameters: readonly QueryParameter[]) => parameters.map(parameter => ({ ...parameter }));
/** 明确RAM mock能力，只记录UI协议；不声称覆盖真实缓存、父标签绑定或执行。 */
function ramPort(parameters: QueryParameter[] | null = [{ name: 'value', type: 'text', value: '上次😀' }]) {
  let available = parameters ? copy(parameters) : null, current = true, optIn = false, stageAllowed = true;
  const listeners = new Set<() => void>(), order: string[] = [];
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const port: QueryParameterReusePort = {
    current: vi.fn(() => current), has: vi.fn(() => available !== null), read: vi.fn(() => available ? copy(available) : null),
    setOptIn: vi.fn((enabled: boolean) => { optIn = enabled; if (!enabled) available = null; emit(); return current; }),
    forget: vi.fn(() => { available = null; optIn = false; emit(); }),
    stage: vi.fn((_info: QueryParameterNames, _parameters: readonly QueryParameter[]) => { order.push('stage'); return current && optIn && stageAllowed; }),
    subscribe: vi.fn((changed: () => void) => { listeners.add(changed); return () => { listeners.delete(changed); }; }),
  };
  return { port, order, listeners, setCurrent: (value: boolean) => { current = value; emit(); }, allowStage: (value: boolean) => { stageAllowed = value; }, replace: (value: QueryParameter[] | null) => { available = value ? copy(value) : null; emit(); } };
}
async function mount(options: { pending?: ReturnType<typeof deferred<QueryParameterNames>>; port?: ReturnType<typeof ramPort>; initial?: QueryParameter[]; source?: string } = {}) {
  const capability = options.port ?? ramPort(), onExecute = vi.fn((parameters: QueryParameter[]) => { capability.order.push('execute'); }), onClose = vi.fn();
  const loadNames = vi.fn(() => options.pending?.promise ?? Promise.resolve(names()));
  let props: Parameters<typeof Dialog>[0] = { source: options.source ?? 'SELECT :value', loadNames, onExecute, onClose, reuse: capability.port, initialParameters: options.initial ?? [] };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = () => root!.render(<Dialog {...props}/>); await act(async () => render());
  return { ...capability, onExecute, onClose, loadNames, async render(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; await act(async () => render()); }, renderNow(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; flushSync(() => render()); }, unmountNow() { flushSync(() => root!.unmount()); root = undefined; }, async unmount() { await act(async () => root!.unmount()); root = undefined; } };
}
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function checkbox(): MemoryNode { const node = document.querySelectorAll('input').find(item => item.type === 'checkbox'); expect(node).toBeDefined(); return node!; }
function callback(node: MemoryNode, name = 'onClick'): (...args: any[]) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); const handler = (Reflect.get(node, key) as Record<string, unknown>)[name]; if (typeof handler !== 'function') throw Error('缺少真实回调'); return handler as (...args: any[]) => void; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function check(enabled: boolean) { const node = checkbox(); expect(node.disabled).toBe(false); await act(async () => callback(node, 'onChange')({ target: { checked: enabled } })); }
function rowNodes(): MemoryNode[] { return document.querySelectorAll('div').filter(node => node.classList.contains('parameter-row')); }
function formValues() { return rowNodes().map(row => ({ name: row.querySelector('input')!.value, type: row.querySelector('select')!.value, value: row.querySelector('textarea')!.value, disabled: row.querySelector('textarea')!.disabled })); }
async function changeValue(index: number, value: string) { const node = rowNodes()[index].querySelector('textarea')!; expect(node.disabled).toBe(false); await act(async () => callback(node, 'onChange')({ target: { value } })); }

describe('参数复用正式表单真实React RAM（非Monaco/IPC/SQL验收）', () => {
  it('names未回前禁复用，ready后仍默认unchecked且不自动读/填/执行', async () => {
    const pending = deferred<QueryParameterNames>(), f = await mount({ pending });
    expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(true); expect(button(reuseText.fill).disabled).toBe(true); expect(button(text.execute).disabled).toBe(true);
    expect(f.port.read).not.toHaveBeenCalled(); expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled();
    await act(async () => pending.resolve(names())); expect(checkbox().checked).toBe(false); expect(button(reuseText.fill).disabled).toBe(false); expect(formValues()).toEqual([{ name: 'value', type: 'text', value: '', disabled: false }]);
    expect(f.port.read).not.toHaveBeenCalled(); expect(f.port.setOptIn).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled();
    await click(reuseText.fill); expect(formValues()[0].value).toBe('上次😀'); expect(f.port.read).toHaveBeenCalledExactlyOnceWith(names()); expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it('显式fill完整替换手动extra与九类型原值，NULL和空串不混同', async () => {
    const values: QueryParameter[] = [
      { name: 'extra', type: 'integer', value: '+18446744073709551615' }, { name: 'value', type: 'text', value: '' }, { name: 'unicode', type: 'text', value: '中文😀\r\n\0' },
      { name: 'decimal', type: 'decimal', value: '-9007199254740993.123456789012' }, { name: 'boolean', type: 'boolean', value: 'false' },
      { name: 'date', type: 'date', value: '2024-02-29' }, { name: 'datetime', type: 'datetime', value: '2024-02-29 23:59:59.123456' },
      { name: 'time', type: 'time', value: '-838:59:59.000000' }, { name: 'binary', type: 'binary', value: '00fFa1' }, { name: 'nil', type: 'null' },
    ];
    const f = await mount({ port: ramPort(values), initial: [{ name: 'oldManual', type: 'text', value: '旧手动值' }] });
    expect(formValues().some(row => row.name === 'oldManual')).toBe(true); await click(reuseText.fill);
    // HTML textarea的DOM value统一显示LF；后面的真实提交断言仍要求整组原CRLF逐字保持。
    expect(formValues()).toEqual(values.map(parameter => ({ name: parameter.name, type: parameter.type, value: (parameter.value ?? '').replace(/\r\n?/g, '\n'), disabled: parameter.type === 'null' })));
    expect(document.body.textContent).not.toContain('oldManual'); expect(f.onExecute).not.toHaveBeenCalled(); expect(f.port.stage).not.toHaveBeenCalled();
    await click(text.execute); expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith(values); expect(f.order).toEqual(['execute']);
  });
  it('unchecked submit不stage；checked本地校验通过且stage成功才执行一次', async () => {
    const f = await mount(); await changeValue(0, '本轮填写😀'); await check(true);
    expect(f.port.setOptIn).toHaveBeenCalledExactlyOnceWith(true); expect(f.port.stage).not.toHaveBeenCalled();
    const oldSubmit = callback(button(text.execute)); await act(async () => { oldSubmit(); oldSubmit(); });
    expect(f.port.stage).toHaveBeenCalledExactlyOnceWith(names(), [{ name: 'value', type: 'text', value: '本轮填写😀' }]); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '本轮填写😀' }]); expect(f.order).toEqual(['stage', 'execute']);
  });
  it('stage拒绝保留当前输入并禁止execute；校验失败连stage也不调用', async () => {
    const f = await mount({ initial: [{ name: 'value', type: 'integer', value: '1e3' }] }); await check(true); await click(text.execute);
    expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled(); expect(formValues()[0].value).toBe('1e3');
    await changeValue(0, '9007199254740993'); f.allowStage(false); await click(text.execute);
    expect(f.port.stage).toHaveBeenCalledOnce(); expect(f.onExecute).not.toHaveBeenCalled(); expect(formValues()[0].value).toBe('9007199254740993'); expect(checkbox().checked).toBe(true); expect(document.body.textContent).toContain(reuseText.unavailable);
  });
  it('stage同步重入旧submit不能重复stage或执行', async () => {
    const f = await mount(); await changeValue(0, '重入值'); await check(true);
    const submit = callback(button(text.execute)); let entered = false;
    const stage = vi.fn((_info: QueryParameterNames, _parameters: readonly QueryParameter[]) => { if (!entered) { entered = true; submit(); } return true; }); f.port.stage = stage;
    await act(async () => submit()); expect(stage).toHaveBeenCalledExactlyOnceWith(names(), [{ name: 'value', type: 'text', value: '重入值' }]); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '重入值' }]);
  });
  it.each(['source', 'source-aba', 'props', 'close', 'unmount'] as const)('stage同步%s后不能续交onExecute', async kind => {
    const f = await mount(); await changeValue(0, '阶段原值'); await check(true);
    const stage = vi.fn((_info: QueryParameterNames, _parameters: readonly QueryParameter[]) => {
      if (kind === 'source' || kind === 'source-aba') { f.setCurrent(false); if (kind === 'source-aba') f.setCurrent(true); }
      if (kind === 'props') f.renderNow({ source: 'SELECT :other' });
      if (kind === 'close') { f.renderNow(); callback(button('取消'))(); }
      if (kind === 'unmount') f.unmountNow();
      return true;
    }); f.port.stage = stage;
    await click(text.execute); expect(stage).toHaveBeenCalledOnce(); expect(f.onExecute).not.toHaveBeenCalled(); if (kind === 'close') expect(f.onClose).toHaveBeenCalledOnce();
    if (kind === 'source' || kind === 'source-aba') { expect(formValues()[0].value).toBe('阶段原值'); expect(button(text.execute).disabled).toBe(false); }
  });
  it.each(['source', 'source-aba', 'props', 'close', 'unmount'] as const)('read同步%s后不能替换旧表单或声称填入', async kind => {
    const f = await mount(); await changeValue(0, '不能丢弃的本轮输入');
    const read = vi.fn((_info: QueryParameterNames) => {
      if (kind === 'source' || kind === 'source-aba') { f.setCurrent(false); if (kind === 'source-aba') f.setCurrent(true); }
      if (kind === 'props') f.renderNow({ source: 'SELECT :other' });
      if (kind === 'close') { f.renderNow(); callback(button('取消'))(); }
      if (kind === 'unmount') f.unmountNow();
      return [{ name: 'value', type: 'text' as const, value: '旧暂存不应填入' }];
    }); f.port.read = read;
    await click(reuseText.fill); expect(read).toHaveBeenCalledOnce(); expect(f.onExecute).not.toHaveBeenCalled();
    if (kind !== 'unmount') { expect(formValues()[0].value).toBe('不能丢弃的本轮输入'); expect(document.body.textContent).not.toContain(reuseText.filled); }
    if (kind === 'source' || kind === 'source-aba') expect(button(reuseText.fill).disabled).toBe(true);
  });
  it('read同步产生新fill时，旧返回值不能覆盖新阶段结果', async () => {
    const f = await mount(); let count = 0;
    f.port.read = vi.fn(() => {
      count++;
      if (count === 1) { f.renderNow(); callback(button(reuseText.fill))(); return [{ name: 'value', type: 'text' as const, value: '旧阶段返回值' }]; }
      return [{ name: 'value', type: 'text' as const, value: '新阶段完整填入' }];
    });
    await click(reuseText.fill); expect(f.port.read).toHaveBeenCalledTimes(2); expect(formValues()[0].value).toBe('新阶段完整填入'); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it('stage不能借传入参数对象改写稍后提交的本轮原值', async () => {
    const f = await mount(); await changeValue(0, '原填写值'); await check(true);
    f.port.stage = vi.fn((_info: QueryParameterNames, parameters: readonly QueryParameter[]) => { parameters[0].value = '能力侧改写'; return true; });
    await click(text.execute); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '原填写值' }]);
  });
  it('仅暂存能力失效不改变未勾选的原捕获模板执行', async () => {
    const f = await mount(); await changeValue(0, '仍执行原捕获值'); await act(async () => f.setCurrent(false));
    expect(checkbox().checked).toBe(false); expect(button(reuseText.fill).disabled).toBe(true); await click(text.execute);
    expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '仍执行原捕获值' }]);
  });
  it.each(['before-stage', 'during-stage'] as const)('已勾选%s失效后可取消勾选再普通执行，父清理失败也不锁表单', async kind => {
    const f = await mount(); await changeValue(0, '失效后保留输入'); await check(true);
    if (kind === 'before-stage') await act(async () => f.setCurrent(false));
    else f.port.stage = vi.fn(() => { f.setCurrent(false); return true; });
    await click(text.execute); expect(f.onExecute).not.toHaveBeenCalled(); expect(checkbox().checked).toBe(true); expect(formValues()[0].value).toBe('失效后保留输入');
    f.port.setOptIn = vi.fn(() => { throw Error('父能力已经释放'); }); await check(false);
    expect(checkbox().checked).toBe(false); expect(formValues()[0].value).toBe('失效后保留输入'); await click(text.execute);
    expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '失效后保留输入' }]);
  });
  it('setOptIn回调同步失效不能把checkbox恢复为已勾，后续普通执行仍可用', async () => {
    const f = await mount(); f.port.setOptIn = vi.fn(() => { f.setCurrent(false); f.setCurrent(true); return true; });
    await check(true); expect(checkbox().checked).toBe(false); expect(button(reuseText.fill).disabled).toBe(true); await changeValue(0, '未勾选原路径'); await click(text.execute);
    expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '未勾选原路径' }]); expect(f.port.stage).not.toHaveBeenCalled();
  });
  it('forget回调重入卸载后不向后继表单发布状态', async () => {
    const f = await mount(); await changeValue(0, '旧表单'); await check(true); f.port.forget = vi.fn(() => f.unmountNow());
    await click(reuseText.forget); expect(f.onExecute).not.toHaveBeenCalled(); const next = await mount({ initial: [{ name: 'value', type: 'text', value: '后继表单' }] });
    expect(formValues()[0].value).toBe('后继表单'); expect(checkbox().checked).toBe(false); expect(next.onExecute).not.toHaveBeenCalled();
  });
  it('forget仅清缓存/解除optIn，当前表单内容类型保留', async () => {
    const f = await mount(); await click(reuseText.fill); await changeValue(0, '已修改的当前输入'); await check(true); const before = formValues();
    await click(reuseText.forget); expect(f.port.forget).toHaveBeenCalledOnce(); expect(formValues()).toEqual(before); expect(checkbox().checked).toBe(false); expect(button(reuseText.fill).disabled).toBe(true); expect(f.onExecute).not.toHaveBeenCalled();
    await click(text.execute); expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).toHaveBeenCalledExactlyOnceWith([{ name: 'value', type: 'text', value: '已修改的当前输入' }]);
  });
  it.each(['rerender', 'source', 'port', 'unmount'] as const)('旧submit/fill/forget在%s后不能获得新render权限', async kind => {
    const f = await mount(); const submit = callback(button(text.execute)), fill = callback(button(reuseText.fill)), forget = callback(button(reuseText.forget));
    if (kind === 'rerender') await f.render(); if (kind === 'source') { await f.render({ source: 'SELECT :other' }); await f.render({ source: 'SELECT :value' }); }
    if (kind === 'port') { await f.render({ reuse: ramPort().port }); await f.render({ reuse: f.port }); } if (kind === 'unmount') await f.unmount();
    await act(async () => { fill(); forget(); submit(); }); expect(f.port.read).not.toHaveBeenCalled(); expect(f.port.forget).not.toHaveBeenCalled(); expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it('重新识别忙态与旧fill不能读缓存，late names不穿透换source的表单', async () => {
    const f = await mount(); await changeValue(0, '本地输入'); const fill = callback(button(reuseText.fill));
    const pending = deferred<QueryParameterNames>(); await f.render({ loadNames: () => pending.promise }); await click(text.retry);
    expect(button(reuseText.fill).disabled).toBe(true); expect(checkbox().disabled).toBe(true); await act(async () => fill()); expect(f.port.read).not.toHaveBeenCalled();
    await f.render({ source: 'SELECT :other' }); await act(async () => pending.resolve({ ...names(), names: ['other'] }));
    expect(formValues().map(row => row.name)).toEqual(['value']); expect(formValues()[0].value).toBe('本地输入'); expect(f.port.read).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it('reload的has同步换来源后不得发布新的names或改写原输入', async () => {
    const f = await mount(); await changeValue(0, '识别前本地输入'); await f.render({ loadNames: async () => ({ ...names(), names: ['other'] }) });
    f.port.has = vi.fn(() => { f.renderNow({ source: 'SELECT :other' }); return true; });
    await click(text.retry); expect(formValues().map(row => row.name)).toEqual(['value']); expect(formValues()[0].value).toBe('识别前本地输入'); expect(f.onExecute).not.toHaveBeenCalled(); expect(f.port.read).not.toHaveBeenCalled();
  });
  it('旧挂载names晚回不改变后来新表单，卸载同时释放原订阅', async () => {
    const pending = deferred<QueryParameterNames>(), old = await mount({ pending }); expect(old.listeners.size).toBe(1); await old.unmount(); expect(old.listeners.size).toBe(0);
    const next = await mount({ source: 'SELECT :value /* 新表单 */', initial: [{ name: 'value', type: 'text', value: '后来输入' }] });
    await act(async () => pending.resolve({ ...names(), names: ['obsolete'] })); expect(formValues()).toEqual([{ name: 'value', type: 'text', value: '后来输入', disabled: false }]); expect(next.onExecute).not.toHaveBeenCalled(); expect(old.port.read).not.toHaveBeenCalled(); expect(next.port.read).not.toHaveBeenCalled();
  });
  it('同来源重新识别仅最新ready数据可用，期间旧动作不生效且输入按名保留', async () => {
    const f = await mount(); await changeValue(0, '新输入'); const pending = deferred<QueryParameterNames>(); await f.render({ loadNames: () => pending.promise });
    const submit = callback(button(text.execute)), fill = callback(button(reuseText.fill)), forget = callback(button(reuseText.forget)); await click(text.retry);
    await act(async () => { submit(); fill(); forget(); }); expect(f.onExecute).not.toHaveBeenCalled(); expect(f.port.read).not.toHaveBeenCalled(); expect(f.port.forget).not.toHaveBeenCalled();
    await act(async () => pending.resolve(names())); expect(formValues()[0].value).toBe('新输入'); expect(button(reuseText.fill).disabled).toBe(false); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it('checkbox ABA跨render不会复活旧submit；同栈勾选也不能绕过stage', async () => {
    const f = await mount(); await changeValue(0, '本轮值'); const oldestSubmit = callback(button(text.execute)); await check(true); await check(false); await check(true);
    await act(async () => oldestSubmit()); expect(f.onExecute).not.toHaveBeenCalled(); expect(f.port.stage).not.toHaveBeenCalled();
    const latest = callback(button(text.execute)); const change = callback(checkbox(), 'onChange'); f.allowStage(false);
    await act(async () => { change({ target: { checked: false } }); change({ target: { checked: true } }); latest(); });
    expect(f.onExecute).not.toHaveBeenCalled(); expect(formValues()[0].value).toBe('本轮值');
  });
  it('初次unchecked同栈勾选true后旧submit被撤销，仅新render可stage', async () => {
    const f = await mount(); await changeValue(0, '同栈填写'); const submit = callback(button(text.execute)), change = callback(checkbox(), 'onChange'); f.allowStage(false);
    await act(async () => { change({ target: { checked: true } }); submit(); });
    expect(f.port.stage).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled(); expect(formValues()[0].value).toBe('同栈填写');
    await click(text.execute); expect(f.port.stage).toHaveBeenCalledExactlyOnceWith(names(), [{ name: 'value', type: 'text', value: '同栈填写' }]); expect(f.onExecute).not.toHaveBeenCalled();
  });
  it.each([{ key: 'Enter', ctrlKey: true }, { key: 'Enter', metaKey: true }, { key: 's', ctrlKey: true }, { key: 's', metaKey: true }])('父快捷键$key被文档捕获拦住，不stage/execute', async shortcut => {
    const f = await mount(), parent = vi.fn(); document.addEventListener('keydown', parent);
    const event = Object.assign(new MemoryEvent('keydown'), shortcut); Object.assign(event, { stopImmediatePropagation: () => { event.cancelBubble = true; } });
    try { await act(async () => { rowNodes()[0].querySelector('textarea')!.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true); expect(parent).not.toHaveBeenCalled(); expect(f.onExecute).not.toHaveBeenCalled(); expect(f.port.stage).not.toHaveBeenCalled(); }
    finally { document.removeEventListener('keydown', parent); }
  });
});
