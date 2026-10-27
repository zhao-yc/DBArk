import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { decodeQueryResultSnapshot, encodeQueryResultSnapshot, parseQueryResultSnapshot, queryResultSnapshotLimits, type QueryResultSnapshotDocument } from '../shared/queryResultSnapshot';

/** 文件错误独立集中；提交边界未知时不把磁盘状态误报为未写入。 */
export const queryResultSnapshotFileMessages = {
  choose: '打开结果快照', save: '保存结果快照', defaultName: '结果快照.dbark-result.json', fileType: 'DBArk 结果快照（包含数据与SQL）',
  stale: '结果快照原窗口或文档已变化，本次文件操作失效',
  invalid: '结果快照文件路径无效，请重新选择绝对路径的普通文件',
  busy: '另一项结果快照文件操作尚未完成，请稍后重试',
  tooLarge: '结果快照文件超过 16 MiB 上限',
  ordinary: '请选择普通查询结果快照文件',
  changedBefore: '结果快照文件在读取前已变化',
  changedDuring: '结果快照文件在读取期间已变化',
  encoding: '结果快照必须使用有效的 UTF-8 编码',
  openFailed: '打开结果快照失败，文件资源清理情况请核对',
  noProgress: '结果快照写入未取得进展或返回了无效字节数',
  invalidRead: '结果快照读取返回了无效字节数',
  concurrent: '目标结果快照已被其他操作修改，请重新选择',
  saveFailed: '保存结果快照失败，文件资源清理情况请核对',
  unknownWrite: '结果快照替换已投递，结果未能确认，请核对目标文件；不会自动重试',
} as const;
const text = queryResultSnapshotFileMessages;

export interface QueryResultSnapshotOwner { assertCurrent(): void }
export interface QueryResultSnapshotFilePorts {
  choose(mode: 'open' | 'save'): Promise<string | undefined>;
  reserve(path: string): Promise<() => void>;
  io?: Pick<typeof fs, 'open' | 'lstat' | 'rename' | 'unlink'>;
}

/** 同一原文件的身份、长度和修改时间必须一致，不静默覆盖已知变化的目标。 */
function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** 路径仅接受原生选择器的绝对路径；渲染进程无权指定任意磁盘路径。 */
function checkedPath(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw Error(text.invalid);
  return value;
}

/** 原操作的独占锁覆盖原生选择、在途IO及全部清理，不因来源失效提前释放。 */
export class QueryResultSnapshotFiles {
  private active = false;
  private readonly io: NonNullable<QueryResultSnapshotFilePorts['io']>;
  constructor(private readonly ports: QueryResultSnapshotFilePorts) { this.io = ports.io ?? fs; }

  /** 同步占门后才允许首个await；竞争请求既不弹对话框，也不访问磁盘。 */
  private async operation<T>(owner: QueryResultSnapshotOwner, action: () => Promise<T>): Promise<T> {
    if (this.active) throw Error(text.busy);
    owner.assertCurrent(); this.active = true;
    try { return await action(); } finally { this.active = false; }
  }

  /** 每次原等待前后复核窗口/文档身份；原资源清理不经过此门。 */
  private async guarded<T>(owner: QueryResultSnapshotOwner, action: () => Promise<T>): Promise<T> {
    owner.assertCurrent(); const result = await action(); owner.assertCurrent(); return result;
  }

  /** 只允许普通文件；不存在只能作为保存新目标，权限等错误不得冒充不存在。 */
  private async inspect(path: string, optional: boolean): Promise<Stats | undefined> {
    try {
      const stat = await this.io.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error(text.ordinary);
      return stat;
    } catch (reason) {
      if (optional && (reason as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
      throw reason;
    }
  }

  /** 单句柄分批有界读取；内容、原路径和句柄状态一致且清理完成后才发布。 */
  open(owner: QueryResultSnapshotOwner): Promise<{ name: string; snapshot: QueryResultSnapshotDocument } | null> {
    return this.operation(owner, async () => {
      let handle: FileHandle | undefined;
      let result: { name: string; snapshot: QueryResultSnapshotDocument } | null = null;
      const errors: unknown[] = [];
      try {
        const selected = await this.guarded(owner, () => this.ports.choose('open'));
        if (selected === undefined) return null;
        const path = checkedPath(selected), initial = await this.guarded(owner, () => this.inspect(path, false));
        // 先保留迟到的原句柄再校验，来源失效也必须关闭它。
        owner.assertCurrent(); handle = await this.io.open(path, 'r'); owner.assertCurrent();
        const before = await this.guarded(owner, () => handle!.stat());
        if (!before.isFile() || !initial || !sameFile(initial, before)) throw Error(text.changedBefore);
        if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > queryResultSnapshotLimits.bytes) throw Error(text.tooLarge);
        const data = Buffer.alloc(queryResultSnapshotLimits.bytes + 1); let count = 0;
        while (count < data.length) {
          const length = Math.min(65536, data.length - count);
          const read = await this.guarded(owner, () => handle!.read(data, count, length, count));
          if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 0 || read.bytesRead > length) throw Error(text.invalidRead);
          if (!read.bytesRead) break;
          count += read.bytesRead; if (count > queryResultSnapshotLimits.bytes) throw Error(text.tooLarge);
        }
        const after = await this.guarded(owner, () => handle!.stat()), current = await this.guarded(owner, () => this.inspect(path, false));
        if (!sameFile(before, after) || !current || !sameFile(before, current) || count !== after.size) throw Error(text.changedDuring);
        let decoded: string;
        try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(0, count)); }
        catch { throw Error(text.encoding); }
        result = { name: basename(path), snapshot: decodeQueryResultSnapshot(decoded) }; owner.assertCurrent();
      } catch (reason) { errors.push(reason); }
      if (handle) { try { await handle.close(); } catch (reason) { errors.push(reason); } }
      if (!errors.length) { try { owner.assertCurrent(); } catch (reason) { errors.push(reason); } }
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, text.openFailed);
      return result;
    });
  }

  /** 先捕获已校验正文；同目录独占临时文件分批写入、同步和关闭后才替换目标。 */
  save(snapshot: QueryResultSnapshotDocument, owner: QueryResultSnapshotOwner): Promise<{ name: string } | null> {
    return this.operation(owner, async () => {
      const encoded = Buffer.from(encodeQueryResultSnapshot(parseQueryResultSnapshot(snapshot)), 'utf8');
      if (encoded.length > queryResultSnapshotLimits.bytes) throw Error(text.tooLarge);
      let handle: FileHandle | undefined, temporary: string | undefined, release: (() => void) | undefined;
      let renameSubmitted = false, result: { name: string } | null = null;
      const errors: unknown[] = [];
      try {
        const selected = await this.guarded(owner, () => this.ports.choose('save'));
        if (selected === undefined) return null;
        const path = checkedPath(selected);
        owner.assertCurrent(); release = await this.ports.reserve(path); owner.assertCurrent();
        const initial = await this.guarded(owner, () => this.inspect(path, true)), candidate = join(dirname(path), `.dbark-result-${randomUUID()}.tmp`);
        owner.assertCurrent(); handle = await this.io.open(candidate, 'wx', 0o600); temporary = candidate; owner.assertCurrent();
        let offset = 0;
        while (offset < encoded.length) {
          const length = Math.min(65536, encoded.length - offset), write = await this.guarded(owner, () => handle!.write(encoded, offset, length, offset));
          if (!Number.isSafeInteger(write.bytesWritten) || write.bytesWritten <= 0 || write.bytesWritten > length) throw Error(text.noProgress);
          offset += write.bytesWritten;
        }
        await this.guarded(owner, () => handle!.sync());
        owner.assertCurrent(); await handle.close(); handle = undefined; owner.assertCurrent();
        const current = await this.guarded(owner, () => this.inspect(path, true));
        if (initial ? !current || !sameFile(initial, current) : current !== undefined) throw Error(text.concurrent);
        owner.assertCurrent(); renameSubmitted = true;
        await this.io.rename(temporary, path); temporary = undefined;
        owner.assertCurrent(); result = { name: basename(path) };
      } catch (reason) { errors.push(reason); }
      // 锁保留至原句柄、临时文件及占用收尾结束；清理错误与原始错误一并保留。
      if (handle) { try { await handle.close(); } catch (reason) { errors.push(reason); } }
      if (temporary) { try { await this.io.unlink(temporary); } catch (reason) { errors.push(reason); } }
      if (release) { try { release(); } catch (reason) { errors.push(reason); } }
      if (!errors.length) { try { owner.assertCurrent(); } catch (reason) { errors.push(reason); } }
      if (errors.length) {
        if (renameSubmitted) throw new AggregateError(errors, text.unknownWrite);
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, text.saveFailed);
      }
      return result;
    });
  }
}
