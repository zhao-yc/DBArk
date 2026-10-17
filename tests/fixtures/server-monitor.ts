import type { ServerMonitorSnapshot } from '../../src/shared/serverMonitor';
/** 共享的明确合成快照，计数不经Number转换，不读取数据库或当前环境。 */
export function monitorSnapshot(hostname = '合成服务器'): ServerMonitorSnapshot {
  return { startedAt: '2026-10-17T00:00:00.000Z', completedAt: '2026-10-17T00:00:01.000Z', bytes: 1024,
    summary: { status: 'available', value: { version: '8.4.11', versionComment: 'RAM', hostname, port: '3306', currentUser: '只读账号@%', connectionId: '9007199254740993' } },
    globalStatus: { status: 'available', value: [{ name: 'Questions', value: '18446744073709551615' }] },
    sessions: { status: 'available', value: { rows: [{ id: '9007199254740994', user: '用户', host: '来源', database: null, command: 'Query', seconds: '12', state: '', sql: "SELECT '<img src=x>'", sqlLength: '5120', sqlTruncated: true }], limit: 50, truncated: true, visibility: 'account-visible-unconfirmed' } },
  };
}
/** 原读与取消控制可分别交付终态，用于证明取消回包不能释放读取占位。 */
export function monitorDeferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
