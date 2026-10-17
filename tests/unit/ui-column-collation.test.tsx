import React,{act} from 'react';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {memoryDocument,MemoryEvent,MemoryNode} from '../fixtures/memory-dom';
import {parseTableColumnDefinition} from '../../src/engine/tableColumnDefinition';
import {buildTableColumnPatchSql} from '../../src/engine/tableColumnPatchSql';
import {columnPatchAccess,readColumnOnUpdate,type TableColumnGetOutput} from '../../src/shared/tableColumnPatches';
import {columnPatchZh as text} from '../../src/renderer/locales/columnPatches.zh-CN';
import type {ColumnPatchServices} from '../../src/renderer/components/ColumnPatchDialog';
vi.mock('../../src/renderer/components/SqlEditor',()=>({SqlEditor:({value,readOnly}:any)=><pre aria-label="只读SQL测试端口" data-read-only={String(readOnly)}>{value}</pre>}));
let document:ReturnType<typeof memoryDocument>,createRoot:typeof import('react-dom/client')['createRoot'],root:ReturnType<typeof createRoot>|undefined,ColumnPatchDialog:typeof import('../../src/renderer/components/ColumnPatchDialog')['ColumnPatchDialog'];
const keys=['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'],globals=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
beforeAll(async()=>{
 document=memoryDocument();(document as any).oninput=null;(window as any).confirm=()=>true;
 const create=document.createElement.bind(document);document.createElement=(name:string)=>{const node=create(name);if(name==='input')node.type='text';
  // 只补HTML属性反射及select选中值；不模拟布局或本机浏览器行为。
  const set=node.setAttribute.bind(node),remove=node.removeAttribute.bind(node);node.setAttribute=(key,value)=>{set(key,value);if(key==='disabled')node.disabled=true;if(key==='type')node.type=value;if(key==='value'&&name==='option')node.value=value;};node.removeAttribute=key=>{remove(key);if(key==='disabled')node.disabled=false;};
  if(name==='select'){Object.defineProperty(node,'options',{get:()=>node.querySelectorAll('option')});Object.defineProperty(node,'value',{get:()=>node.querySelectorAll('option').find(option=>(option as any).selected)?.value??'',set:value=>{for(const option of node.querySelectorAll('option'))(option as any).selected=option.value===value;}});}return node;};
 ({createRoot}=await import('react-dom/client'));({ColumnPatchDialog}=await import('../../src/renderer/components/ColumnPatchDialog'));
});
afterEach(async()=>{if(root){await act(async()=>root!.unmount());root=undefined;}});
afterAll(()=>{for(const[key,descriptor]of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});

import { ColumnCollationIntent, columnCollationCandidates, makeColumnAlter, validateColumnDrafts } from '../../src/renderer/columnPatches';
import { columnCollationAcknowledgements } from '../../src/shared/tableColumnPatches';

/** 真实定义读取器只在RAM解析；目录和access是显式服务响应，不做任何实际数据库IO。 */
function snapshotFixture(): TableColumnGetOutput {
 const model=parseTableColumnDefinition("CREATE TABLE t(id INT NOT NULL,txt VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL COMMENT '保留',alt VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL)",{dialect:'mysql',mode:{ansiQuotes:false,noBackslashEscapes:false}});
 return {target:{connectionId:'RAM',database:'db',table:'t'},snapshotId:'s',ddlHash:'原摘要',expiresAt:new Date(Date.now()+300000).toISOString(),warnings:[],capabilities:{dialect:'mysql',serverVersion:'8.4.11',maxDecimalScale:30},collationCatalog:[{charset:'utf8mb4',collation:'utf8mb4_bin'},{charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci'},{charset:'latin1',collation:'latin1_bin'}],columns:model.columns.map(column=>({columnRef:column.name,name:column.name,ordinal:column.ordinal,typeSql:column.type.raw,nullable:column.nullable,default:column.default,comment:column.comment,rawDefinition:column.raw,onUpdate:readColumnOnUpdate(column),access:columnPatchAccess(column,'mysql','8.4.11'),...(column.name==='id'?{}:{collation:{current:{charset:'utf8mb4',collation:'utf8mb4_bin'},access:{editable:true}}})}))};
}
const selected={charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci'};
const required=['ddl-implicit-commit','external-ddl-window',...columnCollationAcknowledgements];
/** 只有服务边界RAM；实际组件、纯草稿校验、风险映射和React事件均为真实代码。 */
async function mount(snapshot=snapshotFixture(),acks=required){
 let next=snapshot,version=1;
 const get=vi.fn(async()=>next),preview=vi.fn(async(input:any)=>({target:next.target,ddlHash:next.ddlHash,previewToken:'p',expiresAt:next.expiresAt,sql:'Root生成的只读预览文本',changes:[],warnings:[],requiredAcknowledgements:acks,concurrencyPolicy:'recheck-before-ddl' as const})),apply=vi.fn(async(_input:Parameters<ColumnPatchServices['apply']>[0])=>({ddlSubmitted:true as const,ddlCompleted:true as const,definitionVerified:true,warnings:[]})),release=vi.fn(async(_input:any)=>{}),dirty=vi.fn(),cleanup=vi.fn(),cancel=vi.fn(async()=>{}),onApplied=vi.fn(),uncertain=vi.fn();
 const services:ColumnPatchServices={get,preview,apply,release,cancel};const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);
 const render=()=>root!.render(<ColumnPatchDialog target={snapshot.target} targetVersion={version} services={services} onClose={()=>{}} onCleanupError={cleanup} onDirtyChange={dirty} onApplied={onApplied} beforeApply={()=>{}} onExecutionUncertain={uncertain}/>);
 await act(async()=>render());return{snapshot,get,preview,apply,release,cancel,dirty,cleanup,onApplied,uncertain,setNext(value:TableColumnGetOutput){next=value;},async version(value:number){version=value;await act(async()=>render());}};
}
function button(label:string){const node=document.querySelectorAll('button').find(node=>node.textContent===label);expect(node,label).toBeDefined();return node!;}
async function click(label:string){const node=button(label);expect(node.disabled,label).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
function callback(node:any,event='onClick'){const key=Object.keys(node).find(key=>key.startsWith('__reactProps$'));if(!key)throw Error('缺少React回调');return node[key][event] as Function;}
function collationToggle(){return document.querySelector(`input[aria-label="${text.modify} ${text.collation}"]`)!;}
function picker(){return document.querySelector(`select[aria-label="${text.collationChoose}"]`)!;}
async function toggle(){const node=collationToggle();expect(node.disabled).toBe(false);await act(async()=>{node.checked=!node.checked;node.dispatchEvent(new MemoryEvent('click'));});}
async function choose(value=selected.collation){const node=picker();expect(node.disabled).toBe(false);await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('change'));});}
async function edit(){await click('txt · VARCHAR(30)');}
async function draft(){await edit();await toggle();await choose();await click(text.rowSave);}
async function acknowledge(label:string){const node=document.querySelectorAll('input').find(node=>node.type==='checkbox'&&node.parentNode?.textContent===label)!;expect(node).toBeDefined();await act(async()=>{node.checked=true;node.dispatchEvent(new MemoryEvent('click'));});}
async function allAcks(){for(const label of [text.ackImplicit,text.ackWindow,text.ackCollationSemantics,text.ackCollationAlgorithm])await acknowledge(label);}
/** 显式控制异步边界，不靠sleep制造迟到。 */
function gate<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(value=>{resolve=value;});return{promise,resolve};}

it('真实选择框只给共享目录同charset候选，原值消差，完整风险确认后双击只apply一次',async()=>{
 const f=await mount(),before=structuredClone(f.snapshot);await edit();expect(document.body.textContent).toContain('utf8mb4 / utf8mb4_bin');expect(picker().querySelectorAll('option').map(node=>node.value)).toEqual(['','utf8mb4_bin',selected.collation]);expect(picker().disabled).toBe(true);await toggle();await click(text.rowSave);expect(button(text.preview).disabled).toBe(true);expect(f.dirty).toHaveBeenLastCalledWith(false);
 await draft();await click(text.preview);expect(f.preview).toHaveBeenCalledOnce();expect(f.preview.mock.calls[0][0].patches).toEqual([{kind:'alter',columnRef:'txt',changes:{collation:selected}}]);expect(Object.keys(f.preview.mock.calls[0][0]).sort()).toEqual(['patches','snapshotId','taskId']);expect(document.querySelector('pre[aria-label="只读SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true');expect(button(text.apply).disabled).toBe(true);
 for(const label of [text.ackImplicit,text.ackWindow,text.ackCollationSemantics])await acknowledge(label);expect(button(text.apply).disabled).toBe(true);await acknowledge(text.ackCollationAlgorithm);const apply=callback(button(text.apply));await act(async()=>{apply();apply();});expect(f.apply).toHaveBeenCalledOnce();expect(f.apply.mock.calls[0][0]).toMatchObject({previewToken:'p',acknowledgements:required});expect(f.get).toHaveBeenCalledOnce();expect(f.snapshot).toEqual(before);
});
it.each(['absent','readonly','unknownAccess','catalogMissing','duplicates','otherCharset','malformed'] as const)('%s元数据不猜授权或候选，但不阻止原普通属性路径',async kind=>{
 const snapshot=snapshotFixture();if(kind==='absent')delete snapshot.columns[1].collation;if(kind==='readonly')snapshot.columns[1].collation!.access={editable:false,reason:'Root只读原因'};if(kind==='unknownAccess')delete(snapshot.columns[1].collation!.access as any).editable;if(kind==='catalogMissing')delete snapshot.collationCatalog;if(kind==='duplicates')snapshot.collationCatalog!.push({...snapshot.collationCatalog![0]});if(kind==='otherCharset')snapshot.collationCatalog=[{charset:'latin1',collation:'latin1_bin'}];if(kind==='malformed')snapshot.collationCatalog![0]={charset:'utf8mb4',collation:'bad-name'};
 const f=await mount(snapshot);await edit();expect(collationToggle().disabled).toBe(true);expect(picker().disabled).toBe(true);await act(async()=>callback(collationToggle(),'onChange')({target:{checked:true}}));expect(f.preview).not.toHaveBeenCalled();expect(document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.modify+' '+text.comment)!.disabled).toBe(false);
});
it('已有其它草稿明确拒绝混合，不悄悄覆盖；保存后预览仍是原普通属性',async()=>{
 const f=await mount();await edit();const check=document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.modify+' '+text.comment)!;await act(async()=>{check.checked=true;check.dispatchEvent(new MemoryEvent('click'));});const input=document.querySelector(`textarea[aria-label="${text.comment}"]`)!;await act(async()=>callback(input,'onChange')({target:{value:'显式草稿'}}));await click(text.rowSave);await edit();expect(collationToggle().disabled).toBe(true);await act(async()=>callback(collationToggle(),'onChange')({target:{checked:true}}));expect(document.body.textContent).toContain(text.collationMixed);await click(text.back);await click(text.preview);expect(f.preview.mock.calls[0][0].patches).toEqual([{kind:'alter',columnRef:'txt',changes:{comment:'显式草稿'}}]);
});
it('排序规则草稿不能与新增/删除/其它字段混合，原草稿保留',async()=>{
 const f=await mount();await draft();await click(text.add);expect(document.body.textContent).toContain(text.collationMixed);await act(async()=>callback(button(text.drop))());await click('alt · VARCHAR(20)');expect(collationToggle().disabled).toBe(true);await click(text.back);await click(text.preview);expect(f.preview.mock.calls[0][0].patches).toEqual([{kind:'alter',columnRef:'txt',changes:{collation:selected}}]);
});
it('旧行选择和保存回调不能改变关闭重开的新行或覆盖新选择',async()=>{
 const f=await mount();await edit();await toggle();const oldChoose=callback(picker(),'onChange'),oldSave=callback(button(text.rowSave));await choose();await click(text.rowSave);await edit();await act(async()=>{oldChoose({target:{value:'utf8mb4_bin'}});oldSave();});expect(picker().value).toBe(selected.collation);await click(text.rowSave);await click(text.preview);expect(f.preview.mock.calls[0][0].patches[0].changes.collation).toEqual(selected);
});
it.each(['catalog','value','ref','definition','access','snapshot'] as const)('%s漂移后恢复原值不能复活旧选择，重读后旧回调仍拒绝',async kind=>{
 const f=await mount();await edit();await toggle();const old=callback(picker(),'onChange'),column=f.snapshot.columns[1],catalog=f.snapshot.collationCatalog!,current=column.collation!.current,raw=column.rawDefinition;
 if(kind==='catalog')f.snapshot.collationCatalog=[...catalog];if(kind==='value')current.collation=selected.collation;if(kind==='ref')column.columnRef='changed';if(kind==='definition')column.rawDefinition+=' changed';if(kind==='access')column.collation!.access.editable=false;if(kind==='snapshot')f.snapshot.snapshotId='changed';
 await act(async()=>old({target:{value:selected.collation}}));expect(document.body.textContent).toContain(text.collationStale);f.snapshot.collationCatalog=catalog;current.collation='utf8mb4_bin';column.columnRef='txt';column.rawDefinition=raw;column.collation!.access.editable=true;f.snapshot.snapshotId='s';await act(async()=>old({target:{value:selected.collation}}));expect(picker().value).toBe('utf8mb4_bin');
 f.setNext(snapshotFixture());await click(text.read);await edit();await toggle();await act(async()=>old({target:{value:selected.collation}}));expect(picker().value).toBe('utf8mb4_bin');expect(f.preview).not.toHaveBeenCalled();
});
it('已存草稿在预览前目录漂移即拒绝，恢复目录也不复活；撤销后旧预览闭包拒绝',async()=>{
 const f=await mount();await draft();const oldPreview=callback(button(text.preview)),catalog=f.snapshot.collationCatalog!;f.snapshot.collationCatalog=[...catalog];await click(text.preview);expect(f.preview).not.toHaveBeenCalled();f.snapshot.collationCatalog=catalog;await act(async()=>oldPreview());expect(f.preview).not.toHaveBeenCalled();await click(text.undo);await act(async()=>oldPreview());expect(f.preview).not.toHaveBeenCalled();
});
it('预览等待期间目录变化，迟到token被释放而不成为可执行预览',async()=>{
 const f=await mount(),wait=gate<any>();f.preview.mockImplementationOnce(()=>wait.promise);await draft();await click(text.preview);expect(f.preview).toHaveBeenCalledOnce();f.snapshot.collationCatalog=[...f.snapshot.collationCatalog!];await act(async()=>wait.resolve({target:f.snapshot.target,ddlHash:f.snapshot.ddlHash,previewToken:'late',expiresAt:f.snapshot.expiresAt,sql:'不应接受',changes:[],warnings:[],requiredAcknowledgements:required,concurrencyPolicy:'recheck-before-ddl'}));expect(f.release).toHaveBeenCalledWith({previewToken:'late'});expect(f.apply).not.toHaveBeenCalled();expect(document.body.textContent).toContain(text.collationStale);
});
it.each(['missing','unknown'] as const)('%s确认不放行apply，未知ACK保持原拒执行保护',async kind=>{
 const f=await mount(snapshotFixture(),kind==='missing'?['ddl-implicit-commit']: [...required,'unknown-ack']);await draft();await click(text.preview);expect(f.apply).not.toHaveBeenCalled();if(kind==='missing'){expect(f.release).toHaveBeenCalledWith({previewToken:'p'});expect(document.body.textContent).toContain(text.collationStale);}else{await allAcks();expect(button(text.apply).disabled).toBe(true);await act(async()=>callback(button(text.apply))());expect(f.apply).not.toHaveBeenCalled();expect(document.body.textContent).toContain('unknown-ack');}
});
it('apply前原值漂移永久拒绝；返回编辑释放失败也不能借旧apply回调投递',async()=>{
 const f=await mount();await draft();await click(text.preview);await allAcks();const apply=callback(button(text.apply));f.snapshot.columns[1].collation!.current.collation=selected.collation;await act(async()=>apply());f.snapshot.columns[1].collation!.current.collation='utf8mb4_bin';await act(async()=>apply());expect(f.apply).not.toHaveBeenCalled();f.release.mockRejectedValueOnce(Error('RAM释放失败'));await click(text.back);await act(async()=>apply());expect(f.apply).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledWith({previewToken:'p'});
});
it('连接版本ABA及卸载使旧回调失效，未修改服务/入口或真实连接',async()=>{
 const f=await mount();await edit();await toggle();const old=callback(picker(),'onChange');await f.version(2);await f.version(1);await act(async()=>old({target:{value:selected.collation}}));expect(f.preview).not.toHaveBeenCalled();expect(collationToggle().disabled).toBe(true);await act(async()=>root!.unmount());root=undefined;await act(async()=>old({target:{value:selected.collation}}));expect(f.apply).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledWith({snapshotId:'s'});
});
it('旧预览按钮不能绕过当前行编辑；旧确认回调不能勾选下一份预览',async()=>{
 const f=await mount();await draft();const oldPreview=callback(button(text.preview));await edit();await act(async()=>oldPreview());expect(f.preview).not.toHaveBeenCalled();await click(text.rowSave);await click(text.preview);const ack=document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.ackCollationSemantics)!,oldAck=callback(ack,'onChange');await click(text.back);await click(text.preview);await act(async()=>oldAck({target:{checked:true}}));expect(document.querySelectorAll('input').find(node=>node.parentNode?.textContent===text.ackCollationSemantics)!.checked).toBe(false);expect(button(text.apply).disabled).toBe(true);expect(f.apply).not.toHaveBeenCalled();
});
it('预览中卸载后迟到token释放，禁止旧ACK和apply事件',async()=>{
 const f=await mount(),wait=gate<any>();f.preview.mockImplementationOnce(()=>wait.promise);await draft();await click(text.preview);await act(async()=>root!.unmount());root=undefined;await act(async()=>wait.resolve({target:f.snapshot.target,ddlHash:f.snapshot.ddlHash,previewToken:'unmounted-late',expiresAt:f.snapshot.expiresAt,sql:'迟到',changes:[],warnings:[],requiredAcknowledgements:required,concurrencyPolicy:'recheck-before-ddl'}));expect(f.release).toHaveBeenCalledWith({snapshotId:'s'});expect(f.release).toHaveBeenCalledWith({previewToken:'unmounted-late'});expect(f.cancel).toHaveBeenCalledOnce();expect(f.apply).not.toHaveBeenCalled();
});
it('非法配对注入无法成为草稿，缺省access不被当成授权，目录新增属性也撤销旧选择',async()=>{
 const f=await mount();await edit();await toggle();const change=callback(picker(),'onChange');await act(async()=>change({target:{value:'latin1_bin'}}));expect(document.body.textContent).toContain(text.collationInvalid);expect(picker().value).toBe('utf8mb4_bin');(f.snapshot.collationCatalog![0] as any).extra='变化';await act(async()=>change({target:{value:selected.collation}}));expect(document.body.textContent).toContain(text.collationStale);delete(f.snapshot.collationCatalog![0] as any).extra;await act(async()=>change({target:{value:selected.collation}}));expect(picker().value).toBe('utf8mb4_bin');expect(f.preview).not.toHaveBeenCalled();
});
it('get接收时即绑定原值，首次编辑前漂移及重读后的旧行按钮不能重领授权',async()=>{
 const f=await mount(),oldEdit=callback(button('txt · VARCHAR(30)'));f.snapshot.columns[1].collation!.current.collation=selected.collation;await act(async()=>oldEdit());expect(picker()).toBeNull();expect(document.body.textContent).toContain(text.collationStale);f.snapshot.columns[1].collation!.current.collation='utf8mb4_bin';await act(async()=>oldEdit());expect(picker()).toBeNull();f.setNext(snapshotFixture());await click(text.read);await act(async()=>oldEdit());expect(picker()).toBeNull();await draft();await click(text.preview);expect(f.preview).toHaveBeenCalledOnce();expect(f.get).toHaveBeenCalledTimes(2);
});
it('完整共享快照中另一列原值变化也撤销本行授权，不在打开另一行时重新采信',async()=>{
 const snapshot=snapshotFixture(),intent=new ColumnCollationIntent(snapshot,snapshot.columns[1]);snapshot.columns[2].collation!.current.collation=selected.collation;expect(intent.current(snapshot)).toBe(false);snapshot.columns[2].collation!.current.collation='utf8mb4_bin';expect(intent.current(snapshot)).toBe(false);
});
it.each(['acks','token','sql','expiry'] as const)('预览%s原地变化后不能借恢复值或缩减风险继续apply',async kind=>{
 const f=await mount();await draft();await click(text.preview);await allAcks();const apply=callback(button(text.apply)),plan=await f.preview.mock.results[0].value,acks=plan.requiredAcknowledgements.slice(),token=plan.previewToken,sql=plan.sql,expiry=plan.expiresAt;
 if(kind==='acks')plan.requiredAcknowledgements.splice(2);if(kind==='token')plan.previewToken='changed';if(kind==='sql')plan.sql='changed';if(kind==='expiry')plan.expiresAt=new Date(Date.now()+999999).toISOString();await act(async()=>apply());plan.requiredAcknowledgements.splice(0,plan.requiredAcknowledgements.length,...acks);plan.previewToken=token;plan.sql=sql;plan.expiresAt=expiry;await act(async()=>apply());expect(f.apply).not.toHaveBeenCalled();
});

it('纯助手严格配对/消差/权限/整批单属性且不改原输入，普通属性仍可用',()=>{
 const snapshot=snapshotFixture(),column=snapshot.columns[1],before=structuredClone(snapshot);expect(columnCollationCandidates(column,snapshot.collationCatalog).map(pair=>pair.collation)).toEqual(['utf8mb4_bin',selected.collation]);expect(makeColumnAlter(column,{collation:column.collation!.current},snapshot.collationCatalog)).toBeNull();const patch=makeColumnAlter(column,{collation:selected},snapshot.collationCatalog)!;expect(validateColumnDrafts(snapshot.columns,[patch],30,snapshot.collationCatalog)).toEqual([patch]);
 for(const pair of [{charset:'latin1',collation:'latin1_bin'},{charset:'utf8mb4',collation:'fake'}, {charset:'utf8mb4',collation:'utf8mb4_bin',extra:1}])expect(()=>makeColumnAlter(column,{collation:pair},snapshot.collationCatalog)).toThrow();expect(()=>makeColumnAlter(column,{collation:selected,comment:'混合'},snapshot.collationCatalog)).toThrow(text.collationMixed);expect(()=>validateColumnDrafts(snapshot.columns,[patch,{kind:'drop',columnRef:'alt'}],30,snapshot.collationCatalog)).toThrow();expect(makeColumnAlter(column,{comment:'普通修改'})).toMatchObject({changes:{comment:'普通修改'}});expect(snapshot).toEqual(before);
});
it.each(['array','entry','pair','permission','rowOrder','pairValue'] as const)('纯意图对%s变动单向撤销，恢复后不能复活',kind=>{
 const snapshot=snapshotFixture(),column=snapshot.columns[1],intent=new ColumnCollationIntent(snapshot,column),catalog=snapshot.collationCatalog!,pair=catalog[0],source=column.collation!;expect(intent.current(snapshot)).toBe(true);
 if(kind==='array')snapshot.collationCatalog=[...catalog];if(kind==='entry')catalog[0]={...pair};if(kind==='pair')source.current={...source.current};if(kind==='permission')source.access.editable=false;if(kind==='rowOrder')snapshot.columns.reverse();if(kind==='pairValue')pair.collation='other';expect(intent.current(snapshot)).toBe(false);
 snapshot.collationCatalog=catalog;catalog[0]=pair;source.access.editable=true;if(kind==='rowOrder')snapshot.columns.reverse();pair.collation='utf8mb4_bin';expect(intent.current(snapshot)).toBe(false);
});
