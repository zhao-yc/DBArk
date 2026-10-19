import { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterAll,afterEach,beforeAll,expect,it,vi } from 'vitest';
import { memoryDocument,MemoryEvent } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { validateResultExportData } from '../../src/shared/resultExport';
import { queryResultCopyZh as copyText } from '../../src/renderer/locales/queryResultCopy.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
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
async function mount(multiple = false){commands=[];exports=[];original={columns:[{key:'__proto__',name:'同名',type:'BIGINT'},{key:'d',name:'同名',type:'DECIMAL'},{key:'n',name:'空值',type:'TEXT'},{key:'b',name:'字节',type:'BLOB'},{key:'secret',name:'隐藏内容',type:'TEXT'}],rows:[JSON.parse('{"__proto__":"18446744073709551615","d":"0.12345678901234567890","n":"","b":{"type":"binary","base64":"AP8="},"secret":"秘密"}'),JSON.parse('{"__proto__":"","d":"1.00000000000000000001","n":null,"b":{"type":"binary","base64":""},"secret":"秘密"}')],truncated:true,elapsedMs:1,statement:'SELECT RAM'};second={...original,columns:[{key:'next',name:'新结果',type:'TEXT'}],rows:[{next:'新值'}]};
 if(multiple){ original.rows[0].n='同组';original.rows[1].n='同组';original.rows.push(JSON.parse('{"__proto__":"3","d":"0.50000000000000000000","n":"同组","b":{"type":"binary","base64":"AA=="},"secret":"秘密"}')); }
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

// Root组合验收：分别通过的排序与复制功能仍须共享同一实际视图，显示下标不能错指原行。
it('列布局后精确排序与含列名复制共用当前视图；恢复顺序撤销旧选择且不重发SQL', async () => {
  await mount(); const port = clipboardPort(), before = structuredClone(original);
  await layout(); await act(async()=>mainGrid().onSelectedRowsChange(new Set([0])));
  const stale = callback(button(copyText.action));
  await act(async()=>mainGrid().onSortColumnsChange([{columnKey:'d',direction:'DESC'}]));
  const sorted = grids.all.at(-1)!;
  expect(sorted.rows[0]).toBe(original.rows[1]); expect(sorted.rows[1]).toBe(original.rows[0]);
  expect(sorted.columns.filter((c:any)=>c.key!=='select-row').map((c:any)=>c.key)).toEqual(['b','__proto__','d','n']);
  expect(button(copyText.action).disabled).toBe(true);
  await act(async()=>stale()); expect(port.execute).not.toHaveBeenCalled();
  await act(async()=>sorted.onSelectedRowsChange(new Set([1,0]))); await click(copyText.action);
  expect(JSON.parse(port.writes[0].get('application/x-dbark-cells')!).rows).toEqual([
    ['字节','同名','同名','空值'],
    [{type:'binary',base64:''},'','1.00000000000000000001',null],
    [{type:'binary',base64:'AP8='},'18446744073709551615','0.12345678901234567890',''],
  ]);
  await act(async()=>grids.all.at(-1)!.onSelectedRowsChange(new Set()));
  await act(async()=>grids.all.at(-1)!.onActivePositionChange({row:sorted.rows[0],rowIdx:0,column:{key:'d'}}));
  await click(copyText.action);
  expect(JSON.parse(port.writes[1].get('application/x-dbark-cells')!).rows).toEqual([['同名'],['1.00000000000000000001']]);
  await click(sortText.clear); expect(grids.all.at(-1)!.rows).toBe(original.rows);
  expect(button(copyText.action).disabled).toBe(true); expect(original).toEqual(before);
  expect(commands.filter(c=>c==='query.execute')).toHaveLength(1); expect(exports).toEqual([]);
});

/** 运行已安装RDG的实际位置/鼠标事件函数；仅布局滚动与React状态端口在RAM。 */
function rdgCellClick(position: { current: any }, notifications: { count: number }) {
  const props = grids.all.at(-1)!, source = readFileSync(createRequire(import.meta.url).resolve('react-data-grid'),'utf8');
  const tree = ts.createSourceFile('rdg.js',source,ts.ScriptTarget.Latest,true), names=['isSamePosition','setPosition','handleMouseEvent','createCellEvent'];
  const functions = new Map<string,string>();
  function visit(node:ts.Node) { if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text)&&!functions.has(node.name.text))functions.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit); } visit(tree);
  expect(functions.size).toBe(names.length);
  const columns=props.columns.map((column:any,idx:number)=>({...column,idx})), column=columns[1];
  const api=runInNewContext([...functions.values()].join('\n')+'\n({setPosition,handleMouseEvent})',{
    validatePosition:()=>({isPositionInActiveBounds:true}),commitEditorChanges(){},activePosition:position.current,
    setActivePosition:(value:any)=>{position.current=value;},setPositionToFocus(){},scrollIntoView(){},getCellToScroll(){},gridRef:{current:{}},
    rows:props.rows,columns,onActivePositionChange:(value:any)=>{notifications.count++;props.onActivePositionChange(value);},
    rowIdx:0,row:props.rows[0],column,setActivePositionWrapper(){throw Error('本复制动作不得强改RDG位置');},
  });
  // 实际鼠标按下采用原位置处理，click独立分派；同坐标不人为补发活动回调。
  api.setPosition({rowIdx:0,idx:1}); api.handleMouseEvent(new MemoryEvent('click'),props.onCellClick);
}

it.each(['layout','binary'] as const)('%s撤销后同坐标点击可重新领取当前复制位置，旧按钮仍失效',async mode=>{
  await mount();const {ResultsGrid}=await import('../../src/renderer/components/ResultsGrid');
  const columns=mode==='layout'?[{key:'a',name:'甲',type:'TEXT'},{key:'b',name:'乙',type:'TEXT'}]:[{key:'b',name:'字节',type:'BLOB'}];
  const rows=mode==='layout'?[{a:'A',b:'B'}]:[{b:{type:'binary' as const,base64:'AA=='}}];
  const scope={},current=()=>true,props={columns,rows,selectionScope:scope,isCurrent:current};
  await act(async()=>root!.render(<ResultsGrid {...props}/>));const port=clipboardPort(),position={current:{rowIdx:-1,idx:-1}},notifications={count:0};
  await act(async()=>rdgCellClick(position,notifications));expect(button(copyText.action).disabled).toBe(false);
  const stale=callback(button(copyText.action));
  if(mode==='layout')await act(async()=>root!.render(<ResultsGrid {...props} columns={[columns[1],columns[0]]}/>));
  else {await act(async()=>grids.all.at(-1)!.onCellDoubleClick({row:rows[0],column:{key:'b'}}));await click(zh.dialogs.text001);}
  expect(button(copyText.action).disabled).toBe(true);await act(async()=>stale());expect(port.writes).toHaveLength(0);
  const before=notifications.count;await act(async()=>rdgCellClick(position,notifications));
  expect(notifications.count).toBe(before);expect(button(copyText.action).disabled).toBe(false);
  await click(copyText.action);expect(port.writes[0].get('text/plain')).toBe(mode==='layout'?'乙\nB':'字节\n0x00');
  await act(async()=>stale());expect(port.writes).toHaveLength(1);
});

it('多列排序的次级精确键决定复制顺序；次级值漂移即时拒绝旧含列名复制',async()=>{
  await mount(true);const port=clipboardPort(),before=structuredClone(original);await layout();
  await act(async()=>mainGrid().onSortColumnsChange([{columnKey:'n',direction:'ASC'},{columnKey:'d',direction:'DESC'}]));
  const sorted=grids.all.at(-1)!;
  expect(sorted.sortColumns).toEqual([{columnKey:'n',direction:'ASC'},{columnKey:'d',direction:'DESC'}]);
  expect(sorted.rows).toEqual([original.rows[1],original.rows[2],original.rows[0]]);
  await act(async()=>sorted.onSelectedRowsChange(new Set([2,0])));await click(copyText.action);
  expect(JSON.parse(port.writes[0].get('application/x-dbark-cells')!).rows).toEqual([
    ['字节','同名','同名','空值'],
    [{type:'binary',base64:''},'','1.00000000000000000001','同组'],
    [{type:'binary',base64:'AP8='},'18446744073709551615','0.12345678901234567890','同组'],
  ]);
  expect(original).toEqual(before);const stale=callback(button(copyText.action));
  // 无React重绘也要校验每个已应用键，不能凭首键或原显示下标继续复制。
  original.rows[2].d='2.00000000000000000001';await act(async()=>stale());expect(port.writes).toHaveLength(1);
  original.rows[2].d=before.rows[2].d;await act(async()=>stale());expect(port.writes).toHaveLength(1);
  expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);expect(exports).toEqual([]);
});
