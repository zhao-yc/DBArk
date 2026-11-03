import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqlCompletionScope } from '../completionContext';
import { completionServerFacts } from '../completionServerFacts';
import { ObjectDefinitionReader, type ObjectDefinitionView } from '../objectDefinitionReader';
import { LocalReferencesWorkerClient } from '../localReferencesWorkerClient';
import CompletionWorker from '../completion.worker?worker';
import SqliteLocalReferencesWorker from '../sqliteLocalReferences.worker?worker';
import { objectDefinitionZh as text } from '../locales/objectDefinition.zh-CN';
import { acquireWorkspaceBusy, useWorkspace } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';

export interface ObjectDefinitionSource {
  id: string; tabId: string; connectionName: string; source: string; offset: number;
  dialect: 'mysql' | 'mariadb' | 'sqlite'; scope: SqlCompletionScope;
  current(): boolean; watch(changed: () => void): () => void;
  settled?(): Promise<void>;
}

/** 明确对象导航后才读取；全文只留在只读窗口，不创建查询标签、会话或事务。 */
export function ObjectDefinitionDialog({ source, onClose }: { source: ObjectDefinitionSource; onClose(): void }) {
  const origin = useRef(source).current, [view, setView] = useState<ObjectDefinitionView>({ busy: false, stopping: false, error: '' });
  const [closing, setClosing] = useState(false), [problem, setProblem] = useState('');
  const mounted = useRef(false), closePending = useRef(false), latest = useRef(source); latest.current = source;
  const [reader] = useState(() => new ObjectDefinitionReader({
    source: origin.source, offset: origin.offset, dialect: origin.dialect, scope: origin.scope,
    current: () => latest.current === origin && origin.current(), acquire: () => acquireWorkspaceBusy(origin.tabId),
    facts: () => completionServerFacts.get(origin.scope.connectionId, origin.scope.connectionVersion),
    state: sessionId => invoke('query.completionState', { sessionId }),
    create: () => new LocalReferencesWorkerClient(() => origin.dialect === 'sqlite' ? new SqliteLocalReferencesWorker() : new CompletionWorker(), origin.dialect === 'sqlite' ? 'sqlite' : 'mysql'),
    read: input => invoke('query.objectDefinition', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid,
    changed: setView, cleanup: reason => useWorkspace.getState().notify(errorMessage(reason), true),
  }));
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { reader.observe(); });
  useEffect(() => {
    reader.activate();
    const release = origin.watch(() => reader.observe());
    // 严格模式的试挂载先清理；只有仍挂载的明确动作会开始一次实际读取。
    let active = true; queueMicrotask(() => { if (active) void reader.start(); });
    return () => { active = false; mounted.current = false; release(); reader.dispose(); };
  }, [reader, origin]);
  /** 关闭只停止所属读取，原Promise和取消确认收尾后才释放窗口。 */
  async function close(): Promise<void> {
    if (closePending.current) return; closePending.current = true; setClosing(true);
    try { await reader.stop(); await origin.settled?.(); if (mounted.current) onClose(); }
    catch (reason) { if (mounted.current) { closePending.current = false; setClosing(false); setProblem(errorMessage(reason)); } }
  }
  const current = latest.current === origin && origin.current(), output = current ? view.output : undefined;
  return <Modal title={text.title} wide onClose={() => { void close(); }}><div className="modal-content" data-object-definition={origin.id}>
    <p className="muted small">{text.hint}</p><p>{origin.connectionName}</p>
    {view.busy && <Spinner text={view.stopping || closing ? text.stopping : text.loading}/>}
    <ErrorBox message={problem || view.error || (!current ? text.stale : '')}/>
    {output && <><p role="status">{output.temporary ? text.temporary : text.permanent} · {text.schema}：{output.database} · {text.table}：{output.name}</p>
      <SqlEditor value={output.ddl} readOnly dialect={origin.dialect} height={360}/></>}
  </div><footer className="modal-footer">{view.busy && <button disabled={view.stopping || closing} onClick={() => { void reader.stop(); }}>{text.stop}</button>}<span className="grow"/><button disabled={closing} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
