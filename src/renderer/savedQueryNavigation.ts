import type * as monaco from 'monaco-editor';
import {savedQuerySearchLimits,type SavedQueryNavigationSource,type SavedQueryMatchSpan} from '../shared/savedQuerySearch';
import type {QuerySourceBinding} from '../shared/queryBinding';

export interface SavedQueryNavigationIdentity{sql?:string;connectionId:string;connectionVersion:number;sourceBinding?:QuerySourceBinding}
export interface SavedQueryNavigationState{status:'ready'|'invalid'|'closed';index:number;count:number;limitReached:boolean}
/** 跨React效果重挂载保留终态；同模型同版本的严格模式重订阅可以复用，换模型/修订不能复活。 */
export class SavedQueryNavigationLifetime{
 private owner?:{tabId:string;source:SavedQueryNavigationSource;model:monaco.editor.ITextModel|null;version:number};private ended=false;
 claim(tabId:string,source:SavedQueryNavigationSource,model:monaco.editor.ITextModel|null):boolean{
  if(!this.owner||this.owner.source!==source||this.owner.tabId!==tabId){this.owner={tabId,source,model,version:model?.getVersionId()??0};this.ended=!model;}
  if(this.ended||!this.owner||!model||model.isDisposed()||this.owner.model!==model||this.owner.version!==model.getVersionId()){this.ended=true;return false;}return true;
 }
 /** 只有当前活跃效果的真实失效/关闭才终结，效果清理本身不模拟用户关闭。 */
 end():void{this.ended=true;}
}
/** 摘要、目标修订和完整正文同时绑定；不因撤销或切回旧来源自动恢复失效结果。 */
export function sameSavedQueryNavigation(source:SavedQueryNavigationSource,current:SavedQueryNavigationIdentity|undefined):boolean{
 return !!current&&current.sql===source.sql&&current.connectionId===source.connectionId&&current.connectionVersion===source.connectionVersion&&current.sourceBinding?.id===source.queryId&&current.sourceBinding.digest===source.digest&&/^[a-f0-9]{64}$/.test(source.digest);
}
/** 不接受越界、重叠、拆代理对或伪称完整的超量位置，不在渲染线程重跑用户正则。 */
export function validSavedQuerySpans(sql:string,ranges:SavedQueryMatchSpan[],limitReached:boolean):boolean{
 if(sql.length>savedQuerySearchLimits.sqlUnits||!Array.isArray(ranges)||!ranges.length||ranges.length>savedQuerySearchLimits.sqlMatches||typeof limitReached!=='boolean'||limitReached&&ranges.length!==savedQuerySearchLimits.sqlMatches)return false;
 const boundary=(offset:number)=>!(offset>0&&offset<sql.length&&/[\ud800-\udbff]/.test(sql[offset-1])&&/[\udc00-\udfff]/.test(sql[offset]));
 let previousEnd=-1,previousStart=-1;return ranges.every(range=>{if(!range||typeof range!=='object')return false;const end=range.offset+range.length,valid=Number.isSafeInteger(range.offset)&&Number.isSafeInteger(range.length)&&range.offset>=0&&range.length>=0&&end<=sql.length&&range.offset>=previousEnd&&range.offset>previousStart&&boundary(range.offset)&&boundary(end);previousEnd=end;previousStart=range.offset;return valid;});
}

/** 同步模型租约：所有显示/导航先核当前模型及版本；编辑、换模型、切源或取消永久失效。 */
export class SavedQueryNavigation{
 private readonly source:SavedQueryNavigationSource;
 private model:monaco.editor.ITextModel|null;private version:number;private decorations?:monaco.editor.IEditorDecorationsCollection;private listeners:monaco.IDisposable[]=[];private alive=true;private terminal?:'invalid'|'closed';private index=0;
 constructor(private readonly editor:monaco.editor.IStandaloneCodeEditor,source:SavedQueryNavigationSource,private readonly current:()=>SavedQueryNavigationIdentity|undefined,private readonly changed:(state:SavedQueryNavigationState)=>void){
  this.source=source;
  this.model=editor.getModel();this.version=this.model?.getVersionId()??0;
  if(!this.model||this.model.getValue()!==source.sql||!sameSavedQueryNavigation(source,current())||!validSavedQuerySpans(source.sql,source.occurrences.ranges,source.occurrences.limitReached)){this.invalidate();return;}
  // 有界位置复制为本租约快照，外部复用/修改回包对象也不能移动已经验证的范围。
  this.source={...source,occurrences:{limitReached:source.occurrences.limitReached,ranges:source.occurrences.ranges.map(span=>({...span}))}};
  this.listeners=[this.model.onDidChangeContent(()=>this.invalidate()),this.model.onWillDispose(()=>this.invalidate()),editor.onDidChangeModel(()=>this.invalidate()),editor.onDidDispose(()=>this.invalidate())];
  this.decorations=editor.createDecorationsCollection();this.show();
 }
 /** 外部工作区同步订阅也走同一检查，不能等下一次点击才清理已换源的高亮。 */
 refresh():boolean{if(!this.alive)return false;if(!this.model||this.model.isDisposed()||this.editor.getModel()!==this.model||this.model.getVersionId()!==this.version||!sameSavedQueryNavigation(this.source,this.current())){this.invalidate();return false;}return true;}
 /** 仅在已显示的有界范围内循环，不执行SQL、不改模型或原标签选区。 */
 move(delta:number):void{if(!this.refresh()||!Number.isSafeInteger(delta))return;const count=this.source.occurrences.ranges.length;this.index=((this.index+delta)%count+count)%count;this.show();}
 private show():void{
  if(!this.refresh())return;const model=this.model!;
  this.decorations!.set(this.source.occurrences.ranges.map((span,index)=>{const start=model.getPositionAt(span.offset),end=model.getPositionAt(span.offset+span.length);return{range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},options:{className:index===this.index?'saved-query-match saved-query-match-active':'saved-query-match',showIfCollapsed:true,...(span.length===0?{before:{content:'│',inlineClassName:'saved-query-match-zero'}}:{})}};}));
  // Monaco操作可同步触发外部监听；每步重新确认租约，重入编辑/切源后不能再发布ready。
  if(!this.refresh())return;const position=model.getPositionAt(this.source.occurrences.ranges[this.index].offset);this.editor.setPosition(position);if(!this.refresh())return;this.editor.revealPositionInCenter(position);if(!this.refresh())return;this.editor.focus();if(!this.refresh())return;
  this.changed({status:'ready',index:this.index,count:this.source.occurrences.ranges.length,limitReached:this.source.occurrences.limitReached});
 }
 /** 清理幂等且终态不可逆，旧回调或撤销不能重新创建装饰。 */
 invalidate(status:'invalid'|'closed'='invalid'):void{if(this.terminal==='closed'||!this.alive&&status!=='closed')return;if(this.alive){this.alive=false;this.decorations?.clear();for(const listener of this.listeners)listener.dispose();this.listeners=[];}this.terminal=status;this.changed({status,index:0,count:0,limitReached:false});}
 /** 标签卸载或用户明确关闭共享幂等终态，不保留活动模型监听。 */
 dispose():void{this.invalidate('closed');}
}
