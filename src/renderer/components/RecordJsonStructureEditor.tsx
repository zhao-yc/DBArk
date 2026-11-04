import type { JsonNodeInput } from '../jsonNodeInput';
import { jsonNodeInputBudget } from '../jsonNodeInput';
import { BoundedRecordTextarea } from './BoundedRecordTextarea';
interface StructureInput { readonly base: { readonly session: object; readonly columnName: string; readonly value: JsonNodeInput }; readonly action: RecordStructureAction; }
import {useEffect,useId,useRef} from 'react';
import type {RecordStructureAction} from '../recordJsonStructureInput';
import {recordJsonStructureInputZh as text} from '../locales/recordJsonStructureInput.zh-CN';
import {objectMemberMoveZh as memberMoveText} from '../locales/objectMemberMove.zh-CN';
import {formatText} from '../locales/zh-CN';

/** 结构操作只持有原文及路径；显式for/id关联控件，避免原文或预算提示混入可访问名称。 */
export function RecordJsonStructureEditor<T extends StructureInput>({input,reason,onChange,onClose}:{input:T;reason:string;onChange(action:RecordStructureAction,captured:T):void;onClose():void}){
  const root=useRef<HTMLElement>(null),action=input.action,id=useId();
  // 重开才聚焦，改字沿用当前原生光标和输入法状态；删除意图聚焦可见标题。
  useEffect(()=>{(root.current?.querySelector<HTMLElement>('textarea:not([readonly]),input:not([readonly])')??root.current?.querySelector<HTMLElement>('h3'))?.focus();},[input.base.session]);
  return <section ref={root} className="record-node-input record-structure-input" aria-label={text.title}>
    <header><h3 tabIndex={-1}>{text.actions[action.kind]} · {input.base.columnName}</h3><button onClick={onClose}>{text.close}</button></header>
    {action.kind==='remove' && <p>{text.removeHint}</p>}
    <details><summary>{text.details}</summary>{action.kind!=='remove' && <p>{action.kind==='move-member'?memberMoveText.hint:text.hint}</p>}<p>{text.scope}</p><label htmlFor={id+'-token'}>{text.token}</label><textarea id={id+'-token'} readOnly spellCheck={false} value={input.base.value.initialToken}/><label htmlFor={id+'-path'}>{text.path}</label><textarea id={id+'-path'} readOnly spellCheck={false} value={JSON.stringify({columnName:input.base.columnName,segments:input.base.value.segments})}/></details>
    {(action.kind==='rename'||action.kind==='append-member')&&<><label htmlFor={id+'-key'}>{text.keyLabel}</label><BoundedRecordTextarea id={id+'-key'} spellCheck={false} readOnly={!!reason} value={action.keyToken} budget={jsonNodeInputBudget} inputIdentity={input.base.session} onValueChange={value=>onChange({...action,keyToken:value},input)}/></>}
    {(action.kind==='append-member'||action.kind==='insert-element')&&<><label htmlFor={id+'-value'}>{text.valueLabel}</label><BoundedRecordTextarea id={id+'-value'} spellCheck={false} readOnly={!!reason} value={action.valueToken} budget={jsonNodeInputBudget} inputIdentity={input.base.session} onValueChange={value=>onChange({...action,valueToken:value},input)}/></>}
    {action.kind==='insert-element'&&<><label htmlFor={id+'-index'}>{text.indexLabel}</label><input id={id+'-index'} inputMode="numeric" readOnly={!!reason} value={action.indexText} onChange={event=>onChange({...action,indexText:event.target.value},input)}/></>}
    {action.kind==='move-element'&&<><label htmlFor={id+'-from'}>{text.fromLabel}</label><input id={id+'-from'} inputMode="numeric" readOnly={!!reason} value={action.fromText} onChange={event=>onChange({...action,fromText:event.target.value},input)}/><label htmlFor={id+'-to'}>{text.toLabel}</label><input id={id+'-to'} inputMode="numeric" readOnly={!!reason} value={action.toText} onChange={event=>onChange({...action,toText:event.target.value},input)}/></>}
    {action.kind==='move-member'&&<><p>{formatText(memberMoveText.count,input.base.value.node.kind==='object'?input.base.value.node.members.length:0)}</p><label htmlFor={id+'-from'}>{memberMoveText.fromLabel}</label><input id={id+'-from'} inputMode="numeric" readOnly={!!reason} value={action.fromText} onChange={event=>onChange({...action,fromText:event.target.value},input)}/><label htmlFor={id+'-to'}>{memberMoveText.toLabel}</label><input id={id+'-to'} inputMode="numeric" readOnly={!!reason} value={action.toText} onChange={event=>onChange({...action,toText:event.target.value},input)}/></>}
    {reason&&<p role="status">{reason}</p>}
  </section>;
}
