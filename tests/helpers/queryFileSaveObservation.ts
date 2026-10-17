import { randomUUID } from 'node:crypto';
import type { Locator,Page } from '@playwright/test';

export interface QueryFileSaveEventCount { count:number;trusted:number;untrusted:number;preventedAtCapture:number;hasLast:boolean;lastDefaultPrevented:boolean;lastIsTrusted:boolean; }
export interface QueryFileSaveEvidence {
  version:1;installed:boolean;available:boolean;ownerCurrent:boolean;readFailed:boolean;overflow:boolean;
  events:Record<'click'|'submit'|'invalid',QueryFileSaveEventCount>;
  dom:{dialogConnected:boolean;formConnected:boolean;buttonConnected:boolean;buttonDisabled:boolean;errorBoxPresent:boolean};
  controlsTotal:number;controlsTruncated:boolean;controls:Array<Record<string,boolean|number>>;
  profile:{attempted:boolean;succeeded:boolean;knownOfflineMatches:number};
}
export type QueryFileSaveAttach=(name:string,data:{body:Buffer;contentType:'application/json'})=>Promise<unknown>;
const empty=():QueryFileSaveEventCount=>({count:0,trusted:0,untrusted:0,preventedAtCapture:0,hasLast:false,lastDefaultPrevented:false,lastIsTrusted:false});
/** 不返回异常正文、字段值、配置对象、SQL、路径或owner token。 */
function unavailable(installed:boolean,ownerCurrent:boolean):QueryFileSaveEvidence{return {version:1,installed,available:false,ownerCurrent,readFailed:true,overflow:false,events:{click:empty(),submit:empty(),invalid:empty()},dom:{dialogConnected:false,formConnected:false,buttonConnected:false,buttonDisabled:false,errorBoxPresent:false},controlsTotal:0,controlsTruncated:false,controls:[],profile:{attempted:false,succeeded:false,knownOfflineMatches:0}};}

/** 仅序列化至捕获dialog所在页面；不修改DOM、React、preload、IPC或事件传播。 */
export function installQueryFileSaveObservation(dialog:HTMLElement,token:string):boolean {
 const root=globalThis as any,key='__dbarkQueryFileSaveObservation',doc=dialog.ownerDocument,form=dialog.querySelector('form'),buttons=form?.querySelectorAll('button[type="submit"]');
 if(!doc||doc!==(globalThis as any).document||!dialog.isConnected||!form||buttons?.length!==1||root[key])return false;
 const button=buttons[0] as HTMLButtonElement,win=doc.defaultView;if(!win)return false;
 const fresh=()=>({count:0,trusted:0,untrusted:0,preventedAtCapture:0,last:null as Event|null});
 const state:any={token,doc,dialog,form,button,active:true,overflow:false,events:{click:fresh(),submit:fresh(),invalid:fresh()}};
 const connected=()=>dialog.isConnected&&form.isConnected&&button.isConnected&&dialog.ownerDocument===doc&&form.ownerDocument===doc&&dialog.contains(form)&&form.contains(button);
 const detach=()=>{if(!state.active)return;state.active=false;for(const type of ['click','submit','invalid'])doc.removeEventListener(type,capture,true);win.removeEventListener('pagehide',detach);if(root[key]===state)delete root[key];for(const event of Object.values(state.events) as any[])event.last=null;};
 const increment=(record:any,name:string)=>{if(record[name]>=1024)state.overflow=true;else record[name]++;};
 const capture=(event:Event)=>{
  if(!state.active||root[key]!==state||!connected()){detach();return;}
  const target=event.target as Node|null;
  if(event.type==='click'?!target||!button.contains(target):event.type==='submit'?target!==form:!target||!form.contains(target))return;
  const record=state.events[event.type];if(!record)return;increment(record,'count');increment(record,event.isTrusted?'trusted':'untrusted');if(event.defaultPrevented)increment(record,'preventedAtCapture');record.last=event;
 };
 state.detach=detach;root[key]=state;for(const type of ['click','submit','invalid'])doc.addEventListener(type,capture,{capture:true,passive:true});win.addEventListener('pagehide',detach,{once:true});return true;
}
/** 原token卸载，只释放本例被动listener；不查表单、不给其它owner卸载，也不读取profile。 */
export function detachQueryFileSaveObservation(token:string):void {const state=(globalThis as any).__dbarkQueryFileSaveObservation;if(state?.token===token)state.detach();}

/** 仅失败调用一次：先取白名单布尔，再只读已知离线profile匹配数，绝不调用validity方法。 */
export async function collectQueryFileSaveEvidence(token:string):Promise<QueryFileSaveEvidence|undefined> {
 const root=globalThis as any,state=root.__dbarkQueryFileSaveObservation;
 if(!state||state.token!==token||!state.active||state.doc!==(globalThis as any).document)return;
 const output:any={version:1,installed:true,available:true,ownerCurrent:true,readFailed:false,overflow:state.overflow,events:{},dom:{},controlsTotal:0,controlsTruncated:false,controls:[],profile:{attempted:false,succeeded:false,knownOfflineMatches:0}};
 try{
  for(const type of ['click','submit','invalid']){const record=state.events[type],last=record.last;output.events[type]={count:record.count,trusted:record.trusted,untrusted:record.untrusted,preventedAtCapture:record.preventedAtCapture,hasLast:!!last,lastDefaultPrevented:last?.defaultPrevented===true,lastIsTrusted:last?.isTrusted===true};}
  const {dialog,form,button}=state;output.dom={dialogConnected:dialog.isConnected===true,formConnected:form.isConnected===true,buttonConnected:button.isConnected===true,buttonDisabled:button.disabled===true,errorBoxPresent:!!dialog.querySelector('.error-box')};
  const controls=form.querySelectorAll('input,select,textarea');output.controlsTotal=Math.min(controls.length,9999);output.controlsTruncated=controls.length>16;
  for(let index=0;index<Math.min(controls.length,16);index++){
   const control=controls[index] as HTMLInputElement,validity=control.validity;
   const flags:Record<string,boolean|number>={index,disabled:control.disabled===true,required:control.required===true,readOnly:control.readOnly===true,willValidate:control.willValidate===true,validityKnown:!!validity};
   for(const name of ['valid','valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'])flags[name]=validity?.[name as keyof ValidityState]===true;
   output.controls.push(flags);
   if(new TextEncoder().encode(JSON.stringify(output)).byteLength>3800){output.controls.pop();output.controlsTruncated=true;break;}
  }
  // 只在原document和原dialog仍属本例时读取一次；不把原profile、认证、值或错误信息带回Node。
  if(root.__dbarkQueryFileSaveObservation===state&&state.active&&output.dom.dialogConnected&&output.dom.formConnected){
   output.profile.attempted=true;
   try{const profiles=await root.dbark.invoke('connections.list',{});if(!Array.isArray(profiles)||profiles.length>10000)throw Error('unknown');if(root.__dbarkQueryFileSaveObservation!==state||!state.active||state.doc!==(globalThis as any).document||!dialog.isConnected){output.ownerCurrent=false;output.available=false;throw Error('owner');}output.profile.knownOfflineMatches=Math.min(9999,profiles.filter(profile=>profile?.name==='SQL 文件离线验收'&&profile.host==='127.0.0.1'&&profile.port===1&&profile.user==='offline'&&profile.dialect==='mysql').length);output.profile.succeeded=true;}catch{output.readFailed=true;}
  }
  return output;
 }catch{output.available=false;output.readFailed=true;output.controls=[];return output;}
 finally{state.detach();}
}

/** 安装失败不改原操作；成功只detach，失败取证／attach出错也始终重抛原断言对象。 */
export async function beginQueryFileSaveObservation(page:Pick<Page,'evaluate'>,dialog:Pick<Locator,'evaluate'>,assertOwner:()=>void):Promise<{detach():Promise<void>;failure(original:unknown,attach:QueryFileSaveAttach):Promise<never>}> {
 const token=randomUUID();let installed=false,stopped=false,failed=false;
 const owner=()=>{if(stopped)return false;try{assertOwner();return true;}catch{stopped=true;return false;}};
 if(owner())try{installed=await dialog.evaluate(installQueryFileSaveObservation,token);}catch{/* 观察不可用不能替代原保存行为或断言。 */}
 const detach=async()=>{if(!installed)return;installed=false;if(!owner())return;try{await page.evaluate(detachQueryFileSaveObservation,token);}catch{/* 卸载失效不能掩盖原结果；pagehide另有原document卸载。 */}};
 return {detach,async failure(original,attach){
  if(failed)throw original;failed=true;let evidence=unavailable(installed,false);
  try{
   if(owner()){
    evidence=unavailable(installed,true);
    if(installed)try{evidence=await page.evaluate(collectQueryFileSaveEvidence,token)??evidence;installed=false;}catch{/* 只记录通用不可用事实，不读取异常正文。 */}
    if(!owner())evidence=unavailable(false,false);
   }
   const body=Buffer.from(JSON.stringify(evidence),'utf8');if(body.byteLength<=4096)await attach('query-file-save-observation',{body,contentType:'application/json'});
  }catch{/* 取证或附件失败永不覆盖原断言，不增加重试或延长超时。 */}
  finally{await detach();}throw original;
 }};
}
