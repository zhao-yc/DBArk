import{useEffect,useRef,useState}from'react';
import type{CellValue}from'../../shared/contracts';
import type{DataSearchRecord}from'../../shared/dataSearchRecords';
import{invoke,errorMessage,uid}from'../lib';
import{useWorkspace}from'../store';
import{dataSearchRecordsZh as t}from'../locales/dataSearchRecords.zh-CN';
import{Modal,ErrorBox,Spinner}from'./ui';

/** 二进制以HEX只读显示，JSON和精确数字保持服务器原文，不隐式解析或转Number。 */
function recordText(value:CellValue){if(value===null)return t.null;if(typeof value==='object')return Array.from(atob(value.base64),character=>character.charCodeAt(0).toString(16).padStart(2,'0')).join('').toUpperCase();return value===''?t.empty:String(value);}
/** 独立读取当前记录，返回时等待取消及实际回复，迟到值不会落入搜索或原表格。 */
export function DataSearchRecordDialog({connectionId,recordRef,focusColumn,onBack}:{connectionId:string;recordRef:string;focusColumn?:string;onBack():void}){
 const[result,setResult]=useState<DataSearchRecord>(),[error,setError]=useState(''),[busy,setBusy]=useState(true),[closing,setClosing]=useState(false),mounted=useRef(true),requested=useRef(false),closeWork=useRef<Promise<void>|undefined>(undefined);
 const operation=useRef<{taskId:string;submitted:boolean;pending:boolean;done:Promise<void>}>({taskId:uid(),submitted:false,pending:true,done:Promise.resolve()});
 const content=useRef<HTMLDivElement>(null);
 /** 读取后直达原命中字段，宽表不能先把用户停在字段块开头的NULL值。 */
 useEffect(()=>{if(!result||requested.current)return;const field=Array.from(content.current?.querySelectorAll<HTMLTextAreaElement>('textarea')??[]).find(element=>element.getAttribute('aria-label')===t.value(focusColumn??result.fields[0]?.name??''));field?.focus({preventScroll:true});field?.scrollIntoView({block:'center'});},[result,focusColumn]);
 /** 取消RPC不代替读取的终态；开始前的微任务取消则完全不发查询。 */
 async function stop(){const current=operation.current;requested.current=true;if(current.pending&&current.submitted)await invoke('query.cancel',{taskId:current.taskId});await current.done;}
 useEffect(()=>{
  mounted.current=true;const current=operation.current;
  current.done=(async()=>{try{await Promise.resolve();if(requested.current)return;current.submitted=true;const value=await invoke('search.recordRead',{connectionId,taskId:current.taskId,recordRef});if(mounted.current&&!requested.current)setResult(value);}catch(reason){if(mounted.current&&!requested.current)setError(errorMessage(reason));}finally{current.pending=false;if(mounted.current)setBusy(false);}})();
  const visibility=()=>{if(document.visibilityState==='hidden')back();};document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;document.removeEventListener('visibilitychange',visibility);void stop().catch(reason=>useWorkspace.getState().notify(errorMessage(reason),true));};
 },[connectionId,recordRef]);
 /** 错误时保留对话框，仍可明确重试收尾，不能遗忘未确认结束的任务。 */
 function back(){if(closeWork.current)return;setClosing(true);const closing=(async()=>{try{await stop();if(mounted.current)onBack();}catch(reason){if(mounted.current){setError(errorMessage(reason));setClosing(false);requested.current=false;}}})();closeWork.current=closing;void closing.finally(()=>{if(closeWork.current===closing)closeWork.current=undefined;});}
 return <Modal title={t.title} wide onClose={back}><div ref={content} className="modal-content data-search-record"><p className="info-strip">{t.hint}</p><p className="muted small">{t.expires}</p><ErrorBox message={error}/>{busy&&<Spinner text={closing?t.closing:t.reading}/>}<div role="status">{result&&<><strong>{result.target.database}.{result.target.table}</strong><p>{t.searched}：{result.searchedAt} · {t.read}：{result.readAt} · UTC</p></>}</div>{result?.fields.map(field=>{const text=recordText(field.value);return <section key={field.name}><h3>{field.name} <small className="muted">{field.dataType} · {field.binary?t.binary:t.readOnly}</small> {field.value===null&&<span className="tag">{t.null}</span>}{field.value===''&&<span className="tag">{t.empty}</span>}</h3>{field.truncated&&<p className="warning-text">{t.truncated(field.characters)}</p>}<textarea aria-label={t.value(field.name)} readOnly value={text} rows={field.truncated?6:text.includes('\n')?3:1} spellCheck={false}/></section>;})}</div><footer className="modal-footer"><span className="grow"/><button disabled={closing} onClick={back}>{t.back}</button></footer></Modal>;
}
