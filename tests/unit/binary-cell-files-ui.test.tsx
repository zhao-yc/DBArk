import { act, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, DataRow, ResultColumn } from '../../src/shared/contracts';
import type { RecordContext } from '../../src/renderer/recordViews';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { binaryCellFilesZh as text } from '../../src/renderer/locales/binaryCellFiles.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const port=vi.hoisted(()=>({invoke:vi.fn(async(_command:string,_input?:any):Promise<any>=>null),grid:null as any}));
vi.mock('../../src/renderer/lib',async original=>({...await original<typeof import('../../src/renderer/lib')>(),invoke:port.invoke}));
// 仅替换没有布局的RDG端口；原ResultsGrid、来源守卫、Modal与查看器均真实运行。
vi.mock('react-data-grid',()=>({SelectColumn:{key:'select',name:''},DataGrid(props:any){port.grid=props;return <div role="grid"/>;}}));
let doc:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined;
let Viewer:typeof import('../../src/renderer/components/BinaryCellViewer')['BinaryCellViewer'],Editor:typeof import('../../src/renderer/components/RecordValueEditor')['RecordValueEditor'],Grid:typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'];
let useRecords:typeof import('../../src/renderer/hooks/useRecordViews')['useRecordViews'],store:typeof import('../../src/renderer/store')['useWorkspace'];
const globals=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
beforeAll(async()=>{
  doc=memoryDocument();(doc as any).oninput=null;const create=doc.createElement.bind(doc);
  /** 只补标准HTML属性反射，不修改产品ref、state或来源判断。 */
  doc.createElement=name=>{const node=create(name),set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key.toLowerCase(),value);if(key==='disabled')node.disabled=true;};node.removeAttribute=key=>{remove(key.toLowerCase());if(key==='disabled')node.disabled=false;};
    if(name==='option'){Object.defineProperty(node,'value',{configurable:true,get:()=>node.attributes.get('value')??node.textContent,set:value=>node.attributes.set('value',value)});let selected=false;Object.defineProperty(node,'selected',{get:()=>selected,set:value=>{selected=!!value;if(selected&&node.parentNode?.tagName==='SELECT')for(const other of node.parentNode.querySelectorAll('option'))if(other!==node)Reflect.set(other,'selected',false);}});}
    if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{configurable:true,get:()=>node.querySelectorAll('option').find(option=>Reflect.get(option,'selected'))?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))Reflect.set(option,'selected',option.value===value);}});}return node;};
  ({createRoot}=await import('react-dom/client'));({BinaryCellViewer:Viewer}=await import('../../src/renderer/components/BinaryCellViewer'));({RecordValueEditor:Editor}=await import('../../src/renderer/components/RecordValueEditor'));({ResultsGrid:Grid}=await import('../../src/renderer/components/ResultsGrid'));({useRecordViews:useRecords}=await import('../../src/renderer/hooks/useRecordViews'));({useWorkspace:store}=await import('../../src/renderer/store'));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;doc.body.textContent='';vi.restoreAllMocks();});
afterAll(()=>{for(const[name,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function mount(node:React.ReactNode){port.invoke.mockReset();const host=doc.createElement('div');doc.body.appendChild(host);root=createRoot(host as unknown as Element);await act(async()=>root!.render(node));}
function button(label:string){const node=doc.querySelectorAll('button').find(node=>node.textContent===label);expect(node,label).toBeDefined();return node!;}
async function click(node:MemoryNode){expect(node.disabled).toBe(false);await act(async()=>{node.dispatchEvent(new MemoryEvent('click'));});}
function reactProps(node:MemoryNode):Record<string,any>{const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('真实React事件缺失');return Reflect.get(node,key);}
const binary=(base64='AP+A')=>({type:'binary' as const,base64});
const reply=(base64='AP+A')=>({base64,bytes:Buffer.from(base64,'base64').length,name:'源.bin'});
const current=()=>true,source={};

describe('二进制文件查看器真实React RAM（无系统文件/剪贴板/数据库）',()=>{
  it('完整载入只更新Hex缓冲；另存传当前完整缓冲而非分页，零数据库命令',async()=>{
    let latest='0x01';const changed=vi.fn();function Controlled(){const[hex,setHex]=useState(latest);return <Viewer value={binary()} hexInput={hex} source={[source]} isCurrent={current} onHexChange={value=>{latest=value;changed(value);setHex(value);}}/>;}
    await mount(<Controlled/>);port.invoke.mockImplementation(async(command,input)=>command==='binaryCellFiles.open'?reply():{bytes:Buffer.from(input.base64,'base64').length,name:'目标.bin'});
    await click(button(text.load));expect(latest).toBe('0x00ff80');expect(changed).toHaveBeenCalledTimes(1);await click(button(text.save));expect(port.invoke.mock.calls).toEqual([['binaryCellFiles.open',{}],['binaryCellFiles.save',{base64:'AP+A',suggestedName:'binary-cell.bin'}]]);
  });
  it('文件选择取消保留原缓冲；原任务终结前禁止重复文件任务及旧Hex回调',async()=>{
    const pending=deferred<any>(),change=vi.fn();await mount(<Viewer value={binary()} hexInput="0x00ff80" source={[source]} isCurrent={current} onHexChange={change}/>);port.invoke.mockReturnValue(pending.promise);const load=reactProps(button(text.load)).onClick,hex=doc.querySelectorAll('textarea')[0],edit=reactProps(hex).onChange;
    await click(button(text.load));expect(button(text.load).disabled).toBe(true);expect(button(text.save).disabled).toBe(true);expect(reactProps(hex).readOnly).toBe(true);
    await act(async()=>{load();edit({currentTarget:hex,target:{value:'0xff'}});});expect(port.invoke).toHaveBeenCalledTimes(1);expect(change).not.toHaveBeenCalled();await act(async()=>pending.resolve(null));expect(button(text.load).disabled).toBe(false);expect(change).not.toHaveBeenCalled();expect(hex.value).toBe('0x00ff80');
  });
  it.each([{base64:'A===',bytes:1,name:'坏.bin'},reply(Buffer.alloc(131072).toString('base64')),{base64:'AP+A',bytes:2,name:'坏.bin'}])('非法或超限完整回包整次拒绝，不截断或更新缓冲 %#',async output=>{
    const change=vi.fn();await mount(<Viewer value={binary()} hexInput="0x01" source={[source]} isCurrent={current} onHexChange={change}/>);port.invoke.mockResolvedValue(output);await click(button(text.load));expect(change).not.toHaveBeenCalled();expect(doc.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
  it('只读值超过4096分页仍另存全部字节，且无载入入口',async()=>{
    const base64=Buffer.from(Array.from({length:65537},(_,index)=>index%256)).toString('base64');await mount(<Viewer value={binary(base64)} source={[source]} isCurrent={current} reason="只读"/>);expect(doc.querySelectorAll('button').some(node=>node.textContent===text.load)).toBe(false);port.invoke.mockResolvedValue({bytes:65537,name:'目标.bin'});await click(button(text.save));expect(port.invoke).toHaveBeenCalledWith('binaryCellFiles.save',{base64,suggestedName:'binary-cell.bin'});
  });
  it('零字节可载入和另存，不变成NULL',async()=>{
    const changed=vi.fn();await mount(<Viewer value={binary('')} hexInput="0x" source={[source]} isCurrent={current} onHexChange={changed}/>);port.invoke.mockImplementation(async command=>command==='binaryCellFiles.open'?reply(''):{bytes:0,name:'空.bin'});await click(button(text.load));expect(changed).toHaveBeenCalledWith('0x');await click(button(text.save));expect(port.invoke).toHaveBeenLastCalledWith('binaryCellFiles.save',{base64:'',suggestedName:'binary-cell.bin'});
  });
  it.each([null,undefined,binary('A===')])('NULL/DEFAULT/无效原字节禁止另存 %#',async value=>{await mount(<Viewer value={value} source={[source]} isCurrent={current}/>);expect(button(text.save).disabled).toBe(true);expect(port.invoke).not.toHaveBeenCalled();});
  it('不完整Hex禁止另存，仍允许明确载入完整文件修复缓冲',async()=>{await mount(<Viewer value={binary()} hexInput="0x0" source={[source]} isCurrent={current} onHexChange={vi.fn()}/>);expect(button(text.save).disabled).toBe(true);expect(button(text.load).disabled).toBe(false);});
  it.each(['source','hex','reason'] as const)('等待期间%s发生A→B→A后，旧成功不能写回',async kind=>{
    const pending=deferred<any>(),change=vi.fn();const render=(other:boolean)=><Viewer value={binary()} hexInput={kind==='hex'&&other?'0xff':'0x01'} source={[kind==='source'&&other?'B':'A']} reason={kind==='reason'&&other?'只读':''} isCurrent={current} onHexChange={change}/>;
    await mount(render(false));port.invoke.mockReturnValue(pending.promise);await click(button(text.load));await act(async()=>root!.render(render(true)));await act(async()=>root!.render(render(false)));await act(async()=>pending.resolve(reply()));expect(change).not.toHaveBeenCalled();expect(doc.body.textContent).not.toContain('已载入');
  });
  it('来源已失效时的旧失败不污染恢复后的新输入',async()=>{
    const pending=deferred<any>();await mount(<Viewer value={binary()} hexInput="0x01" source={['A']} isCurrent={current} onHexChange={vi.fn()}/>);port.invoke.mockReturnValue(pending.promise);await click(button(text.load));await act(async()=>root!.render(<Viewer value={binary()} hexInput="0x02" source={['B']} isCurrent={current} onHexChange={vi.fn()}/>));await act(async()=>pending.reject(Error('旧文件失败')));expect(doc.body.textContent).not.toContain('旧文件失败');
  });
  it('卸载后结算不更新任何缓冲且不自动重试',async()=>{const pending=deferred<any>(),change=vi.fn();await mount(<Viewer value={binary()} hexInput="0x01" isCurrent={current} onHexChange={change}/>);port.invoke.mockReturnValue(pending.promise);await click(button(text.load));await act(async()=>root!.unmount());root=undefined;await act(async()=>pending.resolve(reply()));expect(change).not.toHaveBeenCalled();expect(port.invoke).toHaveBeenCalledTimes(1);});
});

const column:ColumnInfo={name:'payload',type:'BLOB',nullable:true,generated:false,defaultValue:null,extra:'',comment:''};
function recordFixture(){const first={id:'1',payload:binary()},second={id:'2',payload:binary('/w==')};let rows:DraftRow[]=[{id:'r1',data:first,original:first,inserted:false,deleted:false},{id:'r2',data:second,original:second,inserted:false,deleted:false}];let context:RecordContext={target:{connectionId:'c',database:'d',table:'t'},connectionVersion:1,generation:1,loaded:true,stale:false,busy:false,info:{database:'d',name:'t',objectKind:'table',engine:'InnoDB',columns:[column,{...column,name:'other'}],primaryKey:['id'],editableKey:['id'],indexes:[],foreignKeys:[],ddl:''}};let editor!:ReturnType<typeof useRecords>;
  function Harness(){editor=useRecords({rows,getRows:()=>rows,getContext:()=>context,onRows:value=>{rows=value;},onDirty:()=>{},onFocusGrid:()=>{}});const draft=editor.draft,key=editor.cellKey??'payload',input=draft?.fields.get(key);return draft&&input?<Editor column={key==='payload'?column:{...column,name:key}} input={input} inserted={false} reason="" focus={false} source={[draft,key]} isCurrent={()=>editor.isFieldCurrent(draft,key,input)} onChange={value=>editor.change(key,value)}/>:null;}
  return{Harness,get editor(){return editor;},get rows(){return rows;},get context(){return context;},set context(value:RecordContext){context=value;}};
}
describe('原记录缓冲和同步字段归属（真实hook，不写数据库）',()=>{
  it('NULL先明确选择binary再载入空文件，暂存前不改行，暂存后保留零字节包装',async()=>{
    const f=recordFixture();f.rows[0].data.payload=null;await mount(<f.Harness/>);await act(async()=>f.editor.openCell('r1','payload'));expect(doc.querySelectorAll('button').some(node=>node.textContent===text.load)).toBe(false);const mode=doc.querySelectorAll('select')[0];await act(async()=>{mode.value='binary';mode.dispatchEvent(new MemoryEvent('change'));});port.invoke.mockResolvedValue(reply(''));await click(button(text.load));expect(f.rows[0].data.payload).toBeNull();expect(f.editor.draft!.fields.get('payload')).toEqual({mode:'binary',text:'0x'});await act(async()=>{expect(f.editor.stage()).toBe(true);});expect(f.rows[0].data.payload).toEqual(binary(''));expect(port.invoke.mock.calls.map(([command])=>command)).toEqual(['binaryCellFiles.open']);
  });
  it.each(['row','field','connection','generation','metadata'] as const)('无React重绘窗口的%s变化拒绝原文件回包',async kind=>{
    const f=recordFixture(),pending=deferred<any>();await mount(<f.Harness/>);await act(async()=>f.editor.openCell('r1','payload'));port.invoke.mockReturnValue(pending.promise);await click(button(text.load));await act(async()=>{
      if(kind==='row')f.editor.select('r2');else if(kind==='field')f.editor.openCell('r1','other');else if(kind==='connection')f.context={...f.context,connectionVersion:2};else if(kind==='generation')f.context={...f.context,generation:2};else f.context={...f.context,info:{...f.context.info!,ddl:'变化',columns:[{...column,type:'VARBINARY(16)'}]}};
      pending.resolve(reply('/w=='));
    });expect(f.rows[0].data.payload).toEqual(binary());expect(f.rows[1].data.payload).toEqual(binary('/w=='));expect([...f.editor.draft!.fields.values()].some(input=>input.text==='0xff')).toBe(false);expect(port.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('只读ResultsGrid原结果租约',()=>{
  const columns:ResultColumn[]=[{key:'payload',name:'payload',type:'BLOB'}],rows:DataRow[]=[{payload:binary()}];
  async function grid(){const tab={id:'q',kind:'query' as const,title:'查询',connectionId:'c',sql:'SELECT payload'};store.setState(state=>({settings:{...state.settings,tabs:[tab],activeTabId:'q'},connections:[],activeJobs:{},connectionVersions:{c:1}}));let ordinary=true,identity:readonly unknown[]=['result1'];const render=()=> <Grid columns={columns} rows={rows} isCurrent={()=>ordinary} binarySourceIdentity={identity} binaryIsCurrent={()=>true}/>;await mount(render());await act(async()=>{port.grid.onCellDoubleClick({row:rows[0],column:columns[0]});});return{render,set ordinary(value:boolean){ordinary=value;},set identity(value:readonly unknown[]){identity=value;}};}
  it('本模态撤销普通选择后仍可另存同一完整原值，不恢复载入能力',async()=>{const f=await grid();f.ordinary=false;await act(async()=>root!.render(f.render()));port.invoke.mockResolvedValue({bytes:3,name:'结果.bin'});expect(doc.querySelectorAll('button').some(node=>node.textContent===text.load)).toBe(false);await click(button(text.save));expect(port.invoke).toHaveBeenCalledWith('binaryCellFiles.save',{base64:'AP+A',suggestedName:'binary-cell.bin'});});
  it.each(['tab','execution','result'] as const)('%s A→B→A撤销旧另存回执，不重放或误报新结果',async kind=>{const f=await grid(),pending=deferred<any>();port.invoke.mockReturnValue(pending.promise);await click(button(text.save));await act(async()=>{if(kind==='tab'){store.setState(state=>({settings:{...state.settings,activeTabId:'other'}}));store.setState(state=>({settings:{...state.settings,activeTabId:'q'}}));}else if(kind==='execution'){store.setState({activeJobs:{q:true}});store.setState({activeJobs:{}});}});if(kind==='result'){f.identity=['result2'];await act(async()=>root!.render(f.render()));f.identity=['result1'];await act(async()=>root!.render(f.render()));}await act(async()=>pending.resolve({bytes:3,name:'旧结果.bin'}));expect(doc.body.textContent).not.toContain('已另存 旧结果.bin');expect(port.invoke).toHaveBeenCalledTimes(1);});
});
