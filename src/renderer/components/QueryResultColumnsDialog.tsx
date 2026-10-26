import { useMemo, useRef, useState } from 'react';
import type { ResultSelectionBinding } from '../resultExport';
import { moveQueryResultColumn, setQueryResultFrozenThrough, type QueryResultColumnLayout } from '../queryResultColumns';
import { queryResultColumnsZh as text } from '../locales/queryResultColumns.zh-CN';
import { zh } from '../locales/zh-CN';
import { Modal, ErrorBox } from './ui';
import '../queryResultColumns.css';

/** 模态只编辑有界列草稿；不扫描、复制行数据，也不投递SQL或文件请求。 */
export function QueryResultColumnsDialog({ binding, initial, owner, isCurrent, onApply, onClose }: { binding:ResultSelectionBinding;initial:QueryResultColumnLayout;owner:string;isCurrent():boolean;onApply(layout:QueryResultColumnLayout):void;onClose():void }) {
  const [layout,setLayout]=useState<QueryResultColumnLayout>(()=>({order:[...initial.order],visible:[...initial.visible],...(initial.frozenThrough===undefined?{}:{frozenThrough:initial.frozenThrough})})),[search,setSearch]=useState('');
  const invalid=useRef(false), live=useRef(layout);live.current=layout;
  /** 首次失效永久停止；旧行闭包还必须匹配当前列草稿，不能按旧位置更改另一列。 */
  function current(expected=live.current):boolean { if(invalid.current)return false;let valid=false;try{valid=isCurrent()===true;}catch{}if(!valid)invalid.current=true;return valid&&live.current===expected; }
  const original=useMemo(()=>new Map(binding.columns.map((column,index)=>[column.key,{column,position:index+1}])),[binding]);
  const needle=search.trim().toLocaleLowerCase(), visible=new Set(layout.visible), valid=current();
  const matches=layout.order.filter(key=>{const item=original.get(key)!;return `${item.column.name} ${item.column.type} ${item.position}`.toLocaleLowerCase().includes(needle);});
  /** 同步更新草稿身份，快速连续触发旧按钮也不能越过当前排列。 */
  function replace(expected:QueryResultColumnLayout,next:QueryResultColumnLayout){if(!current(expected)||!next.visible.length)return;live.current=next;setLayout(next);}
  /** 冻结只改当前有界草稿，边界使用唯一列键，不按重名别名或筛选后的序号猜测。 */
  function freeze(expected:QueryResultColumnLayout,key?:string){if(current(expected))replace(expected,setQueryResultFrozenThrough(expected,key));}
  /** 隐藏边界列时先清除边界；隐藏其它列只改变实际可见前缀长度。 */
  function changeVisible(expected:QueryResultColumnLayout,key:string,checked:boolean){
    if(!current(expected))return;
    const base=!checked&&expected.frozenThrough===key?setQueryResultFrozenThrough(expected):expected;
    replace(expected,{...base,visible:checked?[...new Set([...base.visible,key])]:base.visible.filter(value=>value!==key)});
  }
  const frozenPosition=layout.frozenThrough===undefined?undefined:original.get(layout.frozenThrough)?.position;
  return <div data-query-columns-owner={owner}><Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content query-result-columns"><p>{text.hint}</p><p>{text.freezeHint}</p>
      <p role="status" aria-label={text.freezeStatus}>{frozenPosition===undefined?text.notFrozen:text.frozenThrough(frozenPosition)}</p>
      <label>{text.search}<input aria-label={text.search} value={search} placeholder={text.searchHint} disabled={!valid} onChange={event=>{if(current())setSearch(event.target.value);}}/></label>
      <div className="query-result-columns-list">{matches.map(key=>{const item=original.get(key)!,index=layout.order.indexOf(key);return <div className="query-result-column" key={key}>
        <label><input type="checkbox" aria-label={text.visible(item.position)} checked={visible.has(key)} disabled={!valid||visible.has(key)&&visible.size===1} onChange={event=>changeVisible(layout,key,event.target.checked)}/><strong>{item.column.name||zh.resultExport.emptyName}</strong><small>{text.ordinal(item.position)} · {item.column.type}</small>{layout.frozenThrough===key&&<span className="tag">{text.boundary}</span>}</label>
        <button disabled={!valid||!visible.has(key)} aria-label={text.freezeThrough(item.position)} aria-pressed={layout.frozenThrough===key} onClick={()=>freeze(layout,key)}>{text.freezeButton}</button>
        <button disabled={!valid||index===0} aria-label={text.up(item.position)} onClick={()=>replace(layout,moveQueryResultColumn(layout,key,-1))}>↑</button><button disabled={!valid||index===layout.order.length-1} aria-label={text.down(item.position)} onClick={()=>replace(layout,moveQueryResultColumn(layout,key,1))}>↓</button>
      </div>;})}{!matches.length&&<p>{text.empty}</p>}</div>{!valid&&<ErrorBox message={text.stale}/>}</div>
    <footer className="modal-footer"><button disabled={!valid} title={text.restoreHint} onClick={()=>replace(layout,{...layout,order:binding.columns.map(column=>column.key)})}>{text.restore}</button><button disabled={!valid||layout.frozenThrough===undefined} onClick={()=>freeze(layout)}>{text.unfreeze}</button><span className="grow"/><button onClick={onClose}>{zh.common.cancel}</button><button className="primary" disabled={!valid||!layout.visible.length} onClick={()=>{if(current(layout))onApply(layout);}}>{text.apply}</button></footer>
  </Modal></div>;
}
