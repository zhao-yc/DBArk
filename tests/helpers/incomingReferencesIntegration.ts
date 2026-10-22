import type { ManagedConnection } from '../../src/engine/connection';
import type { DatabaseEncodingLifetime } from './databaseDefaultEncodingIntegration';

interface NativeStream { closed?: boolean; once(name: string, listener: () => void): unknown; }
interface NativeQuery { once(name: string, listener: (...args: unknown[]) => void): unknown; }
interface Native { threadId: number; stream: NativeStream; query(...args: unknown[]): unknown; execute(...args: unknown[]): unknown; }
export interface IncomingReferenceConnectionFact {
  managed: ManagedConnection; native: Native; stream: NativeStream; id: number; scope: string;
  pending: number; closeCalls: number; strict: boolean; closeReturned: boolean; closeFailed: boolean;
  closed: Promise<void>; sawClose: boolean; commands: { sql: string; streamed: boolean }[];
}
/** 真正的callback和流式Query均透传；只旁观原输入/原终态，不补发、补回调或伪造产品响应。 */
export function watchIncomingReferenceConnection(managed: ManagedConnection, scope: string, owner: DatabaseEncodingLifetime, fixtureWrites: ReadonlySet<string>): IncomingReferenceConnectionFact {
  const native = managed.connection as unknown as Native, stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('子记录验收原连接身份不完整');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: IncomingReferenceConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, commands: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check();
      if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id) { owner.stop(); throw Error('子记录验收原物理连接身份漂移'); }
      const input = args[0], sql = typeof input === 'string' ? input : input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'sql')?.value;
      if (typeof sql !== 'string' || !sql) { owner.stop(); throw Error('子记录验收SQL形态未知'); }
      if (!/^(?:SELECT|SHOW)\b/i.test(sql) && !(scope === 'observer' && fixtureWrites.has(sql))) { owner.stop(); throw Error('子记录用途投递了未授权写入或控制语句'); }
      const callback = args.at(-1), streamed = typeof callback !== 'function'; fact.commands.push({ sql, streamed }); fact.pending++; let settled = false;
      const finish = () => { if (!settled) { settled = true; fact.pending--; } };
      if (!streamed) args[args.length - 1] = function (this: unknown, ...result: unknown[]) { try { return (callback as (...args: unknown[]) => unknown).apply(this, result); } finally { finish(); } };
      try {
        const query = original.apply(native, args);
        if (streamed) {
          if (!query || typeof (query as NativeQuery).once !== 'function') { owner.stop(); throw Error('子记录原流查询没有可观察终态'); }
          // 原方法、Query、fields及stream()始终原样，事件只结算本例计数。
          (query as NativeQuery).once('end', finish); (query as NativeQuery).once('error', finish);
        }
        return query;
      } catch (error) { finish(); throw error; }
    };
  }
  const close = managed.close.bind(managed);
  managed.close = async options => { fact.closeCalls++; fact.strict = options?.strict === true; try { await close(options); fact.closeReturned = true; } catch (error) { fact.closeFailed = true; throw error; } };
  return fact;
}
/** 必须先等原closed；Promise动作完成不替代原流关闭、计数归零或严格收尾。 */
export function assertIncomingReferenceReleased(facts: readonly IncomingReferenceConnectionFact[], strict: boolean): void {
  if (facts.some(fact => fact.managed.connection !== fact.native as unknown || fact.native.stream !== fact.stream || fact.native.threadId !== fact.id || fact.pending !== 0 || fact.closeCalls !== 1 || strict && !fact.strict || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true)) throw Error('子记录原任务/流尚未确认释放，保留原资源');
}
