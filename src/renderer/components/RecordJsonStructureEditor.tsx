import {useEffect,useRef} from 'react';
import type {RecordJsonStructureInput,RecordStructureAction} from '../recordJsonStructureInput';
import {recordJsonStructureInputZh as text} from '../locales/recordJsonStructureInput.zh-CN';
import {objectMemberMoveZh as memberMoveText} from '../locales/objectMemberMove.zh-CN';
import {formatText} from '../locales/zh-CN';

/** 结构操作仅显示捕获的原文和路径，没有自己的页数组、查询或写入入口。 */
export function RecordJsonStructureEditor({input,reason,onChange,onClose}:{input:RecordJsonStructureInput;reason:string;onChange(action:RecordStructureAction,captured:RecordJsonStructureInput):void;onClose():void}){
  const root=useRef<HTMLElement>(null),action=input.action;
  // 重开才聚焦，改字沿用当前原生光标和输入法状态；删除意图聚焦可见标题。
  useEffect(()=>{(root.current?.querySelector<HTMLElement>('textarea:not([readonly]),input:not([readonly])')??root.current?.querySelector<HTMLElement>('h3'))?.focus();},[input.base.session]);
  return <section ref={root} className="record-node-input record-structure-input" aria-label={text.title}>
    <header><h3 tabIndex={-1}>{text.actions[action.kind]} · {input.base.columnName}</h3><button onClick={onClose}>{text.close}</button></header>
    <p>{action.kind==='remove'?text.removeHint:action.kind==='move-member'?memberMoveText.hint:text.hint}</p><p className="muted small">{text.scope}</p>
    <details><summary>{text.details}</summary><label>{text.token}<textarea readOnly spellCheck={false} value={input.base.value.initialToken}/></label><label>{text.path}<textarea readOnly spellCheck={false} value={JSON.stringify({columnName:input.base.columnName,segments:input.base.value.segments})}/></label></details>
    {(action.kind==='rename'||action.kind==='append-member')&&<label>{text.keyLabel}<textarea spellCheck={false} maxLength={262144} readOnly={!!reason} value={action.keyToken} onChange={event=>onChange({...action,keyToken:event.target.value},input)}/></label>}
    {(action.kind==='append-member'||action.kind==='insert-element')&&<label>{text.valueLabel}<textarea spellCheck={false} maxLength={262144} readOnly={!!reason} value={action.valueToken} onChange={event=>onChange({...action,valueToken:event.target.value},input)}/></label>}
    {action.kind==='insert-element'&&<label>{text.indexLabel}<input inputMode="numeric" readOnly={!!reason} value={action.indexText} onChange={event=>onChange({...action,indexText:event.target.value},input)}/></label>}
    {action.kind==='move-element'&&<><label>{text.fromLabel}<input inputMode="numeric" readOnly={!!reason} value={action.fromText} onChange={event=>onChange({...action,fromText:event.target.value},input)}/></label><label>{text.toLabel}<input inputMode="numeric" readOnly={!!reason} value={action.toText} onChange={event=>onChange({...action,toText:event.target.value},input)}/></label></>}
    {action.kind==='move-member'&&<><p>{formatText(memberMoveText.count,input.base.value.node.kind==='object'?input.base.value.node.members.length:0)}</p><label>{memberMoveText.fromLabel}<input inputMode="numeric" readOnly={!!reason} value={action.fromText} onChange={event=>onChange({...action,fromText:event.target.value},input)}/></label><label>{memberMoveText.toLabel}<input inputMode="numeric" readOnly={!!reason} value={action.toText} onChange={event=>onChange({...action,toText:event.target.value},input)}/></label></>}
    {reason&&<p role="status">{reason}</p>}
  </section>;
}
