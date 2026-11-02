import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { TableForeignKeyJoinServices } from '../../src/renderer/components/TableForeignKeyJoinDialog';
import { TableForeignKeyJoinIntent } from '../../src/renderer/tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { tableForeignKeyJoinFilterZh as filterText } from '../../src/renderer/locales/tableForeignKeyJoinFilter.zh-CN';
import { tableFilterGroupsZh as groupText } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

const grid = vi.hoisted(() => ({ props: null as any }));
vi.mock('react-data-grid', async () => { const react = await import('react'); return { SelectColumn: { key: 'select-row' }, DataGrid(props: any) { grid.props = props; react.useImperativeHandle(props.ref, () => ({ setActivePosition() {}, scrollToCell() {} }), []); return react.createElement('div', { role: 'grid' }); } }; });
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: () => null }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableForeignKeyJoinDialog')['TableForeignKeyJoinDialog'], official: TableForeignKeyJoinServices, TableTab: typeof import('../../src/renderer/components/TableTab')['TableTab'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let restoreNavigationMenuPort = () => {};
beforeAll(async () => {
  document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    // 只补浏览器受控select和disabled属性，不替换组件选择或异步生命周期。
    if (name === 'option') { Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = Boolean(value); if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableForeignKeyJoinDialog: Dialog, tableForeignKeyJoinServices: official } = await import('../../src/renderer/components/TableForeignKeyJoinDialog')); ({ TableTab } = await import('../../src/renderer/components/TableTab')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
beforeEach(() => { (window as any).dbark = { invoke: vi.fn(async () => undefined), onTask: () => () => {} }; });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flush(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { restoreNavigationMenuPort(); for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 合成目录只用于组件交互，既不连接数据库，也不把RAM结果当作实际SQL执行。 */
function tables() {
  const table = (name: string, columns: string[]): TableInfo => ({ database: 'db', name, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], columns: columns.map(name => ({ name, type: 'bigint', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })) });
  const child = table('child', ['id', 'parent_id']), parent = table('parent', ['id', 'note']);
  child.foreignKeys = ['fk', 'fk_other'].map(name => ({ name, columns: ['parent_id'], referencedDatabase: 'db', referencedTable: name === 'fk' ? 'parent' : 'other', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }));
  return { child, parent };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function button(label: string) { const node = navigationMenuRamButton(document.body, label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function select(label: string, value: string) { const node = document.body.querySelectorAll('select').find(node => node.getAttribute('aria-label') === label)!; expect(node).toBeDefined(); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function toggle(label: string) { const node = document.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === label)!; expect(node).toBeDefined(); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
function sql() { return document.body.querySelectorAll('section').find(node => node.getAttribute('aria-label') === text.preview)?.textContent ?? ''; }
/** 原React受控输入事件用于文本上限测试，不替换组件状态或生成器。 */
async function limitInput(value: string) { const node=document.body.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===text.resultLimit)!;expect(node).toBeDefined();expect(node.disabled).toBe(false);const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!;await act(async()=>{(node as any)[key].onChange({target:{value}});}); }
/** 条件输入走真实React端口，完整文本留在受控状态，不手改预览或store。 */
function filterControl(label:string){const node=document.body.querySelector('[aria-label="'+label+'"]');expect(node,label).not.toBeNull();return node!;}
async function filterInput(label:string,value:string){const node=filterControl(label);expect(node.disabled).toBe(false);const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!;await act(async()=>(node as any)[key].onChange({target:{value}}));}
async function mount(options: { read?: TableForeignKeyJoinServices['read']; cancel?: TableForeignKeyJoinServices['cancel']; strict?: boolean; width?: number } = {}) {
  const { child, parent } = tables(), scope = {};
  if (options.width) for (const table of [child, parent]) for (let index = 0; index < options.width; index++) table.columns.push({ ...table.columns[0], name: 'wide_' + index });
  const intent = new TableForeignKeyJoinIntent(child, 'connection', 43, [scope], () => true);
  const read = vi.fn<TableForeignKeyJoinServices['read']>(options.read ?? (async target => target.table === 'child' ? child : { ...parent, name: target.table }));
  const cancel = vi.fn<TableForeignKeyJoinServices['cancel']>(options.cancel ?? (async () => undefined)), close = vi.fn(), activity = vi.fn(), opened = vi.fn(), cleanup = vi.fn(), services = { read, cancel };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const view = <Dialog intent={intent} services={services} onClose={close} onActivity={activity} onCleanupError={cleanup} onOpen={preview => { opened(preview); intent.consume(preview); return true; }}/>;
  await act(async () => root!.render(options.strict ? <React.StrictMode>{view}</React.StrictMode> : view));
  return { child, parent, scope, intent, read, cancel, close, activity, opened, cleanup };
}
/** 三条不同来源的有效条件便于验证真实分组编辑，不直接改选择或SQL状态。 */
async function seedGroups() { await click(text.preview); for (let i=1;i<=3;i++) { await click(filterText.add); if(i===2)await select(filterText.side(i),'parent'); await filterInput(filterText.value(i),String(i)); } }
/** 所属组按真实可见名称选择，不猜组件内部节点ID。 */
async function moveJoinCondition(position:number,path:string) { const node=filterControl(groupText.destination(position)),option=node.querySelectorAll('option').find(value=>value.textContent===groupText.group(path));expect(option).toBeDefined();await select(groupText.destination(position),option!.value); }
/** 获取真实事件闭包，只用于旧渲染/重复应用反例，不改组件实现。 */
function joinReactProps(node:MemoryNode) { const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!;return(node as any)[key]; }
it('JOIN分组独占本地草稿，标清双方同名字段，应用后才恢复独立打开且零预执行',async()=>{
  const f=await mount();await seedGroups();const before=sql(),oldOpen=joinReactProps(button(text.open)).onClick,oldValue=joinReactProps(filterControl(filterText.value(1))).onChange;
  await click(filterText.groups);expect(sql()).toBe('');expect(button(text.open).disabled).toBe(true);expect(button(text.preview).disabled).toBe(true);expect(filterControl(filterText.value(1)).disabled).toBe(true);expect(document.body.textContent).toContain('子表 c · id');expect(document.body.textContent).toContain('父表 p · id');
  await act(async()=>{oldOpen();oldValue({target:{value:'999'}});});expect(f.read).toHaveBeenCalledOnce();expect(f.opened).not.toHaveBeenCalled();
  await click(groupText.addGroup());await moveJoinCondition(2,'1');await moveJoinCondition(3,'1');expect(f.read).toHaveBeenCalledOnce();await click(groupText.apply);expect(sql()).not.toBe(before);expect(sql()).toContain(' OR ');expect(filterControl(filterText.value(1)).value).toBe('1');
  await click(text.open);expect(f.read).toHaveBeenCalledTimes(3);expect(f.opened.mock.calls[0][0].options.filterGroup).toEqual({mode:'all',children:[0,{mode:'any',children:[1,2]}]});
});
it('取消分组保原SQL，旧Apply闭包不能应用后来重新打开的草稿',async()=>{
  const f=await mount();await seedGroups();const before=sql();await click(filterText.groups);const oldApply=joinReactProps(button(groupText.apply)).onClick;await click(groupText.addGroup());await click(groupText.cancel);expect(sql()).toBe(before);await click(filterText.groups);await act(async()=>oldApply());expect(sql()).toBe('');expect(filterControl(groupText.title)).toBeDefined();await click(groupText.cancel);expect(sql()).toBe(before);expect(f.read).toHaveBeenCalledOnce();
});
it('删除重编号与无效值修正不丢分组，新增条件置根，同FK重读保留，明确平铺才移除括号',async()=>{
  const f=await mount();await seedGroups();await click(filterText.groups);await click(groupText.addGroup());await moveJoinCondition(2,'1');await moveJoinCondition(3,'1');await click(groupText.apply);const grouped=sql();await click(text.preview);expect(sql()).toBe(grouped);await filterInput(filterText.value(1),'1e20');expect(sql()).toBe('');expect(filterControl(filterText.structure).textContent).toContain('(条件2 或 条件3)');await filterInput(filterText.value(1),'1');expect(sql()).toBe(grouped);
  await click(filterText.remove(2));expect(filterControl(filterText.value(2)).value).toBe('3');expect(filterControl(filterText.structure).textContent).toContain('(条件2)');await click(filterText.add);await filterInput(filterText.value(3),'4');expect(filterControl(filterText.structure).textContent).toContain('且 条件3');await click(filterText.flat);expect(document.body.querySelector('[aria-label="'+filterText.structure+'"]')).toBeNull();expect(sql()).not.toContain(' OR ');expect(f.read).toHaveBeenCalledTimes(2);
});
it('分组根模式改变保留子组，停用不删除映射；切FK或全部清空才恢复无条件',async()=>{
  const f=await mount();await seedGroups();await click(filterText.groups);await click(groupText.addGroup());await moveJoinCondition(2,'1');await moveJoinCondition(3,'1');await click(groupText.apply);await select(filterText.mode,'any');await toggle(filterText.enabled(2));expect(filterControl(filterText.structure).textContent).toContain('(条件1 或 (条件2 或 条件3))');expect(sql().split('\nWHERE ')[1]).not.toContain('p.`id` =');await toggle(filterText.enabled(2));expect(sql().split('\nWHERE ')[1]).toContain('p.`id` =');await select(text.fk,'fk_other');await click(text.preview);expect(sql()).not.toContain('WHERE');expect(document.body.querySelector('[aria-label="'+filterText.structure+'"]')).toBeNull();await click(filterText.add);await filterInput(filterText.value(1),'1');await click(filterText.removeAll);expect(sql()).not.toContain('WHERE');expect(f.opened).not.toHaveBeenCalled();
});
it('分组来源失效后不能Apply或打开，取消仅关闭局部草稿，不发请求',async()=>{
  const f=await mount();await seedGroups();await click(filterText.groups);await act(async()=>f.intent.invalidate());expect(button(groupText.apply).disabled).toBe(true);expect(document.body.textContent).toContain(filterText.groupStale);await click(groupText.cancel);expect(f.opened).not.toHaveBeenCalled();expect(f.read).toHaveBeenCalledOnce();expect(button(text.open).disabled).toBe(true);
});
it('Modal捕获层让分组IME及Escape留在局部，CtrlEnter只应用草稿；关闭后恢复原Escape',async()=>{
  const f=await mount();await seedGroups();const before=sql();await click(filterText.groups);let panel=filterControl(groupText.title);await act(async()=>joinReactProps(panel).onCompositionStart());
  const key=async(name:string,extra:Record<string,unknown>={})=>{const target=filterControl(groupText.groupMode()),event=Object.assign(new MemoryEvent('keydown'),{key:name,...extra});await act(async()=>target.dispatchEvent(event));};
  await key('Escape');expect(f.close).not.toHaveBeenCalled();expect(sql()).toBe('');await act(async()=>joinReactProps(filterControl(groupText.title)).onCompositionEnd());await key('Escape');expect(sql()).toBe(before);expect(f.close).not.toHaveBeenCalled();
  await click(filterText.groups);await key('Enter',{ctrlKey:true,keyCode:13});expect(sql()).toBe(before);expect(document.body.querySelector('[aria-label="'+filterText.structure+'"]')).not.toBeNull();expect(f.read).toHaveBeenCalledOnce();expect(f.opened).not.toHaveBeenCalled();
  const escape=Object.assign(new MemoryEvent('keydown'),{key:'Escape'});await act(async()=>button(text.close).dispatchEvent(escape));expect(f.close).toHaveBeenCalledOnce();
});
it('JOIN未完成条件阻止旧查询打开，精确值、父子同名列及AND/OR只改本地预览',async()=>{const f=await mount();await click(text.preview);await click(filterText.add);expect(button(text.open).disabled).toBe(true);expect(sql()).toBe('');await filterInput(filterText.value(1),'9007199254740993');await click(filterText.add);await select(filterText.side(2),'parent');await filterInput(filterText.value(2),'9007199254740994');await select(filterText.mode,'any');expect(sql()).toContain(' OR ');expect(sql()).toContain('c.`id` =');expect(sql()).toContain('p.`id` =');expect(f.read).toHaveBeenCalledOnce();await click(text.open);expect(f.read).toHaveBeenCalledTimes(3);expect(f.opened.mock.calls[0][0].options).toMatchObject({filterMode:'any',filters:[{side:'child',column:'id',operator:'=',value:'9007199254740993'},{side:'parent',column:'id',operator:'=',value:'9007199254740994'}]});});
it('运算符切换保留单值、区间和集合输入，NULL仅传无值判断',async()=>{const f=await mount();await click(text.preview);await click(filterText.add);await filterInput(filterText.value(1),'12');await select(filterText.operator(1),'BETWEEN');await filterInput(filterText.upper(1),'14');await select(filterText.operator(1),'IN');await filterInput(filterText.values(1),'1\n2');await select(filterText.operator(1),'BETWEEN');expect(filterControl(filterText.value(1)).value).toBe('12');expect(filterControl(filterText.upper(1)).value).toBe('14');await select(filterText.operator(1),'IS NULL');expect(sql()).toContain('c.`id` IS NULL');await click(text.open);expect(f.opened.mock.calls[0][0].options.filters).toEqual([{side:'child',column:'id',operator:'IS NULL'}]);});
it('停用显式条件去掉谓词，清空恢复原字节；同FK重读保留，切FK明确清除',async()=>{const f=await mount();await click(text.preview);const old=sql();await click(filterText.add);await filterInput(filterText.value(1),'123');const selected=sql();await click(text.preview);expect(sql()).toBe(selected);await toggle(filterText.enabled(1));expect(sql()).toBe(old);await toggle(filterText.enabled(1));expect(sql()).toBe(selected);await select(text.fk,'fk_other');await click(text.preview);expect(sql()).not.toContain('WHERE');expect(document.body.textContent).toContain(filterText.empty);expect(f.opened).not.toHaveBeenCalled();});
it('条件移除后原输入闭包不能改变移位的下一条，新输入仍正确',async()=>{const f=await mount();await click(text.preview);await click(filterText.add);await filterInput(filterText.value(1),'1');const node=filterControl(filterText.value(1)),key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!,old=(node as any)[key].onChange;await click(filterText.add);await filterInput(filterText.value(2),'2');await click(filterText.remove(1));await act(async()=>old({target:{value:'999'}}));expect(filterControl(filterText.value(1)).value).toBe('2');await filterInput(filterText.value(1),'3');expect(sql()).toContain("X'33'");expect(f.read).toHaveBeenCalledOnce();});
it('正在双表核对时不能用旧条件输入替换原预览，来源失效也不能打开',async()=>{const f=await mount();await click(text.preview);await click(filterText.add);await filterInput(filterText.value(1),'7');const before=sql(),node=filterControl(filterText.value(1)),key=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!,old=(node as any)[key].onChange,pending=deferred<TableInfo>();f.read.mockImplementationOnce(()=>pending.promise);await click(text.open);await act(async()=>old({target:{value:'8'}}));await act(async()=>pending.resolve(f.child));expect(f.opened).toHaveBeenCalledOnce();expect(f.opened.mock.calls[0][0].sql).toBe(before);});
it('保留值草稿共用一百万字符预算，超量新输入不覆盖原稿',async()=>{const f=await mount();await click(text.preview);await click(filterText.add);await select(filterText.operator(1),'IN');await filterInput(filterText.values(1),'1'.repeat(600000));await click(filterText.add);await select(filterText.operator(2),'IN');await filterInput(filterText.values(2),'2'.repeat(600000));expect(filterControl(filterText.values(1)).value).toHaveLength(600000);expect(filterControl(filterText.values(2)).value).toBe('');expect(document.body.textContent).toContain(filterText.draftBudget);expect(f.opened).not.toHaveBeenCalled();expect(button(text.open).disabled).toBe(true);});
it('七位超限上限保留原文，不因maxlength剪成另一个合法上限',async()=>{await mount();await click(text.preview);await limitInput('1000000');expect(filterControl(text.resultLimit).value).toBe('1000000');expect(button(text.open).disabled).toBe(true);expect(sql()).toBe('');});
it('双侧同名列排序、NULL位置、优先级和上限只改草稿，打开仍重核双表', async () => {
  const f=await mount();await click(text.preview);await click(text.sortAdd);await select(text.sortSide(1),'parent');await select(text.sortDirection(1),'DESC');await select(text.sortNulls(1),'LAST');await click(text.sortAdd);await click(text.sortEarlier(2));await limitInput('2');expect(sql()).toContain('ORDER BY c.`id` ASC, (p.`id` IS NULL) ASC, p.`id` DESC\nLIMIT 2;');expect(f.read).toHaveBeenCalledOnce();expect(f.opened).not.toHaveBeenCalled();await click(text.open);expect(f.read).toHaveBeenCalledTimes(3);expect(f.opened.mock.calls[0][0].options).toMatchObject({limit:2,sort:[{side:'child',column:'id',direction:'ASC'},{side:'parent',column:'id',direction:'DESC',nulls:'LAST'}]});
});
it('无效上限原文保留并撤销旧可打开预览，修正后不自动读取或执行', async () => {
  const f=await mount();await click(text.preview);await limitInput('');expect(sql()).toBe('');expect(button(text.open).disabled).toBe(true);expect(document.body.textContent).toContain(text.limitInvalid);await limitInput('1e2');expect(button(text.open).disabled).toBe(true);await limitInput('100000');expect(sql()).toContain('LIMIT 100000;');expect(f.read).toHaveBeenCalledOnce();expect(f.opened).not.toHaveBeenCalled();await limitInput('43');expect(button(text.open).disabled).toBe(false);
});
it('排序重读保留选择和优先级，切换外键明确清空排序而保留自定义上限', async () => {
  const f=await mount();await click(text.preview);await click(text.sortAdd);await select(text.sortSide(1),'parent');await select(text.sortColumn(1),'note');await limitInput('7');const before=sql();await click(text.preview);expect(sql()).toBe(before);await select(text.fk,'fk_other');expect(sql()).toBe('');await click(text.preview);expect(sql()).not.toContain('ORDER BY');expect(sql()).toContain('LIMIT 7;');expect(f.opened).not.toHaveBeenCalled();
});
it('排序移除与清空不遗留NULL分桶或隐式主键，旧条目按钮不能作用于移位后的项', async () => {
  const f=await mount();await click(text.preview);await click(text.sortAdd);await click(text.sortAdd);const old=button(text.sortRemove(1));const key=Object.keys(old).find(key=>key.startsWith('__reactProps$'))!,handler=(old as any)[key].onClick;await click(text.sortEarlier(2));await act(async()=>handler());expect(sql()).toContain('ORDER BY c.`parent_id` ASC, c.`id` ASC');await click(text.sortRemove(1));expect(sql()).toContain('ORDER BY c.`id` ASC');await select(text.sortNulls(1),'FIRST');await select(text.sortNulls(1),'DEFAULT');expect(sql()).not.toContain('IS NULL');await click(text.sortClear);expect(sql()).not.toContain('ORDER BY');expect(f.read).toHaveBeenCalledOnce();
});
it('正在打开时新排序与上限不能改变原回执，原读取完成后仅打开原草稿', async () => {
  const f=await mount();await click(text.preview);await click(text.sortAdd);await limitInput('4');const before=sql(),pending=deferred<TableInfo>();f.read.mockImplementationOnce(()=>pending.promise);await click(text.open);expect(button(text.sortAdd).disabled).toBe(true);const node=document.body.querySelectorAll('input').find(node=>node.getAttribute('aria-label')===text.resultLimit)!;expect(node.disabled).toBe(true);await act(async()=>pending.resolve(f.child));expect(f.opened).toHaveBeenCalledOnce();expect(f.opened.mock.calls[0][0].sql).toBe(before);expect(f.opened.mock.calls[0][0].options.limit).toBe(4);
});
it('显式预览才读父目录，默认LEFT和两侧全选，精简字段不丢ON且打开前重核双表', async () => {
  const f = await mount(); expect(f.read).not.toHaveBeenCalled(); await click(text.preview); expect(f.read).toHaveBeenCalledOnce();
  expect(sql()).toContain('LEFT JOIN'); expect(sql()).toContain('c.`parent_id` = p.`id`'); expect(sql()).toContain('p.`note`'); expect(sql()).toContain('LIMIT 43;');
  await toggle(text.parentSelect('note')); expect(sql()).not.toContain('p.`note`'); expect(f.read).toHaveBeenCalledOnce(); await click(text.open);
  expect(f.read.mock.calls.map(([input]) => [input.connectionId, input.table])).toEqual([['connection', 'parent'], ['connection', 'child'], ['connection', 'parent']]);
  expect(new Set(f.read.mock.calls.map(([input]) => input.taskId)).size).toBe(3); expect(f.opened).toHaveBeenCalledOnce(); expect(button(text.open).disabled).toBe(true); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1, 1, -1]);
});
it('同一FK重读相同父结构保留精简父字段原顺序及空侧，不静默重新全选', async () => {
  const f = await mount(); await click(text.preview); await toggle(text.parentSelect('id')); const narrowed = sql();
  await click(text.preview); expect(sql()).toBe(narrowed); expect(sql()).toContain('p.`note` AS'); expect(sql()).not.toContain('p.`id` AS');
  await toggle(text.parentSelect('id')); const reordered = sql(); expect(reordered.indexOf('p.`note` AS')).toBeLessThan(reordered.indexOf('p.`id` AS'));
  await click(text.preview); expect(sql()).toBe(reordered);
  await toggle(text.parentSelect('note')); await toggle(text.parentSelect('id')); const emptyParent = sql(); expect(emptyParent).not.toMatch(/p\.`(?:id|note)` AS/);
  await click(text.preview); expect(sql()).toBe(emptyParent); expect(button(text.open).disabled).toBe(false); expect(f.opened).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledTimes(4);
});
it('同一FK重读父相关结构变化永久拒绝旧预览，不能重签SQL或打开查询', async () => {
  const f = await mount(); await click(text.preview); await toggle(text.parentSelect('note'));
  f.read.mockResolvedValue({ ...f.parent, columns: f.parent.columns.map(column => ({ ...column, type: 'varchar(80)' })) }); await click(text.preview);
  expect(f.intent.current()).toBe(false); expect(document.body.textContent).toContain(text.stale); expect(sql()).toBe(''); expect(button(text.open).disabled).toBe(true); expect(button(text.preview).disabled).toBe(true); expect(f.opened).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1, 1, -1]);
});
it('父表拒读保留真实原错，错目标不生成预览且不打开查询', async () => {
  const f = await mount({ read: async () => { throw Error('父表SELECT权限不足的原错误'); } }); await click(text.preview); expect(document.body.textContent).toContain('父表SELECT权限不足的原错误'); expect(sql()).toBe(''); expect(f.opened).not.toHaveBeenCalled();
  f.read.mockResolvedValue({ ...f.parent, name: 'wrong' }); await click(text.preview); expect(document.body.textContent).toContain(text.target); expect(f.opened).not.toHaveBeenCalled();
});
it('关闭原读取只取消一次，ACK先返回也不释放，原读取settle后才关闭', async () => {
  const pending = deferred<TableInfo>(), ack = deferred<unknown>(), f = await mount({ read: () => pending.promise, cancel: () => ack.promise });
  await click(text.preview); await click(text.close); await act(async () => { ack.resolve(undefined); });
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.read.mock.calls[0][0].taskId); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1]); expect(document.body.textContent).toContain(text.closing);
  await act(async () => { pending.resolve(f.parent); }); expect(f.close).toHaveBeenCalledOnce(); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1]); expect(f.opened).not.toHaveBeenCalled(); expect(sql()).toBe('');
});
it('原读取先settle但取消ACK未返仍持占用，切FK不并发且旧父表不发布', async () => {
  const pending = deferred<TableInfo>(), ack = deferred<unknown>(), f = await mount({ read: () => pending.promise, cancel: () => ack.promise });
  await click(text.preview); await select(text.fk, 'fk_other'); await act(async () => { pending.resolve(f.parent); });
  expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1]); expect(f.read).toHaveBeenCalledOnce(); expect(button(text.preview).disabled).toBe(true); expect(sql()).toBe('');
  await act(async () => { ack.resolve(undefined); }); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1]);
  f.read.mockResolvedValue({ ...f.parent, name: 'other' }); await click(text.preview); expect(sql()).toContain('`db`.`other`'); expect(f.cancel).toHaveBeenCalledOnce();
});
it('fresh结构变化拒绝旧SQL并保留窗口，来源ABA也不复活', async () => {
  const f = await mount(); await click(text.preview); f.read.mockResolvedValue({ ...f.child, columns: f.child.columns.map(column => ({ ...column, type: 'varchar(50)' })) }); await click(text.open);
  expect(f.opened).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale); expect(f.read).toHaveBeenCalledTimes(2);
  f.intent.observe([{}]); f.intent.observe([f.scope]); expect(f.intent.current()).toBe(false);
});
it('StrictMode初次清理不毒死原意图，显式父读仍单次而没有自动并发请求', async () => {
  const f = await mount({ strict: true }); expect(f.intent.current()).toBe(true); expect(f.read).not.toHaveBeenCalled(); await click(text.preview); expect(f.read).toHaveBeenCalledOnce(); expect(sql()).toContain('LEFT JOIN'); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1]);
});
it('宽表默认全选超输出预算仍可分页精简，每侧只挂50字段且清本侧不改关系', async () => {
  const f = await mount({ width: 600 }); await click(text.preview); expect(document.body.textContent).toContain(text.budget); expect(button(text.open).disabled).toBe(true);
  expect(document.body.querySelectorAll('input').filter(node => node.type === 'checkbox')).toHaveLength(100);
  const fieldset = document.body.querySelectorAll('fieldset').find(node => node.querySelector('legend')?.textContent === text.parentFields)!, clear = fieldset.querySelectorAll('button').find(node => node.textContent === text.clearFields)!;
  await act(async () => { clear.dispatchEvent(new MemoryEvent('click')); }); expect(sql()).toContain('c.`parent_id` = p.`id`'); expect(sql()).not.toContain('p.`note` AS'); expect(button(text.open).disabled).toBe(false); expect(f.read).toHaveBeenCalledOnce();
});
it('正式服务只发送带独立taskId的metadata.table及原query.cancel', async () => {
  const { parent } = tables(), invoke = vi.fn(async () => parent); (window as any).dbark.invoke = invoke;
  await official.read({ connectionId: 'connection', database: 'db', table: 'parent', taskId: 'unique-read' }); await official.cancel('unique-read');
  expect(invoke.mock.calls).toEqual([['metadata.table', { connectionId: 'connection', database: 'db', table: 'parent', taskId: 'unique-read' }], ['query.cancel', { taskId: 'unique-read' }]]);
});
/** 网格只替换渲染端口，来源草稿、真实store忙碌世代和TableTab回调均执行生产代码。 */
async function mountTable(parentRead?: TableForeignKeyJoinServices['read']) {
  const { child, parent } = tables(), calls: string[] = [], opened: any[] = [];
  (window as any).dbark = { onTask: () => () => {}, invoke: async (command: string, input: any) => {
    calls.push(command); if (['settings.save', 'connections.open', 'query.cancel'].includes(command)) return; if (command === 'table.preferences.get') return null;
    if (command === 'metadata.table') return input.table === 'child' ? child : parentRead ? parentRead(input) : parent;
    if (command === 'table.page') return { page: 1, pageSize: 50, hasMore: false, rows: [{ id: '1', parent_id: '2' }], columns: child.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(child) };
    throw Error('禁止额外RAM命令：' + command);
  } };
  const tab = { id: 'source', kind: 'table' as const, connectionId: 'connection', database: 'db', table: 'child', title: 'child' };
  store.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 43, pageSize: 50, activeTabId: tab.id, tabs: [tab] }, connections: [{ id: 'connection', name: '离线', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], connectionVersions: { connection: 1 }, activeJobs: {}, dirtyTabs: {}, tableLayoutDrafts: {} });
  const noop = () => {}, host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<TableTab tab={tab} onQueryTemplateNavigation={noop} onOpenGeneratedQuery={candidate => { opened.push(candidate); store.getState().openTab(candidate); }} onDesign={noop} onTransfer={noop} onColumnPatches={noop} onIndexPatches={noop} onForeignKeyPatches={noop} onTableRename={noop} onTableAutoIncrement={noop} onTableComment={noop} onTableDefaultEncoding={noop}/>));
  return { child, parent, calls, opened };
}
it('真实TableTab自己的busy不使JOIN失效，保原草稿与页选择且只开一个独立query零执行', async () => {
  const { calls, opened } = await mountTable();
  const rows = grid.props.rows; await act(async () => { grid.props.onRowsChange(rows.map((row: any) => ({ ...row, data: { ...row.data, parent_id: '999' } }))); grid.props.onSelectedRowsChange(new Set([rows[0].id])); });
  const drafts = grid.props.rows, selected = grid.props.selectedRows;
  await click(text.entry); await click(text.preview); expect(sql()).toContain('LEFT JOIN'); expect(store.getState().activeJobs.source).toBe(false); await click(text.open);
  expect(opened).toHaveLength(1); expect(opened[0]).toMatchObject({ kind: 'query', connectionId: 'connection', database: 'db', databaseContext: { state: 'known', database: 'db' } }); expect(opened[0].sql).not.toContain('999');
  expect(grid.props.rows).toBe(drafts); expect(grid.props.selectedRows).toBe(selected); expect(store.getState().dirtyTabs.source).toBe(true); expect(store.getState().settings.tabs).toHaveLength(2); expect(calls.filter(command => command.startsWith('query.execute') || command === 'table.preview' || command === 'table.apply')).toEqual([]);
});
it('其它作业覆盖同true busy也永久撤销，原读收尾不能清除新作业占用', async () => {
  const pending = deferred<TableInfo>(), f = await mountTable(() => pending.promise); await click(text.entry); await click(text.preview); expect(store.getState().activeJobs.source).toBe(true);
  await act(async () => { store.getState().setBusy('source', true); }); expect(document.body.textContent).toContain(text.stale); expect(store.getState().activeJobs.source).toBe(true);
  await act(async () => { pending.resolve(f.parent); }); expect(store.getState().activeJobs.source).toBe(true); expect(f.opened).toHaveLength(0); expect(button(text.open).disabled).toBe(true);
  await act(async () => { store.getState().setBusy('source', false); }); expect(button(text.open).disabled).toBe(true);
});
it('真实TableTab已有100标签时在消费前拒绝打开，原表页与预览保持且零执行', async () => {
  const f = await mountTable(); await click(text.entry); await click(text.preview); const rows = grid.props.rows, preview = sql(), settings = store.getState().settings;
  const others = Array.from({ length: 99 }, (_, index) => ({ id: 'capacity-' + index, kind: 'query' as const, title: '离线占位' + index, connectionId: 'connection', database: 'db', sql: '' }));
  await act(async () => { store.getState().updateSettings({ tabs: [...settings.tabs, ...others] }); });
  expect(store.getState().settings.tabs[0]).toBe(settings.tabs[0]); expect(store.getState().settings.activeTabId).toBe('source'); await click(text.open);
  expect(document.body.textContent).toContain(text.tabs); expect(f.opened).toHaveLength(0); expect(store.getState().settings.tabs).toHaveLength(100); expect(grid.props.rows).toBe(rows); expect(sql()).toBe(preview); expect(button(text.open).disabled).toBe(false);
  expect(f.calls.filter(command => command.startsWith('query.execute') || command === 'table.preview' || command === 'table.apply')).toEqual([]);
});
it('真实store切至有效另一标签再返回仍永久撤销JOIN，迟到父读不能打开', async () => {
  const pending = deferred<TableInfo>(), f = await mountTable(() => pending.promise);
  await act(async () => { store.getState().openTab({ id: 'other-tab', kind: 'query', title: '已有离线查询', connectionId: 'connection', database: 'db', sql: '' }); store.getState().updateSettings({ activeTabId: 'source' }); });
  expect(store.getState().settings.tabs.some(tab => tab.id === 'other-tab')).toBe(true); const rows = grid.props.rows;
  await click(text.entry); await click(text.preview);
  await act(async () => { store.getState().updateSettings({ activeTabId: 'other-tab' }); store.getState().updateSettings({ activeTabId: 'source' }); });
  expect(document.body.textContent).toContain(text.stale); expect(store.getState().settings.activeTabId).toBe('source'); expect(store.getState().activeJobs.source).toBe(true);
  await act(async () => { pending.resolve(f.parent); });
  expect(f.opened).toHaveLength(0); expect(button(text.open).disabled).toBe(true); expect(sql()).toBe(''); expect(grid.props.rows).toBe(rows); expect(store.getState().activeJobs.source).toBe(false); expect(store.getState().settings.tabs).toHaveLength(2);
  expect(f.calls.filter(command => command.startsWith('query.execute') || command === 'table.preview' || command === 'table.apply')).toEqual([]);
});
