import { randomUUID } from 'node:crypto';
import type { PostgresMonitorPrivateSnapshot, PostgresMonitorSignalTarget } from '../engine/postgres/serverMonitor';
import { serverMonitorLimits, type ServerMonitorSignalInput, type ServerMonitorSnapshot } from '../shared/serverMonitor';

interface Permit {
  connectionId: string;
  connectionEpoch: object;
  revision: number;
  token: string;
  expires: number;
  targets: Map<string, PostgresMonitorSignalTarget>;
}

/** 进程代次和查询指纹只在可信进程间传递。窗口得到的是限时、单次快照能力。 */
export class ServerMonitorSignals {
  private readonly latest = new WeakMap<object, Permit>();
  constructor(private readonly connectionEpoch: (id: string) => object) {}

  begin(document: object, connectionId: string, revision: number) {
    const connectionEpoch = this.connectionEpoch(connectionId);
    const permit: Permit = { connectionId, connectionEpoch, revision, token: randomUUID(), expires: Date.now() + 60_000, targets: new Map() };
    this.latest.set(document, permit);
    return (result: PostgresMonitorPrivateSnapshot): ServerMonitorSnapshot => {
      const { signalTargets, ...snapshot } = result;
      if (snapshot.dialect !== 'postgresql' || this.latest.get(document) !== permit ||
          this.connectionEpoch(connectionId) !== connectionEpoch || Date.now() >= permit.expires || !signalTargets?.length) return snapshot;
      const signal = { token: permit.token, targets: signalTargets.map(target => ({ pid: target.pid, canCancel: !!target.query })) };
      const view = { ...snapshot, signal };
      for (let previous = -1; previous !== view.bytes;) { previous = view.bytes; view.bytes = Buffer.byteLength(JSON.stringify(view)); }
      if (view.bytes > serverMonitorLimits.snapshotBytes) return snapshot;
      for (const target of signalTargets) permit.targets.set(target.pid, target);
      return view;
    };
  }

  claim(document: object, revision: number, request: ServerMonitorSignalInput): PostgresMonitorSignalTarget {
    const permit = this.latest.get(document), target = permit?.targets.get(request.pid);
    if (!permit || !target || permit.connectionId !== request.connectionId || permit.token !== request.token ||
        permit.revision !== revision || this.connectionEpoch(request.connectionId) !== permit.connectionEpoch ||
        Date.now() >= permit.expires || request.action === 'cancel-query' && !target.query)
      throw Error('会话操作快照已失效，请重新刷新并确认');
    this.latest.delete(document);
    return target;
  }

}
