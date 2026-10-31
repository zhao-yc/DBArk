import { vi } from 'vitest';
import type { EngineBroker } from '../../src/main/broker';

/** 旧网络Main夹具未登记SQLite资源；归属查询仍为可观察的独立端口，不替代生产退出处理。 */
export function networkBrokerRamPort<Request>(request: Request) {
  return {
    request,
    isSqliteConnection: vi.fn((_connectionId: string): boolean => false),
    isSqliteSession: vi.fn((_sessionId: string): boolean => false),
    isSqliteTask: vi.fn((_taskId: string): boolean => false),
  } satisfies { request: Request } & Pick<EngineBroker, 'isSqliteConnection' | 'isSqliteSession' | 'isSqliteTask'>;
}
