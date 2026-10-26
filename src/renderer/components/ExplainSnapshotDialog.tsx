import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { planSnapshotOutcome, parsePlanSnapshot, type PlanSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text } from '../../shared/explainSnapshot.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ExplainPlanView } from './ExplainPlanView';
import { QueryAnalyzeView } from './QueryAnalyzeView';
import { ErrorBox, Modal } from './ui';
import '../explainSnapshot.css';

/** 文件选择由明确动作触发；导入仅恢复展示结果，始终不创建数据库会话。 */
export function ExplainSnapshotDialog({ onClose }: { onClose(): void }) {
  const [loaded, setLoaded] = useState<{ name: string; snapshot: PlanSnapshotDocument; outcome: QueryOutcome }>(), [busy, setBusy] = useState<'open' | 'save'>(), [error, setError] = useState('');
  const operation = useRef<'open' | 'save' | null>(null), alive = useRef(false), lifetime = useRef(0);
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; }; }, []);
  /** 关闭按钮与捕获阶段 Escape 共用同步锁，等待原始 I/O 真正结束。 */
  function close() { if (alive.current && !operation.current) onClose(); }
  /** 保存和打开共享同一同步入口，不能靠下一帧 disabled 防止交叉提交。 */
  function fileBusy(value: boolean) {
    if (value) {
      if (!alive.current || operation.current) throw Error(text.busy);
      operation.current = 'save'; setBusy('save'); setError('');
    } else if (operation.current === 'save') { operation.current = null; if (alive.current) setBusy(undefined); }
  }
  /** 取消或坏文件保留已打开内容；迟到回执不得更新重挂载后的弹窗。 */
  async function open() {
    if (!alive.current || operation.current) return;
    const epoch = lifetime.current; operation.current = 'open'; setBusy('open'); setError('');
    const current = () => alive.current && lifetime.current === epoch;
    try {
      const selected = await invoke('explainFiles.open', {});
      if (selected && current()) {
        const snapshot = parsePlanSnapshot(selected.snapshot), outcome = planSnapshotOutcome(snapshot);
        if (snapshot.kind === 'dbark.analyze-snapshot' ? !outcome.analysis : !outcome.explain) throw Error(text.invalid);
        if (current()) setLoaded({ name: selected.name, snapshot, outcome });
      }
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { operation.current = null; if (current()) setBusy(undefined); }
  }
  return <Modal title={text.title} wide onClose={close}><div className="explain-snapshot-dialog">
    <p>{text.notice}</p><div className="explain-snapshot-actions"><button disabled={!!busy} onClick={() => void open()}>{busy === 'open' ? text.opening : text.choose}</button><button disabled={!!busy} onClick={close}>{text.close}</button></div>
    <ErrorBox message={error}/>{loaded && <><p role="status">{text.opened(loaded.name)}</p><p className="muted small">{loaded.snapshot.kind === 'dbark.analyze-snapshot' ? text.actual : text.estimated}</p><div className="explain-snapshot-plan">{loaded.snapshot.kind === 'dbark.analyze-snapshot' ? <QueryAnalyzeView plan={loaded.outcome.analysis!} outcome={loaded.outcome} fileSnapshot={loaded.snapshot} busy={!!busy} fileActions saveAs onFileBusyChange={fileBusy}/> : <ExplainPlanView outcome={loaded.outcome} fileSnapshot={loaded.snapshot} busy={!!busy} fileActions saveAs onFileBusyChange={fileBusy}/>}</div></>}
  </div></Modal>;
}
