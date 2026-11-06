import { randomUUID } from 'node:crypto';
import { constants, linkSync, lstatSync, unlinkSync, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { AtomicFile, privateAtomicFileIO } from '../engine/atomicFile';
import { databaseBackupArchiveLimits, inspectDatabaseBackupArchive, type DatabaseBackupArchiveSink } from '../engine/databaseBackupArchive';
import { databaseBackupArchiveZh as text, type DatabaseBackupArchiveView, type DatabaseBackupRestoreTargetAudit, type DatabaseBackupSqlExport } from '../shared/databaseBackupArchiveFiles';

const leaseMs = 10 * 60_000;
const invalidPath = () => Error('请选择有效的普通归档文件或新的 SQL 文件名');
const changed = () => Error(text.stale);
const sameObject = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino && right.isFile();
const sameRevision = (left: BigIntStats, right: BigIntStats) => sameObject(left, right) &&
  left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;

interface ArchivePorts<Owner> {
  assert(owner: Owner): void;
  same(left: Owner, right: Owner): boolean;
  choose(owner: Owner, action: 'open' | 'export'): Promise<string | undefined>;
  reserve(path: string): Promise<() => void>;
  assertDestination(path: string): Promise<void>;
}

interface Inspection<Owner> {
  owner: Owner;
  path: string;
  stamp: BigIntStats;
  view: DatabaseBackupArchiveView;
  expires: number;
}

type RegisterStop = (stop: () => Promise<void>) => void;
interface ArchiveJob<Owner> {
  owner: Owner;
  id: string;
  cancelled: boolean;
  publishing: boolean;
  stop?: () => Promise<void>;
  stopping?: Promise<void>;
}

/** 两次校验均用同一轮打开的只读句柄。选中路径、文件代次、CRC 和 SHA 同时约束导出。 */
async function readArchive(path: string, check: () => void, stamp?: BigIntStats, sink?: DatabaseBackupArchiveSink) {
  check();
  if (!isAbsolute(path) || path.includes('\0')) throw invalidPath();
  const initial = await lstat(path, { bigint: true });
  check();
  if (!initial.isFile() || initial.size > databaseBackupArchiveLimits.archiveBytes || stamp && !sameRevision(stamp, initial))
    throw changed();
  // POSIX 防止检查与打开之间换成链接或阻塞设备。Windows 在打开前后核验同一普通文件。
  const flags = process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(path, flags);
  try {
    check();
    if (!sameRevision(initial, await handle.stat({ bigint: true }))) throw changed();
    const checked = await inspectDatabaseBackupArchive({
      size: initial.size,
      async read(offset, length) {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, Number(offset));
        return buffer.subarray(0, bytesRead);
      }
    }, check, sink);
    if (!sameRevision(initial, await handle.stat({ bigint: true })) || !sameRevision(initial, await lstat(path, { bigint: true }))) throw changed();
    check();
    return { stamp: initial, checked };
  } finally { await handle.close(); }
}

async function assertNewTarget(path: string): Promise<void> {
  if (!isAbsolute(path) || path.includes('\0') || !/\.sql$/i.test(path)) throw invalidPath();
  try { await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw Error(text.existing);
}

/** Main 保存原窗口最近一份通过校验的归档。渲染只持令牌，不能从 IPC 选择路径。 */
export class DatabaseBackupArchiveFiles<Owner> {
  private inspection?: Inspection<Owner>;
  private active?: ArchiveJob<Owner>;
  constructor(private readonly ports: ArchivePorts<Owner>) {}

  private async run<T>(owner: Owner, id: string, work: (check: () => void, publishing: () => void, registerStop: RegisterStop) => Promise<T>): Promise<T> {
    this.ports.assert(owner);
    if (this.active) throw Error('另一项备份归档操作尚未完成');
    const job: ArchiveJob<Owner> = { owner, id, cancelled: false, publishing: false };
    this.active = job;
    const check = () => {
      this.ports.assert(owner);
      if (job.cancelled) throw Error(text.cancelled);
    };
    try {
      return await work(check, () => { check(); job.publishing = true; }, stop => { check(); job.stop = stop; });
    } finally {
      try { await job.stopping; }
      finally { this.active = undefined; }
    }
  }

  /** 取消只作用于当前任务。发布开始后等待原提交回执。 */
  async cancel(owner: Owner, id: string): Promise<void> {
    const job = this.active;
    if (job?.id !== id || !this.ports.same(job.owner, owner) || job.publishing) return;
    job.cancelled = true;
    if (job.stop) await (job.stopping ??= job.stop());
  }

  private assertInspection(owner: Owner, token: string): Inspection<Owner> {
    const inspection = this.inspection;
    if (!inspection || inspection.view.token !== token || inspection.expires <= Date.now() ||
      !this.ports.same(inspection.owner, owner)) throw changed();
    return inspection;
  }

  /** 只转发已校验清单；原窗口或文件代次变化后，不发布另一目标的查询回执。 */
  auditTarget(owner: Owner, id: string, token: string, read: (manifest: DatabaseBackupArchiveView['manifest'],
    registerStop: RegisterStop) => Promise<DatabaseBackupRestoreTargetAudit>): Promise<DatabaseBackupRestoreTargetAudit> {
    return this.run(owner, id, async (check, _publishing, registerStop) => {
      const inspection = this.assertInspection(owner, token);
      const assertCurrent = async () => {
        const stamp = await lstat(inspection.path, { bigint: true }).catch(() => { throw changed(); });
        check();
        if (!sameRevision(inspection.stamp, stamp)) throw changed();
        this.assertInspection(owner, token);
      };
      await assertCurrent();
      const result = await read(inspection.view.manifest, registerStop);
      await assertCurrent();
      return result;
    });
  }

  open(owner: Owner, id: string): Promise<DatabaseBackupArchiveView | null> {
    return this.run(owner, id, async check => {
      this.inspection = undefined;
      const path = await this.ports.choose(owner, 'open');
      check();
      if (!path) return null;
      const { stamp, checked } = await readArchive(path, check);
      check();
      const view = { token: randomUUID(), name: basename(path), manifest: checked.manifest, archive: checked.archive };
      this.inspection = { owner, path, stamp, view, expires: Date.now() + leaseMs };
      return structuredClone(view);
    });
  }

  /** 复核的 SQL 直接流入同卷私有文件，整包一致且已关闭来源后才发布。硬链接确保同名竞争时不覆盖。 */
  export(owner: Owner, id: string, token: string): Promise<DatabaseBackupSqlExport | null> {
    return this.run(owner, id, async (check, publishing) => {
      const assertInspection = () => {
        check();
        return this.assertInspection(owner, token);
      };
      const original = assertInspection();
      const path = await this.ports.choose(owner, 'export');
      assertInspection();
      if (!path) return null;
      await assertNewTarget(path);
      const parentIdentity = await privateAtomicFileIO.parentIdentity!(path);
      const assertParent = async () => {
        if (await privateAtomicFileIO.parentIdentity!(path) !== parentIdentity) throw Error('SQL 目标目录已变化，请重新选择');
      };
      const release = await this.ports.reserve(path);
      let output: AtomicFile | undefined, cleanupPending = false;
      try {
        check();
        await this.ports.assertDestination(path);
        await assertNewTarget(path);
        await assertParent();
        output = await AtomicFile.create(path, 'utf8', check, publishing, {
          ...privateAtomicFileIO,
          async rename(staging, target) {
            const owned = lstatSync(staging, { bigint: true });
            try { linkSync(staging, target); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error(text.existing); throw error; }
            try {
              if (!sameObject(owned, lstatSync(staging, { bigint: true }))) throw changed();
              unlinkSync(staging);
            } catch { cleanupPending = true; }
          }
        }, Number(databaseBackupArchiveLimits.archiveBytes), undefined, true);
        const { checked } = await readArchive(original.path, check, original.stamp, output);
        if (checked.archive.sha256 !== original.view.archive.sha256) throw changed();
        await output.prepare(true);
        await this.ports.assertDestination(path);
        await assertParent();
        assertInspection();
        await output.commit();
        return { name: basename(path), bytes: checked.dump.bytes, sha256: checked.dump.sha256, cleanupPending };
      } finally {
        try { await output?.dispose(); } finally { release(); }
      }
    });
  }
}
