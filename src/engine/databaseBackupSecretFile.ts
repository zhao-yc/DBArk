import { posix, win32 } from 'node:path';

export interface DatabaseBackupSecretOwner { readonly taskId: string; readonly planToken: string; }
export interface DatabaseBackupSecretStamp {
  /** 原句柄身份与当前具名入口身份必须相同；Root端口必须同时检查，不得只做fstat。 */
  identity: string; entryIdentity: string; kind: 'file' | 'directory' | 'other'; unsafeLink: boolean;
  uid?: number; mode?: number;
}
export interface DatabaseBackupSecretRemoval { identity: string; removed: true; }
export interface DatabaseBackupSecretFileHandle {
  inspect(): Promise<DatabaseBackupSecretStamp>;
  write(bytes: Uint8Array, offset: number, length: number, position: number): Promise<number>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface DatabaseBackupSecretDirectory {
  inspect(): Promise<DatabaseBackupSecretStamp>;
  /** 必须是独占新目录，不能递归mkdir或将EEXIST当作成功；失败无法排除分配时保持未知。 */
  createDirectory(name: string, mode: 0o700): Promise<DatabaseBackupSecretDirectory>;
  openFile(name: 'client.cnf', options: { flags: 'wx'; mode: 0o600 }): Promise<DatabaseBackupSecretFileHandle>;
  inspectFile(name: 'client.cnf'): Promise<DatabaseBackupSecretStamp>;
  /** Root必须对原具名入口和身份进行受控删除并给出实际回执，不能只接受本模块的期望值。 */
  removeFile(name: 'client.cnf', expectedIdentity: string): Promise<DatabaseBackupSecretRemoval>;
  removeEmptyDirectory(name: string, expectedIdentity: string): Promise<DatabaseBackupSecretRemoval>;
  close(): Promise<void>;
}
export interface DatabaseBackupSecretAcl {
  identity: string; ownerSid: string; inheritanceDisabled: true;
  aces: readonly { sid: string; allow: true; inherited: false; fullControl: true; containerInherit: boolean; objectInherit: boolean }[];
}
export interface DatabaseBackupSecretWindowsProtection {
  /** 只检查既有父目录，不能擅自重写它的ACL。 */
  readDirectory(owner: DatabaseBackupSecretOwner, directory: DatabaseBackupSecretDirectory): Promise<DatabaseBackupSecretAcl>;
  /** 必须返回操作系统读回的Owner、DACL及继承证明，不能用chmod或常量布尔替代。 */
  protectDirectory(owner: DatabaseBackupSecretOwner, directory: DatabaseBackupSecretDirectory): Promise<DatabaseBackupSecretAcl>;
  protectFile(owner: DatabaseBackupSecretOwner, file: DatabaseBackupSecretFileHandle): Promise<DatabaseBackupSecretAcl>;
}
export interface DatabaseBackupSecretCleanupPermit {
  owner: DatabaseBackupSecretOwner; originalOperationLeft: true; nativeClosed: true; streamsClosed: true;
}
export interface DatabaseBackupSecretFilePorts {
  openParent(owner: DatabaseBackupSecretOwner, path: string): Promise<DatabaseBackupSecretDirectory>;
  /** Root的不可逆终态许可；签发后同一scope不再启动工具或使用此路径，cancel ACK不能签发它。 */
  cleanupPermit(owner: DatabaseBackupSecretOwner): Promise<DatabaseBackupSecretCleanupPermit>;
  windows?: DatabaseBackupSecretWindowsProtection;
  /** 可选的永久健康门；与取消分离，供路径、快照和清理返回检查原端口是否已未知。 */
  checkHealthy?(): void;
  checkCancelled(): void;
}
export interface DatabaseBackupSecretFileConfig {
  platform: 'posix' | 'win32'; parentDirectory: string; directoryName: string;
  uid?: number; currentUserSid?: string;
}
interface Ownership { owner: DatabaseBackupSecretOwner; taskId: string; planToken: string; slot: number; poisoned: boolean; }
const blocked = () => new Error('临时客户端选项文件状态、权限或归属未经证实，已保留并阻断');

/** owner永久占位防止任务号ABA；Root必须复用同一本账，不能在恢复时新建账本绕过未知资源。 */
export class DatabaseBackupSecretFileOwners {
  #entries = new Map<string, Ownership>();
  constructor(private readonly capacity = 128) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 512) throw blocked(); }
  register(owner: DatabaseBackupSecretOwner): Ownership {
    if (!owner || typeof owner.taskId !== 'string' || typeof owner.planToken !== 'string' || !owner.taskId || !owner.planToken || owner.taskId.length > 200 || owner.planToken.length > 200 || /[\x00-\x1f]/u.test(owner.taskId + owner.planToken)) throw blocked();
    const previous = this.#entries.get(owner.taskId);
    if (previous) { previous.poisoned = true; throw blocked(); }
    if (this.#entries.size >= this.capacity) throw blocked();
    const entry = { owner, taskId: owner.taskId, planToken: owner.planToken, slot: this.#entries.size + 1, poisoned: false };
    this.#entries.set(entry.taskId, entry); return entry;
  }
}
interface Resource<T> { started: boolean; settled: boolean; resource?: T; identity?: string; closed: boolean; closeStarted: boolean; closeUnknown: boolean; closePromise?: Promise<void>; }
const resource = <T>(): Resource<T> => ({ started: false, settled: false, closed: false, closeStarted: false, closeUnknown: false });

/** 无原生IO默认实现，Root注入真实端口；构造同步登记三类槽位，迟到分配永远保留在原实例。 */
export class DatabaseBackupSecretFile {
  #entry: Ownership; #config: DatabaseBackupSecretFileConfig; #ports: DatabaseBackupSecretFilePorts;
  #parent = resource<DatabaseBackupSecretDirectory>(); #directory = resource<DatabaseBackupSecretDirectory>(); #file = resource<DatabaseBackupSecretFileHandle>();
  #filePath: string; #active = false; #started = false; #failed = false; #ready = false; #consumed = false; #portUnknown = false;
  #bytesWritten = 0; #pending = 0; #allocationInvalid = false; #cleanupStarted = false; #cleanupConfirmed = false; #cleanupPromise?: Promise<{ owner: DatabaseBackupSecretOwner; state: 'confirmed' | 'unknown' }>;
  #fileRemovalStarted = false; #fileRemoved = false; #directoryRemovalStarted = false; #directoryRemoved = false;

  constructor(owner: DatabaseBackupSecretOwner, config: DatabaseBackupSecretFileConfig, ports: DatabaseBackupSecretFilePorts, owners: DatabaseBackupSecretFileOwners) {
    this.#entry = owners.register(owner); this.#ports = ports;
    try {
      // 只保存配置白名单，不能通过额外属性把敏感文本长期挂在实例上。
      this.#config = { platform: config.platform, parentDirectory: config.parentDirectory, directoryName: config.directoryName, uid: config.uid, currentUserSid: config.currentUserSid };
      if (!['posix', 'win32'].includes(config.platform) || !/^[A-Za-z0-9_-]{1,100}$/u.test(config.directoryName)) throw blocked();
      const paths = config.platform === 'win32' ? win32 : posix;
      if (typeof config.parentDirectory !== 'string' || !paths.isAbsolute(config.parentDirectory) || config.parentDirectory !== paths.normalize(config.parentDirectory) || /[\x00-\x1f]/u.test(config.parentDirectory) || Buffer.from(config.parentDirectory, 'utf8').toString('utf8') !== config.parentDirectory) throw blocked();
      if (config.platform === 'win32' && (!/^[A-Za-z]:\\/u.test(config.parentDirectory) || /[^\x20-\x7e]/u.test(config.parentDirectory))) throw blocked();
      if (config.platform === 'posix' ? !Number.isSafeInteger(config.uid) || config.uid! < 0 : typeof config.currentUserSid !== 'string' || config.currentUserSid.length > 200 || !/^S-1-(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*)){1,15}$/u.test(config.currentUserSid) || config.currentUserSid === 'S-1-5-18') throw blocked();
      this.#filePath = paths.join(config.parentDirectory, config.directoryName, 'client.cnf');
      if (config.platform === 'win32' && this.#filePath.length > 240) throw blocked();
    } catch { this.#entry.poisoned = true; throw blocked(); }
  }
  /** 不可复用原owner或编号；观察到字段换绑后即永久停链，即使改回原字符串也不能恢复。 */
  #owner(): void {
    const entry = this.#entry;
    try { if (entry.poisoned || entry.owner.taskId !== entry.taskId || entry.owner.planToken !== entry.planToken) throw blocked(); }
    catch { entry.poisoned = true; this.#failed = true; this.#ready = false; throw blocked(); }
    // 端口失效不伪装成owner换绑；只永久停用本文件，仍保留原槽位和待处理事实。
    try { if (this.#portUnknown) throw blocked(); this.#ports.checkHealthy?.(); }
    catch { this.#portUnknown = true; this.#failed = true; this.#ready = false; throw blocked(); }
  }
  #check(): void { this.#owner(); this.#ports.checkCancelled(); if (this.#failed || this.#cleanupStarted) throw blocked(); }
  /** 待处理标志先于调用端口，返回的原句柄先捕获再检查取消。reject不被解释为“没有资源”。 */
  async #allocate<T>(slot: Resource<T>, action: () => Promise<T>): Promise<T> {
    if (slot.started) throw blocked(); slot.started = true; this.#pending++;
    try { const value = await action(); slot.resource = value; return value; }
    finally { slot.settled = true; this.#pending--; }
  }
  /** pending仅记事实；finally不关闭/删除资源。 */
  async #wait<T>(action: () => Promise<T>): Promise<T> { this.#pending++; try { return await action(); } finally { this.#pending--; } }
  #stamp(value: DatabaseBackupSecretStamp, slot: Resource<unknown>, kind: 'file' | 'directory'): void {
    if (!value || typeof value.identity !== 'string' || !value.identity || value.identity.length > 2048 || value.identity !== value.entryIdentity || value.kind !== kind || value.unsafeLink !== false || slot.identity !== undefined && slot.identity !== value.identity) throw blocked();
    if (this.#config.platform === 'posix' && (value.uid !== this.#config.uid || value.mode !== (kind === 'directory' ? 0o700 : 0o600))) throw blocked();
    slot.identity ??= value.identity;
  }
  #acl(value: DatabaseBackupSecretAcl, identity: string, directory: boolean): void {
    const sids = new Set([this.#config.currentUserSid!, 'S-1-5-18']);
    if (!value || value.identity !== identity || value.ownerSid !== this.#config.currentUserSid || value.inheritanceDisabled !== true || !Array.isArray(value.aces) || value.aces.length !== 2) throw blocked();
    for (const ace of value.aces) {
      if (!sids.delete(ace.sid) || ace.allow !== true || ace.inherited !== false || ace.fullControl !== true || ace.containerInherit !== directory || ace.objectInherit !== directory) throw blocked();
    }
    if (sids.size) throw blocked();
  }
  /** 同一原句柄最多关闭一次；拒绝后保持未知，不因再次cleanup而重试。 */
  #close<T extends { close(): Promise<void> }>(slot: Resource<T>): Promise<void> {
    if (!slot.resource) return Promise.reject(blocked());
    if (!slot.closePromise) {
      slot.closeStarted = true;
      slot.closePromise = this.#wait(() => slot.resource!.close()).then(() => { slot.closed = true; }, () => { slot.closeUnknown = true; throw blocked(); });
    }
    return slot.closePromise;
  }
  /** 先完成目录/文件权限证明才取一次文本；内容最多64KiB，写入短片完整消费，退出时仅清零RAM。 */
  async open(source: { takeText(): string }): Promise<void> {
    this.#owner();
    if (this.#started || this.#active || this.#cleanupStarted) { this.#failed = true; this.#ready = false; throw blocked(); }
    this.#started = true; this.#active = true; let bytes: Buffer | undefined;
    try {
      this.#check();
      if (this.#config.platform === 'win32' && !this.#ports.windows) throw blocked();
      const parent = await this.#allocate(this.#parent, () => this.#ports.openParent(this.#entry.owner, this.#config.parentDirectory)); this.#check();
      this.#stamp(await this.#wait(() => parent.inspect()), this.#parent, 'directory'); this.#check();
      if (this.#config.platform === 'win32') { this.#acl(await this.#wait(() => this.#ports.windows!.readDirectory(this.#entry.owner, parent)), this.#parent.identity!, true); this.#check(); }
      const directory = await this.#allocate(this.#directory, () => parent.createDirectory(this.#config.directoryName, 0o700)); this.#check();
      if (directory === parent) { this.#allocationInvalid = true; throw blocked(); }
      this.#stamp(await this.#wait(() => directory.inspect()), this.#directory, 'directory'); this.#check();
      if (this.#directory.identity === this.#parent.identity) { this.#allocationInvalid = true; throw blocked(); }
      if (this.#config.platform === 'win32') { this.#acl(await this.#wait(() => this.#ports.windows!.protectDirectory(this.#entry.owner, directory)), this.#directory.identity!, true); this.#check(); }
      const file = await this.#allocate(this.#file, () => directory.openFile('client.cnf', { flags: 'wx', mode: 0o600 })); this.#check();
      if (Object.is(file, directory) || Object.is(file, parent)) { this.#allocationInvalid = true; throw blocked(); }
      this.#stamp(await this.#wait(() => file.inspect()), this.#file, 'file'); this.#check();
      if ([this.#parent.identity, this.#directory.identity].includes(this.#file.identity)) { this.#allocationInvalid = true; throw blocked(); }
      if (this.#config.platform === 'win32') { this.#acl(await this.#wait(() => this.#ports.windows!.protectFile(this.#entry.owner, file)), this.#file.identity!, false); this.#check(); }
      this.#stamp(await this.#wait(() => parent.inspect()), this.#parent, 'directory'); this.#check();
      this.#stamp(await this.#wait(() => directory.inspect()), this.#directory, 'directory'); this.#check();
      this.#stamp(await this.#wait(() => file.inspect()), this.#file, 'file'); this.#check();
      this.#consumed = true;
      let text: string | undefined = source.takeText();
      if (typeof text !== 'string' || !text.startsWith('[client]\n') || text.includes('\0') || Buffer.byteLength(text, 'utf8') > 65536) throw blocked();
      bytes = Buffer.from(text, 'utf8'); if (bytes.toString('utf8') !== text) throw blocked(); text = undefined;
      while (this.#bytesWritten < bytes.length) {
        this.#check(); const offset = this.#bytesWritten, remaining = bytes.length - offset;
        const written = await this.#wait(() => file.write(bytes!, offset, remaining, offset));
        if (!Number.isSafeInteger(written) || written < 1 || written > remaining) throw blocked();
        this.#bytesWritten += written; this.#check();
      }
      await this.#wait(() => file.sync()); this.#check(); await this.#close(this.#file); this.#check(); this.#ready = true;
    } catch { this.#failed = true; this.#ready = false; throw blocked(); }
    finally { bytes?.fill(0); this.#active = false; }
  }
  /** 路径只给Root私有工具接线，不能进入任务事件；返回只代表open时已证权限，不替代启动前连续性检查。 */
  privateClientPath(): string {
    try { this.#check(); if (!this.#ready) throw blocked(); return this.#filePath; }
    catch { this.#failed = true; this.#ready = false; throw blocked(); }
  }
  /** 清理不排队等待在途原操作；Root应在操作真正离开后调用。首次清理未知后永久复用原结果。 */
  cleanup(): Promise<{ owner: DatabaseBackupSecretOwner; state: 'confirmed' | 'unknown' }> {
    try { this.#owner(); } catch { return Promise.resolve({ owner: this.#entry.owner, state: 'unknown' }); }
    if (this.#active || this.#pending) return Promise.resolve({ owner: this.#entry.owner, state: 'unknown' });
    if (this.#cleanupPromise) return this.#cleanupResult();
    this.#cleanupStarted = true; this.#ready = false;
    this.#cleanupPromise = Promise.resolve().then(() => this.#cleanup()); return this.#cleanupResult();
  }
  /** 原清理Promise只创建一次；健康端口另在异步交付缓存结果时检查，不能重新执行清理。 */
  #cleanupResult(): Promise<{ owner: DatabaseBackupSecretOwner; state: 'confirmed' | 'unknown' }> {
    const original = this.#cleanupPromise!;
    if (!this.#ports.checkHealthy) return original;
    return original.then(result => { try { this.#owner(); return result; } catch { return { owner: this.#entry.owner, state: 'unknown' as const }; } });
  }
  /** 许可必须来自Root真实终态；删除仅限原wx文件和独占空目录，绝不递归，也不finally补删。 */
  async #cleanup(): Promise<{ owner: DatabaseBackupSecretOwner; state: 'confirmed' | 'unknown' }> {
    const owner = this.#entry.owner;
    try {
      const permit = await this.#wait(() => this.#ports.cleanupPermit(owner)); this.#owner();
      if (permit.owner !== owner || permit.originalOperationLeft !== true || permit.nativeClosed !== true || permit.streamsClosed !== true || this.#active) throw blocked();
      if (this.#allocationInvalid) throw blocked();
      for (const slot of [this.#parent, this.#directory, this.#file]) if (slot.started && (!slot.settled || !slot.resource || slot.closeUnknown)) throw blocked();
      if (this.#parent.resource) {
        const parent = this.#parent.resource; this.#stamp(await this.#wait(() => parent.inspect()), this.#parent, 'directory'); this.#owner();
        if (this.#directory.resource) {
          const directory = this.#directory.resource; this.#stamp(await this.#wait(() => directory.inspect()), this.#directory, 'directory'); this.#owner();
          if (this.#file.resource) {
            this.#stamp(await this.#wait(() => directory.inspectFile('client.cnf')), this.#file, 'file'); this.#owner();
            await this.#close(this.#file); this.#owner();
            this.#fileRemovalStarted = true;
            const removed = await this.#wait(() => directory.removeFile('client.cnf', this.#file.identity!)); this.#owner();
            if (removed.identity !== this.#file.identity || removed.removed !== true) throw blocked(); this.#fileRemoved = true;
          }
          await this.#close(this.#directory); this.#owner(); this.#directoryRemovalStarted = true;
          const removed = await this.#wait(() => parent.removeEmptyDirectory(this.#config.directoryName, this.#directory.identity!)); this.#owner();
          if (removed.identity !== this.#directory.identity || removed.removed !== true) throw blocked(); this.#directoryRemoved = true;
        }
        await this.#close(this.#parent); this.#owner();
      }
      this.#cleanupConfirmed = true; return { owner, state: 'confirmed' };
    } catch { this.#failed = true; return { owner, state: 'unknown' }; }
  }
  /** 严格白名单：仅布尔和本地编号/计数，不含owner令牌、内容、路径、身份串或原始错误。 */
  snapshot() {
    try { this.#owner(); } catch { /* 永久停链事实仍可观察。 */ }
    return { slot: this.#entry.slot, poisoned: this.#entry.poisoned, active: this.#active, started: this.#started, pending: this.#pending, consumed: this.#consumed, bytesWritten: this.#bytesWritten, ready: this.#ready && !this.#failed && !this.#cleanupStarted,
      parentStarted: this.#parent.started, directoryStarted: this.#directory.started, fileStarted: this.#file.started,
      allocationUnknown: this.#allocationInvalid || [this.#parent, this.#directory, this.#file].some(slot => slot.started && slot.settled && !slot.resource),
      parentAllocated: !!this.#parent.resource, directoryAllocated: !!this.#directory.resource, fileAllocated: !!this.#file.resource, parentClosed: this.#parent.closed, directoryClosed: this.#directory.closed, fileClosed: this.#file.closed,
      closeUnknown: this.#parent.closeUnknown || this.#directory.closeUnknown || this.#file.closeUnknown, portUnknown: this.#portUnknown, failed: this.#failed, cleanupStarted: this.#cleanupStarted, fileRemovalStarted: this.#fileRemovalStarted, fileRemoved: this.#fileRemoved, directoryRemovalStarted: this.#directoryRemovalStarted, directoryRemoved: this.#directoryRemoved, closed: this.#cleanupConfirmed && !this.#portUnknown && !this.#entry.poisoned };
  }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
