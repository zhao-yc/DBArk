import { useEffect, useRef, useState } from 'react';
import type { DatabaseObject } from '../../shared/contracts';
import type { DefinitionSearchOpen, DefinitionNavigationSource, DefinitionNavigationTarget } from '../../shared/definitionNavigation';
import { DefinitionReadLease, DefinitionSearchLifetime, DefinitionNavigationLifetime, DefinitionEditorLease, DefinitionNavigation, readDefinitionNavigation, type DefinitionReadResult, type DefinitionNavigationState } from '../definitionNavigation';
import { definitionNavigationZh as t } from '../locales/definitionNavigation.zh-CN';
import { databaseSearchZh } from '../locales/databaseSearch.zh-CN';
import { zh } from '../locales/zh-CN';
import { invoke, kindLabels, errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import '../definitionNavigation.css';

/** 实际定义编辑器只读展示；源对象、连接修订与模型监听共同撤销旧命中。 */
function DefinitionMatches({ source, editor, current }: { source: DefinitionNavigationSource; editor: DefinitionEditorLease | null; current: () => DefinitionNavigationTarget | undefined }) {
  const [state, setState] = useState<DefinitionNavigationState>(), controller = useRef<DefinitionNavigation | undefined>(undefined);
  const lifetime = useRef(new DefinitionNavigationLifetime()), latest = useRef(current); latest.current = current;
  useEffect(() => {
    if (!editor) return;
    if (!editor.current() || !lifetime.current.claim(source, editor.model)) { lifetime.current.end(); setState({ status: 'invalid', index: 0, count: 0, limitReached: false }); return; }
    let mounted = true;
    const navigation = new DefinitionNavigation(editor.editor, source, () => { const target = editor.current() ? latest.current() : undefined; return target ? { ...target, uri: source.uri, sql: source.sql, digest: source.digest } : undefined; }, value => { if (mounted) { if (value.status !== 'ready') lifetime.current.end(); setState(value); } });
    controller.current = navigation; const unsubscribe = useWorkspace.subscribe(() => navigation.refresh());
    return () => { mounted = false; unsubscribe(); navigation.dispose(); };
  }, [source, editor]);
  if (!state || state.status === 'closed') return null;
  return <section className="definition-navigation" aria-label={t.title}><span role="status">{state.status === 'ready' ? t.count(state.index, state.count) + t.position(state.line!, state.column!) : state.status === 'unlocatable' ? t.unlocatable : t.invalid}</span>{state.status === 'ready' && <><button onClick={() => controller.current?.move(-1)}>{t.previous}</button><button onClick={() => controller.current?.move(1)}>{t.next}</button><span className="muted small">{state.limitReached ? t.capped(state.count) : t.complete}</span></>}<button onClick={() => { lifetime.current.end(); controller.current?.dispose(); setState({ status: 'closed', index: 0, count: 0, limitReached: false }); }}>{t.close}</button></section>;
}

/** 复用原connections.open/metadata.ddl读取；无SQL执行、应用、保存查询或定义写回入口。 */
export function DefinitionViewer({ connectionId, database, object, search, onClose }: { connectionId: string; database: string; object: DatabaseObject; search?: DefinitionSearchOpen; onClose(): void }) {
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const latest = useRef({ connectionId, database, object, search }); latest.current = { connectionId, database, object, search };
  const binding = useRef(new DefinitionSearchLifetime()), generation = useRef(0);
  const [read, setRead] = useState<{ lease: DefinitionReadLease; generation: number; value?: DefinitionReadResult; busy: boolean; error?: string }>();
  const [editor, setEditor] = useState<DefinitionEditorLease | null>(null), modelLease = useRef<{ owner: DefinitionReadLease; lease: DefinitionEditorLease } | undefined>(undefined);
  /** 同步读取最新工作区版本，目标ABA不能等待React效果才撤销来源。 */
  function current(): DefinitionNavigationTarget | undefined {
    const props = latest.current, workspace = useWorkspace.getState();
    if (!workspace.connections.some(connection => connection.id === props.connectionId)) return;
    const target = { connectionId: props.connectionId, connectionVersion: workspace.connectionVersions[props.connectionId] ?? 0, database: props.database, name: props.object.name, kind: props.object.kind };
    if (props.search && !binding.current.claim(props.search, target)) return;
    return target;
  }
  useEffect(() => {
    const target = { connectionId, connectionVersion: version, database, name: object.name, kind: object.kind }, lease = new DefinitionReadLease(target, current), request = ++generation.current;
    setEditor(null); setRead({ lease, generation: request, busy: true });
    const unsubscribe = useWorkspace.subscribe(() => { if (!lease.current()) setRead(previous => previous?.lease === lease ? { ...previous, busy: false, value: { sql: '', status: 'invalid' } } : previous); });
    if (!lease.current()) setRead({ lease, generation: request, busy: false, value: { sql: '', status: 'invalid' } });
    else void readDefinitionNavigation(lease, search, async () => {
      await invoke('connections.open', { id: target.connectionId }); if (!lease.current()) return '';
      return invoke('metadata.ddl', { connectionId: target.connectionId, database: target.database, name: target.name, kind: target.kind });
    }).then(value => { if (value && lease.current()) setRead({ lease, generation: request, value, busy: false }); }).catch(reason => { if (lease.current()) setRead({ lease, generation: request, busy: false, error: errorMessage(reason) }); });
    return () => { lease.cancel(); unsubscribe(); if (modelLease.current?.owner === lease) { modelLease.current.lease.dispose(); modelLease.current = undefined; } };
  }, [connectionId, database, object.name, object.kind, version, search]);
  // 旧目标即使在效果清理前重绘，也不能继续展示其原文或高亮。
  const owned = read?.lease.current(), value = owned ? read?.value : undefined, invalid = !!read && !owned || value?.status === 'invalid';
  return <Modal title={databaseSearchZh.definitionTitle(kindLabels[object.kind], object.name)} wide onClose={() => { read?.lease.cancel(); onClose(); }}><div className="modal-content"><UsageHelp><p>{databaseSearchZh.definitionReadOnly}</p></UsageHelp>{invalid && <p role="status">{t.invalid}</p>}{owned && read?.busy && <Spinner/>}{value?.status === 'unavailable' && <p role="status">{t.unavailable}</p>}{value?.source && <DefinitionMatches source={value.source} editor={editor} current={() => read?.lease.current() ? current() : undefined}/ >}{value?.sql && <SqlEditor key={read?.generation} value={value.sql} readOnly height={340} onReady={instance => { if (read?.lease.current()) { modelLease.current?.lease.dispose(); const prepared = new DefinitionEditorLease(instance); modelLease.current = { owner: read.lease, lease: prepared }; setEditor(prepared); } }}/ >}{owned && read?.error && <><p role="status">{t.failed}</p><ErrorBox message={read.error}/></>}</div><footer className="modal-footer"><span className="grow"/><button onClick={() => { read?.lease.cancel(); onClose(); }}>{zh.common.cancel}</button></footer></Modal>;
}
