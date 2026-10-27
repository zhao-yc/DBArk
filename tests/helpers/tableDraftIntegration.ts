import type { ManagedConnection } from '../../src/engine/connection';
import type { DatabaseEncodingLifetime } from './databaseDefaultEncodingIntegration';
import type { TableStatisticsConnectionFact } from './tableStatisticsIntegration';

export const tableDraftReadControls = [
  'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ',
  'SET SESSION lock_wait_timeout = 15',
  'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
  'ROLLBACK AND NO CHAIN NO RELEASE',
] as const;

/** 复用统计专项的原流/终包/严格关闭事实，产品仅允许本功能精确只读控制语句。 */
export function watchTableDraftConnection(managed: ManagedConnection, scope: string, owner: DatabaseEncodingLifetime, fixtureWrites: ReadonlySet<string>): TableStatisticsConnectionFact {
  const native = managed.connection as unknown as TableStatisticsConnectionFact['native'], stream = native.stream;
  if (!stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('草稿验收原物理连接身份不完整');
  let ended!: () => void; const closed = new Promise<void>(resolve => { ended = resolve; });
  const fact: TableStatisticsConnectionFact = { managed, native, stream, id: native.threadId, scope, pending: 0, closeCalls: 0, strict: false, closeReturned: false, closeFailed: false, closed, sawClose: false, commands: [] };
  stream.once('close', () => { fact.sawClose = true; ended(); });
  for (const method of ['query', 'execute'] as const) {
    const original = native[method];
    native[method] = function (...args: unknown[]) {
      owner.check();
      if (managed.connection !== native as unknown || native.stream !== stream || native.threadId !== fact.id) { owner.stop(); throw Error('草稿验收原物理连接身份漂移'); }
      const input = args[0], sql = typeof input === 'string' ? input : input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'sql')?.value;
      if (typeof sql !== 'string' || !sql) { owner.stop(); throw Error('草稿验收原SQL形状未知'); }
      const control = scope !== 'observer' && (tableDraftReadControls as readonly string[]).includes(sql);
      if (!/^(?:SELECT|SHOW)\b/i.test(sql) && !control && !(scope === 'observer' && fixtureWrites.has(sql))) { owner.stop(); throw Error('草稿产品发送了写入或非本例控制语句'); }
      const callback = args.at(-1), streamed = typeof callback !== 'function'; fact.commands.push({ sql, streamed }); fact.pending++; let settled = false;
      const finish = () => { if (!settled) { settled = true; fact.pending--; } };
      if (!streamed) args[args.length - 1] = function (this: unknown, ...result: unknown[]) { try { return (callback as (...args: unknown[]) => unknown).apply(this, result); } finally { finish(); } };
      try {
        const query = original.apply(native, args);
        if (streamed) {
          if (!query || typeof (query as { once?: unknown }).once !== 'function') { owner.stop(); throw Error('草稿验收原查询缺少可观察终态'); }
          const originalQuery = query as { once(name: string, listener: () => void): unknown };
          originalQuery.once('end', finish); originalQuery.once('error', finish);
        }
        return query;
      } catch (error) { finish(); throw error; }
    };
  }
  const close = managed.close.bind(managed);
  managed.close = async options => { fact.closeCalls++; fact.strict = options?.strict === true; try { await close(options); fact.closeReturned = true; } catch (error) { fact.closeFailed = true; throw error; } };
  return fact;
}
