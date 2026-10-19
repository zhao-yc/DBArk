import { act } from 'react';
import { afterAll,afterEach,beforeAll,expect,it,vi } from 'vitest';
import { memoryDocument,MemoryEvent } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { validateResultExportData } from '../../src/shared/resultExport';
import { queryResultCopyZh as copyText } from '../../src/renderer/locales/queryResultCopy.zh-CN';
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

/** 仅执行内存Document的copy分派端口；系统剪贴板及navigator接口一律禁止。 */
function clipboardPort() {
  const writes: Map<string,string>[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get() { throw Error('禁止访问系统剪贴板'); } });
  const execute = vi.fn(() => {
    const values = new Map<string,string>(), event = new MemoryEvent('copy') as any;
    event.clipboardData = { setData: (key:string,value:string) => values.set(key,value) };
    event.stopImmediatePropagation = () => event.stopPropagation(); document.dispatchEvent(event); writes.push(values); return true;
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execute });
  return { writes, execute };
}

it('真实QueryTab列显隐重排后点击含列名复制，所选矩阵与旧复制保持各自格式且无SQL重放', async () => {
  await mount(); const port = clipboardPort(), before = structuredClone(original);
  expect(button(copyText.action).disabled).toBe(true); await layout();
  await act(async () => mainGrid().onSelectedRowsChange(new Set([1,0]))); await click(copyText.action);
  expect(port.execute).toHaveBeenCalledOnce();
  expect(JSON.parse(port.writes[0].get('application/x-dbark-cells')!).rows).toEqual([
    ['字节','同名','同名','空值'],
    [{type:'binary',base64:'AP8='},'18446744073709551615','0.12345678901234567890',''],
    [{type:'binary',base64:''},'','1.00000000000000000001',null],
  ]);
  expect(port.writes[0].get('text/plain')).not.toContain('秘密');
  expect(JSON.parse(copy().get('application/x-dbark-cells')!).rows).toHaveLength(2);
  expect(mainGrid().selectedRows).toEqual(new Set([1,0])); expect(original).toEqual(before);
  expect(commands.filter(c => c === 'query.execute')).toHaveLength(1); expect(exports).toEqual([]);
});

it('真实网格活动单元格的重复别名仍绑定源key；整行、未知列和不符源行分别处理', async () => {
  await mount(); const port = clipboardPort();
  await act(async () => mainGrid().onActivePositionChange({ row: original.rows[1], rowIdx: 1, column: {key:'d'} })); await click(copyText.action);
  expect(JSON.parse(port.writes[0].get('application/x-dbark-cells')!).rows).toEqual([['同名'],['1.00000000000000000001']]);
  await act(async () => mainGrid().onActivePositionChange({ row: original.rows[0], rowIdx: 0 })); await click(copyText.action);
  expect(JSON.parse(port.writes[1].get('application/x-dbark-cells')!).rows[0]).toEqual(original.columns.map(c=>c.name));
  await act(async () => mainGrid().onActivePositionChange({ row: original.rows[0], rowIdx: 0, column: {key:'不存在'} })); expect(button(copyText.action).disabled).toBe(true);
  await act(async () => mainGrid().onActivePositionChange({ row: original.rows[0], rowIdx: 1, column: {key:'d'} })); expect(button(copyText.action).disabled).toBe(true);
  expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
});

it.each(['selection','layout','result','pin','version','job','inactive','modal','unmount'] as const)('%s变化后旧真实按钮永久失效，不能复制旧行列或借ABA恢复', async change => {
  await mount(); const port=clipboardPort(); await act(async()=>mainGrid().onSelectedRowsChange(new Set([0])));
  const stale=callback(button(copyText.action)),state=store.getState();
  if(change==='selection')await act(async()=>mainGrid().onSelectedRowsChange(new Set([1])));
  else if(change==='layout')await layout();
  else if(change==='result')await click(zh.query.text017+'2');
  else if(change==='pin')await click(zh.query.pinResult);
  else if(change==='version')await act(async()=>{store.setState({connectionVersions:{c:2}});store.setState({connectionVersions:{c:1}});});
  else if(change==='job')await act(async()=>{store.getState().setBusy('q',true);store.getState().setBusy('q',false);});
  else if(change==='inactive')await act(async()=>{store.setState({settings:{...state.settings,activeTabId:'other'}});store.setState({settings:state.settings});});
  else if(change==='modal'){const node=document.createElement('div');node.setAttribute('role','dialog');document.body.appendChild(node);node.parentNode!.removeChild(node);await act(async()=>{for(const observer of [...observers])observer([{addedNodes:[node]}]);});}
  else {await act(async()=>root!.unmount());root=undefined;}
  await act(async()=>stale()); expect(port.execute).not.toHaveBeenCalled(); expect(port.writes).toEqual([]);
});

