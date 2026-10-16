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

/** 实际ReactDOM/字段组件/草稿助手/SQL计划器；服务边界只接RAM，不调用生产IPC。 */
async function mount(existing=false,readonly=false){
 const source="CREATE TABLE t(id int NOT NULL,updated_at DATETIME(6) NULL DEFAULT NULL"+(existing?' ON UPDATE CURRENT_TIMESTAMP(6)':'')+" COMMENT '保留') ENGINE=InnoDB",context={dialect:'mysql' as const,mode:{ansiQuotes:false,noBackslashEscapes:false}},documentModel=parseTableColumnDefinition(source,context),target={connectionId:'synthetic',database:'db',table:'t'},refs=new Map(documentModel.columns.map(column=>[column.name,column.name]));
 const snapshot:TableColumnGetOutput={target,snapshotId:'snapshot',ddlHash:'原摘要',expiresAt:new Date(Date.now()+300000).toISOString(),columns:documentModel.columns.map(column=>({columnRef:column.name,name:column.name,ordinal:column.ordinal,typeSql:column.type.raw,nullable:column.nullable,default:column.default,comment:column.comment,rawDefinition:column.raw,onUpdate:readColumnOnUpdate(column),access:columnPatchAccess(column,'mysql','8.4.11')})),warnings:[],capabilities:{dialect:'mysql',serverVersion:'8.4.11',maxDecimalScale:30}};
 if(readonly)snapshot.columns[1].access.onUpdate={editable:false,reason:'合成不可靠目录，仅属性只读'};
 const dirty=vi.fn(),preview=vi.fn(async(input:any)=>{const plan=buildTableColumnPatchSql(documentModel,input.patches,{database:'db',serverVersion:'8.4.11',columnRefs:refs});return{target,previewToken:'preview',expiresAt:snapshot.expiresAt,ddlHash:snapshot.ddlHash,sql:plan.sql,changes:[],warnings:[],requiredAcknowledgements:['ddl-implicit-commit','external-ddl-window'],concurrencyPolicy:'recheck-before-ddl' as const};}),apply=vi.fn(async()=>({ddlSubmitted:true as const,ddlCompleted:true as const,definitionVerified:true,warnings:[]})),release=vi.fn(async()=>{});
 const services:ColumnPatchServices={get:vi.fn(async()=>snapshot),preview,apply,release,cancel:vi.fn(async()=>{})};const noop=()=>{};
 const container=document.createElement('div');document.body.appendChild(container);root=createRoot(container as any);await act(async()=>root!.render(<ColumnPatchDialog target={target} targetVersion={1} services={services} onClose={noop} onCleanupError={noop} onDirtyChange={dirty} onApplied={noop} beforeApply={noop} onExecutionUncertain={noop}/>));return{dirty,preview,apply,release};
}
function button(label:string){const node=document.body.querySelectorAll('button').find(node=>node.textContent===label);expect(node,label).toBeDefined();return node!;}
async function click(label:string){const node=button(label);expect(node.disabled,label+'：'+document.body.textContent.slice(-900)).toBe(false);await act(async()=>node.dispatchEvent(new MemoryEvent('click')));}
function checkbox(label:string){const node=document.body.querySelectorAll('input').find(node=>node.type==='checkbox'&&node.parentNode?.textContent===label);expect(node,label).toBeDefined();return node!;}
async function check(label:string){const node=checkbox(label);expect(node.disabled).toBe(false);await act(async()=>{node.checked=!node.checked;node.dispatchEvent(new MemoryEvent('click'));});}
async function choose(value:string){const node=document.body.querySelector('select[aria-label="'+text.onUpdate+'"]')!;await act(async()=>{node.value=value;node.dispatchEvent(new MemoryEvent('change'));});}

it('打开真实设计窗口及保存未勾属性不留补丁；新增ON UPDATE经控件暂存、只读预览及确认后单次apply',async()=>{
 const f=await mount();expect(f.dirty).toHaveBeenLastCalledWith(false);await click('updated_at · DATETIME(6)');await click(text.rowSave);expect(f.dirty).toHaveBeenLastCalledWith(false);expect(button(text.preview).disabled).toBe(true);
 await click('updated_at · DATETIME(6)');await check(text.modify+' '+text.onUpdate);await choose('expression');await click(text.rowSave);expect(f.apply).not.toHaveBeenCalled();expect(f.preview).not.toHaveBeenCalled();await click(text.preview);expect(f.preview.mock.calls[0][0].patches).toEqual([{kind:'alter',columnRef:'updated_at',changes:{onUpdate:{kind:'expression',expression:'current-timestamp',precision:6}}}]);
 const sql=document.body.querySelector('pre[aria-label="只读SQL测试端口"]')!;expect(sql.textContent).toContain('ON UPDATE CURRENT_TIMESTAMP(6)');expect(sql.getAttribute('data-read-only')).toBe('true');expect(button(text.apply).disabled).toBe(true);expect(f.apply).not.toHaveBeenCalled();await check(text.ackImplicit);await check(text.ackWindow);const applyButton=button(text.apply);await act(async()=>{applyButton.dispatchEvent(new MemoryEvent('click'));applyButton.dispatchEvent(new MemoryEvent('click'));});expect(f.apply).toHaveBeenCalledTimes(1);
});
it('移除null在再次打开行编辑时保持，恢复原受控值后删除补丁，目录只读控件不可启用',async()=>{
 const f=await mount(true);await click('updated_at · DATETIME(6)');await check(text.modify+' '+text.onUpdate);await choose('none');await click(text.rowSave);await click('updated_at · DATETIME(6)');expect(document.body.querySelector('select[aria-label="'+text.onUpdate+'"]')!.value).toBe('none');await choose('expression');await click(text.rowSave);expect(f.dirty).toHaveBeenLastCalledWith(false);expect(button(text.preview).disabled).toBe(true);
 await act(async()=>root!.unmount());root=undefined;await mount(false,true);await click('updated_at · DATETIME(6)');expect(checkbox(text.modify+' '+text.onUpdate).disabled).toBe(true);expect(document.body.textContent).toContain('合成不可靠目录，仅属性只读');
});
