import { randomBytes } from 'node:crypto';
import { win32 } from 'node:path';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { DatabaseBackupNativeChild } from './databaseBackupNativeProcess';
import type { DatabaseBackupSecretOwner as Owner, DatabaseBackupSecretFilePorts, DatabaseBackupSecretDirectory, DatabaseBackupSecretFileHandle, DatabaseBackupSecretStamp, DatabaseBackupSecretAcl, DatabaseBackupSecretCleanupPermit } from './databaseBackupSecretFile';

export const databaseBackupWindowsFilesSource = Object.freeze({ name: 'databaseBackupWindowsFiles.helper.cs', sha256: 'de41d2526e432f5278584f49ce21bf45073e4f9669d17fbee56773fb3cd01d94', maxBytes: 65536 });
/** 固定小bootstrap；只将已核固定C#资源载入内存后编译，不拼接任何请求或秘密。 */
export const databaseBackupWindowsFilesBootstrap = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='SilentlyContinue'
try {
  if(-not [Environment]::Is64BitProcess){throw 'unsupported'}
  $f=[IO.File]::Open($env:DBARK_WF_SOURCE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    if($f.Length -le 0 -or $f.Length -gt 65536){throw 'source'}
    $b=New-Object byte[] ([int]$f.Length)
    $i=0
    while($i -lt $b.Length){$n=$f.Read($b,$i,$b.Length-$i);if($n -le 0){throw 'source'};$i+=$n}
    if($f.ReadByte() -ne -1){throw 'source'}
  } finally {$f.Dispose()}
  $h=[Security.Cryptography.SHA256]::Create()
  try {$digest=[BitConverter]::ToString($h.ComputeHash($b)).Replace('-','').ToLowerInvariant()} finally {$h.Dispose()}
  if($digest -ne '${databaseBackupWindowsFilesSource.sha256}'){throw 'source'}
  $encoding=New-Object Text.UTF8Encoding($false,$true)
  $source=$encoding.GetString($b)
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll' -ErrorAction Stop | Out-Null
  [Environment]::Exit([DBArkWindowsFiles.Program]::Run())
} catch {
  [Console]::Error.WriteLine('Windows文件helper启动失败')
  [Environment]::Exit(70)
}`;
export interface DatabaseBackupWindowsFilesConfig { parentDirectory: string; directoryName: string; currentUserSid: string; systemRoot: string; sourcePath: string; timeoutMs?: number; startupTimeoutMs?: number; }
export interface DatabaseBackupWindowsFilesSpawnRequest { executable: string; argv: readonly string[]; options: { shell: false; windowsVerbatimArguments: false; windowsHide: true; detached: false; cwd: string; env: Readonly<Record<string, string>>; stdio: readonly ['pipe', 'pipe', 'pipe'] }; commandLineCharacters: number; }
export interface DatabaseBackupWindowsFilesPort {
  spawn(request: DatabaseBackupWindowsFilesSpawnRequest, capture: (child: DatabaseBackupNativeChild) => void): DatabaseBackupNativeChild | void;
  /** 仍由Root证明原dump进程、流及原操作真实终止，不包含这个仍在清理文件的helper，避免循环。 */
  cleanupPermit(owner: Owner): Promise<DatabaseBackupSecretCleanupPermit>;
  checkCancelled(): void;
}
/** Root显式注入Node spawn；这里只构造端口，不自启动helper。 */
export function databaseBackupWindowsFilesNodeSpawn(spawn: typeof nodeSpawn) {
  return (request: DatabaseBackupWindowsFilesSpawnRequest, capture: (child: DatabaseBackupNativeChild) => void) => {
    const child = spawn(request.executable, [...request.argv], { ...request.options, env: { ...request.options.env }, stdio: ['pipe', 'pipe', 'pipe'] }); capture(child); return child;
  };
}
const blocked = () => new Error('Windows敏感文件helper操作或实际资源终态未确认');
function path(value: unknown): string { if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z]:\\/u.test(value) || /[^\x20-\x7e]/u.test(value) || value !== win32.normalize(value) || value.slice(3).split('\\').some(item => !item || /[<>:"/|?*]/u.test(item) || /[ .]$/u.test(item))) throw blocked(); return value; }
/** 完整命令行含NUL，按保守引号规则计算UTF-16代码单元上界；Base64不是加密或原脚本字节预算。 */
export function databaseBackupWindowsFilesLaunch(config: DatabaseBackupWindowsFilesConfig): DatabaseBackupWindowsFilesSpawnRequest {
  const root = path(config.parentDirectory), sourcePath = path(config.sourcePath), systemRoot = path(config.systemRoot);
  if (root.length > 180 || root.slice(3).split('\\').length > 31 || win32.basename(sourcePath) !== databaseBackupWindowsFilesSource.name || !/^[A-Za-z0-9_-]{1,100}$/u.test(config.directoryName) || win32.join(root, config.directoryName, 'client.cnf').length > 240 || typeof config.currentUserSid !== 'string' || config.currentUserSid.length > 200 || !/^S-1-(?:\d+-)+\d+$/u.test(config.currentUserSid) || config.currentUserSid === 'S-1-5-18') throw blocked();
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), argv = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(databaseBackupWindowsFilesBootstrap, 'utf16le').toString('base64')]);
  const quote = (value: string) => '"' + value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1') + '"';
  const commandLineCharacters = [executable, ...argv].map(quote).join(' ').length + 1; if (commandLineCharacters > 32767) throw blocked();
  return Object.freeze({ executable, argv, options: Object.freeze({ shell: false as const, windowsVerbatimArguments: false as const, windowsHide: true as const, detached: false as const, cwd: win32.dirname(sourcePath), env: Object.freeze({ SystemRoot: systemRoot, TEMP: root, TMP: root, DBARK_WF_SOURCE: sourcePath }), stdio: Object.freeze(['pipe', 'pipe', 'pipe'] as const) }), commandLineCharacters });
}
interface Entry { owner: Owner; taskId: string; planToken: string; slot: number; poisoned: boolean; instance: DatabaseBackupWindowsFiles; }
/** 任务号永久占位并有界保留原helper；未知时不可换账本、换owner或重新启动。 */
export class DatabaseBackupWindowsFilesOwners {
  #entries = new Map<string, Entry>();
  constructor(private readonly capacity = 32) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw blocked(); }
  register(owner: Owner, instance: DatabaseBackupWindowsFiles): Entry { if (!owner || typeof owner.taskId !== 'string' || typeof owner.planToken !== 'string' || !owner.taskId || !owner.planToken || owner.taskId.length > 200 || owner.planToken.length > 200) throw blocked(); const old = this.#entries.get(owner.taskId); if (old) { old.poisoned = true; throw blocked(); } if (this.#entries.size >= this.capacity) throw blocked(); const entry = { owner, taskId: owner.taskId, planToken: owner.planToken, slot: this.#entries.size + 1, poisoned: false, instance }; this.#entries.set(entry.taskId, entry); return entry; }
}
interface Rpc { seq: number; op: number; writeLeft: boolean; responseLeft: boolean; resolve(value: Record<string, unknown>): void; reject(error: Error): void; invalidate(error: Error): void; }
interface Slot { id: number; stamp?: DatabaseBackupSecretStamp; closeAttempted: boolean; closePromise?: Promise<void>; removalAttempted: boolean; removed: boolean; }
/** 真实Win32 helper的私有pipe客户端；构造先登记，后续首await前捕获原child及所有流。 */
export class DatabaseBackupWindowsFiles {
  #entry!: Entry; #config: DatabaseBackupWindowsFilesConfig; #port: DatabaseBackupWindowsFilesPort; #request!: DatabaseBackupWindowsFilesSpawnRequest;
  #nonce = randomBytes(16).toString('hex'); #child?: DatabaseBackupNativeChild; #started = false; #unknown = false; #cancelled = false; #initialized = false; #initStarted = false;
  #sequence = 0; #active?: Rpc; #header = Buffer.alloc(4); #headerAt = 0; #body?: Buffer; #bodyAt = 0; #wireFrames = new Set<Buffer>();
  #guards = 0; #writers = 0; #countsSeen = false; #helperFailed = false; #stderrBytes = 0; #stderrOverflow = false;
  #spawnSeen = false; #exitSeen = false; #childClosed = false; #stdinClosed = false; #stdoutEnded = false; #stdoutClosed = false; #stderrEnded = false; #stderrClosed = false;
  #cleanupStarted = false; #cleanupGranted = false; #shutdownSent = false; #shutdownReplySeen = false; #slots = new Map<number, Slot>(); #closedWaiters = new Set<() => void>();
  constructor(owner: Owner, config: DatabaseBackupWindowsFilesConfig, port: DatabaseBackupWindowsFilesPort, owners: DatabaseBackupWindowsFilesOwners) {
    this.#port = port; this.#config = { parentDirectory: config.parentDirectory, directoryName: config.directoryName, currentUserSid: config.currentUserSid, systemRoot: config.systemRoot, sourcePath: config.sourcePath, timeoutMs: config.timeoutMs ?? 2500, startupTimeoutMs: config.startupTimeoutMs ?? 15000 };
    try { this.#entry = owners.register(owner, this); if (!Number.isInteger(this.#config.timeoutMs) || this.#config.timeoutMs! < 1 || this.#config.timeoutMs! > 3000 || !Number.isInteger(this.#config.startupTimeoutMs) || this.#config.startupTimeoutMs! < 1 || this.#config.startupTimeoutMs! > 30000) throw blocked(); this.#request = databaseBackupWindowsFilesLaunch(this.#config); }
    catch { if (this.#entry) this.#entry.poisoned = true; throw blocked(); }
  }
  #owner(): void { const entry = this.#entry; try { if (entry.poisoned || entry.owner.taskId !== entry.taskId || entry.owner.planToken !== entry.planToken) throw blocked(); } catch { entry.poisoned = true; this.#fail(); throw blocked(); } }
  /** Promise已resolve也不能撤回永久unknown；所有返回与缓存回执必须再过此门。 */
  #healthy(): void { this.#owner(); if (this.#unknown) throw blocked(); }
  /** 取消/已知helper失败只禁新工作；原操作终态清理仍单独受健康门与Root许可约束。 */
  #work(): void { this.#healthy(); if (!this.#started || !this.#child || this.#cancelled || this.#helperFailed || this.#shutdownReplySeen) throw blocked(); this.#port.checkCancelled(); this.#healthy(); if (this.#cancelled || this.#helperFailed || this.#shutdownReplySeen) throw blocked(); }
  /** 只有收到零句柄的正常shutdown成功回执，且无残头/残体，才接受终止事件。 */
  #expectedEnd(): boolean { return this.#shutdownReplySeen && !this.#headerAt && !this.#body && (!this.#active || this.#active.op === 14 && this.#active.responseLeft); }
  #fail(): void { this.#unknown = true; this.#active?.reject(blocked()); this.#active?.invalidate(blocked()); }
  #observe(action: () => void): void { try { this.#owner(); } catch { /* 仍保留原对象迟到的物理事件。 */ } try { action(); } catch { this.#fail(); } if (this.#childClosed && this.#stdinClosed && this.#stdoutClosed && this.#stderrClosed) { for (const frame of this.#wireFrames) frame.fill(0); this.#wireFrames.clear(); } if (this.#localClosed() || this.#entry.poisoned) { for (const wake of this.#closedWaiters) wake(); this.#closedWaiters.clear(); } }
  #capture(child: DatabaseBackupNativeChild): void {
    if (child === this.#child) return; if (this.#child) { this.#fail(); return; } this.#child = child;
    try {
      child.on('spawn', () => this.#observe(() => { this.#spawnSeen = true; })); child.on('error', () => this.#observe(() => this.#fail()));
      child.on('exit', (code: unknown, signal: unknown) => this.#observe(() => { this.#exitSeen = true; if (!this.#expectedEnd() || code !== 0 || signal !== null) this.#fail(); })); child.on('close', () => this.#observe(() => { this.#childClosed = true; if (!this.#expectedEnd()) this.#fail(); }));
      child.stdin.on('error', () => this.#observe(() => this.#fail())); child.stdin.on('close', () => this.#observe(() => { this.#stdinClosed = true; if (!this.#expectedEnd()) this.#fail(); }));
      child.stdout.on('data', (bytes: unknown) => this.#observe(() => { if (!(bytes instanceof Uint8Array)) throw blocked(); this.#receive(bytes); }));
      child.stdout.on('end', () => this.#observe(() => { this.#stdoutEnded = true; if (!this.#expectedEnd()) this.#fail(); })); child.stdout.on('close', () => this.#observe(() => { this.#stdoutClosed = true; if (!this.#expectedEnd()) this.#fail(); })); child.stdout.on('error', () => this.#observe(() => this.#fail()));
      child.stderr.on('data', (bytes: unknown) => this.#observe(() => { if (!(bytes instanceof Uint8Array)) throw blocked(); const total = this.#stderrBytes + bytes.length; this.#stderrOverflow ||= total > 65536; this.#stderrBytes = Math.min(total, 65536); }));
      child.stderr.on('end', () => this.#observe(() => { this.#stderrEnded = true; if (!this.#expectedEnd()) this.#fail(); })); child.stderr.on('close', () => this.#observe(() => { this.#stderrClosed = true; if (!this.#expectedEnd()) this.#fail(); })); child.stderr.on('error', () => this.#observe(() => this.#fail()));
      child.stdout.resume(); child.stderr.resume();
    } catch { this.#fail(); }
  }
  start(): void { try { this.#owner(); if (this.#started || this.#cancelled) throw blocked(); this.#started = true; const child = this.#port.spawn(this.#request, value => this.#capture(value)); if (child) this.#capture(child); } catch { this.#fail(); throw blocked(); } }
  #receive(chunk: Uint8Array): void {
    if (this.#stdoutEnded || this.#stdoutClosed) throw blocked();
    let at = 0;
    while (at < chunk.length) {
      // 单RPC只允许一份回执；合法帧后的多余字节即使不足一个头也不能延后判错。
      if (!this.#active || this.#active.responseLeft) throw blocked();
      if (!this.#body) { const count = Math.min(4 - this.#headerAt, chunk.length - at); this.#header.set(chunk.subarray(at, at + count), this.#headerAt); at += count; this.#headerAt += count; if (this.#headerAt < 4) continue; const size = this.#header.readUInt32LE(); if (size < 2 || size > 16384 || !this.#active || this.#active.responseLeft) throw blocked(); this.#body = Buffer.alloc(size); this.#bodyAt = 0; }
      const count = Math.min(this.#body.length - this.#bodyAt, chunk.length - at); this.#body.set(chunk.subarray(at, at + count), this.#bodyAt); this.#bodyAt += count; at += count;
      if (this.#bodyAt === this.#body.length) { const body = this.#body; this.#body = undefined; this.#headerAt = 0; try { this.#reply(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); } finally { body.fill(0); } }
    }
  }
  #reply(value: any): void {
    const rpc = this.#active; if (!rpc || value?.seq !== rpc.seq || value?.owner !== this.#nonce || typeof value?.ok !== 'boolean' || !value.result || typeof value.result !== 'object') throw blocked();
    const counts = value.counts; if (!Number.isSafeInteger(counts?.guards) || counts.guards < 0 || counts.guards > 128 || !Number.isSafeInteger(counts?.writers) || counts.writers < 0 || counts.writers > 3 || typeof counts.failed !== 'boolean') throw blocked();
    this.#guards = counts.guards; this.#writers = counts.writers; this.#countsSeen = true; this.#helperFailed ||= counts.failed; rpc.responseLeft = true;
    if (rpc.op === 14 && value.ok && value.result.shutdown === true && !counts.guards && !counts.writers) this.#shutdownReplySeen = true;
    if (!value.ok) rpc.reject(blocked()); else rpc.resolve(value.result); if (rpc.writeLeft) this.#active = undefined;
  }
  /** 所有payload只在私有pipe；write回调与drain均完成才清零自有frame，超时不能提前清零在途内存。 */
  #write(frame: Buffer): Promise<void> {
    const stdin = this.#child!.stdin; this.#wireFrames.add(frame);
    return new Promise<void>((resolve, reject) => {
      let returned = false, left = false, accepted = false, drained = false, failed = false;
      const finish = () => { if (returned && left && (accepted || drained || failed)) { stdin.off('drain', onDrain); frame.fill(0); this.#wireFrames.delete(frame); failed ? reject(blocked()) : resolve(); } };
      const onDrain = () => { drained = true; finish(); }; stdin.once('drain', onDrain);
      try { accepted = stdin.write(frame, error => { left = true; failed = !!error; finish(); }); returned = true; finish(); }
      catch { stdin.off('drain', onDrain); this.#fail(); reject(blocked()); /* 同步throw不能证明底层write已离开，保留原frame到原流真实close。 */ }
    });
  }
  async #rpc(op: number, meta: Record<string, unknown> = {}, payload?: Uint8Array): Promise<Record<string, unknown>> {
    this.#healthy(); if (!this.#started || !this.#child || this.#active || this.#shutdownSent || this.#shutdownReplySeen || (this.#cancelled || this.#helperFailed) && [1, 3, 4, 6, 7, 8].includes(op)) throw blocked();
    const metadata = Buffer.from(JSON.stringify({ owner: this.#nonce, ...meta }), 'utf8'); if (metadata.length > 4096 || (payload?.length ?? 0) > 65536) throw blocked();
    const seq = ++this.#sequence; if (seq > 0x7fffffff) throw blocked(); const frame = Buffer.alloc(13 + metadata.length + (payload?.length ?? 0)); frame.writeUInt32LE(frame.length - 4); frame.writeUInt32LE(seq, 4); frame[8] = op; frame.writeUInt32LE(metadata.length, 9); metadata.copy(frame, 13); if (payload) frame.set(payload, 13 + metadata.length);
    let resolve!: Rpc['resolve'], reject!: Rpc['reject']; const response = new Promise<Record<string, unknown>>((yes, no) => { resolve = yes; reject = no; }); void response.catch(() => {});
    // 独立失效Promise不会因response已resolve而失效；原write/response及frame继续留在原账本。
    let invalidate!: Rpc['invalidate']; const invalidated = new Promise<never>((_, no) => { invalidate = no; }); void invalidated.catch(() => {});
    const rpc: Rpc = { seq, op, writeLeft: false, responseLeft: false, resolve, reject, invalidate }; this.#active = rpc;
    const write = this.#write(frame).then(() => { rpc.writeLeft = true; if (rpc.responseLeft && this.#active === rpc) this.#active = undefined; }, () => { rpc.writeLeft = true; this.#fail(); throw blocked(); }); void write.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { const result = await Promise.race([Promise.all([response, write]).then(([result]) => result), invalidated, new Promise<never>((_, no) => { timer = setTimeout(() => { this.#fail(); no(blocked()); }, op === 1 ? this.#config.startupTimeoutMs : this.#config.timeoutMs); })]); this.#healthy(); if ((this.#cancelled || this.#helperFailed) && [1, 3, 4, 6, 7, 8].includes(op)) throw blocked(); return result; }
    catch { throw blocked(); } finally { if (timer) clearTimeout(timer); }
  }
  #stamp(value: any, slot: Slot): DatabaseBackupSecretStamp { this.#healthy(); if (typeof value?.identity !== 'string' || !/^[a-f0-9]{48}$/u.test(value.identity) || value.entryIdentity !== value.identity || value.unsafeLink !== false || value.kind !== (slot.id === 3 ? 'file' : 'directory') || slot.stamp && slot.stamp.identity !== value.identity) throw blocked(); const stamp = { identity: value.identity, entryIdentity: value.entryIdentity, kind: value.kind, unsafeLink: false } as DatabaseBackupSecretStamp; slot.stamp = stamp; return stamp; }
  #slot(id: number): Slot { const slot = this.#slots.get(id); if (!slot) throw blocked(); return slot; }
  #reserve(id: number): Slot { this.#healthy(); if (this.#slots.has(id)) throw blocked(); const slot: Slot = { id, closeAttempted: false, removalAttempted: false, removed: false }; this.#slots.set(id, slot); return slot; }
  async #close(slot: Slot): Promise<void> { this.#healthy(); if (!slot.closePromise) { slot.closeAttempted = true; slot.closePromise = this.#rpc(9, { id: slot.id }).then(result => { this.#healthy(); if (result.workClosed !== true || result.guardHeld !== (slot.id !== 1) || slot.id === 1 && (this.#guards !== 0 || this.#writers !== 0)) throw blocked(); }); } await slot.closePromise; this.#healthy(); }
  #file(slot: Slot): DatabaseBackupSecretFileHandle { return this.#remember({ inspect: async () => this.#stamp(await this.#rpc(2, { id: slot.id }), slot), write: async (bytes: Uint8Array, offset: number, length: number, position: number) => { this.#healthy(); if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || offset + length > bytes.length || length > 65536 || !Number.isSafeInteger(position) || position < 0) throw blocked(); const result = await this.#rpc(7, { id: 3, position }, bytes.subarray(offset, offset + length)); this.#healthy(); if (!Number.isSafeInteger(result.written) || Number(result.written) < 1 || Number(result.written) > length) throw blocked(); return Number(result.written); }, sync: async () => { const result = await this.#rpc(8, { id: 3 }); this.#healthy(); if (result.synced !== true) throw blocked(); }, close: () => this.#close(slot) }, slot.id); }
  #directory(slot: Slot): DatabaseBackupSecretDirectory {
    const facade: DatabaseBackupSecretDirectory = { inspect: async () => this.#stamp(await this.#rpc(2, { id: slot.id }), slot), createDirectory: async (name, mode) => { if (slot.id !== 1 || name !== this.#config.directoryName || mode !== 0o700) throw blocked(); const child = this.#reserve(2), result = await this.#rpc(3); if (result.id !== 2) throw blocked(); this.#stamp(result.stamp, child); return this.#directory(child); },
      openFile: async (name, options) => { if (slot.id !== 2 || name !== 'client.cnf' || options.flags !== 'wx' || options.mode !== 0o600) throw blocked(); const file = this.#reserve(3), result = await this.#rpc(4); if (result.id !== 3) throw blocked(); this.#stamp(result.stamp, file); return this.#file(file); },
      inspectFile: async name => { if (slot.id !== 2 || name !== 'client.cnf') throw blocked(); const file = this.#slot(3); return this.#stamp(await this.#rpc(2, { id: 3 }), file); },
      removeFile: async (name, identity) => { if (slot.id !== 2 || name !== 'client.cnf') throw blocked(); return this.#remove(this.#slot(3), identity); }, removeEmptyDirectory: async (name, identity) => { if (slot.id !== 1 || name !== this.#config.directoryName) throw blocked(); return this.#remove(this.#slot(2), identity); }, close: () => this.#close(slot) };
    return this.#remember(facade, slot.id);
  }
  async #remove(slot: Slot, identity: string) { this.#healthy(); if (!this.#cleanupGranted || slot.removalAttempted || !slot.stamp || identity !== slot.stamp.identity) throw blocked(); slot.removalAttempted = true; const result = await this.#rpc(slot.id === 3 ? 11 : 12, { id: slot.id, identity }); this.#healthy(); if (result.identity !== identity || result.removed !== true) throw blocked(); slot.removed = true; return { identity, removed: true as const }; }
  /** 实际ACL值直接来自固定helper GetSecurityInfo读回，不用预期值构造proof。 */
  async #acl(id: number, protect: boolean): Promise<DatabaseBackupSecretAcl> { const value: any = await this.#rpc(protect ? 6 : 5, { id }); this.#healthy(); const slot = this.#slot(id), directory = id !== 3, remaining = new Set([this.#config.currentUserSid, 'S-1-5-18']); if (value.identity !== slot.stamp?.identity || value.ownerSid !== this.#config.currentUserSid || value.inheritanceDisabled !== true || !Array.isArray(value.aces) || value.aces.length !== 2) throw blocked(); for (const ace of value.aces) if (!remaining.delete(ace.sid) || ace.allow !== true || ace.inherited !== false || ace.fullControl !== true || ace.containerInherit !== directory || ace.objectInherit !== directory) throw blocked(); if (remaining.size) throw blocked(); return value as DatabaseBackupSecretAcl; }
  /** 只接受本实例发放的facade，不能用另一个owner的id或路径替换。 */
  #facades = new WeakMap<object, number>();
  #remember<T extends object>(facade: T, id: number): T { this.#facades.set(facade, id); return facade; }
  ports(): DatabaseBackupSecretFilePorts {
    return { checkHealthy: () => this.#healthy(), checkCancelled: () => this.#work(), openParent: async (owner, root) => { this.#work(); if (owner !== this.#entry.owner || root !== this.#config.parentDirectory || this.#initStarted) throw blocked(); this.#initStarted = true; const parent = this.#reserve(1), result = await this.#rpc(1, { root, leaf: this.#config.directoryName, sid: this.#config.currentUserSid }); if (result.id !== 1) throw blocked(); this.#stamp(result.stamp, parent); this.#initialized = true; return this.#remember(this.#directory(parent), 1); },
      windows: { readDirectory: async (owner, directory) => this.#proof(owner, directory, false), protectDirectory: async (owner, directory) => this.#proof(owner, directory, true), protectFile: async (owner, file) => this.#proof(owner, file, true) },
      cleanupPermit: async owner => { this.#healthy(); if (owner !== this.#entry.owner || this.#active || this.#cleanupStarted) throw blocked(); this.#cleanupStarted = true; const permit = await this.#port.cleanupPermit(owner); this.#healthy(); if (permit.owner !== owner || permit.originalOperationLeft !== true || permit.nativeClosed !== true || permit.streamsClosed !== true || this.#active) throw blocked(); const result = await this.#rpc(10, { originalOperationLeft: permit.originalOperationLeft, nativeClosed: permit.nativeClosed, streamsClosed: permit.streamsClosed }); this.#healthy(); if (result.granted !== true) throw blocked(); this.#cleanupGranted = true; return permit; } };
  }
  async #proof(owner: Owner, facade: object, protect: boolean) { this.#healthy(); const id = this.#facades.get(facade); if (owner !== this.#entry.owner || !id || protect && id === 1) throw blocked(); const result = await this.#acl(id, protect); this.#healthy(); return result; }
  requestCancel(): void { this.#owner(); this.#cancelled = true; }
  /** 只能在helper报告所有guard/writer为0后请求正常退出；不kill未知helper或伪造CloseHandle。 */
  async shutdown(timeoutMs = 2500): Promise<{ owner: Owner; state: 'confirmed' | 'unknown' }> {
    const owner = this.#entry.owner;
    try {
      this.#healthy(); if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 3000 || this.#active || !this.#initialized || !this.#countsSeen || this.#guards || this.#writers) throw blocked();
      if (!this.#shutdownSent) { const result = await this.#rpc(14); if (result.shutdown !== true) throw blocked(); this.#shutdownSent = true; if (!this.#stdinClosed) this.#child!.stdin.end(); }
      if (!this.#localClosed() && timeoutMs) { let timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined; try { await new Promise<void>(resolve => { wake = resolve; this.#closedWaiters.add(resolve); timer = setTimeout(resolve, timeoutMs); }); } finally { if (timer) clearTimeout(timer); if (wake) this.#closedWaiters.delete(wake); } }
      this.#healthy(); return { owner, state: this.#localClosed() ? 'confirmed' : 'unknown' };
    } catch { return { owner, state: 'unknown' }; }
  }
  #localClosed(): boolean { return !!this.#child && this.#childClosed && this.#stdinClosed && this.#stdoutClosed && this.#stderrClosed && this.#shutdownReplySeen && !this.#unknown && !this.#entry.poisoned; }
  snapshot() { try { this.#owner(); } catch { /* 原helper和槽位保留。 */ } return { slot: this.#entry.slot, poisoned: this.#entry.poisoned, started: this.#started, childAllocated: !!this.#child, spawnSeen: this.#spawnSeen, exitSeen: this.#exitSeen, childClosed: this.#childClosed, stdinClosed: this.#stdinClosed, stdoutEnded: this.#stdoutEnded, stdoutClosed: this.#stdoutClosed, stderrEnded: this.#stderrEnded, stderrClosed: this.#stderrClosed, pending: !!this.#active, wireFrames: this.#wireFrames.size, unknown: this.#unknown, helperFailed: this.#helperFailed, registeredSlots: this.#slots.size, guards: this.#guards, writers: this.#writers, countsSeen: this.#countsSeen, cleanupGranted: this.#cleanupGranted, shutdownSent: this.#shutdownSent, stderrBytes: this.#stderrBytes, stderrOverflow: this.#stderrOverflow, helperLocalClosed: this.#localClosed() }; }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
