import { useEffect, useRef, useState } from 'react';
import { tablePresetLimits, validateTablePresetColumns, type TablePresetConfiguration, type TablePresetSnapshot, type TablePresetTarget } from '../../shared/tablePresets';
import { invoke, errorMessage, uid } from '../lib';
import { tablePresetsZh as t } from '../locales/tablePresets.zh-CN';
import { ErrorBox, UsageHelp } from './ui';

interface Props {
  target:TablePresetTarget;connectionVersion:number;refreshVersion:number;columns:string[];
  configuration:TablePresetConfiguration;disabled:boolean;postgres?:boolean;beforeApply():boolean;onApply(configuration:TablePresetConfiguration):boolean | Promise<boolean>;
}
/** 本机命名方案独立于条件输入器；保存回包从不清空名称、条件输入或表格草稿。 */
export function TablePresetPanel(props:Props) {
  const [snapshot,setSnapshot]=useState<TablePresetSnapshot|null>(null),[name,setName]=useState(''),[selected,setSelected]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [confirmation,setConfirmation]=useState<{kind:'replace'|'delete';key:string}>();
  const identity=JSON.stringify([props.postgres,props.target,props.connectionVersion,props.refreshVersion,props.columns]);
  const environment=useRef({identity,epoch:0});if(environment.current.identity!==identity)environment.current={identity,epoch:environment.current.epoch+1};
  const configurationKey=JSON.stringify(props.configuration),configurationEpoch=useRef({key:configurationKey,epoch:0});
  if(configurationEpoch.current.key!==configurationKey)configurationEpoch.current={key:configurationKey,epoch:configurationEpoch.current.epoch+1};
  const latest=useRef(props);latest.current=props;const mounted=useRef(true),request=useRef(0),lock=useRef(false);
  const activeRead=useRef<{taskId:string;cancelled:boolean}|null>(null),[reading,setReading]=useState(false);
  /** 取消只是发起请求，仍等待原metadata读取的严格资源结算，不能提前恢复busy门。 */
  function cancelRead(){const read=activeRead.current;if(read&&!read.cancelled){read.cancelled=true;void invoke('query.cancel',{taskId:read.taskId}).catch(reason=>{if(mounted.current)setError(errorMessage(reason));});}}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;cancelRead();};},[]);
  /** 目标变化立即使旧请求永久失效；刷新只读本机存储，不应用或保存任何条件。 */
  async function reload() {
    const id=++request.current,epoch=environment.current.epoch,target={...latest.current.target};lock.current=true;setPending(true);setError('');
    try{const result=await invoke(latest.current.postgres?'postgres.table.presets.list':'table.presets.list',target);if(mounted.current&&id===request.current&&epoch===environment.current.epoch){setSnapshot(result);setSelected('');}}
    catch(reason){if(mounted.current&&id===request.current){setSnapshot(null);setError(errorMessage(reason));}}
    finally{if(mounted.current&&id===request.current){lock.current=false;setPending(false);}}
  }
  useEffect(()=>{setSnapshot(null);setNotice('');void reload();return cancelRead;},[identity]);
  /** 异步应用只接受原表页/字段/筛选；使用最新父回调再次经过脏稿与忙状态保护。 */
  async function action(kind:'save'|'replace'|'delete'|'apply', confirmed = false) {
    const current=latest.current;if(lock.current||activeRead.current||current.disabled||!snapshot)return;
    const same=snapshot.entries.find(item=>item.name===name),entry=snapshot.entries.find(item=>item.id===selected);
    if(kind==='replace'&&!same||kind==='delete'&&!entry||kind==='apply'&&!entry)return;
    if (kind === 'replace' || kind === 'delete') {
      const chosen = kind === 'replace' ? same! : entry!;
      if (current.postgres) {
        // 确认绑定选中的方案和当前条件，避免旧确认覆盖新版本或另一项。
        const key = JSON.stringify([kind, environment.current.epoch, configurationEpoch.current.epoch, snapshot.revision, chosen.id]);
        if (!confirmed) { setConfirmation({ kind, key }); return; }
        setConfirmation(undefined);
        if (confirmation?.key !== key) { setError(t.changed); return; }
      } else if (!window.confirm(kind === 'replace' ? t.replaceConfirm : t.deleteConfirm)) return;
    }
    if(kind==='apply'&&!current.beforeApply())return;
    const epoch=environment.current.epoch,id=++request.current,configuration=configurationEpoch.current.epoch;
    const checked={...current.target,expectedRevision:snapshot.revision,source:snapshot.source,bindingToken:snapshot.bindingToken};lock.current=true;setPending(true);setError('');setNotice('');
    let readRequest:{taskId:string;cancelled:boolean}|undefined;
    try {
      if(kind==='apply'){
        let result: TablePresetConfiguration;
        if (current.postgres) {
          result = await invoke('postgres.table.presets.read', { ...checked, id: entry!.id });
        } else {
          const read={taskId:uid(),cancelled:false};readRequest=read;activeRead.current=read;setReading(true);
          result=await invoke('table.presets.apply',{...checked,id:entry!.id,taskId:read.taskId});
        }
        if(!mounted.current||id!==request.current)return;
        if(readRequest?.cancelled||epoch!==environment.current.epoch||latest.current.disabled||configuration!==configurationEpoch.current.epoch)throw Error(t.changed);
        const next=validateTablePresetColumns(result,latest.current.columns,current.postgres);
        if (!await latest.current.onApply(next)) throw Error(t.changed);
        if (mounted.current && id === request.current && epoch === environment.current.epoch) setNotice(t.applied);
      }else{
        const result=kind==='delete'?await invoke(current.postgres?'postgres.table.presets.delete':'table.presets.delete',{...checked,id:entry!.id}):await invoke(current.postgres?'postgres.table.presets.save':'table.presets.save',{...checked,name,configuration:validateTablePresetColumns(current.configuration,current.columns,current.postgres),...(kind==='replace'?{replaceId:same!.id}:{})});
        if(mounted.current&&id===request.current&&epoch===environment.current.epoch){setSnapshot(result);setNotice(kind==='delete'?t.deleted:t.saved);if(kind==='delete')setSelected('');}
      }
    }catch(reason){if(mounted.current&&id===request.current)setError(errorMessage(reason));}
    finally{
      if(readRequest&&activeRead.current===readRequest){activeRead.current=null;if(mounted.current)setReading(false);}
      if(mounted.current&&id===request.current){lock.current=false;setPending(false);}
    }
  }
  const disabled=props.disabled||pending||reading||!snapshot,editingDisabled=disabled||!!confirmation,same=snapshot?.entries.some(item=>item.name===name);
  return <section aria-label={t.title}><strong>{t.title}</strong><UsageHelp><p>{t.notice}</p></UsageHelp><div className="filter-inputs">
    <input aria-label={t.name} maxLength={tablePresetLimits.name} value={name} disabled={!!confirmation} onChange={event=>setName(event.target.value)}/>
    <button disabled={editingDisabled||!name.trim()||same} onClick={()=>void action('save')}>{t.save}</button>
    <button disabled={editingDisabled||!same} onClick={()=>void action('replace')}>{t.replace}</button>
    <select aria-label={t.choose} value={selected} disabled={editingDisabled} onChange={event=>setSelected(event.target.value)}><option value="">{t.none}</option>{snapshot?.entries.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
    <button disabled={editingDisabled||!selected} onClick={()=>void action('apply')}>{t.apply}</button><button disabled={editingDisabled||!selected} onClick={()=>void action('delete')}>{t.remove}</button><button disabled={pending||props.disabled||!!confirmation} onClick={()=>void reload()}>{t.reload}</button>{reading&&<button onClick={cancelRead}>{t.cancel}</button>}
  </div>{confirmation&&<div className="filter-inputs">
    <p>{confirmation.kind==='replace'?t.replaceConfirm:t.deleteConfirm}</p>
    <button onClick={()=>setConfirmation(undefined)}>{t.cancelChange}</button>
    <button className="danger" disabled={disabled} onClick={()=>void action(confirmation.kind,true)}>{confirmation.kind==='replace'?t.confirmReplace:t.confirmRemove}</button>
  </div>}<ErrorBox message={error}/>{notice&&<p role="status">{notice}</p>}</section>;
}
