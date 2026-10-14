import { useEffect, useRef } from 'react';
import type { RecordJsonNodeInput } from '../recordJsonNodeInput';
import { recordJsonNodeInputZh as text } from '../locales/recordJsonNodeInput.zh-CN';

/** 节点只拥有互斥原文缓冲；没有自己的页面数据、IPC 或自动提交入口。 */
export function RecordJsonNodeEditor({input,reason,onChange,onClose}:{input:RecordJsonNodeInput;reason:string;onChange(value:string,captured:RecordJsonNodeInput):void;onClose():void}) {
  const editor=useRef<HTMLTextAreaElement>(null);
  // 同一次节点输入改字不抢光标；打开新节点或关闭后重开才恢复输入焦点。
  useEffect(()=>{editor.current?.focus();},[input.session]);
  return <section className="record-node-input" aria-label={text.title}>
    <header><h3>{text.title} · {input.columnName}</h3><button onClick={onClose}>{text.close}</button></header>
    <p>{text.hint}</p><details><summary>{text.details}</summary><p className="muted small">{text.scope}</p><label>{text.path}<textarea readOnly spellCheck={false} value={JSON.stringify({columnName:input.columnName,segments:input.value.segments})}/></label></details>
    <label>{text.label}<textarea ref={editor} spellCheck={false} maxLength={262_144} readOnly={!!reason} value={input.value.text} onChange={event=>onChange(event.target.value,input)}/></label>
    {reason&&<p role="status">{reason}</p>}
  </section>;
}
