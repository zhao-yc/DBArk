import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { decodeTableDraft, encodeTableDraft, tableDraftLimits, type TableDraftDocument } from '../shared/tableDraft';
/** 草稿文件错误保持集中；磁盘操作结果未知时不得宣称保存成功。 */
export const tableDraftFileMessages = {
  invalid: '草稿文件路径无效，请重新选择绝对路径的普通文件',
  busy: '另一项草稿文件操作尚未完成，请稍后重试',
  tooLarge: '草稿文件超过 8 MiB 上限',
  unknownWrite: '草稿文件替换已投递，结果未能确认，请核对目标文件；不会自动重试',
  ordinary: '请选择普通表格草稿文件',
  changedBefore: '表格草稿文件在读取前已变化',
  changedDuring: '表格草稿文件在读取期间已变化',
  encoding: '表格草稿必须使用有效的 UTF-8 编码',
  openFailed: '打开表格草稿失败，文件资源清理情况请核对',
  noProgress: '表格草稿写入未取得进展',
  concurrent: '目标表格草稿已被其他操作修改，请重新选择',
  saveFailed: '保存表格草稿失败，文件资源清理情况请核对',
} as const;
const text = tableDraftFileMessages;

export interface TableDraftOwner { assertCurrent(): void }
export interface TableDraftFilePorts {
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
export class TableDraftFiles {
  private active = false;
  private readonly io: Pick<typeof fs, 'open' | 'lstat' | 'rename' | 'unlink'>;

  constructor(private readonly ports: TableDraftFilePorts) { this.io = ports.io ?? fs; }

  /** 同步占用，失效或取消只影响结果，绝不会提前释放仍在运行的操作。 */
  private async operation<T>(owner: TableDraftOwner, action: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error(text.busy);
    owner.assertCurrent(); this.active = true;
    try { return await action(); } finally { this.active = false; }
  }

  /** 每次等待前后检查原窗口所有权；清理独立执行，不受失效检查阻断。 */
  private async guarded<T>(owner: TableDraftOwner, action: () => Promise<T>): Promise<T> {
    owner.assertCurrent();
    const result = await action();
    owner.assertCurrent();
    return result;
  }

  /** 打开时拒绝目录、符号链接和特殊文件；不存在仅允许用于保存的新目标。 */
  private async inspect(path: string, optional: boolean): Promise<Stats | undefined> {
    try {
      const stat = await this.io.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(text.ordinary);
      return stat;
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** 单句柄有界读取，严格 UTF-8 解码后才解析，来源变化时不发布任何草稿。 */
  open(owner: TableDraftOwner): Promise<{ name: string; document: TableDraftDocument } | null> {
    return this.operation(owner, async () => {
      let handle: FileHandle | undefined;
      let result: { name: string; document: TableDraftDocument } | null = null;
      const errors: unknown[] = [];
      try {
        const selected = await this.guarded(owner, () => this.ports.choose('open'));
        if (selected === undefined) return null;
        const path = checkedPath(selected);
        const initial = await this.guarded(owner, () => this.inspect(path, false));
        // 先保存句柄，再检查所有权，失效也能关闭刚刚返回的原始句柄。
        owner.assertCurrent(); handle = await this.io.open(path, 'r'); owner.assertCurrent();
        const before = await this.guarded(owner, () => handle!.stat());
        if (!before.isFile() || !initial || !sameFile(initial, before)) throw new Error(text.changedBefore);
        if (before.size > tableDraftLimits.bytes) throw new Error(text.tooLarge);
        const data = Buffer.alloc(tableDraftLimits.bytes + 1);
        let count = 0;
        while (count < data.length) {
          const read = await this.guarded(owner, () => handle!.read(data, count, Math.min(65536, data.length - count), count));
          if (!read.bytesRead) break;
          count += read.bytesRead;
          if (count > tableDraftLimits.bytes) throw new Error(text.tooLarge);
        }
        const after = await this.guarded(owner, () => handle!.stat());
        const current = await this.guarded(owner, () => this.inspect(path, false));
        if (!sameFile(before, after) || !current || !sameFile(before, current) || count !== after.size) throw new Error(text.changedDuring);
        let decoded: string;
        try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, count)); }
        catch { throw new Error(text.encoding); }
        result = { name: basename(path), document: decodeTableDraft(decoded) };
        owner.assertCurrent();
      } catch (error) { errors.push(error); }
      if (handle) {
        try { await handle.close(); } catch (error) { errors.push(error); }
      }
      if (!errors.length) { try { owner.assertCurrent(); } catch (error) { errors.push(error); } }
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, text.openFailed);
      return result;
    });
  }

  /** 同目录独占临时文件同步后原子替换；先校验内容，再打开保存对话框。 */
  save(document: TableDraftDocument, owner: TableDraftOwner): Promise<{ name: string } | null> {
    return this.operation(owner, async () => {
      const encoded = Buffer.from(encodeTableDraft(document), 'utf8');
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
        const candidate = join(dirname(path), `.dbark-draft-${randomUUID()}.tmp`);
        owner.assertCurrent(); handle = await this.io.open(candidate, 'wx', 0o600); temporary = candidate; owner.assertCurrent();
        let offset = 0;
        while (offset < encoded.length) {
          const write = await this.guarded(owner, () => handle!.write(encoded, offset, Math.min(65536, encoded.length - offset), offset));
          if (write.bytesWritten <= 0) throw new Error(text.noProgress);
          offset += write.bytesWritten;
        }
        await this.guarded(owner, () => handle!.sync());
        owner.assertCurrent(); await handle.close(); handle = undefined; owner.assertCurrent();
        const current = await this.guarded(owner, () => this.inspect(path, true));
        if (initial ? !current || !sameFile(initial, current) : current !== undefined) throw new Error(text.concurrent);
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
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, text.saveFailed);
      }
      return result;
    });
  }
}
