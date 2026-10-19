import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFindZh as findText } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryRowDetailsZh as detailsText } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
const ports=vi.hoisted(()=>({grids:[] as any[],scroll:vi.fn()}));
// 仅虚拟布局/Monaco由RAM替代；真实QueryTab、选择/复制/查找/详情/导出及store均运行。
vi.mock('react-data-grid',async()=>{const {useImperativeHandle,useRef}=await import('react');return{SelectColumn:{key:'select-row'},DataGrid(props:any){const host=useRef<HTMLDivElement>(null);ports.grids.push(props);useImperativeHandle(props.ref,()=>({element:host.current,scrollToCell:ports.scroll}));return <div ref={host} role="grid"/>;}};});
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:()=>null}));
let Grid:typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'];
let QueryTab:typeof import('../../src/renderer/components/QueryTab')['QueryTab'],store:typeof import('../../src/renderer/store')['useWorkspace'],flush:typeof import('../../src/renderer/store')['flushSettings'];
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let original:QueryResult,commands:string[],exports:any[],observers:Set<Function>,events:((event:any)=>void)|undefined;
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT','MutationObserver','Element'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
beforeAll(async()=>{
  document=memoryDocument();(document as any).oninput=null;Object.assign(window,{setTimeout,clearTimeout,confirm:()=>true});const create=document.createElement.bind(document);
  document.createElement=name=>{const node=create(name);if(name==='input'){let kind='text';Object.defineProperty(node,'type',{configurable:true,get:()=>kind,set:value=>{kind=value;node.attributes.set('type',value);}});}if(name==='option')Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};return node;};
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
function button(name:string){const node=document.querySelectorAll('button').find(node=>node.textContent===name||node.getAttribute('aria-label')===name||name===zh.query.text010&&node.textContent.startsWith(name)||name===zh.resultExport.chooseFile&&node.textContent.includes(name));expect(node,'缺少按钮：'+name).toBeDefined();return node!;}
async function click(name:string){const node=button(name);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
async function sort(column='id',direction:'ASC'|'DESC'='ASC'){const before=grid();await act(async()=>before.onSortColumnsChange([{columnKey:column,direction}]));}
function copy(current=grid()){const data=new Map<string,string>();current.onCellCopy({row:current.rows[0],column:{key:'id'}},{preventDefault(){},clipboardData:{setData:(key:string,value:string)=>data.set(key,value)}});return data;}

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
