import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { QueryResult } from '../../shared/contracts';
import { createQueryResultSnapshot, parseQueryResultSnapshot, type QueryResultSnapshotDocument } from '../../shared/queryResultSnapshot';
import { queryResultSnapshotUiZh as text } from '../locales/queryResultSnapshot.zh-CN';
import { errorMessage, invoke } from '../lib';
import { ErrorBox, Spinner } from './ui';
import '../queryResultSnapshot.css';

export interface QueryResultSnapshotServices {
  open(): Promise<{ name: string; snapshot: QueryResultSnapshotDocument } | null>;
  save(snapshot: QueryResultSnapshotDocument): Promise<{ name: string } | null>;
}
export const queryResultSnapshotServices: QueryResultSnapshotServices = {
  open: () => invoke('resultSnapshotFiles.open', {}), save: snapshot => invoke('resultSnapshotFiles.save', { snapshot }),
};
export interface QueryResultSnapshotOperation {
  readonly result?: QueryResult; readonly name?: string;
  current(): boolean; invalidate(): void; finish(): void;
  adopt(snapshot: QueryResultSnapshotDocument, name: string): void;
  uncertain(message: string): void;
  reportError(message: string): void;
}
type Operation = { owner: QueryResultSnapshotOperation; mode: 'open' | 'save'; cancelled: boolean; reported: boolean };

/** 原生选择器即用户的明确动作；取消仅废弃本地发布，原Promise收尾前保持原作业占用。 */
export function QueryResultSnapshotActions({ result, disabled, begin, services = queryResultSnapshotServices, renderActions }: {
  result?: QueryResult; disabled: boolean; begin(mode: 'open' | 'save'): QueryResultSnapshotOperation; services?: QueryResultSnapshotServices; renderActions?(actions: ReactNode): ReactNode;
}) {
  const [working, setWorking] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const active = useRef<Operation | null>(null), alive = useRef(true), committed = useRef<object | null>(null), ticket = {};
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) { active.current.cancelled = true; active.current.owner.invalidate(); } }; }, []);
  /** 即使页面已卸载，保存不确定性仍明确报告一次，不能自动重发同一文件写入。 */
  function uncertain(operation: Operation): void {
    if (operation.mode !== 'save' || operation.reported) return;
    operation.reported = true; if (alive.current) setMessage(text.uncertain);
    operation.owner.uncertain(text.uncertain);
  }
  /** 同轮连点只领取一个原owner，完整文件回包及其cleanup都经同一finally释放。 */
  function start(mode: 'open' | 'save'): void {
    if (!alive.current || committed.current !== ticket || active.current || disabled) return;
    let owner: QueryResultSnapshotOperation;
    try { owner = begin(mode); } catch (reason) { setError(errorMessage(reason)); return; }
    const operation: Operation = { owner, mode, cancelled: false, reported: false }; active.current = operation;
    setWorking(true); setError(''); setMessage('');
    void (async () => {
      try {
        if (!owner.current()) throw Error(text.stale);
        if (mode === 'save') {
          if (!owner.result) throw Error(text.unavailable);
          const snapshot = createQueryResultSnapshot(owner.result, owner.name); if (!owner.current()) throw Error(text.stale);
          const saved = await services.save(snapshot);
          if (saved === null) { if (alive.current) setMessage(text.cancelled); return; }
          if (!owner.current() || operation.cancelled || !alive.current) { uncertain(operation); return; }
          if (alive.current) setMessage(text.saved);
        } else {
          const opened = await services.open();
          if (opened === null) { if (alive.current) setMessage(text.cancelled); return; }
          if (!owner.current() || operation.cancelled || !alive.current) throw Error(text.stale);
          const snapshot = parseQueryResultSnapshot(opened.snapshot); if (!owner.current()) throw Error(text.stale);
          owner.adopt(snapshot, opened.name); if (alive.current) setMessage(text.opened);
        }
      } catch (reason) {
        if (alive.current) setError(errorMessage(reason));
        else if (mode === 'save') owner.reportError(errorMessage(reason));
      } finally {
        // 卸载/撤销不走提前释放；旧owner.finish必须自行拒绝清理后来作业。
        owner.finish(); if (active.current === operation) { active.current = null; if (alive.current) setWorking(false); }
      }
    })();
  }
  /** 只是撤销本轮回包，不声称取消原生选择器、已提交写入或主进程清理。 */
  function cancel(): void { const operation = active.current; if (!operation || operation.cancelled || committed.current !== ticket) return; operation.cancelled = true; operation.owner.invalidate(); setMessage(text.cancelling); }
  const actions = <><button disabled={disabled || working || !result?.columns.length} title={text.scope} onClick={() => start('save')}>{text.save}</button><button disabled={disabled || working} title={text.offline} onClick={() => start('open')}>{text.open}</button></>;
  const status = <>{result?.truncated && <strong className="warning-text">{text.truncated}</strong>}{working && <><Spinner text={text.working}/><button disabled={!!active.current?.cancelled} onClick={cancel}>{text.cancel}</button></>}{message && <span role="status">{message}</span>}<ErrorBox message={error}/></>;
  // 展示端口只迁移按钮，原作业与取消/不确定性状态始终常驻于此组件。
  return renderActions ? <>{renderActions(actions)}<div className="query-result-snapshot-status">{status}</div></> : <div className="query-result-snapshot-actions">{actions}{status}</div>;
}
