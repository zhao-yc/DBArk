import { createHash } from 'node:crypto';
import { lstat, realpath, open, rename, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

type Identity = Readonly<{ dev: string; ino: string; size: number; hash: string }>;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** 只登记原run已新建的私有目录与三个合成路径；不是清理或应用生命周期框架。 */
export class QueryFilesNativeFiles {
  readonly paths: Readonly<Record<'source' | 'missing' | 'replacement', string>>;
  private directory?: Readonly<{ dev: bigint; ino: bigint }>; private readonly handles = new Set<FileHandle>();
  readonly records: object[] = [];
  constructor(readonly root: string, private readonly check: () => void) {
    this.paths = Object.freeze({ source: join(root, 'native-source.sql'), missing: join(root, 'native-missing.sql'), replacement: join(root, 'native-replacement.sql') });
    this.records.push({ stage: 'paths-planned', paths: this.paths });
  }
  /** 原目录身份在首次文件写入之前冻结；每次实际IO前后继续核该dev/ino及规范路径。 */
  async start() { this.check(); if (this.directory) throw Error('原私有目录不得重签'); const stat = await lstat(this.root, { bigint: true }); this.check(); if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.root) !== resolve(this.root)) throw Error('原私有目录未知'); this.check(); this.directory = Object.freeze({ dev: stat.dev, ino: stat.ino }); this.records.push({ stage: 'directory-captured', dev: String(stat.dev), ino: String(stat.ino) }); }
  private async current(path: string) {
    this.check(); if (!Object.values(this.paths).includes(path) || !this.directory) throw Error('合成文件路径未登记');
    const stat = await lstat(this.root, { bigint: true }); this.check(); const canonical = await realpath(this.root); this.check();
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.directory.dev || stat.ino !== this.directory.ino || canonical !== resolve(this.root)) throw Error('原私有目录身份变化');
  }
  /** 重启与既有fixture限定删除之前，仍须消费首次冻结的目录身份。 */
  async assertDirectory() { await this.current(this.paths.source); }
  /** wx+原写句柄先登记，首次观察同句柄与路径必须同对象；不改已有未知文件。 */
  async create(path: string, bytes: Buffer) {
    await this.current(path); if (bytes.length > 4096) throw Error('合成文件写入预算超限'); this.records.push({ stage: 'write-planned', path, size: bytes.length, hash: digest(bytes) });
    const handle = await open(path, 'wx+'); this.handles.add(handle); this.check();
    let original: Identity, failure: unknown;
    try { await handle.writeFile(bytes); this.check(); await handle.sync(); this.check(); const own = await handle.stat({ bigint: true }); this.check(); const named = await lstat(path, { bigint: true }); this.check(); if (!own.isFile() || own.nlink !== 1n || own.size !== BigInt(bytes.length) || own.dev !== named.dev || own.ino !== named.ino) throw Error('原写句柄与路径不一致'); original = Object.freeze({ dev: String(own.dev), ino: String(own.ino), size: bytes.length, hash: digest(bytes) }); this.records.push({ stage: 'original-handle-captured', path, identity: original }); }
    catch (reason) { failure = reason; throw reason; }
    finally { try { await handle.close(); this.handles.delete(handle); } catch (closing) { throw failure === undefined ? closing : new AggregateError([failure, closing], '原写失败及原句柄关闭失败', { cause: failure }); } }
    const result = await this.read(path, original); assert.deepEqual(result.bytes, bytes); this.records.push({ stage: 'created', path, identity: original }); return original;
  }
  /** 有界独立读盘；expected只能来自先前捕获，目标被同字节异inode替换也拒绝。 */
  async read(path: string, expected?: Identity) {
    await this.current(path); const before = await lstat(path, { bigint: true }); this.check();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 4096n || before.size < 0n) throw Error('合成文件类型或预算未知');
    if (expected && (String(before.dev) !== expected.dev || String(before.ino) !== expected.ino || Number(before.size) !== expected.size)) throw Error('合成文件原对象身份变化');
    const canonical = await realpath(path); this.check(); if (canonical !== resolve(path)) throw Error('合成文件规范路径变化');
    const handle = await open(path, 'r'); this.handles.add(handle); this.check(); let failure: unknown;
    try {
      const own = await handle.stat({ bigint: true }); this.check(); if (own.dev !== before.dev || own.ino !== before.ino || own.size !== before.size) throw Error('原读句柄与路径不一致'); const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
      while (offset < bytes.length) { const part = await handle.read(bytes, offset, bytes.length - offset, offset); this.check(); if (!part.bytesRead) throw Error('合成文件短读'); offset += part.bytesRead; }
      const end = await handle.stat({ bigint: true }); this.check(); const named = await lstat(path, { bigint: true }); this.check();
      for (const stat of [own, end, named]) if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.mtimeNs !== before.mtimeNs || stat.ctimeNs !== before.ctimeNs) throw Error('合成文件读取期间变化');
      const identity = Object.freeze({ dev: String(before.dev), ino: String(before.ino), size: bytes.length, hash: digest(bytes) }); if (expected) assert.deepEqual(identity, expected); await this.current(path); return { bytes, identity };
    } catch (reason) { failure = reason; throw reason; }
    finally { try { await handle.close(); this.handles.delete(handle); } catch (closing) { throw failure === undefined ? closing : new AggregateError([failure, closing], '原读失败及原句柄关闭失败', { cause: failure }); } }
  }
  /** 仅明确的自有改名/替换场景；先核原源及已知目标，不在失败收尾中补还原或删除。 */
  async move(from: string, to: string, original: Identity, target?: Identity) {
    await this.read(from, original); await this.current(to);
    if (target) await this.read(to, target); else { try { await lstat(to); throw Error('合成目标已存在'); } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; } this.check(); }
    await rename(from, to); this.check(); const moved = await this.read(to, original); this.records.push({ stage: 'moved', from, to, identity: original }); return moved;
  }
  /** 只关闭本例已经取得的原文件句柄；未知场景不清理文件，不触碰应用或进程。 */
  async closeHandles() { const failed: unknown[] = []; for (const handle of this.handles) try { await handle.close(); this.handles.delete(handle); } catch (reason) { failed.push(reason); } if (failed.length) throw new AggregateError(failed, '原文件句柄关闭失败'); }
}
