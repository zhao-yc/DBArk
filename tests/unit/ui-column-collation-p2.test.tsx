import React, { act } from 'react';
import type { ColumnPatchServices } from '../../src/renderer/components/ColumnPatchDialog';
import { beforeAll, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../../tests/fixtures/memory-dom';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import { ColumnCollationIntent, columnCollationCandidates, makeColumnAlter, validateColumnDrafts } from '../../src/renderer/columnPatches';
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value }: any) => <pre aria-label="独审只读SQL端口">{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: any, root: any, Dialog: any;
const descriptors = ['document','window','navigator','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; (window as any).confirm = () => true;
  const create = document.createElement.bind(document);
  document.createElement = (name: string) => {
    const node = create(name); if (name === 'input') node.type = 'text';
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key,value) => { set(key,value); if(key==='disabled') node.disabled=true; if(key==='type') node.type=value; if(key==='value'&&name==='option')node.value=value; };
    node.removeAttribute = key => { remove(key); if(key==='disabled')node.disabled=false; };
    if(name==='select') { Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')}); Object.defineProperty(node,'value',{get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}}); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ColumnPatchDialog: Dialog } = await import('../../src/renderer/components/ColumnPatchDialog'));
});
afterEach(async()=>{ if(root)await act(async()=>root.unmount()); root=undefined; document.body.textContent=''; });
afterAll(()=>{for(const[key,value]of descriptors)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);});
const pair = { charset:'utf8mb4',collation:'utf8mb4_unicode_ci' }, required = ['ddl-implicit-commit','external-ddl-window','column-collation-semantics','column-collation-default-algorithm'];
/** 独立构造服务元数据；不复用作者61项夹具，不生成或执行真实SQL。 */
function snapshot(id='independent-s1'): any {
  const access=()=>Object.fromEntries(['name','type','nullable','default','onUpdate','comment','position'].map(key=>[key,{editable:true}]));
  const column=(name:string)=>({columnRef:name,name,ordinal:name==='a'?1:2,typeSql:'VARCHAR(20)',nullable:true,default:{kind:'none'},onUpdate:null,comment:'原注释',rawDefinition:'`'+name+'` varchar(20) COLLATE utf8mb4_bin',access:access(),collation:{current:{charset:'utf8mb4',collation:'utf8mb4_bin'},access:{editable:true}}});
  return {target:{connectionId:'RAM独审',database:'db',table:'t'},snapshotId:id,ddlHash:'独审原摘要',expiresAt:new Date(Date.now()+120000).toISOString(),warnings:[],capabilities:{dialect:'mysql',serverVersion:'8.4.11',maxDecimalScale:30},columns:[column('a'),column('b')],collationCatalog:[{charset:'utf8mb4',collation:'utf8mb4_bin'},pair,{charset:'latin1',collation:'latin1_bin'}]};
}
/** 真实组件/Modal/ReactDOM，只在服务边界注入显式RAM响应。 */
async function mount(acks=required) {
  const first=snapshot(); let next=first, version=1, sequence=0;
  const services={get:vi.fn(async()=>next),preview:vi.fn(async(_input:Parameters<ColumnPatchServices['preview']>[0])=>({target:next.target,ddlHash:next.ddlHash,previewToken:'independent-p'+(++sequence),expiresAt:next.expiresAt,sql:'只读固定预览',changes:[],warnings:[],requiredAcknowledgements:[...acks],concurrencyPolicy:'recheck-before-ddl'})),apply:vi.fn(async()=>({ddlSubmitted:true,ddlCompleted:true,definitionVerified:true,warnings:[]})),release:vi.fn(async()=>{}),cancel:vi.fn(async()=>{})};
  const callbacks={onClose:vi.fn(),onCleanupError:vi.fn(),onDirtyChange:vi.fn(),onApplied:vi.fn(),beforeApply:vi.fn(),onExecutionUncertain:vi.fn()};
  const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);
  const render=()=>root.render(<Dialog target={first.target} targetVersion={version} services={services} {...callbacks}/>);
  await act(async()=>render());
  return {first,services,callbacks,next(value:any){next=value;},async version(value:number){version=value;await act(async()=>render());}};
}
function button(label:string) { const node=document.querySelectorAll('button').find(node=>node.textContent===label);expect(node,'真实按钮 '+label).toBeDefined();return node!; }
async function click(label:string){const node=button(label);expect(node.disabled).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
function callback(node:MemoryNode,event='onClick'):Function {const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('React事件端口未就绪');return(node as any)[key][event];}
function picker(){return document.querySelector(`select[aria-label="${text.collationChoose}"]`)!;}
async function draft(){await click('a · VARCHAR(20)');const toggle=document.querySelector(`input[aria-label="${text.modify} ${text.collation}"]`)!;expect(toggle.disabled).toBe(false);await act(async()=>{toggle.checked=true;toggle.dispatchEvent(new MemoryEvent('click'));});await act(async()=>{picker().value=pair.collation;picker().dispatchEvent(new MemoryEvent('change'));});await click(text.rowSave);}
async function ackVisible(){for(const node of document.querySelectorAll('input').filter(node=>node.type==='checkbox'))await act(async()=>{node.checked=true;node.dispatchEvent(new MemoryEvent('click'));});}
function gate(){let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return{resolve,promise};}


// 员工4原两红断言原样保留；仅服务mock补充明确输入类型，新增共同入口必要对照。
describe('列排序规则P2精确回归',()=>{
it('红例：只含新增两ACK的预览缺基础两ACK，真实组件必须拒绝apply投递',async()=>{
    const f=await mount(required.slice(2));await draft();await click(text.preview);await ackVisible();
    const apply=document.querySelectorAll('button').find(node=>node.textContent===text.apply);
    if(apply&&!apply.disabled)await act(async()=>apply.dispatchEvent(new MemoryEvent('click')));
    expect(f.services.apply,'缺隐式提交/外部窗口确认不得发起apply').not.toHaveBeenCalled();
  });
it('新快照后旧行事件不能改新scope，目录原地变化再恢复也不复活旧intent',async()=>{
    const f=await mount();await click('a · VARCHAR(20)');const oldRow=callback(button(text.rowSave));const oldChoice=callback(picker(),'onChange');
    f.next(snapshot('independent-s2'));await click(text.read);await draft();const dirtyBefore=f.callbacks.onDirtyChange.mock.calls.at(-1)?.[0];await act(async()=>{oldChoice({target:{value:'utf8mb4_bin'}});oldRow();});
    console.log('员工4旧行诊断',JSON.stringify({getCalls:f.services.get.mock.calls.length,dirtyBefore,dirtyAfter:f.callbacks.onDirtyChange.mock.calls.at(-1)?.[0],previewDisabled:button(text.preview).disabled,previewCalls:f.services.preview.mock.calls.length}));
    await click(text.preview);expect(f.services.preview).toHaveBeenCalledOnce();expect(f.services.preview.mock.calls[0][0]).toMatchObject({snapshotId:'independent-s2',patches:[{kind:'alter',columnRef:'a',changes:{collation:pair}}]});
    const s=snapshot(),intent=new ColumnCollationIntent(s,s.columns[0]);s.collationCatalog[1].collation='changed';expect(intent.current(s)).toBe(false);s.collationCatalog[1].collation=pair.collation;expect(intent.current(s)).toBe(false);
  });
it.each(['ddl-implicit-commit','external-ddl-window'])('P2窄对照：单独缺少%s必须释放预览且不投递',async missing=>{
 const f=await mount(required.filter(id=>id!==missing));await draft();await click(text.preview);await ackVisible();expect(f.services.release).toHaveBeenCalledWith({previewToken:'independent-p1'});expect(f.services.apply).not.toHaveBeenCalled();expect(f.callbacks.beforeApply).not.toHaveBeenCalled();expect(document.body.textContent).toContain(text.collationStale);
});
it('P2窄对照：当前普通属性保存仍保留草稿并能预览',async()=>{
 const f=await mount();await click('a · VARCHAR(20)');const toggle=document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.modify+' '+text.comment)!;await act(async()=>{toggle.checked=true;toggle.dispatchEvent(new MemoryEvent('click'));});await act(async()=>callback(document.querySelector(`textarea[aria-label="${text.comment}"]`)!,'onChange')({target:{value:'当前普通注释'}}));await click(text.rowSave);expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);await click(text.preview);expect(f.services.preview.mock.calls[0][0]).toMatchObject({snapshotId:'independent-s1',patches:[{kind:'alter',columnRef:'a',changes:{comment:'当前普通注释'}}]});
});
it('P2窄对照：同一快照切换编辑器后旧普通保存不能覆盖当前行',async()=>{
 const f=await mount();await click('a · VARCHAR(20)');const old=callback(button(text.rowSave));await click(text.back);await click('b · VARCHAR(20)');const toggle=document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.modify+' '+text.comment)!;await act(async()=>{toggle.checked=true;toggle.dispatchEvent(new MemoryEvent('click'));});await act(async()=>callback(document.querySelector(`textarea[aria-label="${text.comment}"]`)!,'onChange')({target:{value:'保留新行'}}));await act(async()=>old());expect(document.querySelector(`textarea[aria-label="${text.comment}"]`)).not.toBeNull();expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);await click(text.rowSave);await click(text.preview);expect(f.services.preview.mock.calls[0][0]).toMatchObject({patches:[{kind:'alter',columnRef:'b',changes:{comment:'保留新行'}}]});
});
it.each(['row','ref'] as const)('P2窄对照：原%s身份变化后普通保存拒绝清空当前编辑器',async change=>{
 const f=await mount();await click('a · VARCHAR(20)');const old=callback(button(text.rowSave));if(change==='row')f.first.columns[0]={...f.first.columns[0]};else f.first.columns[0].columnRef='changed';await act(async()=>old());expect(document.querySelector(`textarea[aria-label="${text.comment}"]`)).not.toBeNull();expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);expect(f.services.preview).not.toHaveBeenCalled();
});

});
