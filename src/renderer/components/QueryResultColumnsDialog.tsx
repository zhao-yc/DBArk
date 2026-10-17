import { useMemo, useRef, useState } from 'react';
import type { ResultSelectionBinding } from '../resultExport';
import { moveQueryResultColumn, type QueryResultColumnLayout } from '../queryResultColumns';
import { queryResultColumnsZh as text } from '../locales/queryResultColumns.zh-CN';
import { zh } from '../locales/zh-CN';
import { Modal, ErrorBox } from './ui';
import '../queryResultColumns.css';

/** 模态只编辑有界列草稿；不扫描、复制行数据，也不投递SQL或文件请求。 */
export function QueryResultColumnsDialog({ binding, initial, owner, isCurrent, onApply, onClose }: { binding:ResultSelectionBinding;initial:QueryResultColumnLayout;owner:string;isCurrent():boolean;onApply(layout:QueryResultColumnLayout):void;onClose():void }) {
  const [layout,setLayout]=useState<QueryResultColumnLayout>(()=>({order:[...initial.order],visible:[...initial.visible]})),[search,setSearch]=useState('');
  const invalid=useRef(false), live=useRef(layout);live.current=layout;
  /** 首次失效永久停止；旧行闭包还必须匹配当前列草稿，不能按旧位置更改另一列。 */
  function current(expected=live.current):boolean { if(invalid.current)return false;let valid=false;try{valid=isCurrent()===true;}catch{}if(!valid)invalid.current=true;return valid&&live.current===expected; }
  const original=useMemo(()=>new Map(binding.columns.map((column,index)=>[column.key,{column,position:index+1}])),[binding]);
  const needle=search.trim().toLocaleLowerCase(), visible=new Set(layout.visible), valid=current();
  const matches=layout.order.filter(key=>{const item=original.get(key)!;return `${item.column.name} ${item.column.type} ${item.position}`.toLocaleLowerCase().includes(needle);});
  /** 同步更新草稿身份，快速连续触发旧按钮也不能越过当前排列。 */
  function replace(expected:QueryResultColumnLayout,next:QueryResultColumnLayout){if(!current(expected)||!next.visible.length)return;live.current=next;setLayout(next);}
  return <div data-query-columns-owner={owner}><Modal title={text.title} onClose={onClose} wide><div className="modal-content query-result-columns"><p>{text.hint}</p><label>{text.search}<input aria-label={text.search} value={search} placeholder={text.searchHint} disabled={!valid} onChange={event=>{if(current())setSearch(event.target.value);}}/></label><div className="query-result-columns-list">{matches.map(key=>{const item=original.get(key)!,index=layout.order.indexOf(key);return <div className="query-result-column" key={key}><label><input type="checkbox" aria-label={text.visible(item.position)} checked={visible.has(key)} disabled={!valid||visible.has(key)&&visible.size===1} onChange={event=>replace(layout,{...layout,visible:event.target.checked?[...new Set([...layout.visible,key])]:layout.visible.filter(value=>value!==key)})}/><strong>{item.column.name||zh.resultExport.emptyName}</strong><small>{text.ordinal(item.position)} · {item.column.type}</small></label><button disabled={!valid||index===0} aria-label={text.up(item.position)} onClick={()=>replace(layout,moveQueryResultColumn(layout,key,-1))}>↑</button><button disabled={!valid||index===layout.order.length-1} aria-label={text.down(item.position)} onClick={()=>replace(layout,moveQueryResultColumn(layout,key,1))}>↓</button></div>;})}{!matches.length&&<p>{text.empty}</p>}</div>{!valid&&<ErrorBox message={text.stale}/>}</div><footer className="modal-footer"><button disabled={!valid} title={text.restoreHint} onClick={()=>replace(layout,{...layout,order:binding.columns.map(column=>column.key)})}>{text.restore}</button><span className="grow"/><button onClick={onClose}>{zh.common.cancel}</button><button className="primary" disabled={!valid||!layout.visible.length} onClick={()=>{if(current(layout))onApply(layout);}}>{text.apply}</button></footer></Modal></div>;
}
