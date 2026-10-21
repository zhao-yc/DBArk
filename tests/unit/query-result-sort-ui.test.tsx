import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { QueryResult } from '../../src/shared/contracts';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFindZh as findText } from '../../src/renderer/locales/queryResultFind.zh-CN';
import { queryRowDetailsZh as detailsText } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
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
function button(name:string){const node=document.querySelectorAll('button').find(node=>node.textContent===name||node.getAttribute('aria-label')===name||name===zh.query.text010&&node.textContent.startsWith(name)||name===zh.resultExport.chooseFile&&node.textContent.includes(name));expect(node,'缺少按钮：'+name).toBeDefined();return node!;}
async function click(name:string){const node=button(name);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
async function sort(column='id',direction:'ASC'|'DESC'='ASC'){const before=grid();await act(async()=>before.onSortColumnsChange([{columnKey:column,direction}]));}
/** 使用真实优先级控件；保留RAM外界端口，不能把此检查当成原生窗口或系统输入。 */
async function nullPosition(order:number,name:string,value:''|'FIRST'|'LAST'){
  const node=document.querySelector('[aria-label="'+text.nulls(order,name)+'"]')!;expect(node).not.toBeNull();expect(node.disabled).toBe(false);
  await act(async()=>reactProps(node).onChange({target:{value}}));
}
function copy(current=grid()){const data=new Map<string,string>();current.onCellCopy({row:current.rows[0],column:{key:'id'}},{preventDefault(){},clipboardData:{setData:(key:string,value:string)=>data.set(key,value)}});return data;}

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

it('条件启停：停用保留原值与草稿，应用恢复原行，重开启用后重新筛选且不执行SQL',async()=>{
  await mount();await sort();await act(async()=>grid().onSelectedRowsChange(new Set([0])));await click(filterText.open);await addFilterRule(1,'id','eq','2');await enableFilterRule(1,false);
  expect(document.querySelector('[aria-label="'+filterText.input+' 1"]')!.value).toBe('2');await click(filterText.apply);expect(grid().rows).toBe(original.rows);expect(grid().sortColumns).toEqual([]);expect(grid().selectedRows.size).toBe(0);
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
it('空子组保留原排序并显示错误，补条件后才应用，清空根恢复准确原source',async()=>{
  await mount();await sort();const before=grid().rows;await click(filterText.open);await click(filterText.addGroup);await click(filterText.remove(1));await click(filterText.apply);expect(document.body.textContent).toContain(filterText.emptyGroup);expect(grid().rows).toBe(before);expect(grid().sortColumns).toEqual([{columnKey:'id',direction:'ASC'}]);await click(filterText.addInGroup('1'));await configureGroupedRule(1,'id','eq','2');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[2]]);await click(filterText.open);await click(filterText.clearDraft);await click(filterText.apply);expect(grid().rows).toBe(original.rows);
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
  await setFilterField(filterText.member(1,2),'9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);expect(grid().sortColumns).toEqual([]);
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
  await setFilterField(filterText.upper+' 1','9007199254740993');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);expect(grid().sortColumns).toEqual([]);expect(document.body.textContent).not.toContain(filterText.rangeOrder);
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
  await click(filterText.open);await addFilterRule(1,'group','eq','A');await addFilterRule(2,'id','gt','9007199254740992');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1]]);expect(grid().sortColumns).toEqual([]);expect(document.body.textContent).toContain(filterText.counts(3,1));expect(document.body.textContent).toContain(filterText.truncated);
  await click(filterText.open);await setFilterField(filterText.mode,'OR');await click(filterText.apply);expect(grid().rows).toEqual([original.rows[1],original.rows[2]]);await click(filterText.clear);expect(grid().rows).toBe(original.rows);expect(commands.filter(c=>c==='query.execute')).toHaveLength(1);
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
it('筛选：查找/详情沿过滤后排序的同一视图，清除筛选恢复原序和原列引用',async()=>{
  await mountMulti();await filterGroup();await headerAction('id');await act(async()=>grid().onActivePositionChange({row:grid().rows[0],rowIdx:0}));await click(detailsText.open);expect(document.body.textContent).toContain('甲组早行');await click(detailsText.next);expect(document.body.textContent).toContain('甲组晚行');await click(detailsText.close);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});await click(findText.open);const input=document.querySelector('input[aria-label="'+findText.input+'"]')!;await act(async()=>{input.value='甲组早行';input.dispatchEvent(new MemoryEvent('input'));});await act(async()=>{await vi.runAllTimersAsync();});await click(findText.next);expect(ports.scroll).toHaveBeenLastCalledWith({rowIdx:0,idx:6});vi.useRealTimers();await click(filterText.clear);expect(grid().rows).toBe(original.rows);expect(grid().sortColumns).toEqual([]);expect(grid().columns.filter((c:any)=>c.key!=='select-row').map((c:any)=>c.key)).toEqual(original.columns.map(c=>c.key));
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
