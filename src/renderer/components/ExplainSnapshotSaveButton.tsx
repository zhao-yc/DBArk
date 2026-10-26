import { useLayoutEffect, useRef, useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { capturePlanSnapshot, parsePlanSnapshot, type PlanSnapshotDocument } from '../../shared/explainSnapshot';
import { explainSnapshotZh as text } from '../../shared/explainSnapshot.zh-CN';
import { errorMessage, invoke } from '../lib';

/** 显式捕获当前结果；本地文件回执不替换计划对象或重置阅读状态。 */
export function ExplainSnapshotSaveButton({ outcome, fileSnapshot, busy, saveAs = false, onFileBusyChange }: { outcome: QueryOutcome; fileSnapshot?: PlanSnapshotDocument; busy: boolean; saveAs?: boolean; onFileBusyChange?(busy: boolean): void }) {
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<{ value: string; error?: boolean }>();
  const operation = useRef<object | null>(null), lifetime = useRef(0), alive = useRef(false);
  const source = useRef({ outcome, fileSnapshot, generation: 0 });
  if (source.current.outcome !== outcome || source.current.fileSnapshot !== fileSnapshot) source.current = { outcome, fileSnapshot, generation: source.current.generation + 1 };
  const renderedSource = source.current, unavailable = useRef(busy); unavailable.current = busy;
  useLayoutEffect(() => { alive.current = true; lifetime.current++; return () => { alive.current = false; lifetime.current++; }; }, []);
  /** 同步占有入口，原请求结束后才释放；旧生命周期或 A→B→A 回执不再发布。 */
  async function save() {
    if (!alive.current || unavailable.current || source.current !== renderedSource || operation.current) return;
    const token = {}, epoch = lifetime.current, captured = renderedSource; operation.current = token;
    let claimed = false;
    const current = () => alive.current && lifetime.current === epoch && source.current === captured && operation.current === token;
    try {
      onFileBusyChange?.(true); claimed = true; setPending(true); setNotice(undefined);
      // 导入文件保留原始文档；本次版本新增的解析诊断仅用于显示，不能挤占另存预算。
      const snapshot = captured.fileSnapshot ? parsePlanSnapshot(captured.fileSnapshot) : capturePlanSnapshot(captured.outcome);
      const saved = await invoke('explainFiles.save', { snapshot });
      if (current() && saved) setNotice({ value: text.saved(saved.name) });
    } catch (reason) { if (current()) setNotice({ value: errorMessage(reason), error: true }); }
    finally {
      if (operation.current === token) operation.current = null;
      if (alive.current && lifetime.current === epoch) setPending(false);
      // 外层共享锁始终由原请求释放；外层回调自行核对生命周期。
      if (claimed) onFileBusyChange?.(false);
    }
  }
  return <span className="explain-snapshot-save"><button disabled={busy || pending} onClick={() => void save()}>{pending ? text.saving : saveAs ? text.saveAs : text.save}</button>{notice && <span role={notice.error ? 'alert' : 'status'}>{notice.value}</span>}</span>;
}
