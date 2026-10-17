import { useMemo, useRef, useState } from 'react';
import type { ConnectionProfile } from '../../shared/contracts';
import { useWorkspace } from '../store';
import { createServerMonitorServices } from '../serverMonitorServices';
import { serverMonitorZhCN as t } from '../serverMonitorZh';
import { ServerMonitorDialog } from './ServerMonitorDialog';
import { Field, Modal } from './ui';

interface Props { open: boolean; connections: readonly ConnectionProfile[]; versions: Readonly<Record<string, number>>; preferredConnectionId?: string; onClose(): void; }
/** 应用正式入口先选已有连接，监控组件常驻以跨关闭/重开保留原读取屏障。 */
export function ServerMonitorEntry(props: Props) {
  const [pickId, setPickId] = useState(''), [targetId, setTargetId] = useState('');
  const profile = props.connections.find(item => item.id === targetId), sourceVersion = props.versions[targetId] ?? 0;
  const lifetime = useRef({ profile, sourceVersion, epoch: 0 });
  if (lifetime.current.profile !== profile || lifetime.current.sourceVersion !== sourceVersion) lifetime.current = { profile, sourceVersion, epoch: lifetime.current.epoch + 1 };
  const revision = lifetime.current.epoch, latest = useRef({ props, targetId, revision }); latest.current = { props, targetId, revision };
  const services = useMemo(() => createServerMonitorServices(targetId, () => {
    const current = latest.current, workspace = useWorkspace.getState();
    // 直接读取Zustand实时状态，覆盖状态已变化而React尚未完成渲染的窗口。
    return current.props.open && current.targetId === targetId && current.revision === revision && profile !== undefined
      && workspace.connections.find(item => item.id === targetId) === profile && (workspace.connectionVersions[targetId] ?? 0) === sourceVersion;
  }), [targetId, revision, profile, sourceVersion]);
  const candidate = props.connections.find(item => item.id === pickId) ?? props.connections.find(item => item.id === props.preferredConnectionId) ?? props.connections[0];
  const close = () => { setTargetId(''); props.onClose(); };
  return <>
    {props.open && !profile && <Modal title={t.title} onClose={close}>
      {candidate ? <><Field label={t.connection}><select value={candidate.id} onChange={event => setPickId(event.target.value)}>{props.connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><button type="button" onClick={() => setTargetId(candidate.id)}>{t.open}</button></> : <p>{t.noConnections}</p>}
      <button type="button" onClick={close}>{t.close}</button>
    </Modal>}
    <ServerMonitorDialog open={props.open && profile !== undefined} connectionId={targetId} connectionRevision={revision} services={services} onClose={close}/>
  </>;
}
