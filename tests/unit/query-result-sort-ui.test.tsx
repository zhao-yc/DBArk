import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultHistoryZh as historyText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { queryResultMemoryZh as memoryText } from '../../src/renderer/locales/queryResultMemory.zh-CN';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFindZh as findText } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryRowDetailsZh as detailsText } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultPresetsZh as presetsText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultComparisonZh as comparisonText } from '../../src/renderer/locales/queryResultComparison.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { queryResultSelectedFilterZh as selectedFilterText } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { queryResultPresetSnapshotSchema, queryResultPresetValueSchema, type QueryResultPresetSnapshot } from '../../src/shared/queryResultPresets';
const ports=vi.hoisted(()=>({grids:[] as any[],scroll:vi.fn()}));
// 仅虚拟布局/Monaco由RAM替代；真实QueryTab、选择/复制/查找/详情/导出及store均运行。
vi.mock('react-data-grid',async()=>{const {useImperativeHandle,useRef}=await import('react');return{SelectColumn:{key:'select-row'},DataGrid(props:any){const host=useRef<HTMLDivElement>(null);ports.grids.push(props);useImperativeHandle(props.ref,()=>({element:host.current,scrollToCell:ports.scroll}));return <div ref={host} role="grid"/>;}};});
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:()=>null}));
let Grid:typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'];
let QueryTab:typeof import('../../src/renderer/components/QueryTab')['QueryTab'],store:typeof import('../../src/renderer/store')['useWorkspace'],flush:typeof import('../../src/renderer/store')['flushSettings'];
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let original:QueryResult,commands:string[],exports:any[],observers:Set<Function>,events:((event:any)=>void)|undefined;
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT','MutationObserver','Element'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
/** 单选option选中时取消同级旧项；React依赖此DOM语义，普通布尔字段会留下多个选中项。 */
function installMemoryOption(node:MemoryNode):void{
  let selected=false;
  Object.defineProperty(node,'selected',{configurable:true,get:()=>selected,set:value=>{
    selected=!!value;
    if(selected&&node.parentNode?.tagName==='SELECT'&&!(node.parentNode as any).multiple)
      for(const sibling of node.parentNode.childNodes)if(sibling!==node&&sibling.tagName==='OPTION')(sibling as any).selected=false;
  }});
  Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});
}
beforeAll(async()=>{
  document=memoryDocument();(document as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout,confirm:()=>true});const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name);if(name==='input'){let kind='text';Object.defineProperty(node,'type',{configurable:true,get:()=>kind,set:value=>{kind=value;node.attributes.set('type',value);}});}if(name==='option')installMemoryOption(node);if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
  observers=new Set();(globalThis as any).Element=create('div').constructor;(globalThis as any).MutationObserver=class{constructor(private callback:Function){observers.add(callback);}observe(){}disconnect(){observers.delete(this.callback);}};
  ({createRoot}=await import('react-dom/client'));({QueryTab}=await import('../../src/renderer/components/QueryTab'));({ResultsGrid:Grid}=await import('../../src/renderer/components/ResultsGrid'));({useWorkspace:store,flushSettings:flush}=await import('../../src/renderer/store'));
});
afterEach(async()=>{vi.useRealTimers();if(root){await act(async()=>root!.unmount());root=undefined;}await flush();delete(window as any).dbark;vi.restoreAllMocks();ports.grids=[];ports.scroll.mockClear();document.body.textContent='';});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
/** 只返回本地常量；query.execute是RAM服务端口，禁止网络、DB、实际文件或剪贴板。 */
async function mount(prepare?: (result: QueryResult) => void){
  commands=[];exports=[];original={columns:[{key:'id',name:'同名',type:'LONGLONG'},{key:'value',name:'同名',type:'NEWDECIMAL'},{key:'words',name:'原文',type:'VAR_STRING'},{key:'bytes',name:'字节',type:'BLOB'}],rows:[{id:'18446744073709551615',value:'0.12345678901234567891',words:'晚行',bytes:{type:'binary',base64:'AA=='}},{id:'9007199254740993',value:'0.12345678901234567890',words:'中行',bytes:{type:'binary',base64:'AP8='}},{id:'2',value:'-0.00000000000000000001',words:'早行',bytes:{type:'binary',base64:''}}],truncated:true,elapsedMs:1,statement:'SELECT 原SQL'};
  prepare?.(original);
  (window as any).dbark={onMenu:()=>()=>{},onTask:(callback:any)=>{events=callback;return()=>{};},invoke:async(command:string,input:any)=>{commands.push(command);if(['settings.save','connections.open','sessions.close'].includes(command))return;if(command==='sessions.open')return{sessionId:'s'};if(command==='query.completionState')return{databaseKnown:true,database:null,temporaryObjects:[]};if(command==='query.execute')return{results:[original,{...original,rows:original.rows.slice().reverse()}],elapsedMs:1,transactionOpen:false};if(command==='files.choose')return{token:'ram',name:'内存文件'};if(command==='files.exportResult'){exports.push(structuredClone(input));return{rows:input.result.rows.length};}throw Error('禁止外界命令：'+command);}};
  store.setState({settings:{theme:'light',sidebarWidth:260,resultLimit:1000,pageSize:100,activeTabId:'q',tabs:[{id:'q',kind:'query',connectionId:'c',title:'查询',sql:'SELECT 原SQL',databaseContext:{state:'known',database:null}}]},connections:[{id:'c',name:'RAM',group:'',color:'',dialect:'mysql',host:'offline.invalid',port:1,user:'ram'}],connectionVersions:{c:1},activeJobs:{},dirtyTabs:{}});
  function Harness(){return store(s=>s.settings.tabs).map(tab=><QueryTab key={tab.id} tab={tab} onHistory={()=>{}}/>);}const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);await act(async()=>root!.render(<Harness/>));await click(zh.query.text010);
}
function grid(){return ports.grids.at(-1)!;}

/** 只读真实审核面板的候选输入框，不调用生成器重算测试期望。 */
function selectedFilterMembers(condition = 1): string[] {
  const values: string[] = [];
  for (let index = 1; index <= 128; index++) {
    const input = document.querySelector('[aria-label="' + filterText.member(condition, index) + '"]');
    if (!input) break;
    values.push(input.value);
  }
  return values;
}

it('勾选值筛选：显示排序后不连续勾选取准确原行，当前格仅指定列，取消保持原视图', async () => {
  await mount(); const saved = structuredClone(original); await sort();
  const before = grid().rows, rules = grid().sortColumns;
  expect(before).toEqual([original.rows[2], original.rows[1], original.rows[0]]);
  await act(async () => grid().onSelectedRowsChange(new Set([2, 0]))); await chooseFilterCell(1, 'value');
  expect(button(selectedFilterText.open).disabled).toBe(false); await click(selectedFilterText.open);
  expect(document.querySelector('[aria-label="' + filterText.column + ' 1"]')!.value).toBe('value');
  expect(document.querySelector('[aria-label="' + filterText.operator + ' 1"]')!.value).toBe('in');
  expect(selectedFilterMembers()).toEqual(['-0.00000000000000000001', '0.12345678901234567891']);
  expect(grid().rows).toBe(before); expect(grid().sortColumns).toEqual(rules);
  await click(filterText.cancel); expect(grid().rows).toBe(before); expect(grid().sortColumns).toEqual(rules);
  expect(original).toEqual(saved); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：NULL与空串、NULL字样、逗号及换行原文独立保存，重复值只列一次', async () => {
  await mount(result => {
    result.columns = [result.columns[2]];
    result.rows = [null, '', 'NULL', '带,逗号', '换\n行', ''].map(words => ({ words }));
  });
  const before = grid().rows, saved = structuredClone(original);
  await act(async () => grid().onSelectedRowsChange(new Set([5, 4, 3, 2, 1, 0]))); await chooseFilterCell(1, 'words'); await click(selectedFilterText.open);
  expect(selectedFilterMembers()).toEqual(['', 'NULL', '带,逗号', '换\n行']);
  expect(document.querySelector('[aria-label="' + filterText.mode + '"]')!.value).toBe('AND');
  expect(document.querySelector('[aria-label="' + filterText.groupMode('1') + '"]')!.value).toBe('OR');
  expect(document.querySelector('[aria-label="' + filterText.operator + ' 2"]')!.value).toBe('null');
  expect(grid().rows).toBe(before); await click(filterText.apply); expect(grid().rows).toEqual(original.rows); expect(original).toEqual(saved);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it.each(['未知', 'BLOB'] as const)('勾选值筛选：%s列全部NULL可生成独立NULL草稿，未选的非NULL不被纳入', async type => {
  await mount(result => { result.columns = [{ key: 'candidate', name: '候选', type }]; result.rows = [{ candidate: null }, { candidate: type === 'BLOB' ? { type: 'binary', base64: 'AA==' } : '未知原值' }, { candidate: null }]; });
  await act(async () => grid().onSelectedRowsChange(new Set([2, 0]))); await chooseFilterCell(1, 'candidate'); await click(selectedFilterText.open);
  expect(document.querySelector('[aria-label="' + filterText.operator + ' 1"]')!.value).toBe('null'); expect(selectedFilterMembers()).toEqual([]);
  expect(grid().rows).toBe(original.rows); await click(filterText.apply); expect(grid().rows).toEqual([original.rows[0], original.rows[2]]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：文本与二进制混合整份拒绝，不截掉字节行也不丢已接纳选择', async () => {
  await mount(result => { result.columns = [{ key: 'candidate', name: '候选', type: 'TEXT' }]; result.rows = [{ candidate: '完整原文' }, { candidate: { type: 'binary', base64: 'AP8=' } }, { candidate: null }]; });
  await act(async () => grid().onSelectedRowsChange(new Set([0, 1, 2]))); await chooseFilterCell(0, 'candidate');
  const before = grid().rows, action = button(selectedFilterText.open);
  expect(action.disabled).toBe(true); await act(async () => reactProps(action).onClick());
  expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().rows).toBe(before); expect(grid().selectedRows.size).toBe(3);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：选择变化后旧按钮不能借后来选择开草稿，新按钮仍取本次选择', async () => {
  await mount(); await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id');
  const old = reactProps(button(selectedFilterText.open)).onClick;
  await act(async () => grid().onSelectedRowsChange(new Set([1]))); await act(async () => old());
  expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().selectedRows.size).toBe(1);
  await click(selectedFilterText.open); expect(selectedFilterMembers()).toEqual(['9007199254740993']); await click(filterText.cancel);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：当前列变化后旧按钮拒绝，新草稿使用后来列而非旧列或当前格值', async () => {
  await mount(); await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id');
  const old = reactProps(button(selectedFilterText.open)).onClick; await chooseFilterCell(1, 'words'); await act(async () => old());
  expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().selectedRows.size).toBe(2);
  await click(selectedFilterText.open); expect(document.querySelector('[aria-label="' + filterText.column + ' 1"]')!.value).toBe('words'); expect(selectedFilterMembers()).toEqual(['晚行', '早行']); await click(filterText.cancel);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：已选原值漂移被观察后即使恢复也拒旧按钮，不复活原选择证明', async () => {
  await mount(); await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id');
  const old = reactProps(button(selectedFilterText.open)).onClick, before = grid().rows, originalId = original.rows[0].id;
  original.rows[0].id = '3'; await act(async () => old()); original.rows[0].id = originalId; await act(async () => old());
  expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().rows).toBe(before);
  await act(async () => old()); expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull();
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it.each([128, 129])('勾选值筛选：%s种原值严格遵守128预算，越界不打开部分草稿或清空选择', async count => {
  await mount(result => { result.columns = [{ key: 'candidate', name: '候选', type: 'TEXT' }]; result.rows = Array.from({ length: count }, (_, index) => ({ candidate: '原值' + index })); });
  const before = grid().rows;
  await act(async () => grid().onSelectedRowsChange(new Set(Array.from({ length: count }, (_, index) => index)))); await chooseFilterCell(0, 'candidate');
  if (count === 128) {
    await click(selectedFilterText.open); expect(selectedFilterMembers()).toEqual(Array.from({ length: 128 }, (_, index) => '原值' + index)); expect(grid().rows).toBe(before); await click(filterText.cancel);
  } else {
    const action = button(selectedFilterText.open); expect(action.disabled).toBe(true); expect(action.getAttribute('title')).toBe(selectedFilterText.budget);
    await act(async () => reactProps(action).onClick()); expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().selectedRows.size).toBe(129);
  }
  expect(grid().rows).toBe(before); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：已有OR表达式保留括号，新增IN与完整旧组按AND组合', async () => {
  await mount(); await click(filterText.open); await addFilterRule(1, 'id', 'eq', '18446744073709551615'); await addFilterRule(2, 'id', 'eq', '9007199254740993'); await setFilterField(filterText.mode, 'OR'); await click(filterText.apply);
  const before = grid().rows; expect(before).toEqual([original.rows[0], original.rows[1]]);
  await act(async () => grid().onSelectedRowsChange(new Set([1]))); await chooseFilterCell(0, 'value'); await click(selectedFilterText.open);
  expect(document.querySelector('[aria-label="' + filterText.mode + '"]')!.value).toBe('AND'); expect(document.querySelector('[aria-label="' + filterText.groupMode('1') + '"]')!.value).toBe('OR'); expect(selectedFilterMembers(3)).toEqual(['0.12345678901234567890']);
  expect(grid().rows).toBe(before); await click(filterText.apply); expect(grid().rows).toEqual([original.rows[1]]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：完整结构超32条件时拒绝追加，保留原视图、多排序、选择及历史', async () => {
  await mount(); await click(filterText.open); for (let index = 1; index <= 32; index++) await addFilterRule(index, 'id', 'notNull'); await click(filterText.apply); await sort('id', 'DESC');
  await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id'); const before = grid().rows, sortColumns = grid().sortColumns;
  await click(selectedFilterText.open); expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(document.body.textContent).toContain(filterText.budget);
  expect(grid().rows).toBe(before); expect(grid().sortColumns).toEqual(sortColumns); expect(grid().selectedRows.size).toBe(2); expect(button(historyText.redo).disabled).toBe(true);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：显式应用保留多排序NULL和大小写，一次撤销重做整步且不执行SQL', async () => {
  await mountMulti(); const saved = structuredClone(original);
  await headerAction('words'); await toggleSortCase(1, '原文', true); await nullPosition(1, '原文', 'LAST'); await headerAction('id', { ctrlKey: true });
  const before = grid().rows, sortColumns = grid().sortColumns, selectedRows = [before[0], before[2]];
  await act(async () => grid().onSelectedRowsChange(new Set([2, 0]))); await chooseFilterCell(1, 'id'); await click(selectedFilterText.open);
  expect(grid().rows).toBe(before); await click(filterText.apply); expect(grid().rows).toEqual(selectedRows); expect(grid().sortColumns).toEqual(sortColumns);
  expect(document.querySelector('[aria-label="' + text.nulls(1, '原文') + '"]')!.value).toBe('LAST'); expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true);
  expect(grid().selectedRows.size).toBe(0); await click(historyText.undo); expect(grid().rows).toEqual(before); expect(grid().sortColumns).toEqual(sortColumns);
  await click(historyText.redo); expect(grid().rows).toEqual(selectedRows); expect(grid().sortColumns).toEqual(sortColumns); expect(original).toEqual(saved);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('勾选值筛选：共享活动行模式即使传入快捷接口也不显示按钮或调用请求', async () => {
  await mount(); const selected = vi.fn();
  await act(async () => root!.render(<Grid columns={original.columns} rows={original.rows} selectionScope={{}} isCurrent={() => true} onActiveRowChange={() => {}} onFilterSelected={selected}/>));
  await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id');
  expect(document.querySelectorAll('button').some(node => node.textContent === selectedFilterText.open)).toBe(false); expect(selected).not.toHaveBeenCalled();
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it.each(['active-tab', 'connection', 'job', 'modal', 'new-query'] as const)('勾选值筛选：%s往返后旧按钮永久拒绝，不能借同源结果或新选择开草稿', async mode => {
  await mount(); await act(async () => grid().onSelectedRowsChange(new Set([0, 2]))); await chooseFilterCell(1, 'id');
  const old = reactProps(button(selectedFilterText.open)).onClick, settings = store.getState().settings;
  if (mode === 'new-query') await click(zh.query.text010);
  else await act(async () => {
    if (mode === 'active-tab') { store.setState({ settings: { ...settings, activeTabId: 'other' } }); store.setState({ settings }); }
    if (mode === 'connection') { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); }
    if (mode === 'job') { store.getState().setBusy('q', true); store.getState().setBusy('q', false); }
    if (mode === 'modal') {
      const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.appendChild(dialog);
      for (const observer of observers) observer([{ addedNodes: [dialog] }]);
      dialog.parentNode!.removeChild(dialog);
    }
  });
  const rows = grid().rows;
  await act(async () => old()); expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().rows).toBe(rows); expect(grid().selectedRows.size).toBe(0);
  // 新的真实勾选及当前列仍可用；迟到旧事件不能清掉新选择或偷用其父级接纳证明。
  await act(async () => grid().onSelectedRowsChange(new Set([1]))); await chooseFilterCell(0, 'id');
  await act(async () => old()); expect(document.querySelector('[aria-label="' + filterText.title + '"]')).toBeNull(); expect(grid().selectedRows.size).toBe(1);
  await click(selectedFilterText.open); expect(selectedFilterMembers()).toEqual(['9007199254740993']); expect(grid().rows).toBe(rows); await click(filterText.cancel);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(mode === 'new-query' ? 2 : 1);
});
it('筛选排序联动：原样应用筛选保留重做，旧重做闭包不能跨控制器替换重放', async () => {
  await mount(); await sort(); await click(filterText.open); await addFilterRule(1, 'id', 'gt', '2'); await click(filterText.apply);
  await click(historyText.undo); expect(grid().rows).toEqual([original.rows[2], original.rows[1], original.rows[0]]);
  const redo = reactProps(button(historyText.redo)).onClick;
  await click(filterText.open); await click(filterText.apply); expect(button(historyText.redo).disabled).toBe(false);
  await act(async () => redo()); expect(grid().rows).toEqual([original.rows[2], original.rows[1], original.rows[0]]);
  await click(historyText.redo); expect(grid().rows).toEqual([original.rows[1], original.rows[0]]); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});
it('筛选排序联动：清除筛选触发Unicode映射总预算时保留旧条件和排序，显式清排序后可清筛选', async () => {
  await mount(result => { result.columns = [result.columns[0], result.columns[2]]; result.rows = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), words: 'İ'.repeat(4000) })); });
  await click(filterText.open); await addFilterRule(1, 'id', 'eq', '0'); await click(filterText.apply);
  await sort('words'); await toggleSortCase(1, '原文', true); const rows = grid().rows;
  await click(filterText.clear); expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual([{ columnKey: 'words', direction: 'ASC' }]);
  expect(document.body.textContent).toContain(text.budget); expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true);
  await click(text.clear); await click(filterText.clear); expect(grid().rows).toBe(original.rows); expect(grid().rows).toHaveLength(1000);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('筛选排序联动：草稿期间排序键漂移后即使恢复也拒旧应用，旧草稿不能恢复旧优先级', async () => {
  await mountMulti(); await sort(); await click(filterText.open); await addFilterRule(1, 'group', 'eq', 'A');
  const apply = reactProps(button(filterText.apply)).onClick, rows = grid().rows, value = original.rows[1].id;
  original.rows[1].id = '3'; await act(async () => apply()); expect(grid().rows).toBe(rows); expect(grid().rows).toHaveLength(3);
  original.rows[1].id = value; await act(async () => apply()); expect(grid().rows).toBe(rows); expect(grid().rows).toHaveLength(3);
  await click(filterText.cancel); await act(async () => apply()); expect(grid().rows).toHaveLength(3);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});
it('筛选排序联动：应用筛选保留完整多列优先级、NULL及大小写，一次撤销并保持精确原文', async () => {
  await mountMulti(); const before = structuredClone(original);
  original.rows[1].words = null;
  await headerAction('words'); await toggleSortCase(1, '原文', true); await nullPosition(1, '原文', 'LAST'); await headerAction('id', { ctrlKey: true });
  const sorted = [...grid().rows], rules = [...grid().sortColumns];
  await click(filterText.open); await addFilterRule(1, 'group', 'eq', 'A'); await click(filterText.apply);
  expect(grid().sortColumns).toEqual(rules); expect(grid().rows).toEqual([original.rows[2], original.rows[1]]);
  expect(document.querySelector('[aria-label="' + text.nulls(1, '原文') + '"]')!.value).toBe('LAST');
  expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true);
  await click(historyText.undo); expect(grid().rows).toEqual(sorted); expect(grid().sortColumns).toEqual(rules);
  await click(historyText.redo); expect(grid().rows).toEqual([original.rows[2], original.rows[1]]);
  await act(async () => grid().onSelectedRowsChange(new Set([0, 1]))); await click(zh.resultExport.selectedTitle);
  await click(zh.resultExport.chooseFile); await click(zh.resultExport.start);
  expect(exports[0].result.rows[1].id).toBe('9007199254740993'); expect(exports[0].result.rows[1].amount).toBe('0.12345678901234567891');
  before.rows[1].words = null; expect(original).toEqual(before); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('筛选排序联动：清除筛选保留多列排序，旧选择撤销，撤销恢复前一完整视图', async () => {
  await mountMulti(); await filterGroup(); await headerAction('group'); await headerAction('id', { ctrlKey: true });
  const filtered = [...grid().rows], rules = [...grid().sortColumns]; await act(async () => grid().onSelectedRowsChange(new Set([0]))); const old = grid();
  await click(filterText.clear); expect(grid().sortColumns).toEqual(rules); expect(grid().rows).toEqual([original.rows[2], original.rows[1], original.rows[0]]);
  expect(grid().selectedRows.size).toBe(0); expect(copy(old).size).toBe(0);
  await click(historyText.undo); expect(grid().rows).toEqual(filtered); expect(grid().sortColumns).toEqual(rules);
  await click(historyText.redo); expect(grid().rows).toEqual([original.rows[2], original.rows[1], original.rows[0]]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it.each(['clear', 'draft'] as const)('筛选排序联动：%s扩大到无效排序值时完整拒绝，保留旧视图、规则、选择及历史', async mode => {
  await mount(result => { result.rows[0].id = '不是整数'; });
  await click(filterText.open); await addFilterRule(1, 'words', 'eq', '中行'); await click(filterText.apply); await sort();
  await act(async () => grid().onSelectedRowsChange(new Set([0]))); const old = grid(), rows = old.rows;
  if (mode === 'clear') await click(filterText.clear);
  else { await click(filterText.open); await click(filterText.clearDraft); await click(filterText.apply); }
  expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]);
  expect(document.body.textContent).toContain(text.value);
  if (mode === 'draft') { expect(document.querySelector('[aria-label="' + filterText.title + '"]')).not.toBeNull(); await click(filterText.cancel); }
  else { expect(grid().selectedRows.size).toBe(1); expect(copy(old).size).toBeGreaterThan(0); }
  await click(historyText.undo); expect(grid().rows).toEqual([original.rows[1]]); expect(grid().sortColumns).toEqual([]);
  await click(historyText.redo); expect(grid().rows).toBeDefined(); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('筛选排序联动：全部排序列均不支持时仍可应用NULL筛选，不扩大排序准入', async () => {
  await mount(result => { result.columns = result.columns.map(column => ({ ...column, type: '未知类型' })); result.rows[0].id = null; });
  await click(filterText.open); await addFilterRule(1, 'id', 'null'); await click(filterText.apply);
  expect(grid().rows).toEqual([original.rows[0]]); expect(grid().sortColumns).toEqual([]);
  await click(filterText.clear); expect(grid().rows).toBe(original.rows); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});
it.each(['failed', 'no-columns'] as const)('暂存整理：后续查询%s仍显示暂存并允许主动丢弃', async mode => {
  await mount(); await sort(); await click(memoryText.save); const oldDiscard = reactProps(button(memoryText.clear)).onClick;
  const previous = window.dbark.invoke; (window.dbark as any).invoke = async (command: any, input: any) => {
    if (command === 'query.execute') { if (mode === 'failed') throw Error('本例预期SQL失败'); return { results: [{ columns: [], rows: [], affectedRows: 0, elapsedMs: 0, statement: '状态结果' }], elapsedMs: 0 }; }
    return previous(command, input);
  };
  await click(zh.query.text010); expect(document.body.textContent).toContain(memoryText.saved); expect(button(memoryText.apply).disabled).toBe(true);
  await act(async () => oldDiscard()); expect(document.body.textContent).toContain(memoryText.saved);
  await click(memoryText.clear); expect(document.body.textContent).not.toContain(memoryText.saved);
});
it('暂存整理：新查询后显式整份应用，多列排序和筛选一次撤销/重做，旧选择不复活', async () => {
  await mountMulti(); await filterGroup(); await headerAction('group'); await headerAction('id', { ctrlKey: true });
  const expected = [...grid().rows], sorted = [...grid().sortColumns]; await act(async () => grid().onSelectedRowsChange(new Set([0])));
  await click(memoryText.save); expect(grid().selectedRows.size).toBe(1);
  const old = grid(); await click(zh.query.text010); expect(grid().rows).toBe(original.rows); expect(button(historyText.undo).disabled).toBe(true);
  await click(memoryText.apply); expect(grid().rows).toEqual(expected); expect(grid().sortColumns).toEqual(sorted);
  expect(grid().selectedRows.size).toBe(0); expect(copy(old).size).toBe(0);
  await click(historyText.undo); expect(grid().rows).toBe(original.rows); expect(grid().sortColumns).toEqual([]);
  await click(historyText.redo); expect(grid().rows).toEqual(expected); expect(grid().sortColumns).toEqual(sorted);
  await act(async () => grid().onSelectedRowsChange(new Set([0, 1])));
  await click(zh.resultExport.selectedTitle); await click(zh.resultExport.chooseFile); await click(zh.resultExport.start);
  expect(exports[0].result.rows.map((row: any) => row.id)).toEqual(['2', '9007199254740993']);
  expect(exports[0].result.rows[1].amount).toBe('0.12345678901234567891');
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it('暂存整理：完整NULL位置、大小写、停用条件原文在重新执行后保留', async () => {
  await mount(); await click(filterText.open); await addFilterRule(1, 'id', 'eq', '保留的停用原文'); await enableFilterRule(1, false); await click(filterText.apply);
  await sort('words'); await toggleSortCase(1, '原文', true); await nullPosition(1, '原文', 'LAST'); await click(memoryText.save);
  await click(zh.query.text010); await click(memoryText.apply);
  expect(document.querySelector('[aria-label="' + text.nulls(1, '原文') + '"]')!.value).toBe('LAST');
  expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true);
  await click(filterText.open); expect(document.querySelector('[aria-label="' + filterText.enabled(1) + '"]')!.checked).toBe(false);
  expect(document.querySelector('[aria-label="' + filterText.input + ' 1"]')!.value).toBe('保留的停用原文');
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it('暂存整理：新结果空匹配保持空，可撤销恢复新原行，丢弃不改视图或SQL', async () => {
  await mountMulti(); await filterGroup('没有匹配'); await click(memoryText.save); await click(zh.query.text010);
  await click(memoryText.apply); expect(grid().rows).toEqual([]); await click(memoryText.clear); expect(grid().rows).toEqual([]);
  expect(document.body.textContent).not.toContain(memoryText.saved); await click(historyText.undo); expect(grid().rows).toBe(original.rows);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it('暂存整理：替换后旧应用/丢弃回调无效，原样应用保留重做', async () => {
  await mount(); await sort(); await click(memoryText.save);
  const apply = reactProps(button(memoryText.apply)).onClick, discard = reactProps(button(memoryText.clear)).onClick;
  await sort('id', 'DESC'); await click(memoryText.save); const descending = grid().rows;
  await act(async () => { apply(); discard(); }); expect(grid().rows).toBe(descending); expect(document.body.textContent).toContain(memoryText.saved);
  await click(historyText.undo); await click(memoryText.apply); expect(grid().rows).toEqual(descending);
  await click(historyText.undo); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]);
  await click(memoryText.save); await click(memoryText.apply); expect(button(historyText.redo).disabled).toBe(false);
  await click(historyText.redo); expect(grid().rows).toEqual(descending);
});

it.each(['key', 'name', 'type', 'order'] as const)('暂存整理：新结果%s变化禁用完整应用，当前行及暂存保持', async change => {
  await mount(); await sort(); await click(memoryText.save);
  if (change === 'order') original.columns.reverse(); else original.columns[0][change] = '改变';
  await click(zh.query.text010); const rows = grid().rows; expect(button(memoryText.apply).disabled).toBe(true);
  await act(async () => reactProps(button(memoryText.apply)).onClick()); expect(document.body.textContent).toContain(memoryText.mismatch);
  expect(grid().rows).toBe(rows); expect(button(historyText.undo).disabled).toBe(true); expect(document.body.textContent).toContain(memoryText.saved);
});

it('暂存整理：新行精度格式不兼容时整体拒绝，不丢暂存或移动整理历史', async () => {
  await mount(); await sort(); await click(memoryText.save); original.rows[0].id = '无法解析的整数';
  await click(zh.query.text010); const rows = grid().rows; await click(memoryText.apply);
  expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual([]); expect(button(historyText.undo).disabled).toBe(true);
  expect(document.body.textContent).toContain(memoryText.saved); expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it.each(['inactive', 'new', 'result', 'version', 'job', 'modal'] as const)('暂存整理：%s变化后旧保存/应用/丢弃回调不能重放', async mode => {
  await mount(); await sort(); await click(memoryText.save);
  const save = reactProps(button(memoryText.save)).onClick, apply = reactProps(button(memoryText.apply)).onClick, discard = reactProps(button(memoryText.clear)).onClick, settings = store.getState().settings;
  if (mode === 'new') await click(zh.query.text010);
  if (mode === 'result') await click(zh.query.text017 + '2');
  if (mode === 'inactive') await act(async () => { store.setState({ settings: { ...settings, activeTabId: 'other' } }); store.setState({ settings }); });
  if (mode === 'version') await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  if (mode === 'job') await act(async () => { store.getState().setBusy('q', true); store.getState().setBusy('q', false); });
  if (mode === 'modal') { const node = document.createElement('div'); node.setAttribute('role', 'dialog'); document.body.appendChild(node); node.parentNode!.removeChild(node); await act(async () => { for (const observer of observers) observer([{ addedNodes: [node] }]); }); }
  const rows = grid().rows; await act(async () => { save(); apply(); discard(); }); expect(grid().rows).toBe(rows);
  expect(document.body.textContent.includes(memoryText.saved)).toBe(mode !== 'version');
  if (mode === 'inactive') { await click(memoryText.apply); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]); }
});
function button(name:string){const node=document.querySelectorAll('button').find(node=>node.textContent===name||node.getAttribute('aria-label')===name||name===zh.query.text010&&node.textContent.startsWith(name)||name===zh.resultExport.chooseFile&&node.textContent.includes(name));expect(node,'缺少按钮：'+name).toBeDefined();return node!;}
async function click(name:string){const node=button(name);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
async function sort(column='id',direction:'ASC'|'DESC'='ASC'){const before=grid();await act(async()=>before.onSortColumnsChange([{columnKey:column,direction}]));}
/** 使用真实优先级控件；保留RAM外界端口，不能把此检查当成原生窗口或系统输入。 */
async function nullPosition(order:number,name:string,value:''|'FIRST'|'LAST'){
  const node=document.querySelector('[aria-label="'+text.nulls(order,name)+'"]')!;expect(node).not.toBeNull();expect(node.disabled).toBe(false);
  await act(async()=>reactProps(node).onChange({target:{value}}));
}
function copy(current=grid()){const data=new Map<string,string>();current.onCellCopy({row:current.rows[0],column:{key:'id'}},{preventDefault(){},clipboardData:{setData:(key:string,value:string)=>data.set(key,value)}});return data;}

/** 调用正式网格键盘端口和真实整理控制器；仅DOM及RDG事件包装来自RAM，不发送系统按键。 */
async function historyGridKey(options:Record<string,unknown>={},current=grid(),args:Record<string,unknown>={}){
  const event={key:'z',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,defaultPrevented:false,keyCode:90,nativeEvent:{isComposing:false},target:document.querySelector('[role="grid"]'),isGridDefaultPrevented:()=>false,preventGridDefault:vi.fn(),preventDefault:vi.fn(),stopPropagation:vi.fn(),...options};
  await act(async()=>current.onCellKeyDown({mode:'ACTIVE',column:current.columns.find((column:any)=>column.key!=='select-row'),row:current.rows[0],rowIdx:current.rows.length?0:-1,...args},event));return event;
}

/** 操作真实排序草稿控件；RAM仅替代浏览器DOM及外部服务，不代替父级排序与历史。 */
async function sortDraftField(label: string, value: string | boolean) {
  const node = document.querySelector('[aria-label="' + label + '"]')!; expect(node).not.toBeNull(); expect(node.disabled).toBe(false);
  await act(async () => reactProps(node).onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } }));
}

/** 走实际region键盘处理器，记录是否消费事件，不替代排序／筛选／工作区控制器。 */
async function sortDraftKey(key: string, options: Record<string, unknown> = {}) {
  const panel = document.querySelector('[aria-label="' + text.panelTitle + '"]')!, event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, keyCode: 0, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...options };
  await act(async () => reactProps(panel).onKeyDown(event)); return event;
}

it.each(['ctrlKey', 'metaKey'])('排序草稿%s+Enter只应用一次，旧键盘回调不提交后继草稿，也不执行SQL', async modifier => {
  await mount(); await click(text.panelTitle); await click(text.panelAdd); await sortDraftField(text.panelDirection(1), 'DESC');
  const oldKey = reactProps(document.querySelector('[aria-label="' + text.panelTitle + '"]')!).onKeyDown;
  const event = await sortDraftKey('Enter', { [modifier]: true }); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }]);
  await click(text.panelTitle); await click(text.panelClear); await click(text.panelAdd); await sortDraftField(text.panelField(1), 'value');
  await act(async () => oldKey({ ...event, ctrlKey: true })); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }]);
  await sortDraftKey('Escape'); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('排序草稿普通Enter、Alt/Shift组合及输入法原生标记不提交，长按命令消费但不应用', async () => {
  await mount(); await click(text.panelTitle); await click(text.panelAdd);
  for (const [key, options] of [
    ['Enter', {}], ['Enter', { ctrlKey: true, altKey: true }], ['Enter', { metaKey: true, shiftKey: true }], ['Escape', { ctrlKey: true }],
    ['Enter', { ctrlKey: true, nativeEvent: { isComposing: true } }], ['Enter', { ctrlKey: true, keyCode: 229 }], ['Enter', { ctrlKey: true, defaultPrevented: true }],
  ] as [string, Record<string, unknown>][]) {
    const event = await sortDraftKey(key, options); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled(); expect(grid().sortColumns).toEqual([]);
  }
  for (const [key, options] of [['Enter', { ctrlKey: true, repeat: true }], ['Escape', { repeat: true }]] as [string, Record<string, unknown>][]) {
    const event = await sortDraftKey(key, options); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(grid().sortColumns).toEqual([]);
  }
  let panel = document.querySelector('[aria-label="' + text.panelTitle + '"]')!; await act(async () => reactProps(panel).onCompositionStart());
  await sortDraftKey('Enter', { ctrlKey: true }); await sortDraftKey('Escape'); expect(grid().sortColumns).toEqual([]); expect(button(text.panelApply).disabled).toBe(true);
  panel = document.querySelector('[aria-label="' + text.panelTitle + '"]')!; await act(async () => reactProps(panel).onCompositionEnd());
  await sortDraftKey('Enter', { ctrlKey: true }); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'ASC' }]);
});

it('排序草稿Esc保留原筛选、排序和重做，失效键盘不能关闭后继面板', async () => {
  await mount(); await sort(); await sort('id', 'DESC'); await click(historyText.undo); const rows = grid().rows;
  await click(text.panelTitle); await sortDraftField(text.panelDirection(1), 'DESC');
  const event = await sortDraftKey('Escape'); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(grid().rows).toBe(rows); expect(button(historyText.redo).disabled).toBe(false);
  await click(text.panelTitle); const stale = reactProps(document.querySelector('[aria-label="' + text.panelTitle + '"]')!).onKeyDown;
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  await click(text.panelTitle); await click(text.panelAdd); await act(async () => stale(event));
  expect(document.querySelector('[aria-label="' + text.panelField(1) + '"]')).not.toBeNull();
});

it('多列排序草稿保留筛选，一次应用完整优先级，原文精度、选择导出及整理撤销一致', async () => {
  await mountMulti(); const saved = structuredClone(original);
  await click(filterText.open); await addFilterRule(1, 'group', 'eq', 'A'); await click(filterText.apply);
  const filtered = grid().rows; await click(text.panelTitle); await click(text.panelAdd);
  await sortDraftField(text.panelField(1), 'amount'); await sortDraftField(text.panelDirection(1), 'DESC');
  await click(text.panelAdd); await sortDraftField(text.panelField(2), 'id');
  expect(grid().rows).toBe(filtered); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
  expect(button(filterText.open).disabled).toBe(true); expect(button(columnsText.open).disabled).toBe(true); expect(copy().size).toBe(0);
  await click(text.panelApply); expect(grid().rows).toEqual([original.rows[1], original.rows[2]]);
  expect(grid().sortColumns).toEqual([{ columnKey: 'amount', direction: 'DESC' }, { columnKey: 'id', direction: 'ASC' }]);
  await click(historyText.undo); expect(grid().rows).toEqual(filtered); expect(grid().sortColumns).toEqual([]);
  await click(historyText.redo); expect(grid().sortColumns).toHaveLength(2);
  await act(async () => grid().onSelectedRowsChange(new Set([0, 1])));
  const typed = JSON.parse(copy().get('application/x-dbark-cells')!); expect(typed.rows.map((row: any[]) => row[1])).toEqual(['9007199254740993', '2']);
  await click(zh.resultExport.selectedTitle); await click(zh.resultExport.chooseFile); await click(zh.resultExport.start);
  expect(exports[0].result.rows.map((row: any) => row.amount)).toEqual(['0.12345678901234567891', '0.12345678901234567890']);
  expect(original).toEqual(saved); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('排序草稿改方向、NULL及大小写并移动优先级，取消不改变原规则和重做历史', async () => {
  await mountMulti(); await sort('group'); await sort('id'); await click(historyText.undo);
  const rows = grid().rows; await click(text.panelTitle);
  await sortDraftField(text.panelNulls(1), 'LAST'); await sortDraftField(text.panelCase(1), true); await sortDraftField(text.panelDirection(1), 'DESC');
  await click(text.panelAdd); await sortDraftField(text.panelField(2), 'id'); await click(text.panelEarlier(2));
  expect(document.querySelector('[aria-label="' + text.panelNulls(2) + '"]')!.value).toBe('LAST');
  expect(document.querySelector('[aria-label="' + text.panelCase(2) + '"]')!.checked).toBe(true);
  expect(grid().rows).toBe(rows); await click(text.panelCancel); expect(grid().rows).toBe(rows); expect(button(historyText.redo).disabled).toBe(false);
  await click(text.panelTitle); expect(document.querySelector('[aria-label="' + text.panelNulls(1) + '"]')!.value).toBe('');
  await click(text.panelClear); await click(text.panelApply); expect(grid().rows).toBe(original.rows); await click(historyText.undo);
  // 整理撤销重新建立视图数组，但每个原行引用及顺序必须相同；取消草稿仍要求原数组身份保持。
  expect(grid().rows).toEqual(rows); grid().rows.forEach((row: any, index: number) => expect(row).toBe(rows[index]));
});

it('排序草稿按唯一内部列键区分同名列，拒绝重复、非法方向和二进制，不发布部分排序', async () => {
  await mount(); await click(text.panelTitle); await click(text.panelAdd); await click(text.panelAdd);
  await sortDraftField(text.panelField(2), 'id'); expect(document.body.textContent).toContain(text.rules); expect(document.querySelector('[aria-label="' + text.panelField(2) + '"]')!.value).toBe('value');
  await sortDraftField(text.panelField(2), 'bytes'); expect(document.body.textContent).toContain(text.type);
  await sortDraftField(text.panelDirection(1), '不认识的方向'); expect(grid().sortColumns).toEqual([]);
  await sortDraftField(text.panelDirection(1), 'DESC'); await click(text.panelApply);
  expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }, { columnKey: 'value', direction: 'ASC' }]);
  expect(grid().rows[0]).toBe(original.rows[0]); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('排序草稿跨十项分页不裁剪原完整规则，跨页优先级移动保留NULL选项', async () => {
  await mount(result => { result.columns = Array.from({ length: 12 }, (_, i) => ({ key: 'c' + i, name: '同名', type: 'INT' })); result.rows = [Object.fromEntries(result.columns.map(column => [column.key, '1']))]; });
  await click(text.panelTitle); for (let i = 0; i < 12; i++) await click(text.panelAdd);
  expect(document.querySelector('[aria-label="' + text.panelField(11) + '"]')!.value).toBe('c10');
  await sortDraftField(text.panelNulls(11), 'LAST'); await click(text.panelEarlier(11));
  expect(document.querySelector('[aria-label="' + text.panelField(10) + '"]')!.value).toBe('c10'); expect(document.querySelector('[aria-label="' + text.panelNulls(10) + '"]')!.value).toBe('LAST');
  const oldPage = reactProps(button(text.panelApply)).onClick; await click(text.panelNext); await act(async () => oldPage()); expect(grid().sortColumns).toEqual([]);
  await click(text.panelApply); expect(grid().sortColumns).toHaveLength(12); expect(grid().sortColumns[9].columnKey).toBe('c10');
  await click(text.panelTitle); await click(text.panelNext); expect(document.querySelector('[aria-label="' + text.panelField(12) + '"]')!.value).toBe('c11');
});

it.each(['连接ABA', '标签切换', '新查询', '新结果'] as const)('排序草稿%s后旧应用／取消不能影响后继面板', async change => {
  await mount(); await click(text.panelTitle); await click(text.panelAdd); const oldApply = reactProps(button(text.panelApply)).onClick, oldCancel = reactProps(button(text.panelCancel)).onClick;
  if (change === '连接ABA') await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  if (change === '标签切换') await act(async () => { store.getState().updateSettings({ activeTabId: 'other' }); store.getState().updateSettings({ activeTabId: 'q' }); });
  if (change === '新查询') await click(zh.query.text010);
  if (change === '新结果') { await click(zh.query.text017 + '2'); await click(zh.query.text017 + '1'); }
  await click(text.panelTitle); await click(text.panelAdd); await sortDraftField(text.panelField(1), 'value');
  await act(async () => { oldApply(); oldCancel(); }); expect(document.querySelector('[aria-label="' + text.panelField(1) + '"]')!.value).toBe('value');
  expect(grid().sortColumns).toEqual([]); await click(text.panelApply); expect(grid().sortColumns).toEqual([{ columnKey: 'value', direction: 'ASC' }]);
});

it('组合输入及旧渲染回调不能提交或覆盖排序草稿，取消也不重放', async () => {
  await mount(); await click(text.panelTitle); await click(text.panelAdd); const oldApply = reactProps(button(text.panelApply)).onClick;
  await sortDraftField(text.panelDirection(1), 'DESC'); await act(async () => oldApply()); expect(grid().sortColumns).toEqual([]);
  let panel = document.querySelector('[aria-label="' + text.panelTitle + '"]')!;
  await act(async () => reactProps(panel).onCompositionStart()); expect(button(text.panelApply).disabled).toBe(true);
  await act(async () => reactProps(button(text.panelApply)).onClick()); expect(grid().sortColumns).toEqual([]);
  panel = document.querySelector('[aria-label="' + text.panelTitle + '"]')!; await act(async () => reactProps(panel).onCompositionEnd());
  await click(text.panelApply); expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }]);
});

it('排序草稿实际应用大小写和独立NULL位置，组合次级精确大数仍保留原行', async () => {
  await mount(result => { result.rows[0].id = null; result.rows[0].words = 'A'; result.rows[1].words = 'a'; result.rows[2].words = 'a'; });
  const saved = structuredClone(original); await click(text.panelTitle); await click(text.panelAdd); await sortDraftField(text.panelField(1), 'words'); await sortDraftField(text.panelCase(1), true);
  await click(text.panelAdd); await sortDraftField(text.panelField(2), 'id'); await sortDraftField(text.panelDirection(2), 'DESC'); await sortDraftField(text.panelNulls(2), 'FIRST');
  await click(text.panelApply); expect(grid().rows).toEqual([original.rows[0], original.rows[1], original.rows[2]]); grid().rows.forEach((row: any, index: number) => expect(row).toBe(original.rows[index]));
  expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true); expect(document.querySelector('[aria-label="' + text.nulls(2, '同名') + '"]')!.value).toBe('FIRST');
  expect(original).toEqual(saved); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('完整排序超文本预算保留原视图及可修改草稿，明确关闭大小写转换后单次成功', async () => {
  await mount(result => { result.columns = [{ key: 'id', name: '原文一', type: 'TEXT' }, { key: 'value', name: '原文二', type: 'TEXT' }]; result.rows = Array.from({ length: 1000 }, (_, index) => ({ id: 'A'.repeat(4090) + String(index).padStart(6, '0'), value: 'B'.repeat(4096) })); });
  await click(text.panelTitle); await click(text.panelAdd); await sortDraftField(text.panelCase(1), true); await click(text.panelAdd);
  await click(text.panelApply); expect(document.body.textContent).toContain(text.budget); expect(grid().rows).toBe(original.rows); expect(grid().sortColumns).toEqual([]); expect(button(text.panelApply).disabled).toBe(false);
  await sortDraftField(text.panelCase(1), false); await click(text.panelApply); expect(grid().sortColumns).toHaveLength(2); expect(grid().rows[999]).toBe(original.rows[999]);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('本文件内存单选端口选中新项时取消旧项，value读取准确当前项',async()=>{
  await mount();
  const select=document.createElement('select'),first=document.createElement('option'),last=document.createElement('option');
  first.value='FIRST';last.value='LAST';select.appendChild(first);select.appendChild(last);
  (first as any).selected=true;(last as any).selected=true;
  expect((first as any).selected).toBe(false);expect((last as any).selected).toBe(true);expect(select.value).toBe('LAST');
});

it('NULL位置控件独立于真实列头升降序，旧回调拒绝，复制和导出仍保留准确原行',async()=>{
  await mount(result=>{result.rows[0].id=null;});await sort();
  expect(grid().rows).toEqual([original.rows[0],original.rows[2],original.rows[1]]);
  await nullPosition(1,'同名','LAST');expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  const oldSelect=document.querySelector('[aria-label="'+text.nulls(1,'同名')+'"]')!,oldChange=reactProps(oldSelect).onChange;
  await headerAction('id');expect(grid().rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);
  await act(async()=>oldChange({target:{value:'FIRST'}}));expect(grid().rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);
  expect(document.querySelector('[aria-label="'+text.nulls(1,'同名')+'"]')!.value).toBe('LAST');
  await act(async()=>grid().onSelectedRowsChange(new Set([0,1,2])));
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any[])=>row[0])).toEqual(['9007199254740993','2',null]);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
  expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['9007199254740993','2',null]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});

it('各列NULL选项随优先级移动，Ctrl追加及方向切换保留，恢复默认和原序明确生效',async()=>{
  await mountMulti();original.rows[0].group=null;original.rows[1].group=null;
  await headerAction('group');await nullPosition(1,'分组','LAST');await headerAction('id',{ctrlKey:true});
  expect(grid().rows).toEqual([original.rows[2],original.rows[0],original.rows[1]]);
  await click(text.changeDirection(2,'编号'));expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await click(text.later(1,'分组'));expect(document.querySelector('[aria-label="'+text.nulls(2,'分组')+'"]')!.value).toBe('LAST');
  expect(grid().rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);
  await click(text.earlier(2,'分组'));await nullPosition(1,'分组','');
  expect(grid().rows).toEqual([original.rows[1],original.rows[0],original.rows[2]]);
  await click(text.clear);expect(grid().rows).toBe(original.rows);expect(document.querySelector('[aria-label="'+text.nulls(1,'分组')+'"]')).toBeNull();
});

it('列头三态排序保留源行/列与SQL，精确排序后选择复制和导出共用视图顺序',async()=>{
  await mount();const rawRows=original.rows,saved=structuredClone(original),sql=store.getState().settings.tabs[0].sql;expect(grid().columns.find((c:any)=>c.key==='id').sortable).toBe(true);expect(grid().columns.find((c:any)=>c.key==='bytes').sortable).toBe(false);
  await sort();expect(grid().rows.map((r:any)=>r.id)).toEqual(['2','9007199254740993','18446744073709551615']);expect(grid().rows[0]).toBe(rawRows[2]);
  await act(async()=>grid().onSelectedRowsChange(new Set([0,2])));const typed=JSON.parse(copy().get('application/x-dbark-cells')!);expect(typed.rows.map((r:any)=>r[0])).toEqual(['2','18446744073709551615']);
  expect(document.body.textContent).toContain(text.truncated);expect(document.body.textContent).toContain(text.scope);expect(store.getState().settings.tabs[0].sql).toBe(sql);expect(original).toEqual(saved);expect(original.rows).toBe(rawRows);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((r:any)=>r.id)).toEqual(['2','18446744073709551615']);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('降序/清除及固定结果独立，旧排序/复制闭包不能在新视图重放',async()=>{
  await mount();const before=grid();await sort();const ascending=grid();await sort('id','DESC');expect(grid().rows[0]).toBe(original.rows[0]);await act(async()=>before.onSortColumnsChange([{columnKey:'value',direction:'ASC'}]));expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'DESC'}]);expect(copy(ascending).size).toBe(0);
  await click(text.clear);expect(grid().rows).toBe(original.rows);expect(grid().sortColumns).toEqual([]);await click(zh.query.pinResult);const pinned=grid().rows;await sort();expect(grid().rows[0]).toBe(pinned[2]);await click(zh.query.currentResults);expect(grid().rows).toBe(original.rows);expect(grid().sortColumns).toEqual([]);
});
it('全结果导出冻结排序后的全部已返回行，原结果及会话不变；拒绝二进制列不改视图',async()=>{
  await mount();const saved=structuredClone(original);await sort('value');const sorted=grid();await act(async()=>sorted.onSortColumnsChange([{columnKey:'bytes',direction:'ASC'}]));expect(grid().rows).toBe(sorted.rows);expect(document.body.textContent).toContain(text.value);
  await click(zh.resultExport.title);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((r:any)=>r.id)).toEqual(['2','9007199254740993','18446744073709551615']);expect(original).toEqual(saved);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);expect(commands.some(c=>c.startsWith('query.transaction'))).toBe(false);
});
it('排序前已有的勾选明确清除，不把旧显示位置的选择转给另一原行',async()=>{
  await mount();await act(async()=>grid().onSelectedRowsChange(new Set([0])));const before=grid();expect(grid().selectedRows).toEqual(new Set([0]));await sort();expect(grid().selectedRows.size).toBe(0);expect(button(zh.resultExport.selectedTitle).disabled).toBe(true);expect(copy(before).size).toBe(0);expect(document.body.textContent).toContain(text.selection);
});
it('排序后活动位置、详情上下行、查找滚动和字节查看都定位同一视图原行',async()=>{
  await mount();await sort();await act(async()=>grid().onActivePositionChange({row:grid().rows[0],rowIdx:0}));await click(detailsText.open);expect(document.body.textContent).toContain('早行');await click(detailsText.next);expect(document.body.textContent).toContain('中行');await click(detailsText.close);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await click(findText.open);const input=document.querySelector(`input[aria-label="${findText.input}"]`)!;await act(async()=>{input.value='早行';input.dispatchEvent(new MemoryEvent('input'));});await act(async()=>{await vi.runAllTimersAsync();});await click(findText.next);expect(ports.scroll).toHaveBeenLastCalledWith({rowIdx:0,idx:3});expect(grid().columns.find((c:any)=>c.key==='words').cellClass(grid().rows[0])).toBe('query-result-find-hit');expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it.each(['result','new','pin','version','job','inactive','closed','modal','unmount','append'])('%s使旧排序和选择永久失效，不按恢复的下标重领',async mode=>{
  await mount();await sort();const old=grid(),saved=store.getState().settings;
  if(mode==='result')await click(zh.query.text017+'2');if(mode==='new')await click(zh.query.text010);if(mode==='pin')await click(zh.query.pinResult);
  if(mode==='version')await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});if(mode==='job')await act(async()=>{store.getState().setBusy('q',true);store.getState().setBusy('q',false);});if(mode==='inactive')await act(async()=>{store.setState({settings:{...saved,activeTabId:'other'}});store.setState({settings:saved});});if(mode==='closed')await act(async()=>{store.setState({settings:{...saved,tabs:[]}});store.setState({settings:saved});});
  if(mode==='modal'){const node=document.createElement('div');node.setAttribute('role','dialog');document.body.appendChild(node);node.parentNode!.removeChild(node);await act(async()=>{for(const observer of observers)observer([{addedNodes:[node]}]);});}if(mode==='unmount'){await act(async()=>root!.unmount());root=undefined;}
  if(mode==='append')await act(async()=>{original.rows.push({id:'3',value:'1',words:'新批次',bytes:{type:'binary',base64:''}});store.setState({settings:{...saved}});});
  await act(async()=>{old.onSortColumnsChange([{columnKey:'value',direction:'DESC'}]);old.onSelectedRowsChange(new Set([0]));});expect(copy(old).size).toBe(0);expect(exports).toEqual([]);
});
it('真实列管理改变可见列后重置排序，旧列头不能排序隐藏列',async()=>{
  await mount();await sort('value');const old=grid();await click(columnsText.open);const field=document.querySelector(`input[aria-label="${columnsText.visible(2)}"]`)!;await act(async()=>{field.checked=false;field.dispatchEvent(new MemoryEvent('click'));});await click(columnsText.apply);expect(grid().sortColumns).toEqual([]);expect(grid().columns.some((c:any)=>c.key==='value')).toBe(false);await act(async()=>old.onSortColumnsChange([{columnKey:'value',direction:'DESC'}]));expect(grid().sortColumns).toEqual([]);
});
it('原source追加但React尚未更新时，旧视图复制/导出已拒绝，恢复长度也不复活',async()=>{
  await mount();await sort();await act(async()=>grid().onSelectedRowsChange(new Set([0])));const old=grid(),node=button(zh.resultExport.selectedTitle),props=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!,action=(node as any)[props].onClick;
  original.rows.push({id:'3',value:'0',words:'后批',bytes:{type:'binary',base64:''}});expect(copy(old).size).toBe(0);await act(async()=>action());expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  original.rows.pop();expect(copy(old).size).toBe(0);await act(async()=>action());expect(exports).toEqual([]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('排序后的二进制查看器在原模态撤销回调后保持原行，不因重置行数组自动关闭',async()=>{
  await mount();await sort();const sorted=grid(),rows=sorted.rows;await act(async()=>grid().onCellDoubleClick({row:rows[0],column:{key:'bytes'}}));const dialog=document.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();
  await act(async()=>{for(const observer of observers)observer([{addedNodes:[dialog]}]);});expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);expect(grid().rows).toBe(rows);expect(copy(sorted).size).toBe(0);
  await click(zh.dialogs.text001);await act(async()=>{for(const observer of observers)observer([{addedNodes:[]}]);});expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);expect(grid().rows[0]).toBe(original.rows[2]);expect(copy(sorted).size).toBe(0);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('锁定RDG的实际Enter/空格列头处理经真实QueryTab回调完成升降清除，不以合成自造键盘逻辑替代',async()=>{
  await mount();const source=readFileSync(createRequire(import.meta.url).resolve('react-data-grid'),'utf8'),tree=ts.createSourceFile('rdg.js',source,ts.ScriptTarget.Latest,true);let functions='';
  function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='HeaderCell')functions=n.body!.statements.filter(node=>ts.isFunctionDeclaration(node)&&['onKeyDown','onSort'].includes(node.name?.text??'')).map(node=>node.getText(tree)).join('\n');ts.forEachChild(n,visit);}visit(tree);expect(functions).not.toBe('');
  for(const key of ['Enter',' ','Enter']){const current=grid(),column=current.columns.find((c:any)=>c.key==='id'),sortIndex=current.sortColumns.findIndex((c:any)=>c.columnKey==='id'),sortDirection=current.sortColumns[sortIndex]?.direction;const action=runInNewContext(functions+'\nonKeyDown',{sortable:column.sortable,column,sortIndex,sortDirection,sortColumn:current.sortColumns[sortIndex],sortColumns:current.sortColumns,onSortColumnsChange:current.onSortColumnsChange,resizable:false});await act(async()=>action({key,preventDefault:vi.fn(),ctrlKey:false,metaKey:false}));}
  expect(grid().sortColumns).toEqual([]);expect(grid().rows).toBe(original.rows);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('其它网格的服务端排序和关联选择仍按原接口回传，不接本地类型准入',async()=>{
  await mount();const row={g:'原关联对象'},onRow=vi.fn(),onSort=vi.fn();await act(async()=>root!.render(<Grid columns={[{key:'g',name:'几何',type:'GEOMETRY'}]} rows={[row]} sort={[]} onSortChange={onSort} onActiveRowChange={onRow}/>));
  expect(grid().columns[0].sortable).toBe(true);await act(async()=>{grid().onSortColumnsChange([{columnKey:'g',direction:'ASC'}]);grid().onActivePositionChange({row,rowIdx:0});});expect(onSort).toHaveBeenCalledWith([{column:'g',direction:'ASC'}]);expect(onRow).toHaveBeenLastCalledWith(row);
});


/** 读取真实QueryTab的父端口，区分既有网格门与新排序来源门，不自造控制器。 */
function queryResultPort(){let fiber:any=document.querySelector('[role="grid"]');fiber=fiber[Object.keys(fiber).find(key=>key.startsWith('__reactFiber$'))!];while(fiber&&fiber.type!==Grid)fiber=fiber.return;expect(fiber).toBeDefined();return fiber.memoizedProps;}
/** 原网格超过1024列已有选择租约限制；此处单独验证原详情父端口4096列契约。 */
it.each([1025,4096])('%i列超排序预算保留原详情父端口，源漂移即时撤销且恢复不复活',async count=>{
  await mount(result=>{result.columns=Array.from({length:count},(_,i)=>({key:'c'+i,name:'字段'+i,type:'VAR_STRING'}));result.rows=[Object.fromEntries(result.columns.map((c,i)=>[c.key,'原字段'+i]))];});
  const old=grid();expect(old.rows).toBe(original.rows);expect(old.columns.every((c:any)=>!c.sortable)).toBe(true);expect(document.body.textContent).toContain(text.budget);
  expect(button(zh.resultExport.title).disabled).toBe(true);expect(button(columnsText.open).disabled).toBe(true);
  await act(async()=>queryResultPort().onActiveRowIndexChange(0));await click(detailsText.open);expect(document.body.textContent).toContain('原字段0');await click(detailsText.close);
  await act(async()=>queryResultPort().onActiveRowIndexChange(0));const node=button(detailsText.open),props=Object.keys(node).find(key=>key.startsWith('__reactProps$'))!,action=(node as any)[props].onClick;
  const sourceRows=original.rows;original.rows=sourceRows.slice();await act(async()=>action());expect(document.querySelector('[role="region"]')).toBeNull();original.rows=sourceRows;await act(async()=>action());expect(document.querySelector('[role="region"]')).toBeNull();expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it.each(['rows','columns'] as const)('超过原功能%s预算仍仅浏览，不能借排序回退扩大选择/导出/详情',async mode=>{
  await mount(result=>{if(mode==='rows')result.rows=Array.from({length:100001},(_,i)=>({...result.rows[0],id:String(i)}));else{result.columns=Array.from({length:4097},(_,i)=>({key:'c'+i,name:'字段'+i,type:'VAR_STRING'}));result.rows=[Object.fromEntries(result.columns.map(c=>[c.key,'原值']))];}});
  const current=grid();expect(current.rows).toBe(original.rows);expect(current.columns.every((c:any)=>!c.sortable)).toBe(true);expect(button(zh.resultExport.title).disabled).toBe(true);expect(button(columnsText.open).disabled).toBe(true);await act(async()=>current.onActivePositionChange({row:current.rows[0],rowIdx:0}));expect(button(detailsText.open).disabled).toBe(true);expect(copy(current).size).toBe(0);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
/** 多列fixture仍由原query.execute RAM端口返回；数值/时间保留协议字符串。 */
async function mountMulti(){await mount(result=>{
  result.columns=[{key:'group',name:'分组',type:'TEXT'},{key:'id',name:'编号',type:'BIGINT'},{key:'amount',name:'精度',type:'DECIMAL'},{key:'stamp',name:'时刻',type:'DATETIME'},{key:'duration',name:'时长',type:'TIME'},{key:'words',name:'原文',type:'TEXT'},{key:'bytes',name:'字节',type:'BLOB'}];
  result.rows=[{group:'B',id:'1',amount:'0.12345678901234567891',stamp:'2026-10-19 12:00:00.000002',duration:'-99:59:59.999999',words:'乙组',bytes:{type:'binary',base64:''}},{group:'A',id:'9007199254740993',amount:'0.12345678901234567891',stamp:'2026-10-19 12:00:00.000002',duration:'-99:59:59.999999',words:'甲组晚行',bytes:{type:'binary',base64:'AA=='}},{group:'A',id:'2',amount:'0.12345678901234567890',stamp:'2026-10-19 12:00:00.000001',duration:'-100:00:00.000001',words:'甲组早行',bytes:{type:'binary',base64:'AP8='}}];
});}
let multiHeaderFunctions:string|undefined;
/** 提取已安装RDG真实列头点击/键盘处理；Ctrl/Cmd和规则三态由库实现，测试不自造。 */
async function headerAction(columnKey:string,options:{key?:string;ctrlKey?:boolean;metaKey?:boolean}={}){
  if(!multiHeaderFunctions){const source=readFileSync(createRequire(import.meta.url).resolve('react-data-grid'),'utf8'),tree=ts.createSourceFile('rdg.js',source,ts.ScriptTarget.Latest,true);function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==='HeaderCell')multiHeaderFunctions=n.body!.statements.filter(node=>ts.isFunctionDeclaration(node)&&['onClick','onKeyDown','onSort'].includes(node.name?.text??'')).map(node=>node.getText(tree)).join('\n');ts.forEachChild(n,visit);}visit(tree);}
  const current=grid(),column=current.columns.find((c:any)=>c.key===columnKey),sortIndex=current.sortColumns.findIndex((c:any)=>c.columnKey===columnKey),sortColumn=current.sortColumns[sortIndex];const action=runInNewContext(multiHeaderFunctions+'\n'+(options.key?'onKeyDown':'onClick'),{sortable:column.sortable,column,sortIndex,sortColumn,sortDirection:sortColumn?.direction,sortColumns:current.sortColumns,onSortColumnsChange:current.onSortColumnsChange,resizable:false});await act(async()=>action({preventDefault:vi.fn(),ctrlKey:false,metaKey:false,...options}));
}
it('多列：真实RDG点击/Ctrl追加按完整优先级，列头编号和显式规则界面一致',async()=>{
  await mountMulti();await headerAction('group');await headerAction('id',{ctrlKey:true});expect(grid().sortColumns).toEqual([{columnKey:'group',direction:'ASC'},{columnKey:'id',direction:'ASC'}]);expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  const list=document.querySelector('[aria-label="'+text.priorities+'"]')!;expect(list.textContent).toContain(text.priority(1,'分组'));expect(list.textContent).toContain(text.priority(2,'编号'));const header=grid().columns.find((c:any)=>c.key==='id').renderHeaderCell();const badge=header.props.children.find((child:any)=>child?.props?.title===text.priority(2,'编号'));expect(badge.props.children.join('')).toBe('2 ↑');expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('多列：真实RDG Ctrl/Cmd Enter/空格追加、切换和移除；普通点击保留原替换语义',async()=>{
  await mountMulti();await headerAction('group',{key:'Enter'});await headerAction('id',{key:' ',metaKey:true});await headerAction('id',{key:'Enter',ctrlKey:true});expect(grid().sortColumns).toEqual([{columnKey:'group',direction:'ASC'},{columnKey:'id',direction:'DESC'}]);await headerAction('id',{key:' ',metaKey:true});expect(grid().sortColumns).toEqual([{columnKey:'group',direction:'ASC'}]);await headerAction('amount',{ctrlKey:true});await headerAction('stamp');expect(grid().sortColumns).toEqual([{columnKey:'stamp',direction:'ASC'}]);
});
it('多列：规则按钮调整优先级、切换方向、单独移除和恢复原序，旧按钮不得重放',async()=>{
  await mountMulti();await headerAction('group');await headerAction('id',{ctrlKey:true});const remove=button(text.remove(1,'分组')),props=Object.keys(remove).find(key=>key.startsWith('__reactProps$'))!,oldAction=(remove as any)[props].onClick;
  await click(text.later(1,'分组'));expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'},{columnKey:'group',direction:'ASC'}]);expect(grid().rows[0]).toBe(original.rows[0]);await act(async()=>oldAction());expect(grid().sortColumns).toHaveLength(2);
  await click(text.earlier(2,'分组'));await click(text.changeDirection(2,'编号'));expect(grid().rows[0]).toBe(original.rows[1]);await click(text.remove(1,'分组'));expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'DESC'}]);await click(text.clear);expect(grid().rows).toBe(original.rows);expect(document.querySelector('[aria-label="'+text.priorities+'"]')).toBeNull();
});
it('多列：选择复制及已选导出按同一视图原行，原SQL/会话/源顺序不改',async()=>{
  await mountMulti();const originalRows=original.rows,saved=structuredClone(original);await headerAction('group');await headerAction('id',{ctrlKey:true});await act(async()=>grid().onSelectedRowsChange(new Set([0,2])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[1])).toEqual(['2','1']);await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['2','1']);expect(original.rows).toBe(originalRows);expect(original).toEqual(saved);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);expect(commands.some(c=>c.startsWith('query.transaction'))).toBe(false);
});
it.each(['id','amount','stamp','duration'])('多列：%s次级键在React更新前漂移立即拒旧复制/导出/详情，恢复值不复活',async column=>{
  await mountMulti();await act(async()=>grid().onSortColumnsChange(['group','id','amount','stamp','duration'].map(columnKey=>({columnKey,direction:'ASC'}))));await act(async()=>grid().onSelectedRowsChange(new Set([0])));await act(async()=>grid().onActivePositionChange({row:grid().rows[0],rowIdx:0}));const old=grid(),exportNode=button(zh.resultExport.selectedTitle),detailNode=button(detailsText.open),getAction=(node:any)=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))!].onClick,exportAction=getAction(exportNode),detailAction=getAction(detailNode),raw=original.rows[0],saved=raw[column];
  raw[column]=column==='stamp'?'2026-10-19 12:00:00.000003':column==='duration'?'-100:00:00.000002':'7';expect(copy(old).size).toBe(0);await act(async()=>{exportAction();detailAction();});expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.querySelector('[role="region"]')).toBeNull();raw[column]=saved;expect(copy(old).size).toBe(0);await act(async()=>exportAction());expect(exports).toEqual([]);
});
it('多列：查找和行详情按同一视图，列布局变更和新查询撤销全部旧规则',async()=>{
  await mountMulti();await headerAction('group');await headerAction('id',{ctrlKey:true});const old=grid();await act(async()=>old.onActivePositionChange({row:old.rows[0],rowIdx:0}));await click(detailsText.open);expect(document.body.textContent).toContain('甲组早行');await click(detailsText.next);expect(document.body.textContent).toContain('甲组晚行');await click(detailsText.close);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await click(findText.open);const input=document.querySelector('input[aria-label="'+findText.input+'"]')!;await act(async()=>{input.value='甲组早行';input.dispatchEvent(new MemoryEvent('input'));});await act(async()=>{await vi.runAllTimersAsync();});await click(findText.next);expect(ports.scroll).toHaveBeenLastCalledWith({rowIdx:0,idx:6});vi.useRealTimers();await click(columnsText.open);const field=document.querySelector('input[aria-label="'+columnsText.visible(2)+'"]')!;await act(async()=>{field.checked=false;field.dispatchEvent(new MemoryEvent('click'));});await click(columnsText.apply);expect(grid().sortColumns).toEqual([]);expect(copy(old).size).toBe(0);await headerAction('group');await headerAction('amount',{ctrlKey:true});await click(zh.query.text010);expect(grid().sortColumns).toEqual([]);expect(grid().rows).toBe(original.rows);
});
it('多列：活动规则中途准入失败不部分排序，也不改变勾选/导出的视图',async()=>{
  await mountMulti();await headerAction('group');await headerAction('id',{ctrlKey:true});await act(async()=>grid().onSelectedRowsChange(new Set([0])));const current=grid();await act(async()=>current.onSortColumnsChange([...current.sortColumns,{columnKey:'bytes',direction:'ASC'}]));expect(grid().rows).toBe(current.rows);expect(grid().sortColumns).toEqual(current.sortColumns);expect(grid().selectedRows).toEqual(new Set([0]));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows[0][1]).toBe('2');
});
/** 筛选UI仍使用真实QueryTab和真实条件面板，仅通过RAM事件修改受控输入。 */
function reactProps(node:any){return node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))!];}
/** 走真实条件组件的受控启停入口；仅DOM宿主由内存实现。 */
async function enableFilterRule(index:number,enabled:boolean){const node=document.querySelector('[aria-label="'+filterText.enabled(index)+'"]')!;expect(node).not.toBeNull();await act(async()=>reactProps(node).onChange({target:{checked:enabled}}));}
/** 从真实分组选项读取目标，不按内部ID或显示编号推导节点身份；聚焦模拟键盘选择。 */
async function moveFilterRule(index:number,label:string){const node=document.querySelector('[aria-label="'+filterText.destination(index)+'"]')!;expect(node).not.toBeNull();expect(node.disabled).toBe(false);const option=node.querySelectorAll('option').find(option=>option.textContent===label);expect(option).toBeDefined();node.focus();await act(async()=>reactProps(node).onChange({target:{value:option!.value}}));}
/** 读取真实选择框的当前组名，既验证受控value也验证选项单选互斥。 */
function filterRuleGroup(index:number){const node=document.querySelector('[aria-label="'+filterText.destination(index)+'"]')!;expect(node).not.toBeNull();return node.querySelectorAll('option').find(option=>option.value===node.value)?.textContent;}

it('移动筛选条件：原交集改为括号内OR，只改草稿并保留精确原值和键盘焦点',async()=>{
  await mount();const saved=structuredClone(original);await click(filterText.open);await addFilterRule(1,'value','gt','0.00000000000000000000');await click(filterText.addGroup);await configureGroupedRule(2,'id','eq','18446744073709551615');await addFilterRule(3,'id','eq','9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([]);
  await click(filterText.open);await moveFilterRule(3,filterText.group('1'));expect(filterRuleGroup(3)).toBe(filterText.group('1'));expect(grid().rows).toEqual([]);
  expect(document.activeElement).toBe(document.querySelector('[aria-label="'+filterText.destination(3)+'"]'));expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('0.00000000000000000000');expect(document.querySelector('[aria-label="'+filterText.input+' 3"]')!.value).toBe('9007199254740993');
  await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);expect(copy().size).toBeGreaterThan(0);expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('移动筛选条件：嵌套组保留成员、区间、大小写和停用状态，取消恢复原树',async()=>{
  await mount();await click(filterText.open);await click(filterText.addGroup);await setFilterField(filterText.column+' 1','value');await setFilterField(filterText.operator+' 1','between');await setFilterField(filterText.lower+' 1','.12345678901234567890');await setFilterField(filterText.upper+' 1','.12345678901234567891');
  await click(filterText.addGroupInGroup('1'));await configureGroupedRule(2,'words','contains','行');await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.ignoreCase(2)+'"]')).onChange({target:{checked:true}}));await enableFilterRule(2,false);
  await click(filterText.add);await setFilterField(filterText.column+' 3','id');await setFilterField(filterText.operator+' 3','in');await setFilterField(filterText.member(3,1),'18446744073709551615');await click(filterText.addMember(3));await setFilterField(filterText.member(3,2),'9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await click(filterText.open);await moveFilterRule(3,filterText.group('1.1'));expect(filterRuleGroup(3)).toBe(filterText.group('1.1'));expect(document.querySelector('[aria-label="'+filterText.member(3,1)+'"]')!.value).toBe('18446744073709551615');expect(document.querySelector('[aria-label="'+filterText.member(3,2)+'"]')!.value).toBe('9007199254740993');
  expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(false);expect(document.querySelector('[aria-label="'+filterText.ignoreCase(2)+'"]')!.checked).toBe(true);expect(document.querySelector('[aria-label="'+filterText.lower+' 1"]')!.value).toBe('.12345678901234567890');
  await click(filterText.cancel);await click(filterText.open);expect(filterRuleGroup(3)).toBe(filterText.rootGroup);expect(filterRuleGroup(2)).toBe(filterText.group('1.1'));expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('移动筛选条件：移出后空原组明确拒绝，移除空组后可应用且不存在隐式删除',async()=>{
  await mount();await click(filterText.open);await click(filterText.addGroup);await configureGroupedRule(1,'id','eq','2');await click(filterText.apply);const before=grid().rows;await click(filterText.open);
  await moveFilterRule(1,filterText.rootGroup);expect(filterRuleGroup(1)).toBe(filterText.rootGroup);expect(document.body.textContent).toContain(filterText.emptyGroup);await click(filterText.apply);expect(grid().rows).toBe(before);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();
  await click(filterText.removeGroup('1'));expect(document.querySelector('[aria-label="'+filterText.destination(1)+'"]')).toBeNull();await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('移动筛选条件：无效目标和输入法不改草稿，旧回调先拒绝再读取事件，组编号复用不复活',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','2');await click(filterText.addGroup);await configureGroupedRule(2,'id','eq','2');
  const first=document.querySelector('[aria-label="'+filterText.destination(1)+'"]')!,old=reactProps(first).onChange,originalGroup=first.value;
  for(const value of ['', '-1','01','NaN','Infinity','99999999999999','3x'])await act(async()=>old({target:{value}}));expect(first.value).toBe(originalGroup);expect(filterRuleGroup(1)).toBe(filterText.rootGroup);
  const stale={get target():never{throw Error('被拒绝的旧事件不能读取新控件原值');}},input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;await act(async()=>reactProps(input).onCompositionStart());expect(first.disabled).toBe(true);await act(async()=>old(stale));await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.input+' 1"]')).onCompositionEnd());
  await moveFilterRule(1,filterText.group('1'));await act(async()=>old(stale));expect(filterRuleGroup(2)).toBe(filterText.group('1'));const beforeRemove=reactProps(document.querySelector('[aria-label="'+filterText.destination(1)+'"]')).onChange;
  await click(filterText.removeGroup('1'));await click(filterText.addGroup);await configureGroupedRule(1,'id','eq','9007199254740993');await act(async()=>beforeRemove(stale));expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});

it('批量启停：保留所有层级和原值，显式应用前不改视图，全部重启恢复原组合',async()=>{
  await mount();await click(filterText.open);expect(button(filterText.enableAll).disabled).toBe(true);expect(button(filterText.disableAll).disabled).toBe(true);
  await click(filterText.addGroup);await configureGroupedRule(1,'id','eq','2');await click(filterText.addGroupInGroup('1'));await configureGroupedRule(2,'id','eq','18446744073709551615');await addFilterRule(3,'id','eq','2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);
  await click(filterText.open);expect(button(filterText.enableAll).disabled).toBe(true);const before=grid().rows;await click(filterText.disableAll);expect(grid().rows).toBe(before);
  for(const index of [1,2,3])expect(document.querySelector('[aria-label="'+filterText.enabled(index)+'"]')!.checked).toBe(false);
  expect(document.querySelector('[aria-label="'+filterText.input+' 2"]')!.value).toBe('18446744073709551615');expect(button(filterText.disableAll).disabled).toBe(true);await click(filterText.apply);expect(grid().rows).toBe(original.rows);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.groupMode('1')+'"]')!.value).toBe('OR');expect(document.querySelector('[aria-label="'+filterText.groupMode('1.1')+'"]')!.value).toBe('OR');await click(filterText.enableAll);
  for(const index of [1,2,3])expect(document.querySelector('[aria-label="'+filterText.enabled(index)+'"]')!.checked).toBe(true);
  await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('批量启停：取消不改变已应用状态，草稿变更后旧批量回调不能重新覆盖',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','2');await addFilterRule(2,'id','eq','2');const oldDisable=reactProps(button(filterText.disableAll)).onClick;await enableFilterRule(1,false);
  await act(async()=>oldDisable());expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(true);await click(filterText.apply);
  await click(filterText.open);await click(filterText.enableAll);await click(filterText.cancel);await click(filterText.open);
  expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(true);
  const oldEnable=reactProps(button(filterText.enableAll)).onClick;await click(filterText.remove(1));await addFilterRule(2,'id','eq','9007199254740993');await act(async()=>oldEnable());expect(document.querySelector('[aria-label="'+filterText.input+' 2"]')!.value).toBe('9007199254740993');
  await click(filterText.apply);expect(grid().rows).toEqual([]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('批量启停：输入法组合阻止批量修改，重启无效草稿不覆盖原生效视图',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','2');await addFilterRule(2,'id','eq','未填写');await enableFilterRule(2,false);
  const disable=reactProps(button(filterText.disableAll)).onClick,enable=reactProps(button(filterText.enableAll)).onClick,input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;
  await act(async()=>reactProps(input).onCompositionStart());expect(button(filterText.enableAll).disabled).toBe(true);expect(button(filterText.disableAll).disabled).toBe(true);await act(async()=>{disable();enable();});expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(true);expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(false);
  await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.input+' 1"]')).onCompositionEnd());await click(filterText.disableAll);await click(filterText.apply);expect(grid().rows).toBe(original.rows);
  await click(filterText.open);await click(filterText.enableAll);const before=grid().rows;await click(filterText.apply);expect(grid().rows).toBe(before);expect(document.body.textContent).toContain(filterText.value);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();await click(filterText.cancel);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});

it('条件启停：停用保留原值与草稿，应用恢复全部行且保留排序，重开启用后重新筛选且不执行SQL',async()=>{
  await mount();await sort();await act(async()=>grid().onSelectedRowsChange(new Set([0])));await click(filterText.open);await addFilterRule(1,'id','eq','2');await enableFilterRule(1,false);
  expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(grid().selectedRows.size).toBe(0);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);await enableFilterRule(1,true);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('条件启停：复制、修改字段和取消均保留停用状态，重新启用坏值拒绝并保留旧视图',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','尚未填写');await enableFilterRule(1,false);await click(filterText.duplicate(1));expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(false);
  await setFilterField(filterText.column+' 2','words');expect(document.querySelector('[aria-label="'+filterText.enabled(2)+'"]')!.checked).toBe(false);await click(filterText.apply);expect(grid().rows).toBe(original.rows);
  await click(filterText.open);await enableFilterRule(1,true);await click(filterText.cancel);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);
  await enableFilterRule(1,true);const before=grid().rows;await click(filterText.apply);expect(grid().rows).toBe(before);expect(document.body.textContent).toContain(filterText.value);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();await setFilterField(filterText.input+' 1','2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);
});
it('条件启停：输入法组合和旧根回调不能改动当前草稿或移除后同编号条件',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','2');const old=reactProps(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')).onChange,input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;
  await act(async()=>reactProps(input).onCompositionStart());expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.disabled).toBe(true);await act(async()=>old({target:{checked:false}}));expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(true);
  await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.input+' 1"]')).onCompositionEnd());await enableFilterRule(1,false);await act(async()=>old({target:{checked:true}}));expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);
  await click(filterText.remove(1));await addFilterRule(1,'words','eq','晚行');await act(async()=>old({target:{checked:false}}));expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(true);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
/** 仅替代React键盘事件端口；真实面板及QueryTab处理草稿、选择和SQL调用。 */
function filterKey(options:Record<string,unknown>={}){return{key:'Enter',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,keyCode:13,nativeEvent:{isComposing:false},preventDefault:vi.fn(),stopPropagation:vi.fn(),...options};}
/** 仅通过已渲染的真实排序控件切换，不直接调用比较控制器或改原行。 */
async function toggleSortCase(order:number,name:string,checked:boolean){const node=document.querySelector('[aria-label="'+text.ignoreCase(order,name)+'"]')!;expect(node).not.toBeNull();await act(async()=>reactProps(node).onChange({target:{checked}}));}
async function setFilterField(label:string,value:string){const node=document.querySelector('[aria-label="'+label+'"]')!;expect(node).not.toBeNull();await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent(node.tagName==='SELECT'?'change':'input'));});}
async function addFilterRule(index:number,column:string,operator:string,value=''){await click(filterText.add);await setFilterField(filterText.column+' '+index,column);await setFilterField(filterText.operator+' '+index,operator);if(!['null','notNull','empty','notEmpty'].includes(operator))await setFilterField(filterText.input+' '+index,value);}
/** 配置已由分组创建的真实叶输入，不直调控制器或借根添加按钮改变树位置。 */
async function configureGroupedRule(index:number,column:string,operator:string,value:string){await setFilterField(filterText.column+' '+index,column);await setFilterField(filterText.operator+' '+index,operator);await setFilterField(filterText.input+' '+index,value);}
/** 真实ResultsGrid处理原活动位置；这里只替代虚拟布局，不读写系统剪贴板。 */
async function chooseFilterCell(index:number,key:string){const port=grid();await act(async()=>port.onActivePositionChange({row:port.rows[index],rowIdx:index,column:{key}}));}
it('复制筛选条件：区间副本留在原子组并紧随原条件，编辑副本不提交或改变原端点',async()=>{
  await mountMulti();const saved=structuredClone(original);await click(filterText.open);await click(filterText.addGroup);
  await setFilterField(filterText.column+' 1','id');await setFilterField(filterText.operator+' 1','between');await setFilterField(filterText.lower+' 1','9007199254740993');await setFilterField(filterText.upper+' 1','9007199254740993');await addFilterRule(2,'group','eq','A');
  await click(filterText.duplicate(1));expect(document.querySelector('[aria-label="'+filterText.column+' 2"]')!.value).toBe('id');expect(document.querySelector('[aria-label="'+filterText.column+' 3"]')!.value).toBe('group');
  expect(document.querySelector('[aria-label="'+filterText.upper+' 2"]')!.value).toBe('9007199254740993');await setFilterField(filterText.lower+' 2','2');await setFilterField(filterText.upper+' 2','2');
  expect(document.querySelector('[aria-label="'+filterText.lower+' 1"]')!.value).toBe('9007199254740993');expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')!.value).toBe('9007199254740993');expect(grid().rows).toBe(original.rows);
  await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);expect(original).toEqual(saved);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('复制筛选条件：列表和大小写选项独立保留，编辑副本后复制导出仍使用原文',async()=>{
  await mount(result=>{result.rows[0].words='a';result.rows[1].words='A';result.rows[2].words='B';});const saved=structuredClone(original);await click(filterText.open);await click(filterText.add);
  await setFilterField(filterText.column+' 1','words');await setFilterField(filterText.operator+' 1','in');await setFilterField(filterText.member(1,1),'a');await click(filterText.addMember(1));await setFilterField(filterText.member(1,2),'未匹配');
  await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')).onChange({target:{checked:true}}));await click(filterText.duplicate(1));
  expect(document.querySelector('[aria-label="'+filterText.ignoreCase(2)+'"]')!.checked).toBe(true);expect(document.querySelector('[aria-label="'+filterText.member(2,1)+'"]')!.value).toBe('a');
  await setFilterField(filterText.member(2,1),'b');await click(filterText.removeMember(2,2));expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('a');expect(document.querySelector('[aria-label="'+filterText.member(1,2)+'"]')!.value).toBe('未匹配');
  await setFilterField(filterText.mode,'OR');expect(grid().rows).toBe(original.rows);await click(filterText.apply);expect(grid().rows).toEqual(original.rows);await sort();await act(async()=>grid().onSelectedRowsChange(new Set([0,1,2])));
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any[])=>row[2])).toEqual(['B','A','a']);await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.words)).toEqual(['B','A','a']);expect(original).toEqual(saved);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('复制筛选条件：双击旧回调最多一次，达到32条禁用，移除后旧回调不能重新填满',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','18446744073709551615');const first=reactProps(button(filterText.duplicate(1))).onClick;await act(async()=>{first();first();});expect(document.querySelector('[aria-label="'+filterText.condition(3)+'"]')).toBeNull();
  for(let count=3;count<=31;count++)await click(filterText.duplicate(1));const old=reactProps(button(filterText.duplicate(1))).onClick;await click(filterText.duplicate(1));expect(button(filterText.duplicate(1)).disabled).toBe(true);
  await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.condition(33)+'"]')).toBeNull();await click(filterText.remove(32));expect(button(filterText.duplicate(1)).disabled).toBe(false);await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.condition(32)+'"]')).toBeNull();
  await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('复制筛选条件：组合输入不复制，移除后的旧按钮不能复制同编号新条件',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'words','eq','晚行');let input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;const old=reactProps(button(filterText.duplicate(1))).onClick;
  await act(async()=>reactProps(input).onCompositionStart());expect(button(filterText.duplicate(1)).disabled).toBe(true);await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.condition(2)+'"]')).toBeNull();
  input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;await act(async()=>reactProps(input).onCompositionEnd());await click(filterText.remove(1));await addFilterRule(1,'id','eq','2');await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.condition(2)+'"]')).toBeNull();
  await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it.each(['cancel','revision'] as const)('复制筛选条件：%s后旧面板按钮不能修改重开草稿',async mode=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','2');const old=reactProps(button(filterText.duplicate(1))).onClick;
  if(mode==='cancel'){await click(filterText.cancel);await click(filterText.open);await addFilterRule(1,'words','eq','晚行');}
  else await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});
  await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.condition(2)+'"]')).toBeNull();expect(grid().rows).toBe(original.rows);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('文本排序大小写：只在文本列显示控件，方向/NULL/优先级保留，移除后重加恢复默认',async()=>{
  await mount(result=>{result.rows[0].words='a';result.rows[1].words='B';result.rows[2].words='A';});await headerAction('id');expect(document.querySelector('[aria-label="'+text.ignoreCase(1,'同名')+'"]')).toBeNull();
  await headerAction('words');expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);await toggleSortCase(1,'原文',true);expect(grid().rows).toEqual([original.rows[0],original.rows[2],original.rows[1]]);
  await setFilterField(text.nulls(1,'原文'),'LAST');await headerAction('words');expect(grid().rows).toEqual([original.rows[1],original.rows[0],original.rows[2]]);expect(document.querySelector('[aria-label="'+text.ignoreCase(1,'原文')+'"]')!.checked).toBe(true);expect(document.querySelector('[aria-label="'+text.nulls(1,'原文')+'"]')!.value).toBe('LAST');
  await headerAction('id',{ctrlKey:true});expect(grid().rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);await click(text.earlier(2,'同名'));expect(document.querySelector('[aria-label="'+text.ignoreCase(2,'原文')+'"]')!.checked).toBe(true);expect(document.querySelector('[aria-label="'+text.nulls(2,'原文')+'"]')!.value).toBe('LAST');
  await click(text.remove(2,'原文'));await headerAction('words',{ctrlKey:true});expect(document.querySelector('[aria-label="'+text.ignoreCase(2,'原文')+'"]')!.checked).toBe(false);expect(document.querySelector('[aria-label="'+text.nulls(2,'原文')+'"]')!.value).toBe('');expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('文本排序大小写：旧选择撤销，真实复制和导出仍取原文而非小写比较键',async()=>{
  await mount(result=>{result.rows[0].words='a';result.rows[1].words='B';result.rows[2].words='A';});const saved=structuredClone(original);await headerAction('words');await act(async()=>grid().onSelectedRowsChange(new Set([0])));const old=grid();await toggleSortCase(1,'原文',true);expect(copy(old).size).toBe(0);expect(grid().selectedRows.size).toBe(0);
  await act(async()=>grid().onSelectedRowsChange(new Set([1,0])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any[])=>row[2])).toEqual(['a','A']);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.words)).toEqual(['a','A']);expect(original).toEqual(saved);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('文本排序大小写：旧控件不能修改替换后的数字排序或后来重建的文本规则',async()=>{
  await mount(result=>{result.rows[0].words='a';result.rows[1].words='B';result.rows[2].words='A';});await headerAction('words');const old=reactProps(document.querySelector('[aria-label="'+text.ignoreCase(1,'原文')+'"]')).onChange;
  await headerAction('value');const numeric=grid().rows;await act(async()=>old({target:{checked:true}}));expect(grid().rows).toBe(numeric);await headerAction('words');const current=grid().rows;await act(async()=>old({target:{checked:true}}));expect(grid().rows).toBe(current);expect(document.querySelector('[aria-label="'+text.ignoreCase(1,'原文')+'"]')!.checked).toBe(false);
  await toggleSortCase(1,'原文',true);expect(grid().rows).toEqual([original.rows[0],original.rows[2],original.rows[1]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it.each(['ctrlKey','metaKey'])('筛选快捷键：%s+Enter显式应用原草稿，清除旧选择且不重复执行SQL',async modifier=>{
  await mountMulti();await act(async()=>grid().onSelectedRowsChange(new Set([0])));await click(filterText.open);await addFilterRule(1,'group','eq','A');
  const panel=document.querySelector('[aria-label="'+filterText.title+'"]')!,key=reactProps(panel).onKeyDown,event=filterKey({[modifier]:true});
  expect(document.body.textContent).toContain(filterText.shortcuts);await act(async()=>key(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.stopPropagation).toHaveBeenCalledOnce();expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);expect(grid().selectedRows.size).toBe(0);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();
  const applied=grid().rows;await act(async()=>key(filterKey({[modifier]:true})));expect(grid().rows).toBe(applied);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('筛选快捷键：普通Enter、其它修饰键及长按不提交，单次明确命令才生效',async()=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'group','eq','B');const key=reactProps(document.querySelector('[aria-label="'+filterText.title+'"]')).onKeyDown;
  for(const options of [{},{ctrlKey:true,altKey:true},{metaKey:true,shiftKey:true},{ctrlKey:true,repeat:true}]){const event=filterKey(options);await act(async()=>key(event));expect(grid().rows).toBe(original.rows);if(!options.repeat){expect(event.preventDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();}}
  await act(async()=>key(filterKey({ctrlKey:true})));expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('筛选快捷键：子控件已消费的应用或取消不穿透，原筛选及重做历史保持',async()=>{
  await mountMulti();await filterGroup('A');await sort('id','DESC');await click(historyText.undo);const applied=grid().rows;
  await click(filterText.open);await setFilterField(filterText.input+' 1','B');const panel=document.querySelector('[aria-label="'+filterText.title+'"]')!,key=reactProps(panel).onKeyDown;
  for(const options of [{ctrlKey:true},{metaKey:true},{key:'Escape',keyCode:27}]){
    const event=filterKey({...options,defaultPrevented:true});await act(async()=>key(event));
    expect(event.preventDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBe(panel);expect(grid().rows).toBe(applied);
    expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('B');
  }
  await act(async()=>key(filterKey({key:'Escape',keyCode:27})));expect(button(historyText.redo).disabled).toBe(false);expect(grid().rows).toBe(applied);
  expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('筛选快捷键：带修饰键的Escape保留草稿，随后明确应用仍可撤销回原筛选',async()=>{
  await mountMulti();await filterGroup('A');const applied=grid().rows;
  await click(filterText.open);await setFilterField(filterText.input+' 1','B');const panel=document.querySelector('[aria-label="'+filterText.title+'"]')!,key=reactProps(panel).onKeyDown;
  for(const modifier of ['ctrlKey','metaKey','altKey','shiftKey']){
    const event=filterKey({key:'Escape',keyCode:27,[modifier]:true});await act(async()=>key(event));
    expect(event.preventDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBe(panel);expect(grid().rows).toBe(applied);
  }
  await act(async()=>key(filterKey({ctrlKey:true})));expect(grid().rows).toEqual([original.rows[0]]);
  await click(historyText.undo);expect(grid().rows).toEqual(applied);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it.each(['composition','native','229'])('筛选快捷键：%s输入法确认不应用或取消，完成后才接受命令',async mode=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'words','contains','甲组');const input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!,panel=document.querySelector('[aria-label="'+filterText.title+'"]')!;
  if(mode==='composition')await act(async()=>reactProps(input).onCompositionStart());const key=reactProps(panel).onKeyDown,extra=mode==='native'?{nativeEvent:{isComposing:true}}:mode==='229'?{keyCode:229}:{};
  for(const options of [{ctrlKey:true},{key:'Escape',keyCode:27}]){const event=filterKey({...options,...extra});await act(async()=>key(event));expect(event.preventDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();expect(grid().rows).toBe(original.rows);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();}
  if(mode==='composition')await act(async()=>reactProps(input).onCompositionEnd());await act(async()=>reactProps(document.querySelector('[aria-label="'+filterText.title+'"]')).onKeyDown(filterKey({metaKey:true})));expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('筛选快捷键：Escape只取消新草稿，旧面板命令不能应用或关闭后来面板',async()=>{
  await mountMulti();await filterGroup('A');const applied=grid().rows;await click(filterText.open);await setFilterField(filterText.input+' 1','B');const old=reactProps(document.querySelector('[aria-label="'+filterText.title+'"]')).onKeyDown,event=filterKey({key:'Escape',keyCode:27});await act(async()=>old(event));expect(grid().rows).toBe(applied);expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.stopPropagation).toHaveBeenCalledOnce();
  await click(filterText.open);await setFilterField(filterText.input+' 1','B');const current=document.querySelector('[aria-label="'+filterText.title+'"]');await act(async()=>{old(filterKey({ctrlKey:true}));old(filterKey({key:'Escape',keyCode:27}));});expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBe(current);expect(grid().rows).toBe(applied);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('筛选快捷键：连接修订ABA后旧回调永久拒绝，不复用恢复后的行或SQL',async()=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'group','eq','A');const old=reactProps(document.querySelector('[aria-label="'+filterText.title+'"]')).onKeyDown;
  await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});const before=grid().rows;await act(async()=>old(filterKey({ctrlKey:true})));expect(grid().rows).toBe(before);expect(commands.filter(value=>value==='query.execute')).toHaveLength(1);
});
it('当前单格可快捷填入精确条件，草稿取消保持原视图，旧按钮不能重放',async()=>{
  await mount();expect(button(filterText.cellEquals).disabled).toBe(true);await sort('id','DESC');const before=grid().rows;await chooseFilterCell(0,'value');const stale=reactProps(button(filterText.cellEquals)).onClick;await click(filterText.cellEquals);
  expect(document.querySelector('[aria-label="'+filterText.column+' 1"]')!.value).toBe('value');expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('0.12345678901234567891');expect(grid().rows).toBe(before);await click(filterText.cancel);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'DESC'}]);await act(async()=>stale());expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();
  await chooseFilterCell(0,'value');await click(filterText.cellEquals);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('原OR组在单格追加时整体与新条件AND组合，不扩大匹配范围',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'id','eq','18446744073709551615');await addFilterRule(2,'id','eq','9007199254740993');await setFilterField(filterText.mode,'OR');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await chooseFilterCell(0,'value');await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.mode+'"]')!.value).toBe('AND');expect(document.querySelector('[aria-label="'+filterText.groupMode('1')+'"]')!.value).toBe('OR');expect(document.querySelector('[aria-label="'+filterText.input+' 3"]')!.value).toBe('0.12345678901234567891');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);
  await chooseFilterCell(0,'value');await click(filterText.cellNotEquals);await click(filterText.apply);expect(grid().rows).toEqual([]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('单格NULL、空文本和NULL字样分别进入正确比较，不把字节解码为条件',async()=>{
  await mount(result=>{result.rows[0].words=null;result.rows[1].words='';result.rows[2].words='NULL';});await chooseFilterCell(0,'words');await click(filterText.cellNotEquals);expect(document.querySelector('[aria-label="'+filterText.operator+' 1"]')!.value).toBe('notNull');expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.disabled).toBe(true);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);
  await click(filterText.clear);await chooseFilterCell(1,'words');await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);
  await click(filterText.clear);await chooseFilterCell(2,'words');await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('NULL');await click(filterText.cancel);await chooseFilterCell(0,'bytes');expect(button(filterText.cellEquals).disabled).toBe(true);expect(button(filterText.cellNotEquals).disabled).toBe(true);
});
it('活动单格更换或原值漂移后旧快捷动作失效，恢复原值也须重新选择',async()=>{
  await mount();await chooseFilterCell(0,'id');const old=reactProps(button(filterText.cellEquals)).onClick;await chooseFilterCell(1,'id');await act(async()=>old());expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('9007199254740993');await click(filterText.cancel);
  await chooseFilterCell(0,'id');const drifted=reactProps(button(filterText.cellEquals)).onClick,value=original.rows[0].id;original.rows[0].id='2';await act(async()=>drifted());original.rows[0].id=value;await act(async()=>drifted());expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();await chooseFilterCell(0,'id');await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe(value);
});
it('快捷追加超出条件预算时不打开草稿、不丢原排序或选择',async()=>{
  await mount();await click(filterText.open);for(let index=1;index<=32;index++)await addFilterRule(index,'id','eq','18446744073709551615');await click(filterText.apply);await sort('id','DESC');await chooseFilterCell(0,'id');const before=grid().rows;await click(filterText.cellEquals);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();expect(document.body.textContent).toContain(filterText.budget);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'DESC'}]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('实际分组面板表达OR子组与AND根，排序、复制及导出使用同一原行',async()=>{
  await mount();const saved=structuredClone(original);await click(filterText.open);await click(filterText.addGroup);await configureGroupedRule(1,'id','eq','18446744073709551615');await click(filterText.addInGroup('1'));await configureGroupedRule(2,'id','eq','9007199254740993');await addFilterRule(3,'value','gte','0.12345678901234567890');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await sort();expect(grid().rows).toEqual([original.rows[1],original.rows[0]]);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.groupMode('1')+'"]')!.value).toBe('OR');await setFilterField(filterText.groupMode('1'),'AND');await click(filterText.cancel);expect(grid().rows).toEqual([original.rows[1],original.rows[0]]);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.groupMode('1')+'"]')!.value).toBe('OR');await click(filterText.cancel);await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[0])).toEqual(['9007199254740993','18446744073709551615']);await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows).toEqual([original.rows[1],original.rows[0]]);expect(original).toEqual(saved);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('嵌套子组独立组合且移除整组撤销其旧输入和删除回调',async()=>{
  await mount();await click(filterText.open);await click(filterText.addGroup);await configureGroupedRule(1,'id','eq','2');await click(filterText.addGroupInGroup('1'));await setFilterField(filterText.groupMode('1.1'),'AND');await configureGroupedRule(2,'id','eq','18446744073709551615');await click(filterText.addInGroup('1.1'));await configureGroupedRule(3,'value','gt','0');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[2]]);
  await click(filterText.open);const oldInput=reactProps(document.querySelector('[aria-label="'+filterText.input+' 2"]')).onChange,oldDelete=reactProps(button(filterText.removeGroup('1.1'))).onClick;await click(filterText.removeGroup('1.1'));await click(filterText.addGroupInGroup('1'));await configureGroupedRule(2,'id','eq','9007199254740993');await act(async()=>{oldInput({target:{value:'2'}});oldDelete();});expect(document.querySelector('[aria-label="'+filterText.input+' 2"]')!.value).toBe('9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);
});
it('空子组保留原排序并显示错误，补条件后才应用，清空根保留完整排序和全部原行',async()=>{
  await mount();await sort();const before=grid().rows;await click(filterText.open);await click(filterText.addGroup);await click(filterText.remove(1));await click(filterText.apply);expect(document.body.textContent).toContain(filterText.emptyGroup);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);await click(filterText.addInGroup('1'));await configureGroupedRule(1,'id','eq','2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);await click(filterText.open);await click(filterText.clearDraft);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
});
it('分组增删和应用在输入法组合期间受阻，完成后按最后输入匹配且不执行新SQL',async()=>{
  await mount();await click(filterText.open);await click(filterText.addGroup);await configureGroupedRule(1,'words','eq','早行');let input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;const oldApply=reactProps(button(filterText.apply)).onClick;await act(async()=>reactProps(input).onCompositionStart());expect(button(filterText.addGroup).disabled).toBe(true);expect(button(filterText.removeGroup('1')).disabled).toBe(true);expect(button(filterText.apply).disabled).toBe(true);await act(async()=>{reactProps(input).onChange({target:{value:'晚行'}});oldApply();});expect(grid().rows).toBe(original.rows);input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;await act(async()=>reactProps(input).onCompositionEnd());await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
async function filterGroup(value='A'){await click(filterText.open);await addFilterRule(1,'group','eq',value);await click(filterText.apply);}
/** 使用真实面板的复选回调；此RAM断言不冒充系统鼠标或原生窗口。 */
async function toggleFilterCase(index:number,checked:boolean){const input=document.querySelector('[aria-label="'+filterText.ignoreCase(index)+'"]')!;expect(input).not.toBeNull();expect(input.disabled).toBe(false);await act(async()=>reactProps(input).onChange({target:{checked}}));}
it('文本大小写选项默认关闭，应用后重开保留，排序复制导出保留原文',async()=>{
  await mount(result=>{result.rows[0].words='Ark';result.rows[1].words='ARK';result.rows[2].words='其他';});const saved=structuredClone(original);await click(filterText.open);await addFilterRule(1,'words','eq','ark');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(false);await click(filterText.apply);expect(grid().rows).toEqual([]);
  await click(filterText.open);await toggleFilterCase(1,true);await click(filterText.apply);await sort('words');expect(grid().rows).toEqual([original.rows[1],original.rows[0]]);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(true);await toggleFilterCase(1,false);await click(filterText.cancel);expect(grid().rows).toEqual([original.rows[1],original.rows[0]]);
  await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[2])).toEqual(['ARK','Ark']);await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.words)).toEqual(['ARK','Ark']);expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('大小写选项切换NULL或数值字段后清除，旧复选回调不能修改新草稿',async()=>{
  await mount();await click(filterText.open);await addFilterRule(1,'words','eq','Ark');await toggleFilterCase(1,true);const old=reactProps(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')).onChange;
  await setFilterField(filterText.operator+' 1','null');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')).toBeNull();await act(async()=>old({target:{checked:true}}));await setFilterField(filterText.operator+' 1','eq');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(false);
  await toggleFilterCase(1,true);await setFilterField(filterText.column+' 1','id');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')).toBeNull();await setFilterField(filterText.column+' 1','words');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(false);
});
it('忽略大小写可用于嵌套组和多值，切换否定保持选项并排除NULL',async()=>{
  await mount(result=>{result.rows[0].words='Ark';result.rows[1].words='ARK';result.rows[2].words=null;});await click(filterText.open);await click(filterText.addGroup);await configureGroupedRule(1,'words','eq','ark');await toggleFilterCase(1,true);await setFilterField(filterText.operator+' 1','in');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(true);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await click(filterText.open);await setFilterField(filterText.operator+' 1','notIn');await click(filterText.apply);expect(grid().rows).toEqual([]);
});
it('通配筛选显式选择、重开保留模式及大小写，原行复制导出仍共享视图',async()=>{
  await mount(result=>{result.rows[0].words='Ark';result.rows[1].words='ARK';result.rows[2].words='bark';});
  await click(filterText.open);await addFilterRule(1,'words','like','a_k');expect(document.body.textContent).toContain(filterText.patternHint);await toggleFilterCase(1,true);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('a_k');expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(true);await setFilterField(filterText.operator+' 1','notLike');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);
  await act(async()=>grid().onSelectedRowsChange(new Set([0])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows[0][2]).toBe('bark');await click(zh.resultExport.title);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows).toEqual([original.rows[2]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('非法通配模式保留原视图及草稿，修正后可应用，切换包含恢复字面含义',async()=>{
  await mount(result=>{result.rows[0].words='A%';result.rows[1].words='A_';result.rows[2].words='Ax';});
  await click(filterText.open);await addFilterRule(1,'words','like','A\\');await click(filterText.apply);expect(document.body.textContent).toContain(filterText.patternInvalid);expect(grid().rows).toEqual(original.rows);
  await setFilterField(filterText.input+' 1','A%');await click(filterText.apply);expect(grid().rows).toEqual(original.rows);
  await click(filterText.open);await setFilterField(filterText.operator+' 1','contains');expect(document.querySelector('.query-result-filter-pattern-hint')).toBeNull();await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('组合输入期间大小写复选禁用，旧回调也不能应用迟到开关',async()=>{
  await mount(result=>{result.rows[0].words='ARK';});await click(filterText.open);await addFilterRule(1,'words','eq','ark');const input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!,old=reactProps(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')).onChange;
  await act(async()=>reactProps(input).onCompositionStart());expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.disabled).toBe(true);await act(async()=>old({target:{checked:true}}));await act(async()=>reactProps(input).onCompositionEnd());expect(document.querySelector('[aria-label="'+filterText.ignoreCase(1)+'"]')!.checked).toBe(false);await click(filterText.apply);expect(grid().rows).toEqual([]);
});
/** 独立成员通过真实面板逐项输入，保留逗号和换行，不直调控制器。 */
async function addMemberRule(column:string,values:readonly string[],operator='in'){
  await click(filterText.add);await setFilterField(filterText.column+' 1',column);await setFilterField(filterText.operator+' 1',operator);
  for(let index=0;index<values.length;index++){if(index)await click(filterText.addMember(1));await setFilterField(filterText.member(1,index+1),values[index]);}
}
it('多值面板与排序、复制、导出共用精确原行，重开保留独立成员',async()=>{
  await mountMulti();await click(filterText.open);await addMemberRule('id',['9007199254740993','2']);await click(filterText.apply);await headerAction('group');await headerAction('id',{ctrlKey:true});expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('9007199254740993');expect(document.querySelector('[aria-label="'+filterText.member(1,2)+'"]')!.value).toBe('2');await setFilterField(filterText.member(1,1),'1');await click(filterText.cancel);expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('9007199254740993');await click(filterText.cancel);
  await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[1])).toEqual(['2','9007199254740993']);await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows).toEqual([original.rows[2],original.rows[1]]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('成员移除和切换操作撤销旧输入，重新进入列表不复活隐藏成员',async()=>{
  await mountMulti();await click(filterText.open);await addMemberRule('id',['1','2']);const old=reactProps(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')).onChange;await click(filterText.removeMember(1,1));await act(async()=>old({target:{value:'9007199254740993'}}));expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('2');
  await setFilterField(filterText.operator+' 1','notIn');expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0],original.rows[1]]);
  await click(filterText.open);await setFilterField(filterText.operator+' 1','eq');expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('');await setFilterField(filterText.operator+' 1','in');expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!.value).toBe('');await setFilterField(filterText.column+' 1','words');expect(document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')).toBeNull();await click(filterText.cancel);
});
it('成员输入法组合阻止应用和增删，完成后采用最后原文并排除NULL',async()=>{
  await mount(result=>{result.rows[0].words='a,b\n值';result.rows[1].words=null;result.rows[2].words='其他';});await click(filterText.open);await addMemberRule('words',['']);let input=document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!;
  await act(async()=>reactProps(input).onCompositionStart());expect(button(filterText.apply).disabled).toBe(true);expect(button(filterText.addMember(1)).disabled).toBe(true);await act(async()=>reactProps(input).onChange({target:{value:'a,b\n值'}}));input=document.querySelector('[aria-label="'+filterText.member(1,1)+'"]')!;await act(async()=>reactProps(input).onCompositionEnd());await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);
  await click(filterText.open);await setFilterField(filterText.operator+' 1','notIn');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('无效数字成员保留原排序和草稿，改正后原面板才应用',async()=>{
  await mountMulti();await headerAction('id');const before=grid().rows;await click(filterText.open);await addMemberRule('id',['2','坏值']);await click(filterText.apply);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(document.body.textContent).toContain(filterText.value);
  await setFilterField(filterText.member(1,2),'9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
});
/** 只操作真实条件面板的两个独立输入，不调用筛选控制器来伪造界面结果。 */
async function addRangeRule(column:string,operator:'between'|'notBetween',lower:string,upper:string){
  await click(filterText.add);await setFilterField(filterText.column+' 1',column);await setFilterField(filterText.operator+' 1',operator);
  await setFilterField(filterText.lower+' 1',lower);await setFilterField(filterText.upper+' 1',upper);
}
it('区间面板与多列排序、勾选复制和导出共用精确原行映射，重开保留两个端点',async()=>{
  await mountMulti();const saved=structuredClone(original);await click(filterText.open);await addRangeRule('id','between','2','9007199254740993');await click(filterText.apply);
  await headerAction('group');await headerAction('id',{ctrlKey:true});expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.lower+' 1"]')!.value).toBe('2');expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')!.value).toBe('9007199254740993');await click(filterText.cancel);
  await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[1])).toEqual(['2','9007199254740993']);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
  expect(exports[0].result.rows).toEqual([original.rows[2],original.rows[1]]);expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('小数简写经真实筛选面板应用，重开保留输入；排序、复制和导出仍使用精确原值',async()=>{
  await mount();const saved=structuredClone(original),input='.12345678901234567890';
  await click(filterText.open);await addFilterRule(1,'value','gte',input);await click(filterText.apply);
  await headerAction('value');expect(grid().rows).toEqual([original.rows[1],original.rows[0]]);
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe(input);await click(filterText.cancel);
  await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[1])).toEqual(['0.12345678901234567890','0.12345678901234567891']);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
  expect(exports[0].result.rows).toEqual([original.rows[1],original.rows[0]]);expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('离开区间移除上限并撤销旧输入，重新进入时须重新填写；文本字段不提供区间',async()=>{
  await mountMulti();await click(filterText.open);await addRangeRule('id','between','2','9007199254740993');
  const oldUpper=reactProps(document.querySelector('[aria-label="'+filterText.upper+' 1"]')).onChange;
  await setFilterField(filterText.operator+' 1','eq');await act(async()=>oldUpper({target:{value:'不能写回'}}));expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')).toBeNull();
  expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);
  await click(filterText.open);await setFilterField(filterText.operator+' 1','between');expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')!.value).toBe('');
  await setFilterField(filterText.column+' 1','words');expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')).toBeNull();expect(document.querySelector('[aria-label="'+filterText.operator+' 1"]')!.textContent).not.toContain(filterText.operators.between);
  await click(filterText.apply);expect(grid().rows).toEqual(original.rows);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('颠倒区间保留原排序和草稿，纠正上限后才替换结果',async()=>{
  await mountMulti();await headerAction('id');const before=grid().rows;await click(filterText.open);await addRangeRule('id','between','9007199254740993','2');await click(filterText.apply);
  expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(document.body.textContent).toContain(filterText.rangeOrder);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();
  await setFilterField(filterText.upper+' 1','9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(document.body.textContent).not.toContain(filterText.rangeOrder);
});
it('不介于面板排除NULL和闭区间端点，保留区间外的原行',async()=>{
  await mount(result=>{result.rows[0].value=null;});await click(filterText.open);await addRangeRule('value','notBetween','0.12345678901234567890','0.12345678901234567890');await click(filterText.apply);
  expect(grid().rows).toEqual([original.rows[2]]);expect(grid().rows[0]).toBe(original.rows[2]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('上限组合输入期间不应用，组合结束后按原精度使用最终上限',async()=>{
  await mountMulti();await click(filterText.open);await addRangeRule('amount','between','0.12345678901234567890','0.12345678901234567890');
  let upper=document.querySelector('[aria-label="'+filterText.upper+' 1"]')!;const apply=reactProps(button(filterText.apply)).onClick;
  await act(async()=>reactProps(upper).onCompositionStart());expect(button(filterText.apply).disabled).toBe(true);
  await act(async()=>{reactProps(upper).onChange({target:{value:'0.12345678901234567891'}});apply();});expect(grid().rows).toBe(original.rows);
  upper=document.querySelector('[aria-label="'+filterText.upper+' 1"]')!;await act(async()=>reactProps(upper).onCompositionEnd());await click(filterText.apply);expect(grid().rows).toEqual(original.rows);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).toBeNull();
  await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.upper+' 1"]')!.value).toBe('0.12345678901234567891');await click(filterText.cancel);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it.each([
  ['notContains','甲',[0]],['startsWith','甲',[2,1]],['notStartsWith','甲',[0]],['endsWith','早行',[2]],['notEndsWith','早行',[0,1]]
] as const)('文本条件%s通过实际面板应用，随后排序、复制与导出仍共享同一视图',async(operator,value,indices)=>{
  await mountMulti();const saved=structuredClone(original);await click(filterText.open);await addFilterRule(1,'words',operator,value);await click(filterText.apply);await headerAction('id');
  expect(grid().rows).toEqual(indices.map(index=>original.rows[index]));
  await act(async()=>grid().onSelectedRowsChange(new Set(indices.map((_,index)=>index))));
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows.map((row:any)=>row[1])).toEqual(indices.map(index=>original.rows[index].id));
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
  expect(exports[0].result.rows).toEqual(indices.map(index=>original.rows[index]));expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);expect(commands.some(command=>command.startsWith('query.transaction'))).toBe(false);
});
it.each(['empty','notEmpty'] as const)('文本条件%s清空并禁用原值输入，切回等于后仍区分空文本和NULL',async operator=>{
  await mount(result=>{result.rows[0].words='';result.rows[1].words=null;result.rows[2].words=' ';});await click(filterText.open);await addFilterRule(1,'words','eq','不能隐藏的旧值');await setFilterField(filterText.operator+' 1',operator);
  const input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;expect(input.disabled).toBe(true);expect(input.value).toBe('');await click(filterText.apply);
  expect(grid().rows).toEqual([original.rows[operator==='empty'?0:2]]);await click(filterText.open);await setFilterField(filterText.operator+' 1','eq');
  const restored=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;expect(restored.disabled).toBe(false);expect(restored.value).toBe('');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('筛选：真实面板草稿不改结果，取消不改已生效排序，AND/OR条件应用有原返回/过滤计数',async()=>{
  await mountMulti();await headerAction('id');const before=grid().rows;await click(filterText.open);await addFilterRule(1,'group','eq','A');expect(grid().rows).toBe(before);await click(filterText.cancel);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
  await click(filterText.open);await addFilterRule(1,'group','eq','A');await addFilterRule(2,'id','gt','9007199254740992');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(document.body.textContent).toContain(filterText.counts(3,1));expect(document.body.textContent).toContain(filterText.truncated);
  await click(filterText.open);await setFilterField(filterText.mode,'OR');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);await click(filterText.clear);expect(grid().rows).toEqual([original.rows[0],original.rows[2],original.rows[1]]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it.each([['id','gt','9007199254740992',1],['amount','eq','0.12345678901234567890',2],['stamp','eq','2026-10-19 12:00:00.000001',2],['duration','lt','-100:00:00.000000',2]] as const)('筛选：真实面板%s比较保留大数/小数/微秒/负时间',async(column,operator,value,sourceIndex)=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,column,operator,value);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[sourceIndex]]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('筛选：文本空串和NULL判断不混淆，未知类型只显示NULL比较，二进制原值比较明确报错',async()=>{
  await mount(result=>{result.columns[0].type='未知';result.rows[0].words='';result.rows[1].words=null;});await click(filterText.open);await addFilterRule(1,'id','notNull');expect(document.querySelector('[aria-label="'+filterText.operator+' 1"]')!.textContent).toBe(filterText.operators.null+filterText.operators.notNull);await click(filterText.apply);expect(grid().rows).toHaveLength(3);
  await click(filterText.open);await click(filterText.clearDraft);await addFilterRule(1,'words','eq','');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);await click(filterText.open);await setFilterField(filterText.operator+' 1','null');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);
  await click(filterText.open);await click(filterText.clearDraft);await addFilterRule(1,'bytes','eq','');const before=grid().rows;await click(filterText.apply);expect(grid().rows).toBe(before);expect(document.body.textContent).toContain(filterText.value);expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();await click(filterText.cancel);
});
it('筛选：逐条移除/清空草稿使用稳定条件身份，迟到旧输入不修改同位置下一条',async()=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'group','eq','A');await addFilterRule(2,'id','eq','2');const input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!,oldChange=reactProps(input).onChange;await click(filterText.remove(1));await act(async()=>oldChange({target:{value:'错误覆盖'}}));expect((document.querySelector('[aria-label="'+filterText.input+' 1"]') as any).value).toBe('2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);await click(filterText.open);await click(filterText.clearDraft);await click(filterText.apply);expect(grid().rows).toBe(original.rows);
});
it('筛选：过滤后多列排序、勾选复制及导出共同使用原行视图，变更撤销旧选择',async()=>{
  await mountMulti();const saved=structuredClone(original),sourceRows=original.rows;await filterGroup();await headerAction('group');await headerAction('id',{ctrlKey:true});expect(grid().rows).toEqual([original.rows[2],original.rows[1]]);await act(async()=>grid().onSelectedRowsChange(new Set([0])));const old=grid();expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows[0][1]).toBe('2');await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['2']);expect(original).toEqual(saved);expect(original.rows).toBe(sourceRows);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);expect(copy(old).size).toBe(0);
});
it('筛选：查找/详情沿过滤后排序的同一视图，清除筛选保留排序和原列引用',async()=>{
  await mountMulti();await filterGroup();await headerAction('id');await act(async()=>grid().onActivePositionChange({row:grid().rows[0],rowIdx:0}));await click(detailsText.open);expect(document.body.textContent).toContain('甲组早行');await click(detailsText.next);expect(document.body.textContent).toContain('甲组晚行');await click(detailsText.close);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await click(findText.open);const input=document.querySelector('input[aria-label="'+findText.input+'"]')!;await act(async()=>{input.value='甲组早行';input.dispatchEvent(new MemoryEvent('input'));});await act(async()=>{await vi.runAllTimersAsync();});await click(findText.next);expect(ports.scroll).toHaveBeenLastCalledWith({rowIdx:0,idx:6});vi.useRealTimers();await click(filterText.clear);expect(grid().rows).toEqual([original.rows[0],original.rows[2],original.rows[1]]);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);expect(grid().columns.filter((c:any)=>c.key!=='select-row').map((c:any)=>c.key)).toEqual(original.columns.map(c=>c.key));
});
it('筛选：被排除行的条件键在React更新前漂移也撤销旧复制/导出/详情，恢复不复活',async()=>{
  await mountMulti();await filterGroup();await headerAction('id');await act(async()=>grid().onSelectedRowsChange(new Set([0])));await act(async()=>grid().onActivePositionChange({row:grid().rows[0],rowIdx:0}));const old=grid(),exportAction=reactProps(button(zh.resultExport.selectedTitle)).onClick,detailAction=reactProps(button(detailsText.open)).onClick;original.rows[0].group='A';expect(copy(old).size).toBe(0);await act(async()=>{exportAction();detailAction();});expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.querySelector('[role="region"]')).toBeNull();original.rows[0].group='B';expect(copy(old).size).toBe(0);await act(async()=>exportAction());expect(exports).toEqual([]);
});
it('筛选：输入法组合期间不能应用/Enter取消，取消后的旧应用和compositionend不影响新面板',async()=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'words','contains','甲');let input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!,apply=reactProps(button(filterText.apply)).onClick;const oldEnd=reactProps(input).onCompositionEnd;await act(async()=>reactProps(input).onCompositionStart());expect(button(filterText.apply).disabled).toBe(true);await act(async()=>apply());expect(grid().rows).toBe(original.rows);await click(filterText.cancel);
  await click(filterText.open);await addFilterRule(1,'group','eq','B');await act(async()=>{apply();oldEnd();});expect(document.querySelector('[aria-label="'+filterText.title+'"]')).not.toBeNull();await click(filterText.apply);expect(grid().rows).toEqual([original.rows[0]]);
});
it('筛选：组合输入完成后保留原文显式应用，不靠按键或取消自动提交',async()=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'words','contains','');let input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;await act(async()=>reactProps(input).onCompositionStart());await act(async()=>reactProps(input).onChange({target:{value:'甲组早行'}}));input=document.querySelector('[aria-label="'+filterText.input+' 1"]')!;await act(async()=>reactProps(input).onCompositionEnd());expect(grid().rows).toBe(original.rows);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);
});
it.each(['inactive','new','result','version','job','modal','unmount','append'])('筛选：%s撤销旧面板租约，恢复状态后旧应用不能重放',async mode=>{
  await mountMulti();await click(filterText.open);await addFilterRule(1,'group','eq','A');const action=reactProps(button(filterText.apply)).onClick,saved=store.getState().settings;
  if(mode==='new')await click(zh.query.text010);if(mode==='result')await click(zh.query.text017+'2');if(mode==='inactive')await act(async()=>{store.setState({settings:{...saved,activeTabId:'other'}});store.setState({settings:saved});});if(mode==='version')await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});if(mode==='job')await act(async()=>{store.getState().setBusy('q',true);store.getState().setBusy('q',false);});if(mode==='modal'){const node=document.createElement('div');node.setAttribute('role','dialog');document.body.appendChild(node);node.parentNode!.removeChild(node);await act(async()=>{for(const observer of observers)observer([{addedNodes:[node]}]);});}if(mode==='append'){original.rows.push({...original.rows[0],id:'7'});original.rows.pop();original.rows[0]={...original.rows[0]};await act(async()=>action());}if(mode==='unmount'){await act(async()=>root!.unmount());root=undefined;}
  await act(async()=>action());expect(exports).toEqual([]);if(root)expect(grid().rows.length).toBe(3);expect(commands.some(c=>c.startsWith('query.transaction'))).toBe(false);
});
it('筛选：空结果仍显示原返回/过滤数量，可清除恢复，所有已返回导出不会回退原始全量',async()=>{
  await mountMulti();await filterGroup('无匹配');expect(grid().rows).toEqual([]);expect(document.body.textContent).toContain(filterText.counts(3,0));await click(zh.resultExport.title);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows).toEqual([]);expect(exports[0].rows).toBeUndefined();expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});

it('片段库打开和关闭保留筛选及多列排序，旧选择撤销且不会额外执行SQL',async()=>{
  await mountMulti();await filterGroup();await headerAction('group');await headerAction('id',{ctrlKey:true});
  const displayed=grid().rows,rules=grid().sortColumns,saved=structuredClone(original);
  await act(async()=>grid().onSelectedRowsChange(new Set([0])));const old=grid();
  // 片段列表仅使用明确RAM端口；真实QueryTab、父弹窗和结果视图仍共同运行。
  const invoke=(window as any).dbark.invoke;
  (window as any).dbark.invoke=async(command:string,input:unknown)=>{if(command==='snippets.list'){commands.push(command);return [];}return invoke(command,input);};
  await click(zh.snippets.title);const dialog=document.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();
  await act(async()=>{for(const observer of observers)observer([{addedNodes:[dialog]}]);});
  expect(grid().rows).toBe(displayed);expect(grid().sortColumns).toEqual(rules);expect(copy(old).size).toBe(0);
  expect(button(zh.resultExport.title).disabled).toBe(true);expect(document.body.textContent).toContain(filterText.counts(3,2));
  await click(zh.common.close);await act(async()=>{for(const observer of observers)observer([{addedNodes:[]}]);});
  expect(document.querySelector('[role="dialog"]')).toBeNull();expect(grid().rows).toBe(displayed);expect(grid().sortColumns).toEqual(rules);
  expect(grid().selectedRows.size).toBe(0);expect(copy(old).size).toBe(0);
  await act(async()=>grid().onSelectedRowsChange(new Set([0])));
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows[0][1]).toBe('2');
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
  expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['2']);expect(original).toEqual(saved);
  expect(commands.filter(command=>command==='snippets.list')).toHaveLength(1);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
  expect(commands.some(command=>command.startsWith('snippets.transfer')||command.startsWith('query.transaction'))).toBe(false);
});

it.each(['selected','all'] as const)('筛选和多列排序在%s连续导出模态前后保持，旧选择仍撤销',async mode=>{
  await mountMulti();await filterGroup();await headerAction('group');await headerAction('id',{ctrlKey:true});
  // 导出预览另有网格；查询区域总传完整排序数组，不能将最后渲染的预览当背景视图。
  const viewGrid=()=>[...ports.grids].reverse().find(props=>Array.isArray(props.sortColumns))!;
  const displayed=viewGrid().rows,rules=viewGrid().sortColumns,saved=structuredClone(original);
  const expected=displayed.map((row:any)=>row.id);expect(expected).toEqual(['2','9007199254740993']);
  for(const format of ['csv','json']){
    if(mode==='selected')await act(async()=>viewGrid().onSelectedRowsChange(new Set([1,0])));
    const old=viewGrid();await click(mode==='selected'?zh.resultExport.selectedTitle:zh.resultExport.title);
    // 导出锁只撤销操作权限，不能把背后的过滤视图替换成原始全集。
    expect(viewGrid().rows).toBe(displayed);expect(viewGrid().sortColumns).toEqual(rules);expect(copy(old).size).toBe(0);
    await setFilterField(zh.resultExport.format,format);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);
    expect(exports.at(-1).result.rows.map((row:any)=>row.id)).toEqual(expected);await click(zh.common.done);
    expect(viewGrid().rows).toBe(displayed);expect(viewGrid().sortColumns).toEqual(rules);expect(viewGrid().selectedRows.size).toBe(0);
    expect(copy(old).size).toBe(0);expect(document.body.textContent).toContain(filterText.counts(3,2));
  }
  expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});


it.each(['ctrlKey','metaKey'])('网格整理快捷键：%s撤销及重做原排序／空筛选，严格保留单次SQL',async modifier=>{
  await mount();await sort();const sorted=[original.rows[2],original.rows[1],original.rows[0]];
  await click(filterText.open);await addFilterRule(1,'id','eq','0');await click(filterText.apply);expect(grid().rows).toEqual([]);
  const command={ctrlKey:false,[modifier]:true},undo=await historyGridKey(command);expect(undo.preventGridDefault).toHaveBeenCalledOnce();expect(undo.preventDefault).toHaveBeenCalledOnce();expect(undo.stopPropagation).toHaveBeenCalledOnce();expect(grid().rows).toEqual(sorted);
  await historyGridKey(command);expect(grid().rows).toBe(original.rows);
  await historyGridKey({...command,shiftKey:true});expect(grid().rows).toEqual(sorted);
  await historyGridKey(modifier==='ctrlKey'?{key:'y'}:{...command,shiftKey:true});expect(grid().rows).toEqual([]);
  expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('网格整理快捷键：输入、输入法、旧消费事件和其它组合不改变视图，长按只消费不跨步',async()=>{
  await mount();await sort();const sorted=grid().rows,editable=document.createElement('span');(editable as any).isContentEditable=true;
  for(const options of [{ctrlKey:false},{altKey:true},{key:'y',shiftKey:true},{key:'y',ctrlKey:false,metaKey:true},{defaultPrevented:true},{nativeEvent:{isComposing:true}},{keyCode:229},{isGridDefaultPrevented:()=>true},...['input','textarea','select'].map(tag=>({target:document.createElement(tag)})),{target:editable}]){
    const event=await historyGridKey(options);expect(event.preventDefault).not.toHaveBeenCalled();expect(event.preventGridDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();expect(grid().rows).toBe(sorted);
  }
  const editing=await historyGridKey({},grid(),{mode:'EDIT'});expect(editing.preventDefault).not.toHaveBeenCalled();expect(grid().rows).toBe(sorted);
  const repeat=await historyGridKey({repeat:true});expect(repeat.preventDefault).toHaveBeenCalledOnce();expect(grid().rows).toBe(sorted);
  await historyGridKey();expect(grid().rows).toBe(original.rows);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('网格整理快捷键：旧渲染、排序草稿和连接ABA不能撤销当前结果',async()=>{
  await mount();await sort();await sort('id','DESC');const old=grid();await click(text.panelTitle);const sorted=grid().rows;
  const blocked=await historyGridKey({},old);expect(blocked.preventDefault).not.toHaveBeenCalled();expect(grid().rows).toBe(sorted);
  await click(text.panelCancel);await historyGridKey({},old);expect(grid().rows).toBe(sorted);
  const previous=grid(),event={key:'z',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,defaultPrevented:false,keyCode:90,nativeEvent:{isComposing:false},target:document.querySelector('[role="grid"]'),isGridDefaultPrevented:()=>false,preventGridDefault:vi.fn(),preventDefault:vi.fn(),stopPropagation:vi.fn()},args={mode:'ACTIVE',column:previous.columns.find((column:any)=>column.key==='id'),row:previous.rows[0],rowIdx:0};
  await act(async()=>{previous.onCellKeyDown(args,event);previous.onCellKeyDown(args,event);});expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
  const before=grid();await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});const unchanged=grid().rows;
  await historyGridKey({},before);expect(grid().rows).toBe(unchanged);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('网格整理快捷键：撤销清空旧勾选及旧复制，重做后导出仍保留精确当前行序',async()=>{
  await mount();await sort();await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));const old=grid();await historyGridKey();expect(grid().rows).toBe(original.rows);expect(grid().selectedRows.size).toBe(0);expect(copy(old).size).toBe(0);
  await historyGridKey({key:'y'});await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));
  const typed=JSON.parse(copy().get('application/x-dbark-cells')!);expect(typed.rows.map((row:any[])=>row[0])).toEqual(['2','9007199254740993']);
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['2','9007199254740993']);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('共享表格的活动行回调模式不接收整理快捷键，即使误传历史接口也不触发',async()=>{
  await mount();const onHistoryTravel=vi.fn();await act(async()=>root!.render(<Grid columns={original.columns} rows={original.rows} selectionScope={{}} isCurrent={()=>true} onActiveRowChange={()=>{}} onHistoryTravel={onHistoryTravel}/>));
  const event=await historyGridKey();expect(onHistoryTravel).not.toHaveBeenCalled();expect(event.preventDefault).not.toHaveBeenCalled();
});
it('整理历史：排序与筛选按整步撤销重做，恢复准确原行和空结果，不新增SQL',async()=>{
  await mount();const saved=structuredClone(original);expect(button(historyText.undo).disabled).toBe(true);expect(button(historyText.redo).disabled).toBe(true);
  await sort();expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await click(filterText.open);await addFilterRule(1,'id','eq','0');await click(filterText.apply);expect(grid().rows).toEqual([]);
  await click(historyText.undo);expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await click(historyText.undo);expect(grid().rows).toBe(original.rows);expect(button(historyText.undo).disabled).toBe(true);
  await click(historyText.redo);expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await click(historyText.redo);expect(grid().rows).toEqual([]);expect(button(historyText.redo).disabled).toBe(true);
  expect(original).toEqual(saved);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('整理历史：NULL位置、大小写及筛选停用原文保留，取消草稿不记步',async()=>{
  await mount();await sort('words');await toggleSortCase(1,'原文',true);await nullPosition(1,'原文','LAST');
  await click(filterText.open);await addFilterRule(1,'id','eq','未启用的精确原文');await enableFilterRule(1,false);await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);expect(grid().sortColumns).toEqual([{columnKey:'words',direction:'ASC'}]);
  await click(historyText.undo);expect(grid().sortColumns).toEqual([{columnKey:'words',direction:'ASC'}]);
  expect(document.querySelector('[aria-label="'+text.nulls(1,'原文')+'"]')!.value).toBe('LAST');expect(document.querySelector('[aria-label="'+text.ignoreCase(1,'原文')+'"]')!.checked).toBe(true);
  await click(filterText.open);await click(filterText.cancel);expect(button(historyText.redo).disabled).toBe(false);
  await click(historyText.redo);await click(filterText.open);expect(document.querySelector('[aria-label="'+filterText.enabled(1)+'"]')!.checked).toBe(false);expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('未启用的精确原文');await click(filterText.cancel);
  expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('整理历史：撤销后新排序截断重做，旧按钮闭包和重复点击不能多走一步',async()=>{
  await mount();await sort();await sort('id','DESC');const oldUndo=reactProps(button(historyText.undo)).onClick;
  await act(async()=>{oldUndo();oldUndo();});expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await act(async()=>oldUndo());expect(grid().rows).toEqual([original.rows[2],original.rows[1],original.rows[0]]);
  await sort('words');expect(button(historyText.redo).disabled).toBe(true);await click(historyText.undo);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
  expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});
it('整理历史：连接ABA、切换结果与新执行永久撤销原历史及旧按钮',async()=>{
  await mount();await sort();const oldUndo=reactProps(button(historyText.undo)).onClick;
  await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});expect(button(historyText.undo).disabled).toBe(true);
  const unchanged=grid().rows;await act(async()=>oldUndo());expect(grid().rows).toBe(unchanged);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);
  await sort('id','DESC');await click(zh.query.text017+'2');expect(button(historyText.undo).disabled).toBe(true);await click(zh.query.text017+'1');expect(button(historyText.undo).disabled).toBe(true);
  await sort();await click(zh.query.text010);expect(button(historyText.undo).disabled).toBe(true);expect(commands.filter(command=>command==='query.execute')).toHaveLength(2);
});

it('整理历史：撤销清空勾选和旧复制，重做后的复制及导出共享准确行序和精度',async()=>{
  await mount();await sort();const old=grid();await act(async()=>old.onSelectedRowsChange(new Set([0,2])));expect(button(zh.resultExport.selectedTitle).disabled).toBe(false);
  await click(historyText.undo);expect(button(zh.resultExport.selectedTitle).disabled).toBe(true);expect(copy(old).size).toBe(0);
  await click(historyText.redo);expect(button(zh.resultExport.selectedTitle).disabled).toBe(true);await act(async()=>grid().onSelectedRowsChange(new Set([0,1])));
  const typed=JSON.parse(copy().get('application/x-dbark-cells')!);expect(typed.rows.map((row:any[])=>row[0])).toEqual(['2','9007199254740993']);expect(typed.rows[1][1]).toBe('0.12345678901234567890');
  await click(zh.resultExport.selectedTitle);await click(zh.resultExport.chooseFile);await click(zh.resultExport.start);expect(exports[0].result.rows.map((row:any)=>row.id)).toEqual(['2','9007199254740993']);expect(exports[0].result.rows[1].value).toBe('0.12345678901234567890');await click(zh.common.done);expect(button(historyText.undo).disabled).toBe(false);await click(historyText.undo);expect(grid().rows).toBe(original.rows);expect(commands.filter(command=>command==='query.execute')).toHaveLength(1);
});

/** 仅替代本地IPC传输；实际持久化、来源令牌和Main发布门禁另由真实SQLite/Main测试覆盖。 */
function installPresetPort() {
  const previous = window.dbark.invoke;
  let state: QueryResultPresetSnapshot = queryResultPresetSnapshotSchema.parse({ version: 1, revision: 0, entries: [], source: { connectionRevision: 1, connectionDigest: 'a'.repeat(64) }, bindingToken: '00000000-0000-4000-8000-000000000001' });
  let nextId = 2;
  const calls: { command: string; input: any }[] = [];
  (window.dbark as any).invoke = async (command: any, input: any) => {
    if (!command.startsWith('result.presets.')) return previous(command, input);
    commands.push(command); calls.push({ command, input: structuredClone(input) });
    if (command === 'result.presets.list') return structuredClone(state);
    if (input.expectedRevision !== state.revision || input.bindingToken !== state.bindingToken) throw Error('本例过期方案修订');
    if (command === 'result.presets.read') return structuredClone(state.entries.find(entry => entry.id === input.id)!.value);
    const entries = structuredClone(state.entries);
    if (command === 'result.presets.save') {
      const entry = { id: input.replaceId ?? `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, name: input.name, connectionDigest: state.source.connectionDigest, value: queryResultPresetValueSchema.parse(input.value) };
      const index = entries.findIndex(item => item.id === entry.id); if (index < 0) entries.push(entry); else entries[index] = entry;
    } else if (command === 'result.presets.rename') entries.find(entry => entry.id === input.id)!.name = input.name;
    else if (command === 'result.presets.delete') entries.splice(entries.findIndex(entry => entry.id === input.id), 1);
    else throw Error('本例禁止未知方案命令');
    state = queryResultPresetSnapshotSchema.parse({ ...state, revision: state.revision + 1, entries }); return structuredClone(state);
  };
  return { calls, state: () => state, replace: (next: QueryResultPresetSnapshot) => { state = queryResultPresetSnapshotSchema.parse(next); } };
}
/** 使用已渲染方案字段；不直接向QueryTab注入方案或调用其私有控制器。 */
async function savePreset(name = '常用整理') { await click(presetsText.open); await setFilterField(presetsText.name, name); await click(presetsText.create); }
async function choosePreset(id: string) { await setFilterField(presetsText.choose, id); }

it('命名方案：完整多列和筛选跨查询应用，一次撤销重做，复制导出保留原精度', async () => {
  await mountMulti(); const port = installPresetPort(), originalCopy = structuredClone(original);
  await filterGroup(); await headerAction('group'); await headerAction('id', { ctrlKey: true });
  const expected = [...grid().rows], sorted = [...grid().sortColumns]; await savePreset();
  expect(port.state().entries[0].value.configuration.sort).toHaveLength(2);
  expect(JSON.stringify(port.state())).not.toContain('SELECT 原SQL'); expect(JSON.stringify(port.state())).not.toContain('甲组晚行');
  await click(zh.common.close); await click(zh.query.text010); const old = grid();
  await click(presetsText.open); await choosePreset(port.state().entries[0].id); await click(presetsText.apply);
  expect(grid().rows).toEqual(expected); expect(grid().sortColumns).toEqual(sorted); expect(copy(old).size).toBe(0);
  await click(historyText.undo); expect(grid().rows).toBe(original.rows); expect(grid().sortColumns).toEqual([]);
  await click(historyText.redo); expect(grid().rows).toEqual(expected);
  await act(async () => grid().onSelectedRowsChange(new Set([0, 1])));
  const typed = JSON.parse(copy().get('application/x-dbark-cells')!); expect(typed.rows[1][1]).toBe('9007199254740993');
  await click(zh.resultExport.selectedTitle); await click(zh.resultExport.chooseFile); await click(zh.resultExport.start);
  expect(exports[0].result.rows[1].amount).toBe('0.12345678901234567891'); expect(original).toEqual(originalCopy);
  expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it('命名方案：嵌套表达式、停用原文及NULL/大小写完整保存恢复，不平铺分组', async () => {
  await mount(); const port = installPresetPort();
  await click(filterText.open); await click(filterText.addGroup); await configureGroupedRule(1, 'id', 'eq', '不是整数但已停用'); await enableFilterRule(1, false);
  await addFilterRule(2, 'words', 'notNull'); await click(filterText.apply); await sort('words'); await nullPosition(1, '原文', 'FIRST'); await toggleSortCase(1, '原文', true);
  await savePreset(); const value = port.state().entries[0].value;
  expect(value.configuration.expression.children[0]).toMatchObject({ mode: 'OR', children: [{ enabled: false, value: '不是整数但已停用' }] });
  expect(value.configuration.sort).toEqual([{ column: 'words', direction: 'ASC', nulls: 'FIRST', ignoreCase: true }]);
  await click(zh.common.close); await click(zh.query.text010); await click(presetsText.open); await choosePreset(port.state().entries[0].id); await click(presetsText.apply);
  expect(document.querySelector('[aria-label="' + text.nulls(1, '原文') + '"]')!.value).toBe('FIRST');
  expect(document.querySelector('[aria-label="' + text.ignoreCase(1, '原文') + '"]')!.checked).toBe(true);
  await click(filterText.open); expect(document.querySelector('[aria-label="' + filterText.groupMode('1') + '"]')!.value).toBe('OR');
  expect(document.querySelector('[aria-label="' + filterText.input + ' 1"]')!.value).toBe('不是整数但已停用');
  expect(document.querySelector('[aria-label="' + filterText.enabled(1) + '"]')!.checked).toBe(false);
});

it.each(['type', 'name', 'order', 'visible', 'connection'] as const)('命名方案：%s不匹配拒绝应用且不改变当前结果', async mode => {
  await mount(); const port = installPresetPort(); await sort(); await savePreset(); await click(zh.common.close); await click(zh.query.text010);
  const snapshot = structuredClone(port.state());
  if (mode === 'connection') snapshot.entries[0].connectionDigest = 'b'.repeat(64);
  else if (mode === 'visible') snapshot.entries[0].value = { ...snapshot.entries[0].value, visible: snapshot.entries[0].value.visible.slice(1), configuration: { ...snapshot.entries[0].value.configuration, sort: [] } };
  else if (mode === 'order') snapshot.entries[0].value = { ...snapshot.entries[0].value, columns: [...snapshot.entries[0].value.columns].reverse() };
  else { snapshot.entries[0].value.columns[0][mode] = '变化'; snapshot.entries[0].value.visible[0][mode] = '变化'; }
  port.replace(snapshot); const rows = grid().rows; await click(presetsText.open); await choosePreset(snapshot.entries[0].id);
  expect(button(presetsText.apply).disabled).toBe(true); await act(async () => reactProps(button(presetsText.apply)).onClick());
  expect(grid().rows).toBe(rows); expect(port.calls.some(call => call.command === 'result.presets.read')).toBe(false);
  expect(document.body.textContent).toContain(mode === 'connection' ? presetsText.connectionChanged : presetsText.mismatch);
});

it('命名方案：完整试算失败保留当前视图和历史，不发布部分排序', async () => {
  await mount(); const port = installPresetPort(); await sort(); await savePreset(); await click(zh.common.close);
  original.rows[0].id = '新查询无效整数'; await click(zh.query.text010); const rows = grid().rows;
  await click(presetsText.open); await choosePreset(port.state().entries[0].id); await click(presetsText.apply);
  expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual([]); expect(button(historyText.undo).disabled).toBe(true);
  expect(document.body.textContent).toContain(text.value); expect(document.body.textContent).toContain(presetsText.refreshNeeded);
});

it('命名方案：同连接另一标签显式读取应用，原标签整理保持独立', async () => {
  await mount(); const port = installPresetPort(); await sort('id', 'DESC'); await savePreset(); await click(zh.common.close);
  const settings = store.getState().settings;
  await act(async () => store.setState({ settings: { ...settings, activeTabId: 'q2', tabs: [...settings.tabs, { id: 'q2', kind: 'query', connectionId: 'c', title: '第二标签', sql: 'SELECT 原SQL', databaseContext: { state: 'known', database: null } }] } }));
  const tabs = () => document.querySelectorAll('div').filter(node => node.getAttribute('class')?.split(' ').includes('query-tab'));
  const second = tabs()[1];
  /** 两标签仍真实挂载，仅按宿主节点选择当前标签的控件，避免全局同名按钮误点。 */
  async function currentClick(name: string) { const node = second.querySelectorAll('button').find(node => node.textContent === name || name === zh.query.text010 && node.textContent.startsWith(name)); expect(node).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => node!.dispatchEvent(new MemoryEvent('click'))); }
  await currentClick(zh.query.text010); expect(grid().sortColumns).toEqual([]); await currentClick(presetsText.open);
  await choosePreset(port.state().entries[0].id); await click(presetsText.apply);
  expect(grid().sortColumns).toEqual([{ columnKey: 'id', direction: 'DESC' }]);
  expect(grid().rows.map((row: any) => row.id)).toEqual(['18446744073709551615', '9007199254740993', '2']);
  await act(async () => store.setState({ settings: { ...store.getState().settings, activeTabId: 'q' } }));
  const first = tabs()[0]; expect(first.textContent).toContain(text.priority(1, '同名'));
  expect(port.calls.every(call => call.input.connectionId === 'c')).toBe(true); expect(commands.filter(command => command === 'query.execute')).toHaveLength(2);
});

it.each(['version', 'inactive', 'job', 'result', 'modal'] as const)('命名方案：%s期间的迟到回读不能复活旧结果', async mode => {
  await mount(); const port = installPresetPort(); await sort(); await savePreset(); await click(zh.common.close); await click(zh.query.text010);
  await click(presetsText.open); await choosePreset(port.state().entries[0].id);
  const previous = window.dbark.invoke; let resolve!: (value: unknown) => void;
  (window.dbark as any).invoke = (command: any, input: any) => command === 'result.presets.read' ? new Promise(done => { resolve = done; }) : previous(command, input);
  await click(presetsText.apply); expect(resolve).toBeDefined(); const settings = store.getState().settings;
  await act(async () => {
    if (mode === 'version') { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); }
    if (mode === 'inactive') { store.setState({ settings: { ...settings, activeTabId: 'other' } }); store.setState({ settings }); }
    if (mode === 'job') { store.getState().setBusy('q', true); store.getState().setBusy('q', false); }
    if (mode === 'result') reactProps(button(zh.query.text017 + '2')).onClick();
    if (mode === 'modal') { const node = document.createElement('div'); node.setAttribute('role', 'dialog'); document.body.appendChild(node); for (const observer of observers) observer([{ addedNodes: [node] }]); node.parentNode!.removeChild(node); }
  });
  const rows = grid().rows; await act(async () => resolve(port.state().entries[0].value));
  expect(grid().rows).toBe(rows); expect(grid().sortColumns).toEqual([]); expect(button(historyText.undo).disabled).toBe(true);
});

/** 等待实际统计组件的分批定时器；不调用聚合器重算期望值。 */
async function statisticsReady():Promise<void>{
  for(let attempt=0;attempt<20&&!document.querySelector('[aria-label="'+statisticsText.sum+'"]');attempt++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  expect(document.querySelector('[aria-label="'+statisticsText.sum+'"]')).not.toBeNull();
}
function statistic(label:string):string{return document.querySelector('[aria-label="'+label+'"]')!.textContent;}
it('列统计：无活动格时统计首列，精确BIGINT总和与循环平均数不经Number',async()=>{
  await mount();const rows=grid().rows;await click(statisticsText.open);await statisticsReady();
  expect(statistic(statisticsText.count)).toBe('3');expect(statistic(statisticsText.nonNull)).toBe('3');expect(statistic(statisticsText.nulls)).toBe('0');expect(statistic(statisticsText.distinct)).toBe('3');
  expect(statistic(statisticsText.sum)).toBe('18455751272964292610');expect(statistic(statisticsText.average)).toContain('6151917090988097536.666666666666666667');
  expect(document.body.textContent).toContain(statisticsText.truncated);await click(zh.common.close);expect(grid().rows).toBe(rows);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);expect(exports).toEqual([]);
});
it('列统计：默认已接纳勾选快照，切换列和全部范围保留20位DECIMAL与原结果',async()=>{
  await mount();await act(async()=>grid().onSelectedRowsChange(new Set([2,0])));await chooseFilterCell(1,'value');const rows=grid().rows;
  await click(statisticsText.open);await statisticsReady();expect(statistic(statisticsText.count)).toBe('2');expect(statistic(statisticsText.sum)).toBe('0.12345678901234567890');expect(statistic(statisticsText.average)).toBe('0.06172839450617283945');
  await setFilterField('统计范围','all');await statisticsReady();expect(statistic(statisticsText.count)).toBe('3');expect(statistic(statisticsText.sum)).toBe('0.24691357802469135780');expect(statistic(statisticsText.average)).toBe('0.08230452600823045260');
  await setFilterField('统计列','id');await statisticsReady();expect(statistic(statisticsText.sum)).toBe('18455751272964292610');
  await setFilterField('统计范围','selected');await statisticsReady();expect(statistic(statisticsText.sum)).toBe('18446744073709551617');expect(statistic(statisticsText.average)).toBe('9223372036854775808.5');
  await click(zh.common.close);expect(grid().rows).toBe(rows);expect(grid().selectedRows.size).toBe(0);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('列统计：只统计实际筛选视图，关闭不新增整理历史或重复执行SQL',async()=>{
  await mount();await chooseFilterCell(1,'id');await click(filterText.cellEquals);await click(filterText.apply);const rows=grid().rows;expect(rows).toHaveLength(1);
  await click(statisticsText.open);await statisticsReady();expect(statistic(statisticsText.sum)).toBe('9007199254740993');expect(statistic(statisticsText.count)).toBe('1');await click(zh.common.close);expect(grid().rows).toBe(rows);
  await click(historyText.undo);expect(grid().rows).toBe(original.rows);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it('列统计：空查询结果仍可显示零计数，全部NULL与空文本不混淆',async()=>{
  await mount(result=>{result.rows=[];});await click(statisticsText.open);await statisticsReady();expect(statistic(statisticsText.count)).toBe('0');expect(statistic(statisticsText.nonNull)).toBe('0');expect(statistic(statisticsText.distinct)).toBe('0');await click(zh.common.close);
});
it('列统计：BLOB仅计数，不解码二进制或提供伪造聚合',async()=>{
  await mount();await chooseFilterCell(0,'bytes');await click(statisticsText.open);await statisticsReady();expect(statistic(statisticsText.count)).toBe('3');expect(statistic(statisticsText.nonNull)).toBe('3');expect(statistic(statisticsText.sum)).toBe('—');expect(statistic(statisticsText.distinct)).toBe('—');expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});
it.each(['selection','column'] as const)('列统计：%s变化后旧按钮不能借新选择开窗口',async mode=>{
  await mount();await act(async()=>grid().onSelectedRowsChange(new Set([0])));await chooseFilterCell(0,'id');const old=reactProps(button(statisticsText.open)).onClick;
  if(mode==='selection')await act(async()=>grid().onSelectedRowsChange(new Set([1])));else await chooseFilterCell(0,'value');await act(async()=>old());
  expect(document.querySelector('[data-query-result-statistics-owner]')).toBeNull();await click(statisticsText.open);await statisticsReady();expect(statistic(statisticsText.sum)).toBe(mode==='selection'?'9007199254740993':'0.12345678901234567891');
});
it('列统计：伪造父选择回执拒绝，空集合也不能覆盖已有勾选',async()=>{
  await mount();await act(async()=>grid().onSelectedRowsChange(new Set([0,2])));const container=document.querySelectorAll('div').find(node=>reactProps(node)?.className==='query-result-grid')!,component=(reactProps(container).children as any).props;
  await act(async()=>component.onStatistics(original.columns[0],new Set([1])));expect(document.querySelector('[data-query-result-statistics-owner]')).toBeNull();
  await act(async()=>component.onStatistics(original.columns[0],new Set()));expect(document.querySelector('[data-query-result-statistics-owner]')).toBeNull();expect(grid().selectedRows.size).toBe(2);
});
it.each(['标签ABA','连接ABA','忙态ABA','新查询','新结果','外来模态'] as const)('列统计：%s撤销原窗口，旧关闭不能影响后来窗口',async mode=>{
  await mount();await click(statisticsText.open);await statisticsReady();const close=reactProps(button(zh.common.close)).onClick,saved=store.getState().settings;
  if(mode==='标签ABA')await act(async()=>{store.setState({settings:{...saved,activeTabId:'other'}});store.setState({settings:saved});});
  if(mode==='连接ABA')await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});
  if(mode==='忙态ABA')await act(async()=>{store.getState().setBusy('q',true);store.getState().setBusy('q',false);});
  if(mode==='新查询'){await click(zh.query.text010);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);await click(zh.common.close);await click(zh.query.text010);}if(mode==='新结果')await click(zh.query.text017+'2');
  if(mode==='外来模态'){const node=document.createElement('div');node.setAttribute('role','dialog');document.body.appendChild(node);node.parentNode!.removeChild(node);await act(async()=>{for(const observer of observers)observer([{addedNodes:[node]}]);});}
  expect(document.querySelector('[data-query-result-statistics-owner]')).toBeNull();await click(statisticsText.open);await statisticsReady();const owner=document.querySelector('[data-query-result-statistics-owner]')!.getAttribute('data-query-result-statistics-owner');await act(async()=>close());expect(document.querySelector('[data-query-result-statistics-owner]')!.getAttribute('data-query-result-statistics-owner')).toBe(owner);
});
it('列统计：所属模态观察不自我撤销，原列值漂移终止已完成指标',async()=>{
  await mount();await click(statisticsText.open);await statisticsReady();const dialog=document.querySelector('[role="dialog"]')!;
  await act(async()=>{for(const observer of observers)observer([{addedNodes:[dialog]}]);});expect(statistic(statisticsText.count)).toBe('3');
  original.rows[0].id='改值';await act(async()=>store.setState({settings:{...store.getState().settings,resultLimit:999}}));expect(document.querySelector('[aria-label="'+statisticsText.sum+'"]')).toBeNull();
});

/** 固定两代真实QueryTab结果；第二次仅修改RAM数据库端口的返回值，固定来源仍由实际克隆产生。 */
async function comparisonFixture(prepare?:(result:QueryResult)=>void):Promise<void>{
  await mount(prepare);await click(zh.query.pinResult);
  original.rows=[structuredClone(original.rows[0]),{...structuredClone(original.rows[1]),value:'0.12345678901234567891',words:'修改行',bytes:null},{...structuredClone(original.rows[2]),id:'3',words:'新增行'}];
  await click(zh.query.text010);await click(zh.query.pinResult);
}
async function comparisonKey(key:string,checked=true):Promise<void>{
  const node=document.querySelector('[aria-label="匹配键 '+key+'"]')!;expect(node).not.toBeNull();await act(async()=>reactProps(node).onChange({target:{checked}}));
}
async function comparisonReady():Promise<void>{
  for(let attempt=0;attempt<100&&!document.querySelector('output[aria-label="'+comparisonText.added+'"]');attempt++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  expect(document.querySelector('output[aria-label="'+comparisonText.added+'"]')).not.toBeNull();
}
function compared(label:string):string{return document.querySelector('output[aria-label="'+label+'"]')!.textContent;}
it('固定结果对比：需要两份固定快照和明确匹配键，未选键不开始且不执行SQL',async()=>{
  await mount();expect(button(comparisonText.open).disabled).toBe(true);await click(zh.query.pinResult);expect(button(comparisonText.open).disabled).toBe(true);
  await click(zh.query.text010);await click(zh.query.pinResult);await click(comparisonText.open);
  expect(button('开始对比').disabled).toBe(true);await act(async()=>reactProps(button('开始对比')).onClick());expect(document.querySelector('output')).toBeNull();expect(commands.filter(c=>c==='query.execute')).toHaveLength(2);
});
it('固定结果对比：按明确大整数键统计四类变化，字段详情保留精确原文与NULL、字节',async()=>{
  await comparisonFixture();const rows=grid().rows,rules=grid().sortColumns;await click(comparisonText.open);await comparisonKey('id');await click('开始对比');await comparisonReady();
  for(const label of [comparisonText.added,comparisonText.removed,comparisonText.changed,comparisonText.equal])expect(compared(label)).toBe('1');
  expect(document.querySelector('[aria-label="查看差异 1"]')).toBeNull();await click('查看差异 2');
  expect(document.querySelector('[aria-label="'+comparisonText.leftValue+' value"]')!.textContent).toContain('0.12345678901234567890');expect(document.querySelector('[aria-label="'+comparisonText.rightValue+' value"]')!.textContent).toContain('0.12345678901234567891');
  expect(document.querySelector('[aria-label="'+comparisonText.leftValue+' bytes"]')!.textContent).toContain('AP8=');expect(document.querySelector('[aria-label="'+comparisonText.rightValue+' bytes"]')!.textContent).toContain('NULL');
  await click(zh.common.close);expect(grid().rows).toBe(rows);expect(grid().sortColumns).toEqual(rules);expect(commands.filter(c=>c==='query.execute')).toHaveLength(2);expect(exports).toEqual([]);
});
it('固定结果对比：复合匹配键需明确选择，键变化显示移除和新增，不按行位置配对',async()=>{
  await comparisonFixture();await click(comparisonText.open);await comparisonKey('id');await comparisonKey('words');await click('开始对比');await comparisonReady();
  expect(compared(comparisonText.added)).toBe('2');expect(compared(comparisonText.removed)).toBe('2');expect(compared(comparisonText.changed)).toBe('0');expect(compared(comparisonText.equal)).toBe('1');expect(commands.filter(c=>c==='query.execute')).toHaveLength(2);
});
it('固定结果对比：差异类别和全部显示仅影响列表，左右来源调换反转新增移除及字段原值',async()=>{
  await comparisonFixture();await click(comparisonText.open);await comparisonKey('id');await click('开始对比');await comparisonReady();
  await setFilterField('差异范围','equal');expect(document.querySelector('[aria-label="查看差异 1"]')).not.toBeNull();expect(document.querySelector('[aria-label="查看差异 2"]')).toBeNull();expect(compared(comparisonText.changed)).toBe('1');
  await setFilterField('差异范围','all');expect(document.querySelector('[aria-label="查看差异 2"]')).not.toBeNull();await click('查看差异 3');expect(document.querySelector('[aria-label="'+comparisonText.leftValue+' id"]')!.textContent).toContain('2');
  const left=document.querySelector('[aria-label="左侧固定结果"]')!.value,right=document.querySelector('[aria-label="右侧固定结果"]')!.value;
  await setFilterField('左侧固定结果',right);expect(document.querySelector('output')).toBeNull();await setFilterField('右侧固定结果',left);await comparisonKey('id');await click('开始对比');await comparisonReady();
  expect(compared(comparisonText.added)).toBe('1');expect(compared(comparisonText.removed)).toBe('1');await click('查看差异 2');expect(document.querySelector('[aria-label="'+comparisonText.leftValue+' words"]')!.textContent).toContain('修改行');expect(document.querySelector('[aria-label="'+comparisonText.rightValue+' words"]')!.textContent).toContain('中行');
});
it('固定结果对比：字节不能被选择为匹配键，重复键整份拒绝不显示部分数量',async()=>{
  await comparisonFixture(result=>{result.rows[1].id=result.rows[0].id;});await click(comparisonText.open);expect(document.querySelector('[aria-label="匹配键 bytes"]')!.disabled).toBe(true);await comparisonKey('id');await click('开始对比');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});expect(document.querySelector('output')).toBeNull();expect(document.body.textContent).toContain('重复');expect(commands.filter(c=>c==='query.execute')).toHaveLength(2);
});
it('固定结果对比：对比自有模态不会撤销自己，来源固定不受后来原SQL结果对象变化影响',async()=>{
  await comparisonFixture();await click(comparisonText.open);const dialog=document.querySelector('[role="dialog"]')!;await act(async()=>{for(const observer of observers)observer([{addedNodes:[dialog]}]);});
  original.rows[0].id='后来对象';await comparisonKey('id');await click('开始对比');await comparisonReady();expect(compared(comparisonText.equal)).toBe('1');expect(compared(comparisonText.changed)).toBe('1');expect(document.body.textContent).toContain('截断');
});
it.each(['标签ABA','连接ABA','忙态ABA','外来模态','切换结果'] as const)('固定结果对比：%s撤销原窗口，旧关闭及开始不影响后继窗口',async mode=>{
  await comparisonFixture();await click(comparisonText.open);await comparisonKey('id');const start=reactProps(button('开始对比')).onClick,close=reactProps(button(zh.common.close)).onClick,saved=store.getState().settings;
  if(mode==='标签ABA')await act(async()=>{store.setState({settings:{...saved,activeTabId:'other'}});store.setState({settings:saved});});
  if(mode==='连接ABA')await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});
  if(mode==='忙态ABA')await act(async()=>{store.getState().setBusy('q',true);store.getState().setBusy('q',false);});
  if(mode==='外来模态'){const node=document.createElement('div');node.setAttribute('role','dialog');document.body.appendChild(node);node.parentNode!.removeChild(node);await act(async()=>{for(const observer of observers)observer([{addedNodes:[node]}]);});}
  if(mode==='切换结果')await click(zh.query.text017+'1');
  expect(document.querySelector('[data-query-result-comparison-owner]')).toBeNull();await click(comparisonText.open);const owner=document.querySelector('[data-query-result-comparison-owner]')!.getAttribute('data-query-result-comparison-owner');await act(async()=>{start();close();});
  expect(document.querySelector('[data-query-result-comparison-owner]')!.getAttribute('data-query-result-comparison-owner')).toBe(owner);expect(document.querySelector('output')).toBeNull();await comparisonKey('id');await click('开始对比');await comparisonReady();expect(compared(comparisonText.changed)).toBe('1');
});
it('固定结果对比：同步打开占住父门，旧网格筛选和导出在同一tick也被拒绝',async()=>{
  await comparisonFixture();const old=grid(),open=reactProps(button(comparisonText.open)).onClick,exportAll=reactProps(button(zh.resultExport.title)).onClick;
  await act(async()=>{open();old.onSelectedRowsChange(new Set([0]));exportAll();});expect(document.querySelector('[data-query-result-comparison-owner]')).not.toBeNull();expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);expect(exports).toEqual([]);expect(commands.filter(c=>c==='query.execute')).toHaveLength(2);
});
