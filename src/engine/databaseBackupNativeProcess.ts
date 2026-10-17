import type { ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';
import { isIP } from 'node:net';
import { win32 } from 'node:path';
import type { DatabaseBackupNativeOptions } from './databaseBackupNativeOptions';

type Owner = { readonly taskId: string; readonly planToken: string };
type Launch = DatabaseBackupNativeOptions['launch'];
export interface DatabaseBackupNativeChild extends EventEmitter {
  stdin: Writable; stdout: Readable; stderr: Readable;
  kill(signal: 'SIGTERM'): boolean;
}
export interface DatabaseBackupNativeProcessBinding {
  owner: Owner; toolId: 'mysql-8.4.11-win32-x64'; toolLease: string; defaultsFileLease: string;
  toolDirectory: string; defaultsFilePath: string; database: string;
}
export interface DatabaseBackupNativeSpawnRequest {
  readonly executable: string; readonly argv: readonly string[];
  readonly options: { readonly shell: false; readonly windowsVerbatimArguments: false; readonly windowsHide: true; readonly detached: false; readonly cwd: string; readonly env: Readonly<Record<string, string>>; readonly stdio: readonly ['pipe', 'pipe', 'pipe'] };
}
export interface DatabaseBackupNativeProcessPort {
  /** 只能启动一个child；分配后立即capture，即使后续抛错也不能隐藏已分配句柄。允许迟到capture。 */
  spawn(request: DatabaseBackupNativeSpawnRequest, capture: (child: DatabaseBackupNativeChild) => void): DatabaseBackupNativeChild | void;
}
/** Root显式注入node:child_process.spawn；定义适配器不启动进程，没有默认自动执行端口。 */
export function databaseBackupNativeNodeProcessPort(spawn: typeof nodeSpawn): DatabaseBackupNativeProcessPort {
  return { spawn(request, capture) {
    const child: ChildProcessWithoutNullStreams = spawn(request.executable, [...request.argv], {
      shell: false, windowsVerbatimArguments: false, windowsHide: true, detached: false, cwd: win32.dirname(request.executable), env: {}, stdio: ['pipe', 'pipe', 'pipe'],
    });
    capture(child); return child;
  } };
}
const blocked = () => new Error('原生备份子进程状态、归属或本地资源终态未经证实');
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {});
  return { promise, resolve, reject };
}
interface RecordOwner { owner: Owner; taskId: string; planToken: string; slot: number; poisoned: boolean; instance?: DatabaseBackupNativeProcess; poison?: () => void; }
/** 有界永久占位，无TTL；保留原实例、child、流和Promise，不能用新账本绕过未知资源。 */
export class DatabaseBackupNativeProcessOwners {
  #records = new Map<string, RecordOwner>();
  constructor(private readonly capacity = 64) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 128) throw blocked(); }
  register(owner: Owner, instance: DatabaseBackupNativeProcess): RecordOwner {
    if (!owner || typeof owner.taskId !== 'string' || typeof owner.planToken !== 'string' || !owner.taskId || !owner.planToken || owner.taskId.length > 200 || owner.planToken.length > 200 || /[\x00-\x1f]/u.test(owner.taskId + owner.planToken)) throw blocked();
    const previous = this.#records.get(owner.taskId);
    if (previous) { previous.poisoned = true; previous.poison?.(); throw blocked(); }
    if (this.#records.size >= this.capacity) throw blocked();
    const record = { owner, taskId: owner.taskId, planToken: owner.planToken, slot: this.#records.size + 1, poisoned: false, instance };
    this.#records.set(record.taskId, record); return record;
  }
}
/** 只读自有字段；拒绝getter、附加flags/env或把含clientOptions的整个对象传入进程模块。 */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw blocked();
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]))) throw blocked();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
/** 按cbca固定dump策略精确比对，不能把受控launch当作任意命令、恢复SQL或插件位置入口。 */
function request(launch: Launch, binding: DatabaseBackupNativeProcessBinding): DatabaseBackupNativeSpawnRequest {
  const value = exact(launch, ['executable', 'argv', 'shell', 'windowsVerbatimArguments', 'env', 'stdin', 'stdout']);
  if (value.shell !== false || value.windowsVerbatimArguments !== false || value.stdin !== 'closed' || value.stdout !== 'dump-bytes' || !Array.isArray(value.argv) || !Object.isFrozen(value.argv) || !Object.isFrozen(launch)) throw blocked();
  exact(value.env, []);
  const raw = value.argv as unknown[];
  if (raw.length !== 22) throw blocked();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== raw.length + 1 || Array.from({ length: raw.length }, (_, index) => descriptors[String(index)]).some(item => !item || !('value' in item))) throw blocked();
  const argv = Array.from({ length: raw.length }, (_, index) => descriptors[String(index)].value) as unknown[];
  if (argv.some(arg => typeof arg !== 'string' || arg.length > 1024 || arg.includes('\0')) || binding.toolId !== 'mysql-8.4.11-win32-x64' || [binding.toolLease, binding.defaultsFileLease].some(lease => typeof lease !== 'string' || !lease || lease.length > 200 || /[\x00-\x1f]/u.test(lease))) throw blocked();
  for (const path of [binding.toolDirectory, binding.defaultsFilePath]) if (typeof path !== 'string' || !/^[A-Za-z]:\\/u.test(path) || path !== win32.normalize(path) || /[^\x20-\x7e]/u.test(path) || path.length > 240) throw blocked();
  if (value.executable !== win32.join(binding.toolDirectory, 'bin', 'mysqldump.exe') || argv[0] !== `--defaults-file=${binding.defaultsFilePath}` || argv[8] !== `--plugin-dir=${win32.join(binding.toolDirectory, 'lib', 'plugin')}`) throw blocked();
  const host = String(argv[3]).slice(7), port = String(argv[4]).slice(7);
  if (!String(argv[3]).startsWith('--host=') || !isIP(host) || host.includes('%') || !/^--port=[1-9]\d{0,4}$/u.test(String(argv[4])) || Number(port) > 65535) throw blocked();
  const expected = [argv[0], '--no-login-paths', '--protocol=TCP', argv[3], argv[4], '--default-character-set=utf8mb4', '--ssl-mode=DISABLED', '--default-auth=caching_sha2_password', argv[8], '--opt', '--quick', '--hex-blob', '--routines', '--events', '--triggers', '--quote-names', '--set-gtid-purged=OFF', '--column-statistics=0', '--databases', '--skip-lock-tables', '--', binding.database];
  if (typeof binding.database !== 'string' || !binding.database || [...binding.database].length > 64 || /[\x00-\x1f\x7f/\\.]/u.test(binding.database) || binding.database.startsWith('-') || binding.database.endsWith(' ') || ['mysql', 'information_schema', 'performance_schema', 'sys', 'ndbinfo'].includes(binding.database.toLowerCase()) || Buffer.from(binding.database, 'utf8').toString('utf8') !== binding.database || argv.some((arg, index) => arg !== expected[index])) throw blocked();
  return Object.freeze({ executable: String(value.executable), argv: Object.freeze(argv as string[]), options: Object.freeze({ shell: false as const, windowsVerbatimArguments: false as const, windowsHide: true as const, detached: false as const, cwd: win32.dirname(String(value.executable)), env: Object.freeze({}), stdio: Object.freeze(['pipe', 'pipe', 'pipe'] as const) }) });
}

/** 只证明原本地child/流；构造同步登记原槽位，start无await，不包含凭据文本或服务器事实。 */
export class DatabaseBackupNativeProcess {
  #ownerRecord!: RecordOwner; #request!: DatabaseBackupNativeSpawnRequest; #port: DatabaseBackupNativeProcessPort;
  #child?: DatabaseBackupNativeChild; #unexpected?: DatabaseBackupNativeChild; #started = false; #captureReturned = false; #allocationUnknown = false;
  #spawned = false; #exitSeen = false; #zeroExit = false; #childClosed = false; #stdinFinished = false; #stdinClosed = false;
  #stdoutEnded = false; #stdoutClosed = false; #stderrEnded = false; #stderrClosed = false;
  #failed = false; #sealed = false; #cancelled = false; #killRequested = false; #killError = false; #stderrBytes = 0; #stderrOverflow = false; #stdoutBytes = 0;
  #claimed = false; #nextActive = false; #consumerReturned = false; #waiters = new Set<() => void>();
  #exit = deferred<{ owner: Owner; code: number | null; signal: string | null }>(); #closed = deferred<void>();
  constructor(owner: Owner, launch: Launch, binding: DatabaseBackupNativeProcessBinding, port: DatabaseBackupNativeProcessPort, owners: DatabaseBackupNativeProcessOwners) {
    this.#port = port;
    try { this.#ownerRecord = owners.register(owner, this); this.#ownerRecord.poison = () => this.#fail(); if (binding.owner !== owner) throw blocked(); this.#request = request(launch, binding); }
    catch { if (this.#ownerRecord) this.#ownerRecord.poisoned = true; throw blocked(); }
  }
  #owner(): void {
    const record = this.#ownerRecord;
    try { if (record.poisoned || record.owner.taskId !== record.taskId || record.owner.planToken !== record.planToken) throw blocked(); }
    catch { record.poisoned = true; this.#fail(); throw blocked(); }
  }
  #wake(): void { const waiters = [...this.#waiters]; this.#waiters.clear(); for (const wake of waiters) wake(); }
  #fail(): void { this.#failed = true; this.#exit.reject(blocked()); this.#wake(); }
  #localClosed(): boolean { return !this.#ownerRecord.poisoned && !this.#allocationUnknown && !this.#unexpected && (!this.#started ? this.#sealed : !!this.#child && this.#childClosed && this.#stdinClosed && this.#stdoutClosed && this.#stderrClosed); }
  /** 事件只更新原对象事实，owner无效不抛到EventEmitter；禁止error/exit/kill等冒充close。 */
  #event(action: () => void): void {
    try { this.#owner(); } catch { /* 仍记录原资源晚到事实，但不会发放当前owner的confirmed。 */ }
    try { action(); } catch { this.#fail(); }
    if (this.#localClosed()) this.#closed.resolve(); this.#wake();
  }
  /** 同一child捕获去重；端口若给出另一个物理对象则隔离原对象，不猜哪个有效。 */
  #capture(child: DatabaseBackupNativeChild): void {
    if (child === this.#child) return;
    if (this.#child) { this.#unexpected ??= child; this.#allocationUnknown = true; this.#fail(); return; }
    this.#child = child; this.#allocationUnknown = false;
    try {
      if (!child || !child.stdin || !child.stdout || !child.stderr || child.stdout.readableObjectMode || child.stderr.readableObjectMode) throw blocked();
      child.on('spawn', () => this.#event(() => { this.#spawned = true; }));
      child.on('error', () => this.#event(() => this.#fail()));
      child.on('exit', (code: unknown, signal: unknown) => this.#event(() => {
        if (this.#exitSeen || code !== null && (!Number.isSafeInteger(code) || typeof code !== 'number') || signal !== null && (typeof signal !== 'string' || !/^SIG[A-Z0-9]{1,24}$/u.test(signal))) throw blocked();
        this.#exitSeen = true; this.#zeroExit = code === 0 && signal === null;
        this.#exit.resolve({ owner: this.#ownerRecord.owner, code: code as number | null, signal: signal as string | null });
      }));
      child.on('close', () => this.#event(() => { this.#childClosed = true; }));
      child.stdin.on('finish', () => this.#event(() => { this.#stdinFinished = true; }));
      child.stdin.on('close', () => this.#event(() => { this.#stdinClosed = true; }));
      child.stdin.on('error', () => this.#event(() => this.#fail()));
      child.stdout.on('readable', () => this.#event(() => {}));
      child.stdout.on('end', () => this.#event(() => { this.#stdoutEnded = true; }));
      child.stdout.on('close', () => this.#event(() => { this.#stdoutClosed = true; if (!this.#stdoutEnded) this.#fail(); }));
      child.stdout.on('error', () => this.#event(() => this.#fail()));
      child.stderr.on('data', (bytes: unknown) => this.#event(() => {
        if (!(bytes instanceof Uint8Array)) { this.#fail(); return; }
        const total = this.#stderrBytes + bytes.byteLength; this.#stderrOverflow ||= total > 65536; this.#stderrBytes = Math.min(total, 65536);
      }));
      child.stderr.on('end', () => this.#event(() => { this.#stderrEnded = true; }));
      child.stderr.on('close', () => this.#event(() => { this.#stderrClosed = true; if (!this.#stderrEnded) this.#fail(); }));
      child.stderr.on('error', () => this.#event(() => this.#fail()));
      child.stdout.pause(); child.stderr.resume(); child.stdin.end();
      if (this.#cancelled) this.#kill(); this.#wake();
    } catch { this.#allocationUnknown = true; this.#fail(); }
  }
  /** 不重新spawn、不交给shell；原child、三流及Promise均在同步start返回前登记。 */
  start(): { owner: Owner; stdout: AsyncIterable<Uint8Array>; exit: Promise<{ owner: Owner; code: number | null; signal: string | null }> } {
    try {
      this.#owner(); if (this.#started || this.#sealed || this.#failed) throw blocked(); this.#started = true; this.#allocationUnknown = true;
      const child = this.#port.spawn(this.#request, value => this.#capture(value)); if (child) this.#capture(child); this.#captureReturned = true;
      const stdout = Object.freeze({ [Symbol.asyncIterator]: () => this.#iterator() });
      return { owner: this.#ownerRecord.owner, stdout, exit: this.#exit.promise };
    } catch { this.#fail(); throw blocked(); }
  }
  /** 只有消费者next才read，最多复制64KiB；不使用data队列或全量拼接stdout。 */
  #iterator(): AsyncIterator<Uint8Array> {
    this.#owner(); if (this.#claimed) { this.#fail(); throw blocked(); } this.#claimed = true;
    return { next: () => this.#next(), return: async () => { this.#consumerReturned = true; await this.requestCancel(); return { done: true, value: undefined }; } };
  }
  async #next(): Promise<IteratorResult<Uint8Array>> {
    if (this.#nextActive) { this.#fail(); throw blocked(); } this.#nextActive = true;
    try {
      while (true) {
        this.#owner(); if (this.#failed || this.#cancelled || this.#consumerReturned) throw blocked();
        const stream = this.#child?.stdout;
        if (stream) {
          const available = stream.readableLength;
          if (!Number.isSafeInteger(available) || available < 0) throw blocked();
          const chunk: unknown = stream.read(Math.min(65536, available || 65536));
          this.#owner(); if (this.#failed || this.#cancelled) throw blocked();
          if (chunk !== null) {
            if (!(chunk instanceof Uint8Array) || chunk.byteLength > 65536 || !chunk.byteLength) throw blocked();
            this.#stdoutBytes = Math.min(Number.MAX_SAFE_INTEGER, this.#stdoutBytes + chunk.byteLength);
            return { done: false, value: Buffer.from(chunk) };
          }
          if (this.#stdoutEnded) return { done: true, value: undefined };
          if (this.#stdoutClosed) throw blocked();
        }
        await new Promise<void>(resolve => this.#waiters.add(resolve));
      }
    } catch { this.#fail(); throw blocked(); } finally { this.#nextActive = false; }
  }
  /** kill返回值只是请求回执，不是退出或任何流关闭证明。 */
  #kill(): void {
    if (!this.#child || this.#killRequested || this.#childClosed) return; this.#killRequested = true;
    try { this.#child.kill('SIGTERM'); } catch { this.#killError = true; this.#fail(); }
  }
  requestCancel(): Promise<void> {
    try { this.#owner(); this.#cancelled = true; this.#sealed = true; this.#fail(); this.#kill(); if (this.#localClosed()) this.#closed.resolve(); return Promise.resolve(); }
    catch { return Promise.reject(blocked()); }
  }
  /** 有界等待不改原close Promise；超时后仍保留原child/流，晚到事件可以完成真实本地证明。 */
  async waitLocalClosed(timeoutMs = 2500): Promise<{ owner: Owner; state: 'confirmed' | 'unknown' }> {
    const owner = this.#ownerRecord.owner;
    try {
      this.#owner(); if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 3000) throw blocked();
      if (!this.#started) { this.#sealed = true; this.#fail(); }
      if (this.#localClosed()) return { owner, state: 'confirmed' };
      if (!timeoutMs) return { owner, state: 'unknown' };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.#closed.promise, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
      finally { if (timer) clearTimeout(timer); }
      this.#owner(); return { owner, state: this.#localClosed() ? 'confirmed' : 'unknown' };
    } catch { return { owner, state: 'unknown' }; }
  }
  /** 仅检查本地输出事实，Root提交前需另核真实服务器会话、锁、工具/文件租约及完整对象范围。 */
  assertLocalOutput(): void { this.#owner(); if (this.#failed || this.#cancelled || !this.#spawned || !this.#exitSeen || !this.#zeroExit || !this.#stdoutEnded || !this.#stderrEnded || !this.#localClosed()) throw blocked(); }
  /** 只含布尔和有界数字，不含argv、路径、内容、owner令牌、pid或原error。 */
  snapshot() {
    try { this.#owner(); } catch { /* 原对象继续保留，快照仍可用于隔离。 */ }
    return { slot: this.#ownerRecord.slot, poisoned: this.#ownerRecord.poisoned, started: this.#started, captureReturned: this.#captureReturned, childAllocated: !!this.#child, allocationUnknown: this.#allocationUnknown,
      spawnSeen: this.#spawned, exitSeen: this.#exitSeen, zeroExit: this.#zeroExit, childClosed: this.#childClosed, stdinFinished: this.#stdinFinished, stdinClosed: this.#stdinClosed, stdoutEnded: this.#stdoutEnded, stdoutClosed: this.#stdoutClosed, stderrEnded: this.#stderrEnded, stderrClosed: this.#stderrClosed,
      stdoutBytes: this.#stdoutBytes, stderrBytes: this.#stderrBytes, stderrOverflow: this.#stderrOverflow, failed: this.#failed, cancelled: this.#cancelled, killRequested: this.#killRequested, killError: this.#killError, nextActive: this.#nextActive, localClosed: this.#localClosed() };
  }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
