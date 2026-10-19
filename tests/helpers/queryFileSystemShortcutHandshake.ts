import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, realpath, open, type FileHandle } from 'node:fs/promises';
import { win32 } from 'node:path';
import type { TestInfo } from '@playwright/test';

type FileIdentity = Readonly<{ dev: string; ino: string; size: number; hash: string }>;
export interface SystemShortcutRequest {
  deadline: number; window: number; contents: number; mainPid: number; rendererPid: number; launcherPid: number;
  manifestSha256: string;
  source: { tabId: string; ref: { id: string; revision: number }; path: string; identity: FileIdentity };
}
export interface SystemShortcutReceipt {
  nonce: string; readySha256: string; acknowledgementSha256: string; externalInputRequests: 1;
  acknowledgedOutcome: 'completed'; input: 'Control_L+s'; physicalKeyCountMeasured: false;
}
export interface SystemShortcutDriver {
  caseTitle: string;
  waitForInput(request: SystemShortcutRequest, current: () => void, info: Pick<TestInfo, 'attach'>): Promise<SystemShortcutReceipt>;
}
type Stamp = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** 严格只读数据字段，访问器、重复/多余字段和数组不能变成输入批准。 */
function fields(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('系统握手对象未知');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], 'value'))) throw Error('系统握手字段未知');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
/** 握手不派发任何键，只在Root预建的固定nonce目录写一次ready并只读一次最终ack。 */
export class SystemShortcutHandshake {
  readonly records: object[] = [];
  private started = false; private stopped = false; private previous = 0;
  private directory?: { dev: bigint; ino: bigint }; private ready?: Stamp;
  private readonly configuration: Readonly<{ nonce: string; directory: string; cwd: string }>;
  private readonly readyPath: string; private readonly ackPath: string;
  constructor(configuration: { nonce: string; directory: string; cwd: string }, private readonly current: () => void, private readonly now = () => Date.now(), private readonly pause = () => new Promise<void>(done => setTimeout(done, 25))) {
    const { nonce, directory, cwd } = configuration;
    if (!uuid.test(nonce) || !/^[A-Za-z]:\\/.test(cwd) || cwd !== win32.resolve(cwd) || directory !== win32.join(cwd, '.cache', 'system-shortcut-handshake', nonce)) throw Error('系统握手目录不属于本clone固定nonce');
    this.configuration = Object.freeze({ nonce, directory, cwd }); this.readyPath = win32.join(directory, 'ready.json'); this.ackPath = win32.join(directory, 'ack.json');
  }
  /** 原父门和单调时钟逐次消费同一个deadline；错误后同值恢复也不得再访问文件。 */
  private check(deadline: number) {
    if (this.stopped) throw Error('系统握手已停链');
    try {
      this.current(); const instant = this.now();
      if (!Number.isFinite(deadline) || !Number.isFinite(instant) || instant < this.previous || instant >= deadline) throw Error('系统握手原期限失效');
      this.previous = instant; return instant;
    } catch (reason) { this.stopped = true; throw reason; }
  }
  /** 每个普通文件系统await两侧都消费父门，不能用外围超时掩盖迟到IO。 */
  private async checked<T>(deadline: number, action: () => Promise<T>): Promise<T> {
    this.check(deadline); const result = await action(); this.check(deadline); return result;
  }
  /** 目录原dev/ino、规范路径和非链接身份在所有文件操作之前复核。 */
  private async directoryCurrent(deadline: number) {
    const stat = await this.checked(deadline, () => lstat(this.configuration.directory, { bigint: true }));
    const canonical = await this.checked(deadline, () => realpath(this.configuration.directory));
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical !== this.configuration.directory || this.directory && (stat.dev !== this.directory.dev || stat.ino !== this.directory.ino)) throw Error('系统握手原目录身份变化');
    this.directory ??= Object.freeze({ dev: stat.dev, ino: stat.ino });
  }
  /** 文件必须为单链接普通文件；句柄和名称的inode、大小及时间戳须相等。 */
  private same(stat: Stamp & { isFile(): boolean; isSymbolicLink(): boolean; nlink: bigint }, expected?: Stamp) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size < 0n || stat.size > 4096n || expected && (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const).some(key => stat[key] !== expected[key])) throw Error('系统握手原文件身份或预算变化');
  }
  /** 只验证固定ready名称，不读取Root提供的任意路径。 */
  private async readyCurrent(deadline: number) {
    await this.directoryCurrent(deadline);
    const named = await this.checked(deadline, () => lstat(this.readyPath, { bigint: true }));
    this.same(named, this.ready);
    if (await this.checked(deadline, () => realpath(this.readyPath)) !== this.readyPath) throw Error('系统ready规范路径变化');
  }
  /** 独占创建且绝不覆盖；句柄先取得再核父门，迟到时仍只关闭自己的句柄。 */
  private async writeReady(deadline: number, bytes: Buffer) {
    await this.directoryCurrent(deadline); this.check(deadline);
    const handle = await open(this.readyPath, 'wx'); let failure: unknown;
    try {
      this.check(deadline); await this.checked(deadline, () => handle.writeFile(bytes)); await this.checked(deadline, () => handle.sync());
      const own = await this.checked(deadline, () => handle.stat({ bigint: true }));
      const named = await this.checked(deadline, () => lstat(this.readyPath, { bigint: true }));
      this.same(own); this.same(named, own); if (own.size !== BigInt(bytes.length)) throw Error('系统ready未完整写入');
      this.ready = Object.freeze({ dev: own.dev, ino: own.ino, size: own.size, mtimeNs: own.mtimeNs, ctimeNs: own.ctimeNs });
      await this.readyCurrent(deadline);
    } catch (reason) { failure = reason; throw reason; }
    finally { await this.close(handle, failure); }
    this.check(deadline);
  }
  /** 只读固定ack；拒绝链接、硬链接、同字节异inode替换、短读、读取中修改及超预算。 */
  private async readAck(deadline: number, before: BigIntStats) {
    this.same(before);
    if (await this.checked(deadline, () => realpath(this.ackPath)) !== this.ackPath) throw Error('系统ack规范路径变化');
    this.check(deadline); const handle = await open(this.ackPath, 'r'); let failure: unknown;
    try {
      this.check(deadline); const own = await this.checked(deadline, () => handle.stat({ bigint: true })); this.same(own, before);
      const bytes = Buffer.alloc(Number(own.size)); let offset = 0;
      while (offset < bytes.length) {
        const read = await this.checked(deadline, () => handle.read(bytes, offset, bytes.length - offset, offset));
        if (!read.bytesRead) throw Error('系统ack短读'); offset += read.bytesRead;
      }
      this.same(await this.checked(deadline, () => handle.stat({ bigint: true })), before);
      this.same(await this.checked(deadline, () => lstat(this.ackPath, { bigint: true })), before);
      await this.readyCurrent(deadline); return bytes;
    } catch (reason) { failure = reason; throw reason; }
    finally { await this.close(handle, failure); }
  }
  /** 失败收尾仅关闭已取得的原句柄，关闭故障与原错误一起保留；不删文件、不操作应用。 */
  private async close(handle: FileHandle, failure: unknown) {
    try { await handle.close(); } catch (closing) { throw failure === undefined ? closing : new AggregateError([failure, closing], '系统握手原错误及原句柄关闭失败', { cause: failure }); }
  }
  /** 一次性握手只接受同nonce/ready摘要/原window、contents、PID及来源revision的明确completed。 */
  async wait(request: SystemShortcutRequest): Promise<SystemShortcutReceipt> {
    if (this.started || this.stopped) throw Error('系统握手不得重用'); this.started = true;
    try {
      const value = fields(request, ['deadline', 'window', 'contents', 'mainPid', 'rendererPid', 'launcherPid', 'manifestSha256', 'source']);
      const source = fields(value.source, ['tabId', 'ref', 'path', 'identity']), ref = fields(source.ref, ['id', 'revision']), identity = fields(source.identity, ['dev', 'ino', 'size', 'hash']);
      const readyAt = this.check(value.deadline);
      if (value.deadline - readyAt > 120000 || !['window', 'contents', 'mainPid', 'rendererPid', 'launcherPid'].every(key => positive(value[key])) || !/^[a-f0-9]{64}$/.test(value.manifestSha256) || !uuid.test(source.tabId) || !uuid.test(ref.id) || !positive(ref.revision) || typeof source.path !== 'string' || !win32.isAbsolute(source.path) || win32.basename(source.path) !== 'native-source.sql' || !/^\d+$/.test(identity.dev) || !/^\d+$/.test(identity.ino) || !positive(identity.size) || identity.size > 4096 || !/^[a-f0-9]{64}$/.test(identity.hash)) throw Error('系统ready原来源或期限未知');
      const ready = { schema: 1, kind: 'system-ctrl-s-ready', nonce: this.configuration.nonce, readyAt, deadline: value.deadline, input: 'Control_L+s', externalInputRequests: 1, window: value.window, contents: value.contents, mainPid: value.mainPid, rendererPid: value.rendererPid, launcherPid: value.launcherPid, manifestSha256: value.manifestSha256, source: { tabId: source.tabId, ref, path: source.path, identity } };
      const bytes = Buffer.from(JSON.stringify(ready) + '\n'); if (bytes.length > 4096) throw Error('系统ready预算超限');
      const readySha256 = digest(bytes);
      await this.directoryCurrent(value.deadline);
      // ready之前已有ack代表旧/提前结果；不读取其正文，不允许覆盖或重放。
      try { await this.checked(value.deadline, () => lstat(this.ackPath, { bigint: true })); throw Error('系统ack在ready前已存在'); } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
      this.check(value.deadline); await this.writeReady(value.deadline, bytes);
      this.records.push(Object.freeze({ stage: 'ready', nonce: this.configuration.nonce, readySha256, deadline: value.deadline, externalInputRequests: 1, window: value.window, contents: value.contents }));
      for (;;) {
        await this.readyCurrent(value.deadline);
        let stat;
        try { stat = await this.checked(value.deadline, () => lstat(this.ackPath, { bigint: true })); }
        catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
        if (stat) {
          const data = await this.readAck(value.deadline, stat);
          const decoded = data.toString('utf8'); if (!Buffer.from(decoded).equals(data)) throw Error('系统ack编码未知');
          const ack = fields(JSON.parse(decoded), ['schema', 'kind', 'nonce', 'readySha256', 'window', 'contents', 'mainPid', 'sourceRefId', 'sourceRevision', 'input', 'externalInputRequests', 'outcome', 'completedAt']);
          // 固定单行UTF8规范形式同时拒绝重复JSON键；Root按文档字段顺序写一次，不接受追加。
          if (decoded !== JSON.stringify(ack) + '\n' || ack.schema !== 1 || ack.kind !== 'system-ctrl-s-ack' || ack.nonce !== this.configuration.nonce || ack.readySha256 !== readySha256 || ack.window !== value.window || ack.contents !== value.contents || ack.mainPid !== value.mainPid || ack.sourceRefId !== ref.id || ack.sourceRevision !== ref.revision || ack.input !== 'Control_L+s' || ack.externalInputRequests !== 1 || ack.outcome !== 'completed' || !Number.isSafeInteger(ack.completedAt) || ack.completedAt < readyAt || ack.completedAt > this.check(value.deadline)) throw Error('系统ack不属于原ready或输入结果未知');
          const receipt = Object.freeze({ nonce: this.configuration.nonce, readySha256, acknowledgementSha256: digest(data), externalInputRequests: 1 as const, acknowledgedOutcome: 'completed' as const, input: 'Control_L+s' as const, physicalKeyCountMeasured: false as const });
          this.records.push(Object.freeze({ stage: 'ack', ...receipt })); this.stopped = true; return receipt;
        }
        await this.checked(value.deadline, this.pause);
      }
    } catch (reason) { this.stopped = true; this.records.push(Object.freeze({ stage: 'retained' })); throw reason; }
  }
}
