import { act, useState, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { SqliteFilterDraft } from '../../src/renderer/sqliteTableBrowser';
import { sqliteTableBrowseZh as text } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTextFilterOperators } from '../../src/shared/sqliteTableBrowse';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]as const);
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined,Filters:typeof import('../../src/renderer/components/SqliteTableFilters')['SqliteTableFilters'];
const request=vi.fn(()=>{throw Error('筛选表单禁止IPC');});
beforeAll(async()=>{
 document=memoryDocument();Object.defineProperty(document,'oninput',{configurable:true,value:null});const create=document.createElement.bind(document),selected=new WeakMap<MemoryNode,boolean>();
 document.createElement=name=>{const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};if(name==='input')Object.defineProperty(node,'type',{configurable:true,get:()=>node.attributes.get('type')??'text',set:value=>node.attributes.set('type',value)});if(name==='option')Object.defineProperties(node,{value:{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)},selected:{configurable:true,get:()=>selected.get(node)??false,set:value=>{if(value)for(const sibling of node.parentNode?.querySelectorAll('option')??[])selected.set(sibling,false);selected.set(node,!!value);}}});if(name==='select')Object.defineProperties(node,{options:{get:()=>node.querySelectorAll('option')},value:{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as MemoryNode&{selected?:boolean}).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as MemoryNode&{selected?:boolean}).selected=option.value===String(value);}}});return node;};
 ({createRoot}=await import('react-dom/client'));({SqliteTableFilters:Filters}=await import('../../src/renderer/components/SqliteTableFilters'));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.textContent='';delete(window as unknown as{dbark?:unknown}).dbark;request.mockClear();});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
function control(label: string) { const node = document.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React端口'); return Reflect.get(node, key); }
async function change(label: string, value: string | boolean) { await act(async () => props(control(label)).onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } })); }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
/** 真实React受控表单，父端口仅保留草稿；外部IPC端口直接抛错，不冒称原生验收。 */
async function mount(initial?: SqliteFilterDraft[]) {
  Object.assign(window, { dbark: { invoke: request } });
  const state = { current: true, throws: false, disabled: false }, changed = vi.fn(), modeChanged = vi.fn();
  let snapshot = initial ?? [{ id: 'a', column: 'id', operator: 'eq', kind: 'integer', value: '9223372036854775807' }, { id: 'b', column: 'memo', operator: 'contains', kind: 'text', value: '中文\0🚢' }] satisfies SqliteFilterDraft[], sequence = 0;
  const current = () => { if (state.throws) throw Error('准确目标异常'); return state.current; };
  function Harness() {
    const [filters, setFilters] = useState<SqliteFilterDraft[]>(snapshot), [mode, setMode] = useState<'and' | 'or'>('and'); snapshot = filters;
    const onFilters: ComponentProps<typeof Filters>['onFilters'] = update => { changed(); setFilters(update); };
    return <Filters names={['id', 'memo']} filters={filters} mode={mode} current={current} disabled={state.disabled} id={() => 'new-' + ++sequence} onFilters={onFilters} onMode={value => { modeChanged(value); setMode(value); }}/>;
  }
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as HTMLElement);
  const render = async () => act(async () => root!.render(<Harness/>)); await render();
  return { state, changed, modeChanged, render, values: () => snapshot };
}
it('缺省已启用，单条停用保完整类型/原值，修改不会重启；恢复只改变flag', async () => {
  const f = await mount(); expect(control(text.filterEnabled(1)).checked).toBe(true);
  await change(text.filterEnabled(1), false); expect(f.values()[0]).toEqual({ id: 'a', column: 'id', operator: 'eq', kind: 'integer', value: '9223372036854775807', enabled: false });
  await change(text.filterValue(1), '-9223372036854775808'); expect(f.values()[0].enabled).toBe(false);
  await change(text.filterEnabled(1), true); expect(f.values()[0]).toMatchObject({ value: '-9223372036854775808', enabled: true }); expect(request).not.toHaveBeenCalled();
});
it('全部启停保规则位置及值，新增缺省启用，删除只删准确规则', async () => {
  const f = await mount(), before = f.values().map(value => ({ ...value }));
  await click(text.disableFilters); expect(f.values()).toEqual(before.map(value => ({ ...value, enabled: false }))); expect(document.body.textContent).toContain(text.enabledFilters(0, 2));
  await click(text.addFilter); expect(f.values()[2]).toMatchObject({ column: 'id', value: '' }); expect(control(text.filterEnabled(3)).checked).toBe(true);
  await click(text.enableFilters); expect(f.values().every(value => value.enabled === true)).toBe(true);
  await click(text.removeFilter(2)); expect(f.values().map(value => value.id)).toEqual(['a', 'new-1']); expect(request).not.toHaveBeenCalled();
});
it('停用后NULL→比较还原值，contains仅改变种类，模式切换仅通知草稿', async () => {
  const f = await mount(); await change(text.filterEnabled(1), false); await change(text.filterOperator(1), 'isNull');
  expect(document.querySelectorAll('input').some(node => node.getAttribute('aria-label') === text.filterValue(1))).toBe(false);
  await change(text.filterOperator(1), 'eq'); expect(control(text.filterValue(1)).value).toBe('9223372036854775807');
  await change(text.filterOperator(1), 'contains'); expect(f.values()[0]).toMatchObject({ kind: 'text', enabled: false, value: '9223372036854775807' });
  await change(text.mode, 'or'); expect(f.modeChanged).toHaveBeenCalledExactlyOnceWith('or'); expect(request).not.toHaveBeenCalled();
});
it('同一帧内函数式编辑合并，不因启停或第二字段事件覆盖前一个值', async () => {
  const f = await mount(), toggle = props(control(text.filterEnabled(1))).onChange, value = props(control(text.filterValue(1))).onChange;
  await act(async () => { toggle({ target: { checked: false } }); value({ target: { value: '9007199254740993' } }); });
  expect(f.values()[0]).toMatchObject({ enabled: false, value: '9007199254740993' });
});
it.each(sqliteTextFilterOperators)('%s切换强制文本且保留原值和停用状态，禁用其它类型，不发送IPC', async operator => {
  const f = await mount(); await change(text.filterEnabled(1), false); await change(text.filterOperator(1), operator);
  expect(f.values()[0]).toMatchObject({ operator, kind: 'text', value: '9223372036854775807', enabled: false });
  expect(control(text.filterKind(1)).querySelectorAll('option').filter(node => node.disabled).map(node => node.value)).toEqual(['integer', 'real', 'blob']);
  expect(document.body.textContent).toContain(text.textMatchHint); expect(request).not.toHaveBeenCalled();
});
it.each(['disabled', 'inactive', 'throws', 'unmount', 'old-render'] as const)('%s使旧事件拒绝，不能污染后继草稿或调用IPC', async mode => {
  const f = await mount(), toggle = props(control(text.filterEnabled(1))).onChange, add = props(button(text.addFilter)).onClick, all = props(button(text.disableFilters)).onClick;
  if (mode === 'disabled') { f.state.disabled = true; await f.render(); }
  if (mode === 'inactive') f.state.current = false;
  if (mode === 'throws') f.state.throws = true;
  if (mode === 'unmount') { await act(async () => root!.unmount()); root = undefined; }
  if (mode === 'old-render') await change(text.filterValue(1), '新的准确值');
  const previous = f.changed.mock.calls.length, before = f.values();
  await act(async () => { toggle({ target: { checked: false } }); add(); all(); });
  expect(f.changed).toHaveBeenCalledTimes(previous); expect(f.values()).toBe(before); expect(request).not.toHaveBeenCalled();
});
it('32条停用规则仍占添加上限，旧添加回调不能超预算', async () => {
  const f = await mount(Array.from({ length: 32 }, (_, i) => ({ id: String(i), column: 'id', operator: 'isNull', kind: 'text', value: '', enabled: false })));
  expect(button(text.addFilter).disabled).toBe(true); await act(async () => props(button(text.addFilter)).onClick()); expect(f.values()).toHaveLength(32);
});
it('空组两个启停按钮均禁用，添加新条件仍可用', async () => {
  const f = await mount([]); expect(button(text.enableFilters).disabled).toBe(true); expect(button(text.disableFilters).disabled).toBe(true);
  await click(text.addFilter); expect(f.values()).toHaveLength(1); expect(control(text.filterEnabled(1)).checked).toBe(true);
});
it.each(['between', 'notBetween'] as const)('%s两个边界保留原文，启停与切换普通比较不丢第二值，不自动读取', async operator => {
  const f = await mount(); await change(text.filterOperator(1), operator); expect(control(text.filterSecondValue(1)).value).toBe('');
  await change(text.filterSecondValue(1), '-9223372036854775808'); await change(text.filterEnabled(1), false);
  expect(f.values()[0]).toMatchObject({ operator, value: '9223372036854775807', secondValue: '-9223372036854775808', enabled: false });
  const oldSecond = props(control(text.filterSecondValue(1))).onChange; await change(text.filterOperator(1), 'eq');
  expect(document.querySelectorAll('input').some(node => node.getAttribute('aria-label') === text.filterSecondValue(1))).toBe(false);
  await change(text.filterOperator(1), operator); await act(async () => oldSecond({ target: { value: '旧回调污染' } }));
  expect(control(text.filterSecondValue(1)).value).toBe('-9223372036854775808'); expect(f.values()[0].enabled).toBe(false); expect(request).not.toHaveBeenCalled();
});
it('同帧连续编辑两个边界都保留，文本空界和NULL切换不被自动修正', async () => {
  const f = await mount(); await change(text.filterOperator(1), 'between');
  const first = props(control(text.filterValue(1))).onChange, second = props(control(text.filterSecondValue(1))).onChange;
  await act(async () => { first({ target: { value: '9007199254740993' } }); second({ target: { value: '9223372036854775807' } }); });
  expect(f.values()[0]).toMatchObject({ value: '9007199254740993', secondValue: '9223372036854775807' });
  await change(text.filterKind(1), 'text'); await change(text.filterSecondValue(1), ''); await change(text.filterOperator(1), 'isNull'); await change(text.filterOperator(1), 'between');
  expect(f.values()[0]).toMatchObject({ kind: 'text', value: '9007199254740993', secondValue: '' }); expect(request).not.toHaveBeenCalled();
});
it.each(['in', 'notIn'] as const)('%s列表沿原值初始化，增删修改保精确值，停用及切换普通比较不丢列表', async operator => {
  const f = await mount(); await change(text.filterOperator(1), operator); await click(text.addListValue(1)); await change(text.listValue(1, 2), '-9223372036854775808'); await change(text.filterEnabled(1), false);
  expect(f.values()[0]).toMatchObject({ values: ['9223372036854775807', '-9223372036854775808'], enabled: false });
  const oldSecond = props(control(text.listValue(1, 2))).onChange; await click(text.removeListValue(1, 1));
  expect(f.values()[0]).toMatchObject({ values: ['-9223372036854775808'], value: '-9223372036854775808', enabled: false });
  await act(async () => oldSecond({ target: { value: '旧位置污染' } })); await change(text.filterOperator(1), 'eq'); await change(text.filterOperator(1), operator);
  expect(f.values()[0].values).toEqual(['-9223372036854775808']); expect(request).not.toHaveBeenCalled();
});
it('同帧不同列表项输入合并，先复制事件值，不被随后DOM值污染', async () => {
  const f = await mount(); await change(text.filterOperator(1), 'in'); await click(text.addListValue(1));
  const first = props(control(text.filterValue(1))).onChange, second = props(control(text.listValue(1, 2))).onChange, event = { target: { value: '1' } };
  await act(async () => { first(event); event.target.value = '不应进入草稿'; second({ target: { value: '2' } }); });
  expect(f.values()[0].values).toEqual(['1', '2']); expect(request).not.toHaveBeenCalled();
});
it('列表128项禁止再添加，单项禁止删除为空，二进制列表可明确选择', async () => {
  const f = await mount([{ id: 'list', column: 'memo', operator: 'in', kind: 'blob', value: '00ff', values: Array.from({ length: 128 }, () => '00ff') }]);
  expect(button(text.addListValue(1)).disabled).toBe(true); await act(async () => props(button(text.addListValue(1))).onClick()); expect(f.values()[0].values).toHaveLength(128);
  expect(control(text.filterKind(1)).querySelectorAll('option').find(node => node.value === 'blob')?.disabled).toBe(false);
});
it('单项列表不能通过旧删除端口变空，取消启用后编辑不隐式恢复启用', async () => {
  const f = await mount(); await change(text.filterOperator(1), 'in'); expect(button(text.removeListValue(1, 1)).disabled).toBe(true);
  await act(async () => props(button(text.removeListValue(1, 1))).onClick()); expect(f.values()[0].values).toHaveLength(1);
  await change(text.filterEnabled(1), false); await change(text.filterValue(1), '2'); expect(f.values()[0]).toMatchObject({ enabled: false, values: ['2'] });
});
