import { act } from 'react';
import { afterAll,afterEach,beforeAll,expect,it,vi } from 'vitest';
import { memoryDocument,MemoryEvent } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { validateResultExportData } from '../../src/shared/resultExport';
const grids=vi.hoisted(()=>({all:[] as any[]}));
// 只替换Monaco和虚拟网格的外界渲染端口，真实QueryTab／管理器／导出窗口／store均运行。
vi.mock('react-data-grid',()=>({DataGrid:(props:any)=>{grids.all.push(props);return null;},SelectColumn:{key:'select-row'}}));
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:()=>null}));
let QueryTab:typeof import('../../src/renderer/components/QueryTab')['QueryTab'],store:typeof import('../../src/renderer/store')['useWorkspace'],flush:typeof import('../../src/renderer/store')['flushSettings'];
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let original:QueryResult,second:QueryResult,commands:string[],exports:any[],observers:Set<Function>;
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT','MutationObserver','Element'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
beforeAll(async()=>{
 document=memoryDocument();(document as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout,confirm:()=>true});const create=document.createElement.bind(document);
 document.createElement=name=>{const node=create(name);if(name==='input'){let kind='text';Object.defineProperty(node,'type',{configurable:true,get:()=>kind,set:value=>{kind=value;node.attributes.set('type',value);}});node.type='text';}if(name==='option')Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
 observers=new Set();(globalThis as any).Element=create('div').constructor;(globalThis as any).MutationObserver=class{constructor(private callback:Function){observers.add(callback);}observe(){}disconnect(){observers.delete(this.callback);}};
 ({createRoot}=await import('react-dom/client'));({QueryTab}=await import('../../src/renderer/components/QueryTab'));({useWorkspace:store,flushSettings:flush}=await import('../../src/renderer/store'));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}await flush();delete(window as any).dbark;vi.restoreAllMocks();grids.all=[];});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
/** 只给真实查询端口合成响应；所有文件选择、写入和settings保存都是RAM事件。 */
async function mount(){commands=[];exports=[];original={columns:[{key:'__proto__',name:'同名',type:'BIGINT'},{key:'d',name:'同名',type:'DECIMAL'},{key:'n',name:'空值',type:'TEXT'},{key:'b',name:'字节',type:'BLOB'},{key:'secret',name:'隐藏内容',type:'TEXT'}],rows:[JSON.parse('{"__proto__":"18446744073709551615","d":"0.12345678901234567890","n":"","b":{"type":"binary","base64":"AP8="},"secret":"秘密"}'),JSON.parse('{"__proto__":"","d":"1.00000000000000000001","n":null,"b":{"type":"binary","base64":""},"secret":"秘密"}')],truncated:true,elapsedMs:1,statement:'SELECT RAM'};second={...original,columns:[{key:'next',name:'新结果',type:'TEXT'}],rows:[{next:'新值'}]};
 (window as any).dbark={onTask:()=>()=>{},onMenu:()=>()=>{},invoke:async(command:string,input:any)=>{commands.push(command);if(command==='settings.save'||command==='connections.open'||command==='sessions.close')return;if(command==='sessions.open')return {sessionId:'s'};if(command==='query.completionState')return {databaseKnown:true,database:null,temporaryObjects:[]};if(command==='query.execute')return {results:[original,second],elapsedMs:1,transactionOpen:false};if(command==='files.choose')return {token:'ram-file',name:'内存文件'};if(command==='files.exportResult'){validateResultExportData(input.result);exports.push(structuredClone(input));return {rows:input.result.rows.length};}throw Error('禁止外界命令：'+command);}};
 store.setState({settings:{theme:'light',sidebarWidth:260,resultLimit:1000,pageSize:100,activeTabId:'q',tabs:[{id:'q',kind:'query',connectionId:'c',title:'查询',sql:'SELECT RAM',databaseContext:{state:'known',database:null}}]},connections:[{id:'c',name:'RAM',group:'',color:'',dialect:'mysql',host:'offline.invalid',port:1,user:'ram'}],connectionVersions:{c:1},activeJobs:{},dirtyTabs:{}});
 function Harness(){const tabs=store(state=>state.settings.tabs);return tabs.map(tab=><QueryTab key={tab.id} tab={tab} onHistory={()=>{}}/>);}const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);await act(async()=>root!.render(<Harness/>));await click(zh.query.text010);
}
/** 按真实中文按钮或可访问列序号操作，重复别名不作身份。 */
function button(name:string){const node=document.querySelectorAll('button').find(node=>node.textContent===name||node.getAttribute('aria-label')===name||name===zh.query.text010&&node.textContent.startsWith(name));expect(node,'缺少按钮：'+name).toBeDefined();return node!;}
async function click(name:string){const node=button(name);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
async function toggle(position:number,checked:boolean){const node=document.querySelector(`input[aria-label="${text.visible(position)}"]`)!;expect(node).not.toBeNull();await act(async()=>{node.checked=checked;node.dispatchEvent(new MemoryEvent('click'));});}
/** 抓取旧的真实React闭包来覆盖重绘之后的迟到动作。 */
function callback(node:any,event='onClick'){const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('缺少真实React事件');return node[key][event] as Function;}
function mainGrid(){const props=[...grids.all].reverse().find(props=>props.rows===original.rows);expect(props).toBeDefined();return props!;}
/** 仅内存ClipboardEvent数据，不调用navigator.clipboard或系统剪贴板。 */
function copy(props=mainGrid()){const values=new Map<string,string>();props.onCellCopy({row:props.rows[0],column:{key:props.columns.find((c:any)=>c.key!=='select-row').key}},{preventDefault:vi.fn(),clipboardData:{setData:(key:string,value:string)=>values.set(key,value)}});return values;}
async function layout(){await click(text.open);await toggle(5,false);for(let i=0;i<3;i++)await click(text.up(4));await click(text.apply);}

import { queryRowDetailsZh as detailsText } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { QueryRowDetails, queryRowDetailsLimits } from '../../src/renderer/queryRowDetails';
import { QueryRowDetailsPanel } from '../../src/renderer/components/QueryRowDetailsPanel';

/** 活动位置由原网格rowIdx交付，勾选不作详情身份。 */
async function activate(index = 0, grid = mainGrid()) { await act(async () => grid.onActivePositionChange({ row: grid.rows[index], rowIdx: index })); }
const region = () => document.querySelector('[aria-label="查询结果行详情"]');
async function openDetails(index = 0, grid = mainGrid()) { await activate(index, grid); await click(detailsText.open); expect(region()).not.toBeNull(); }

it('完整原列顺序包含隐藏列，精确值普通文本显示；打开、翻行和关闭不改勾选/布局/复制或发命令', async () => {
  await mount(); const before = structuredClone(original); await layout();
  await act(async () => mainGrid().onSelectedRowsChange(new Set([1])));
  // 先结清前序布局的400ms保存，再验证详情操作没有新增任何请求；不能过滤settings.save掩盖副作用。
  await flush();
  const selected = [...mainGrid().selectedRows], copied = copy(), calls = [...commands], keys = mainGrid().columns.map((column: any) => column.key);
  await openDetails();
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(region()!.textContent).toContain(detailsText.scope);
  expect(region()!.querySelectorAll('article').map(node => node.querySelector('small')!.textContent)).toEqual(original.columns.map(column => column.type));
  expect(region()!.querySelectorAll('article').map(node => node.querySelector('pre')!.textContent)).toEqual(['18446744073709551615', '0.12345678901234567890', detailsText.empty, 'AP8=', '秘密']);
  expect(button(detailsText.previous).disabled).toBe(true); expect(region()!.textContent).toContain(detailsText.truncated);
  await click(detailsText.next); expect(button(detailsText.next).disabled).toBe(true);
  expect(region()!.querySelectorAll('pre').map(node => node.textContent)).toEqual([detailsText.empty, '1.00000000000000000001', detailsText.null, '', '秘密']);
  expect(region()!.textContent).toContain(detailsText.binary + ' · 0');
  // 内联region进入DOM不触发现有foreignModal观察器撤销选择。
  await act(async () => { for (const observer of [...observers]) observer([{ addedNodes: [region()] }]); });
  expect([...mainGrid().selectedRows]).toEqual(selected); expect(copy()).toEqual(copied); expect(mainGrid().columns.map((c: any) => c.key)).toEqual(keys);
  await click(detailsText.close); expect(region()).toBeNull(); expect(commands).toEqual(calls); expect(original).toEqual(before);
});

it('重复row引用按原行位置，非法rowIdx不启用；旧侧栏翻页/关闭不修改当前视图', async () => {
  await mount(); original.rows[1] = original.rows[0];
  // 改动已返回行的身份会撤销旧绑定；重新执行RAM响应后才验证重复引用的原位置。
  await click(zh.query.text010);
  await act(async () => mainGrid().onActivePositionChange({ row: original.rows[0], rowIdx: -1 })); expect(button(detailsText.open).disabled).toBe(true);
  await openDetails(1); expect(region()!.textContent).toContain('行详情 · 2 / 2');
  const close = callback(button(detailsText.close)), previous = callback(button(detailsText.previous));
  await click(detailsText.previous); expect(region()!.textContent).toContain('行详情 · 1 / 2');
  await act(async () => { close(); previous(); }); expect(region()!.textContent).toContain('行详情 · 1 / 2');
  const input = document.querySelector(`input[aria-label="${detailsText.row}"]`)!;
  const change = callback(input, 'onChange');
  for (const value of ['0', '-1', '3', '1.5', '1e0', '999999']) { await act(async () => change({ target: { value } })); expect(button(detailsText.go).disabled).toBe(true); }
  await act(async () => change({ target: { value: '2' } })); await click(detailsText.go); expect(region()!.textContent).toContain('行详情 · 2 / 2');
});

it.each(['result', 'pin', 'version', 'job', 'inactive', 'connection', 'closed', 'new', 'modal', 'unmount'] as const)('%s变化及恢复后旧活动行/详情回调永久失效且不能关闭新详情', async change => {
  await mount(); await openDetails(); const oldGrid = mainGrid(), oldOpen = callback(button(detailsText.open)), oldNext = callback(button(detailsText.next)), oldClose = callback(button(detailsText.close)), state = store.getState();
  if (change === 'result') { await click(zh.query.text017 + '2'); await click(zh.query.text017 + '1'); }
  if (change === 'pin') { await click(zh.query.pinResult); await click(zh.query.currentResults); }
  if (change === 'version') await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  if (change === 'job') await act(async () => { store.getState().setBusy('q', true); store.getState().setBusy('q', false); });
  if (change === 'inactive') await act(async () => { store.setState({ settings: { ...state.settings, activeTabId: 'other' } }); store.setState({ settings: state.settings }); });
  if (change === 'connection') await act(async () => { store.setState({ settings: { ...state.settings, tabs: state.settings.tabs.map(tab => ({ ...tab, connectionId: 'other' })) } }); store.setState({ settings: state.settings }); });
  if (change === 'closed') await act(async () => { store.setState({ settings: { ...state.settings, tabs: [] } }); store.setState({ settings: state.settings }); });
  if (change === 'new') await click(zh.query.text010);
  if (change === 'modal') { const node = document.createElement('div'); node.setAttribute('role', 'dialog'); document.body.appendChild(node); node.parentNode!.removeChild(node); await act(async () => { for (const observer of [...observers]) observer([{ addedNodes: [node] }]); }); }
  if (change === 'unmount') { await act(async () => root!.unmount()); root = undefined; }
  // 当前动作的合法保存必须先完成，后续旧闭包仍逐项比较完整请求基线。
  await flush();
  const calls = [...commands];
  await act(async () => { oldGrid.onActivePositionChange({ row: original.rows[0], rowIdx: 0 }); oldOpen(); oldNext(); oldClose(); });
  expect(region()).toBeNull(); expect(commands).toEqual(calls);
  if (change !== 'unmount') { await openDetails(); await act(async () => { oldNext(); oldClose(); oldOpen(); }); expect(region()!.textContent).toContain('行详情 · 1 / 2'); expect(commands).toEqual(calls); }
});

it('固定快照详情含隐藏列，返回当前结果后旧快照动作不能重开', async () => {
  await mount(); await click(zh.query.pinResult); const pinned = grids.all.at(-1); await layout();
  const grid = grids.all.at(-1); await openDetails(0, grid); expect(region()!.textContent).toContain('秘密');
  const old = callback(button(detailsText.next)); await click(zh.query.currentResults); await act(async () => old()); expect(region()).toBeNull();
  expect(pinned.rows).not.toBe(original.rows); expect(commands.filter(command => command === 'query.execute')).toHaveLength(1);
});

it('宽行按24原列分页，单个长值展开有预算，HTML/JSON保持React文本；旧展开/翻页闭包拒绝', async () => {
  (window as any).dbark = { invoke: async (command: string) => { if (command !== 'settings.save') throw Error('禁止外界命令：' + command); } };
  const long = 'x'.repeat(queryRowDetailsLimits.expanded + 100), controller = new QueryRowDetails();
  const columns = Array.from({ length: 27 }, (_, i) => ({ key: 'k' + i, name: '同名', type: 'TEXT' }));
  const values = columns.map((column, i) => i === 2 ? '<script>全为文本</script>' : i === 3 ? '{"a":1,"a":2}' : long);
  const source = { columns, rows: [Object.fromEntries(columns.map((column, i) => [column.key, values[i]]))], statement: 'RAM', elapsedMs: 0, truncated: false };
  let view = controller.open(controller.bind(source, []), 0);
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  const render = () => root!.render(<QueryRowDetailsPanel key={view.id} controller={controller} view={view} isCurrent={() => true} onMove={() => {}} onClose={() => {}}/>);
  await act(async () => render()); expect(region()!.querySelectorAll('article')).toHaveLength(24); expect(region()!.querySelectorAll('script')).toHaveLength(0);
  expect(region()!.querySelectorAll('pre')[0].textContent.length).toBe(256); expect(region()!.querySelectorAll('pre')[2].textContent).toBe(values[2]); expect(region()!.querySelectorAll('pre')[3].textContent).toBe(values[3]);
  const expands = region()!.querySelectorAll('button').filter(node => node.textContent === detailsText.expand);
  const oldExpand = callback(expands[0]), oldPage = callback(button(detailsText.fieldsNext)); await act(async () => expands[0].dispatchEvent(new MemoryEvent('click')));
  expect(region()!.querySelectorAll('pre')[0].textContent.length).toBe(65536); expect(region()!.textContent).toContain(detailsText.budget);
  await act(async () => expands[1].dispatchEvent(new MemoryEvent('click'))); expect(region()!.querySelectorAll('pre')[0].textContent.length).toBe(256); expect(region()!.querySelectorAll('pre')[1].textContent.length).toBe(65536);
  await click(detailsText.fieldsNext); expect(region()!.querySelectorAll('article')).toHaveLength(3); expect(region()!.querySelectorAll('article')[0].textContent).toContain('25. 同名');
  controller.invalidate(); view = controller.open(controller.bind(source, []), 0); await act(async () => render());
  await act(async () => { oldExpand(); oldPage(); }); expect(region()!.querySelectorAll('article')).toHaveLength(24); expect(region()!.querySelectorAll('pre')[0].textContent.length).toBe(256);
});
