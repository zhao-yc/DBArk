import { useEffect, useRef, useState } from 'react';
import { databaseBackupKinds, type DatabaseBackupInspection, type DatabaseBackupPlan, type DatabaseBackupPreparationServices, type DatabaseBackupToolSummary } from '../../shared/databaseBackup';
import { databaseBackupZh as text } from '../locales/databaseBackup.zh-CN';
import { ErrorBox, Modal } from './ui';
import '../databaseBackup.css';

export interface DatabaseBackupDialogProps {
  connections: readonly { id: string; name: string }[]; tools: readonly DatabaseBackupToolSummary[];
  services: DatabaseBackupPreparationServices; onClose(): void;
}
interface Form { connectionId: string; database: string; toolId: string; }
interface Work { taskId: string; service: DatabaseBackupPreparationServices; promise: Promise<void>; stop: boolean; settled: boolean; cancelState: 'none' | 'pending' | 'confirmed' | 'unknown'; cancellation?: Promise<{ state: 'confirmed' | 'unknown' }>; }

/** 注入 Root 的私有准备端口；没有执行按钮，不接触工具路径、凭据、原始 SQL 或共享 IPC。 */
export function DatabaseBackupDialog({ connections, tools, services, onClose }: DatabaseBackupDialogProps) {
  const [form, setForm] = useState<Form>({ connectionId: '', database: '', toolId: '' });
  const [inspection, setInspection] = useState<DatabaseBackupInspection | null>(null), [plan, setPlan] = useState<DatabaseBackupPlan | null>(null);
  const [file, setFile] = useState<{ fileToken: string; displayName: string } | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), closeRequested = useRef(false), revision = useRef(0), active = useRef<Work | null>(null);
  const authoritative = useRef({ form, inspection, file, acknowledged });
  const currentEpoch = useRef<object | null>(null), epoch = {}; currentEpoch.current = epoch;
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; if (active.current) { active.current.stop = true; void cancelWork(active.current).catch(() => undefined); } }; }, []);

  /** 结果结算与取消释放是两个事实；未知取消即使已收到结果也继续占用本窗口。 */
  function release(owner: Work): void {
    if (active.current !== owner || !owner.settled || !['none', 'confirmed'].includes(owner.cancelState)) return;
    active.current = null; if (alive.current) setBusy(false);
  }

  /** 输入接纳时先同步更新权威状态并撤销旧计划，不等待 React 重绘作为代次屏障。 */
  function change(next: Form): void {
    if (!alive.current || currentEpoch.current !== epoch || active.current || closeRequested.current) return;
    revision.current++; authoritative.current = { form: next, inspection: null, file: null, acknowledged: false };
    setForm(next); setInspection(null); setPlan(null); setFile(null); setAcknowledged(false); setError(''); setMessage('');
  }
  /** 启动前同步占用本窗口；私有端口即使同步回调也不能启动重叠准备或借旧表单提交。 */
  function start<T>(operation: (owner: Work) => Promise<T>, accept: (result: T) => void): void {
    if (!alive.current || currentEpoch.current !== epoch || active.current || closeRequested.current) return;
    const generation = revision.current, owner: Work = { taskId: crypto.randomUUID(), service: services, promise: Promise.resolve(), stop: false, settled: false, cancelState: 'none' };
    active.current = owner; setBusy(true); setError(''); setMessage(''); setPlan(null);
    owner.promise = Promise.resolve().then(() => operation(owner)).then(result => {
      if (alive.current && !owner.stop && !closeRequested.current && active.current === owner && revision.current === generation) accept(result);
    }).catch(reason => { if (alive.current && active.current === owner) setError(reason instanceof Error ? reason.message : text.failed); })
      .finally(() => { owner.settled = true; release(owner); });
  }
  /** 检查只提交稳定标识；工具列表仅供选择，可信性必须由后端注册端口重新核对。 */
  function inspect(): void {
    if (!alive.current || currentEpoch.current !== epoch || active.current || closeRequested.current) return;
    const input = authoritative.current.form;
    if (!connections.some(item => item.id === input.connectionId) || !tools.some(item => item.id === input.toolId) || !input.database) { setError(text.invalid); return; }
    authoritative.current = { ...authoritative.current, inspection: null, file: null, acknowledged: false };
    setInspection(null); setFile(null); setAcknowledged(false);
    start(owner => owner.service.inspect({ ...input, taskId: owner.taskId }), result => {
      if (result.connectionId !== input.connectionId || result.database !== input.database || (result.tool && result.tool.id !== input.toolId) || result.backupExecuted !== false) throw Error(text.stale);
      authoritative.current = { ...authoritative.current, inspection: result }; setInspection(result);
    });
  }
  /** 输出只能来自原生授权文件令牌，取消选择不生成计划。 */
  function chooseFile(): void {
    start(owner => owner.service.chooseFile(), result => { authoritative.current = { ...authoritative.current, file: result }; setFile(result); });
  }
  /** 同步固定检查、文件及影响确认；过期和输入变更必须重新检查，不自动降级。 */
  function prepare(): void {
    if (!alive.current || currentEpoch.current !== epoch || active.current || closeRequested.current) return;
    const current = authoritative.current;
    if (!current.inspection || current.inspection.blockers.length || !current.inspection.scope.complete || !current.file || !current.acknowledged) return;
    if (current.inspection.expiresAt <= Date.now()) { setError(text.expired); return; }
    start(owner => owner.service.prepare({ inspectionToken: current.inspection!.inspectionToken, fileToken: current.file!.fileToken, acknowledgeGlobalWriteBlock: true, taskId: owner.taskId }), result => {
      if (result.inspectionToken !== current.inspection!.inspectionToken || result.connectionId !== current.form.connectionId || result.database !== current.form.database || result.backupExecuted !== false || !result.mustRevalidateUnderLock) throw Error(text.stale);
      setPlan(result);
    });
  }
  /** 一份任务只发送一次取消，并等待端口给出终态；unknown 不等同释放成功。 */
  function cancelWork(owner: Work): Promise<{ state: 'confirmed' | 'unknown' }> {
    owner.stop = true;
    if (!owner.cancellation) {
      owner.cancelState = 'pending';
      owner.cancellation = Promise.resolve().then(() => owner.service.cancel(owner.taskId)).then(result => {
        owner.cancelState = result.state === 'confirmed' ? 'confirmed' : 'unknown';
        if (owner.cancelState === 'unknown') owner.cancellation = undefined; else release(owner);
        return result;
      }, reason => { owner.cancelState = 'unknown'; owner.cancellation = undefined; throw reason; });
    }
    return owner.cancellation;
  }
  /** 取消后仍等本操作结算，不因为取消回执提前允许新的检查。 */
  async function cancel(): Promise<void> {
    const owner = active.current; if (!owner || closeRequested.current || currentEpoch.current !== epoch) return;
    try { const result = await cancelWork(owner); if (result.state !== 'confirmed') throw Error(text.unknown); await owner.promise; if (alive.current && !closeRequested.current && (!active.current || active.current === owner)) setMessage(text.cancelled); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : text.unknown); }
  }
  /** 关闭绑定当前任务，并等取消及检查终态；未知时保留窗口，不能声称资源已清零。 */
  async function close(): Promise<void> {
    if (!alive.current || currentEpoch.current !== epoch || closeRequested.current) return;
    closeRequested.current = true; setClosing(true); const owner = active.current;
    try {
      if (owner) { const result = await cancelWork(owner); if (result.state !== 'confirmed') throw Error(text.unknown); await owner.promise; }
      revision.current++; onClose();
    } catch (reason) { if (alive.current) { closeRequested.current = false; setClosing(false); setError(reason instanceof Error ? reason.message : text.unknown); } }
  }
  const blocked = busy || closing, ready = inspection && !inspection.blockers.length && inspection.scope.complete;
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content database-backup-content">
    <p>{text.intro}</p><fieldset disabled={blocked}><label>{text.connection}<select aria-label={text.connection} value={form.connectionId} onChange={event => change({ ...authoritative.current.form, connectionId: event.currentTarget.value })}><option value="">—</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{text.database}<input aria-label={text.database} value={form.database} onChange={event => change({ ...authoritative.current.form, database: event.currentTarget.value })}/></label>
      <label>{text.tool}<select aria-label={text.tool} value={form.toolId} onChange={event => change({ ...authoritative.current.form, toolId: event.currentTarget.value })}><option value="">—</option>{tools.map(item => <option key={item.id} value={item.id}>{item.label} · {item.version}</option>)}</select></label></fieldset>
    {!tools.length && <p role="status">{text.missingTool}</p>}<ErrorBox message={error}/><p role="status">{closing ? text.closing : busy ? text.busy : message || (!inspection ? text.empty : '')}</p>
    {inspection && <><section><h3>{text.scope}</h3><p>{inspection.serverFamily} {inspection.serverVersion} · {JSON.stringify(inspection.database)}</p><p>{text.preliminary}</p>
      <ul>{databaseBackupKinds.map(kind => <li key={kind}>{text.kinds[kind]}：{inspection.scope.counts[kind]}</li>)}</ul>
      <details><summary>{text.objects}（{inspection.scope.objects.length}）</summary><ul>{inspection.scope.objects.map(object => <li key={JSON.stringify([object.kind, object.name])}>{text.kinds[object.kind]} · {JSON.stringify(object.name)}</li>)}</ul></details>
      {!inspection.scope.objects.length && <p>{text.noObjects}</p>}</section>
      {inspection.blockers.length > 0 ? <section><h3>{text.blockers}</h3><p>{text.incomplete}</p><ul>{inspection.blockers.map((item, index) => <li key={index}>{item.message}</li>)}</ul></section> : <p>{text.complete}</p>}
      <section><h3>{text.lock}</h3><p>{text.impact}</p><p>获取等待上限 {inspection.lock.maxWaitMs / 1000} 秒；持锁预算 {inspection.lock.maxHoldMs / 1000} 秒。超过预算须停止并核实释放，不能保证业务等待时间。</p>
        <label><input type="checkbox" aria-label={text.acknowledge} checked={acknowledged} disabled={blocked || !ready} onChange={event => { if (active.current || closeRequested.current || currentEpoch.current !== epoch) return; const value = event.currentTarget.checked; authoritative.current = { ...authoritative.current, acknowledged: value }; setAcknowledged(value); setPlan(null); }}/>{text.acknowledge}</label></section>
      <p>{text.output}：{file?.displayName ?? '尚未选择'}</p><button disabled={blocked || !ready} onClick={chooseFile}>{text.choose}</button>
      <button disabled={blocked || !ready || !file || !acknowledged} onClick={prepare}>{text.prepare}</button></>}
    {plan && <section role="status" className="database-backup-plan"><h3>{text.planned}</h3><p>{text.notExecuted}</p><p>{text.format}</p><p>{text.output}：{plan.outputName}</p><p>{text.expires}：{new Date(plan.expiresAt).toLocaleString('zh-CN')}</p><p>{text.recheck}</p></section>}
  </div><footer className="modal-footer"><button disabled={blocked || !tools.length} onClick={inspect}>{text.inspect}</button><button disabled={!busy || closing} onClick={() => void cancel()}>{text.cancel}</button><span className="grow"/><button disabled={closing} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
