/** 诊断仅持有本次启动身份和固定原始事实，不持有应用、页面、路径或控制端口。 */
export interface DesktopQuitDiagnosticOwner { token: string; generation: number; mainPid: number; }
export type DesktopQuitDiagnosticEvent =
  | 'observer-armed' | 'observer-unavailable' | 'before-quit' | 'app-quit' | 'will-quit' | 'application-close' | 'page-close'
  | 'quit-requested' | 'quit-request-returned' | 'close-wait-started' | 'close-wait-resolved' | 'close-wait-rejected'
  | 'desktop-close-started' | 'desktop-close-resolved' | 'desktop-close-rejected'
  | 'settings-save-started' | 'settings-save-finished' | 'dialog-response' | 'process-exit' | 'process-close'
  | 'process-pids-gone' | 'force-stop-started' | 'force-stop-finished' | 'quit-failed' | 'disposed' | 'invalid';
export interface DesktopQuitDiagnosticPayload {
  method?: 'app' | 'window'; closed?: boolean; pageClosed?: boolean; ok?: boolean;
  exitCode?: number | null; signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT' | null;
  dialogKind?: 'pending-work' | 'shutdown-failed' | 'other'; response?: number; processCount?: number;
}
export interface DesktopQuitDiagnosticEntry extends DesktopQuitDiagnosticPayload { seq: number; elapsedMs: number; event: DesktopQuitDiagnosticEvent; }
export interface DesktopQuitDiagnosticSnapshot {
  version: 1; owner: DesktopQuitDiagnosticOwner; events: DesktopQuitDiagnosticEntry[]; incomplete: boolean; disposed: boolean;
}
export interface DesktopQuitDiagnostics {
  record(ownerToken: string, event: DesktopQuitDiagnosticEvent, payload?: DesktopQuitDiagnosticPayload): boolean;
  snapshot(): DesktopQuitDiagnosticSnapshot;
  dispose(): void;
}
export const desktopQuitDiagnosticLimits = Object.freeze({ events: 128, bytes: 64 * 1024 });
const fields: Record<DesktopQuitDiagnosticEvent, readonly (keyof DesktopQuitDiagnosticPayload)[]> = {
  'observer-armed': ['ok'], 'observer-unavailable': ['ok'], 'before-quit': [], 'app-quit': [], 'will-quit': [],
  'application-close': ['closed'], 'page-close': ['pageClosed'],
  'quit-requested': ['method', 'closed', 'pageClosed', 'ok'], 'quit-request-returned': ['method', 'closed', 'pageClosed', 'ok'],
  'close-wait-started': ['closed', 'pageClosed', 'ok'], 'close-wait-resolved': ['closed', 'pageClosed', 'ok'], 'close-wait-rejected': ['closed', 'pageClosed', 'ok'],
  'desktop-close-started': ['closed', 'pageClosed', 'ok'], 'desktop-close-resolved': ['closed', 'pageClosed', 'ok'], 'desktop-close-rejected': ['closed', 'pageClosed', 'ok'],
  'settings-save-started': [], 'settings-save-finished': ['ok'], 'dialog-response': ['dialogKind', 'response'],
  'process-exit': ['exitCode', 'signal'], 'process-close': ['exitCode', 'signal'], 'process-pids-gone': ['ok', 'processCount'],
  'force-stop-started': ['processCount'], 'force-stop-finished': ['ok', 'closed', 'pageClosed', 'processCount'],
  'quit-failed': ['closed', 'pageClosed', 'ok'], disposed: [], invalid: [],
};

/** 只取固定自有数据字段；不执行getter、toJSON、toString或原型上的载荷。 */
function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('退出诊断字段无效');
  const names = Reflect.ownKeys(value);
  if (names.length > allowed.length || names.some(name => typeof name !== 'string' || !allowed.includes(name))) throw Error('退出诊断字段无效');
  const output: Record<string, unknown> = Object.create(null);
  for (const name of names as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('退出诊断字段无效');
    output[name] = descriptor.value;
  }
  return output;
}

/** 布尔和小枚举不做转换，未知字符串/对象整条丢弃，不能截断后偷带SQL或错误正文。 */
function payload(event: DesktopQuitDiagnosticEvent, input: unknown): DesktopQuitDiagnosticPayload {
  const output = input === undefined ? {} : plain(input, fields[event]);
  for (const [key, value] of Object.entries(output)) {
    let valid = false;
    switch (key as keyof DesktopQuitDiagnosticPayload) {
      case 'method': valid = value === 'app' || value === 'window'; break;
      case 'closed': case 'pageClosed': case 'ok': valid = typeof value === 'boolean'; break;
      case 'exitCode': valid = value === null || typeof value === 'number' && Number.isSafeInteger(value); break;
      case 'signal': valid = value === null || value === 'SIGTERM' || value === 'SIGKILL' || value === 'SIGINT'; break;
      case 'dialogKind': valid = value === 'pending-work' || value === 'shutdown-failed' || value === 'other'; break;
      case 'response': valid = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 32; break;
      case 'processCount': valid = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 128; break;
    }
    if (!valid) throw Error('退出诊断字段无效');
  }
  return output as DesktopQuitDiagnosticPayload;
}

/** 创建失败仅报固定错误；fixture负责隔离诊断初始化异常，原退出逻辑不依赖记录器。 */
export function createDesktopQuitDiagnostics(input: DesktopQuitDiagnosticOwner, clock: () => number = () => performance.now()): DesktopQuitDiagnostics {
  let owner: DesktopQuitDiagnosticOwner;
  try {
    const value = plain(input, ['token', 'generation', 'mainPid']);
    if (typeof value.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.token)
      || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation <= 0
      || typeof value.mainPid !== 'number' || !Number.isSafeInteger(value.mainPid) || value.mainPid <= 0) throw Error();
    owner = { token: value.token, generation: value.generation, mainPid: value.mainPid };
  } catch { throw Error('退出诊断owner必须为本次UUID、启动代次和原主进程正整数PID'); }
  const events: DesktopQuitDiagnosticEntry[] = [];
  let incomplete = false, disposed = false, start = 0, lastClock = 0, lastElapsed = 0;
  /** 时钟异常和回退只标不完整并钳住时间，不抛出或改变原退出请求。 */
  const readClock = (): number => {
    try {
      const value = clock();
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || value < lastClock) { incomplete = true; return lastClock; }
      lastClock = value; return value;
    } catch { incomplete = true; return lastClock; }
  };
  start = readClock();
  /** 只构造新普通对象和新数组，调用方篡改快照不能污染后续记录。 */
  const snapshot = (): DesktopQuitDiagnosticSnapshot => ({ version: 1, owner: { ...owner }, events: events.map(event => ({ ...event })), incomplete, disposed });
  /** 预算先对候选副本计UTF8；超限丢弃该事件并标不完整，绝不抛出或放宽门槛。 */
  const append = (event: DesktopQuitDiagnosticEvent, detail: DesktopQuitDiagnosticPayload): boolean => {
    if (events.length >= desktopQuitDiagnosticLimits.events) { incomplete = true; return false; }
    const elapsedMs = Math.max(lastElapsed, readClock() - start); lastElapsed = elapsedMs;
    const entry: DesktopQuitDiagnosticEntry = { seq: events.length + 1, elapsedMs, event, ...detail };
    const candidate = snapshot(); candidate.events.push(entry);
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > desktopQuitDiagnosticLimits.bytes) { incomplete = true; return false; }
    events.push(entry); return true;
  };
  return {
    record(ownerToken, event, detail) {
      // 迟到旧owner不能给后来启动的记录器留下事件或不完整标志。
      if (disposed || ownerToken !== owner.token) return false;
      try {
        if (typeof event !== 'string' || !Object.hasOwn(fields, event)) throw Error();
        const value = payload(event, detail);
        if (event === 'observer-unavailable' || event === 'invalid') incomplete = true;
        return append(event, value);
      } catch {
        incomplete = true; append('invalid', {}); return false;
      }
    },
    snapshot,
    dispose() { if (disposed) return; append('disposed', {}); disposed = true; },
  };
}
