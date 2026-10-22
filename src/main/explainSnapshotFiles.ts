import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { decodeExplainSnapshot, encodeExplainSnapshot, explainSnapshotLimits, type ExplainSnapshotDocument } from '../shared/explainSnapshot';
import { explainSnapshotZh as text } from '../shared/explainSnapshot.zh-CN';

export interface ExplainSnapshotOwner { assertCurrent(): void }
export interface ExplainSnapshotFilePorts {
  choose(mode: 'open' | 'save'): Promise<string | undefined>;
  reserve(path: string): Promise<() => void>;
  io?: Pick<typeof fs, 'open' | 'lstat' | 'rename' | 'unlink'>;
}

/** 文件身份和内容状态均需一致，避免已知的选择后替换或并发覆盖。 */
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** 仅接受原生选择器返回的绝对文件路径；界面无法通过 IPC 指定路径。 */
function checkedPath(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error(text.invalid);
  return value;
}

/** 独立离线文件能力；单个原始操作的锁覆盖对话框、磁盘提交与全部清理。 */
export class ExplainSnapshotFiles {
  private active = false;
  private readonly io: Pick<typeof fs, 'open' | 'lstat' | 'rename' | 'unlink'>;

  constructor(private readonly ports: ExplainSnapshotFilePorts) { this.io = ports.io ?? fs; }

  /** 同步占用，失效或取消只影响结果，绝不会提前释放仍在运行的操作。 */
  private async operation<T>(owner: ExplainSnapshotOwner, action: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error(text.busy);
    owner.assertCurrent(); this.active = true;
    try { return await action(); } finally { this.active = false; }
  }

  /** 每次等待前后检查原窗口所有权；清理独立执行，不受失效检查阻断。 */
  private async guarded<T>(owner: ExplainSnapshotOwner, action: () => Promise<T>): Promise<T> {
    owner.assertCurrent();
    const result = await action();
    owner.assertCurrent();
    return result;
  }

  /** 打开时拒绝目录、符号链接和特殊文件；不存在仅允许用于保存的新目标。 */
  private async inspect(path: string, optional: boolean): Promise<Stats | undefined> {
    try {
      const stat = await this.io.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('请选择普通计划快照文件');
      return stat;
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** 单句柄有界读取，严格 UTF-8 解码后才解析，来源变化时不发布任何快照。 */
  open(owner: ExplainSnapshotOwner): Promise<{ name: string; snapshot: ExplainSnapshotDocument } | null> {
    return this.operation(owner, async () => {
      let handle: FileHandle | undefined;
      let result: { name: string; snapshot: ExplainSnapshotDocument } | null = null;
      const errors: unknown[] = [];
      try {
        const selected = await this.guarded(owner, () => this.ports.choose('open'));
        if (selected === undefined) return null;
        const path = checkedPath(selected);
        const initial = await this.guarded(owner, () => this.inspect(path, false));
        // 先保存句柄，再检查所有权，失效也能关闭刚刚返回的原始句柄。
        owner.assertCurrent(); handle = await this.io.open(path, 'r'); owner.assertCurrent();
        const before = await this.guarded(owner, () => handle!.stat());
        if (!before.isFile() || !initial || !sameFile(initial, before)) throw new Error('计划快照文件在读取前已变化');
        if (before.size > explainSnapshotLimits.bytes) throw new Error(text.tooLarge);
        const data = Buffer.alloc(explainSnapshotLimits.bytes + 1);
        let count = 0;
        while (count < data.length) {
          const read = await this.guarded(owner, () => handle!.read(data, count, Math.min(65536, data.length - count), count));
          if (!read.bytesRead) break;
          count += read.bytesRead;
          if (count > explainSnapshotLimits.bytes) throw new Error(text.tooLarge);
        }
        const after = await this.guarded(owner, () => handle!.stat());
        const current = await this.guarded(owner, () => this.inspect(path, false));
        if (!sameFile(before, after) || !current || !sameFile(before, current) || count !== after.size) throw new Error('计划快照文件在读取期间已变化');
        let decoded: string;
        try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, count)); }
        catch { throw new Error('计划快照必须使用有效的 UTF-8 编码'); }
        result = { name: basename(path), snapshot: decodeExplainSnapshot(decoded) };
        owner.assertCurrent();
      } catch (error) { errors.push(error); }
      if (handle) {
        try { await handle.close(); } catch (error) { errors.push(error); }
      }
      if (!errors.length) { try { owner.assertCurrent(); } catch (error) { errors.push(error); } }
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, '打开计划快照失败，文件资源清理情况请核对');
      return result;
    });
  }

  /** 同目录独占临时文件同步后原子替换；先校验内容，再打开保存对话框。 */
  save(snapshot: ExplainSnapshotDocument, owner: ExplainSnapshotOwner): Promise<{ name: string } | null> {
    return this.operation(owner, async () => {
      const encoded = Buffer.from(encodeExplainSnapshot(snapshot), 'utf8');
      let handle: FileHandle | undefined;
      let temporary: string | undefined;
      let release: (() => void) | undefined;
      let renameSubmitted = false;
      let result: { name: string } | null = null;
      const errors: unknown[] = [];
      try {
        const selected = await this.guarded(owner, () => this.ports.choose('save'));
        if (selected === undefined) return null;
        const path = checkedPath(selected);
        owner.assertCurrent(); release = await this.ports.reserve(path); owner.assertCurrent();
        const initial = await this.guarded(owner, () => this.inspect(path, true));
        const candidate = join(dirname(path), `.dbark-plan-${randomUUID()}.tmp`);
        owner.assertCurrent(); handle = await this.io.open(candidate, 'wx', 0o600); temporary = candidate; owner.assertCurrent();
        let offset = 0;
        while (offset < encoded.length) {
          const write = await this.guarded(owner, () => handle!.write(encoded, offset, Math.min(65536, encoded.length - offset), offset));
          if (write.bytesWritten <= 0) throw new Error('计划快照写入未取得进展');
          offset += write.bytesWritten;
        }
        await this.guarded(owner, () => handle!.sync());
        owner.assertCurrent(); await handle.close(); handle = undefined; owner.assertCurrent();
        const current = await this.guarded(owner, () => this.inspect(path, true));
        if (initial ? !current || !sameFile(initial, current) : current !== undefined) throw new Error('目标计划快照已被其他操作修改，请重新选择');
        owner.assertCurrent(); renameSubmitted = true;
        await this.io.rename(temporary, path); temporary = undefined;
        owner.assertCurrent(); result = { name: basename(path) };
      } catch (error) { errors.push(error); }
      // 即使原窗口已失效，也必须等原始句柄关闭、临时文件清理和占用释放完成。
      if (handle) { try { await handle.close(); } catch (error) { errors.push(error); } }
      if (temporary) { try { await this.io.unlink(temporary); } catch (error) { errors.push(error); } }
      if (release) { try { release(); } catch (error) { errors.push(error); } }
      if (!errors.length) { try { owner.assertCurrent(); } catch (error) { errors.push(error); } }
      if (errors.length) {
        if (renameSubmitted) throw new AggregateError(errors, text.unknownWrite);
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, '保存计划快照失败，文件资源清理情况请核对');
      }
      return result;
    });
  }
}
