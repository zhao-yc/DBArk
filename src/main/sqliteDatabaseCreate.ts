import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, readdirSync, realpathSync, rmdirSync, unlinkSync, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteDriverLimits, type SqliteProcessExit, type SqliteProcessTransport, type SqliteValue } from '../engine/sqlite/protocol';
import { createSqliteProcess } from './sqliteProcess';

export interface SqliteDatabaseCreateOptions { assertOwner(): void; createTransport?: () => SqliteProcessTransport; }
interface Identity { device: bigint; inode: bigint; }
interface Resource { transport: SqliteProcessTransport; exited: boolean; result?: SqliteProcessExit; closeId?: string; closedReply: boolean; closeAck: boolean; }
const seedBytes = 64 * 1024;
// 默认工厂另在Main全局registry登记；这里也保留注入工厂的准确句柄，直到真实exit才释放。
const resources = new Set<Resource>();
// 目标close异常不能丢原FileHandle或伪称关闭；不按目标路径删除或重新认领任何对象。
const unconfirmedFiles = new Set<FileHandle>();
let draining: Promise<void> | undefined;
const initialize = 'BEGIN IMMEDIATE; CREATE TABLE "__dbark_initialize" ("value" INTEGER); DROP TABLE "__dbark_initialize"; COMMIT';
const existing = () => Object.assign(Error('目标文件已存在，请选择尚不存在的新文件；原文件未修改，连接未保存'), { code: 'EEXIST' });
const identity = (value: BigIntStats): Identity => ({ device: value.dev, inode: value.ino });
const same = (value: BigIntStats, expected: Identity) => value.dev === expected.device && value.ino === expected.inode;

/** 新主库不能借用旧日志命名空间；任何固定sidecar条目都只拒绝，不删除或解释其内容。 */
function assertNoSidecars(path: string): void {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    let found = false;
    try { lstatSync(path + suffix); found = true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('SQLite目标日志命名空间无法确认，连接未保存', { cause: reason }); }
    if (found) throw Object.assign(Error('目标路径已有SQLite日志文件或同名条目，请选择全新路径；原件未修改，连接未保存'), { code: 'EEXIST' });
  }
}

/** 真实exit是唯一资源释放证明，超时不能从账本删除原句柄。 */
async function waitExit(resource: Resource): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([resource.transport.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite私有初始化进程退出未确认')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]); }
  finally { clearTimeout(timer); }
}

/** Main已等待创建操作settled后调用；只重试准确原进程/句柄，不重放初始化或删除失败seed/用户路径。 */
export function closeSqliteDatabaseCreates(): Promise<void> {
  if (draining) return draining;
  const work = (async () => {
    const results = await Promise.allSettled([
      ...[...resources].map(async resource => { const failures: unknown[] = []; try { resource.transport.terminate(); } catch (reason) { failures.push(reason); } try { await waitExit(resource); } catch (reason) { failures.push(reason); } if (failures.length) throw new AggregateError(failures, 'SQLite原初始化进程退出未全部确认'); }),
      ...[...unconfirmedFiles].map(async file => { await file.close(); unconfirmedFiles.delete(file); }),
    ]);
    const errors = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected').map(value => value.reason);
    if (errors.length || resources.size || unconfirmedFiles.size) throw new AggregateError(errors, 'SQLite新建文件仍有原进程或文件句柄未确认关闭，保留现场');
  })();
  draining = work; void work.finally(() => { if (draining === work) draining = undefined; }).catch(() => {}); return work;
}

/** 只删稳定专属目录里的固定自有文件；出现外来条目、链接或身份漂移就保留现场。 */
function cleanSeed(directory: string, directoryIdentity: Identity, seed: string, seedIdentity: Identity): void {
  const checkDirectory = () => { const value = lstatSync(directory, { bigint: true }); if (!value.isDirectory() || value.isSymbolicLink() || !same(value, directoryIdentity)) throw Error('SQLite私有目录身份已变化，保留原件'); };
  checkDirectory(); const known = new Set([basename(seed), basename(seed) + '-journal', basename(seed) + '-wal', basename(seed) + '-shm']), entries = readdirSync(directory);
  if (entries.some(entry => !known.has(entry))) throw Error('SQLite私有目录出现未知条目，保留原件');
  const files = entries.map(entry => { const path = join(directory, entry), stat = lstatSync(path, { bigint: true }); if (!stat.isFile() || stat.isSymbolicLink() || path === seed && !same(stat, seedIdentity)) throw Error('SQLite私有文件身份已变化，保留原件'); return { path, identity: identity(stat) }; });
  for (const file of files) { checkDirectory(); const stat = lstatSync(file.path, { bigint: true }); if (!stat.isFile() || stat.isSymbolicLink() || !same(stat, file.identity)) throw Error('SQLite私有文件删除归属无法确认'); unlinkSync(file.path); }
  checkDirectory(); rmdirSync(directory);
}

/** 只读固定小文件；在原句柄上验证大小、身份和修改代次，不能读入任意大文件。 */
function readSeed(seed: string, expected: Identity): Buffer {
  const descriptor = openSync(seed, 'r');
  try {
    const before = fstatSync(descriptor, { bigint: true }), path = lstatSync(seed, { bigint: true });
    if (!before.isFile() || !path.isFile() || path.isSymbolicLink() || !same(before, expected) || !same(path, expected) || before.size < 100n || before.size > BigInt(seedBytes)) throw Error('SQLite私有空库大小或读取身份无效');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (count < 1) throw Error('SQLite私有空库读取不完整'); offset += count; }
    const after = fstatSync(descriptor, { bigint: true });
    if (!same(after, expected) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || !same(lstatSync(seed, { bigint: true }), expected)) throw Error('SQLite私有空库读取期间发生变化');
    const pageSize = bytes.readUInt16BE(16) === 1 ? 65536 : bytes.readUInt16BE(16);
    if (!bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) || pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || bytes.length % pageSize !== 0 || bytes.readUInt32BE(28) * pageSize !== bytes.length || bytes[18] !== 1 || bytes[19] !== 1 || bytes[21] !== 64 || bytes[22] !== 32 || bytes[23] !== 32 || bytes.readUInt32BE(56) !== 1) throw Error('SQLite私有空库头或页边界无效');
    return bytes;
  } finally { closeSync(descriptor); }
}

/** 初始化/完整性检查全部经原utility，确认正常close及exit并清完私有seed，才交付有界字节。 */
async function prepareEmptyDatabase(options: SqliteDatabaseCreateOptions): Promise<Buffer> {
  options.assertOwner();
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-')), directoryIdentity = identity(lstatSync(directory, { bigint: true })), seed = join(directory, 'seed.sqlite');
  let descriptor: number | undefined, seedIdentity: Identity | undefined, driver: SqliteDriverSession | undefined, resource: Resource | undefined, bytes: Buffer | undefined;
  const errors: unknown[] = [];
  try {
    options.assertOwner(); descriptor = openSync(seed, 'wx', 0o600); seedIdentity = identity(fstatSync(descriptor, { bigint: true })); closeSync(descriptor); descriptor = undefined; options.assertOwner();
    driver = await SqliteDriverSession.open(() => {
      options.assertOwner(); const transport = (options.createTransport ?? createSqliteProcess)(); resource = { transport, exited: false, closedReply: false, closeAck: false }; resources.add(resource); const owned = resource;
      void transport.exited.then(result => { owned.exited = true; owned.result = result; resources.delete(owned); }, () => {});
      return {
        get pid() { return transport.pid; }, exited: transport.exited, terminate: () => transport.terminate(),
        send: message => { if (message.kind === 'close') owned.closeId = message.id; transport.send(message); if (message.kind === 'closeAck' && message.id === owned.closeId) owned.closeAck = true; },
        onMessage: listener => transport.onMessage(message => { if (message.kind === 'closed' && message.id === owned.closeId) owned.closedReply = true; listener(message); }),
      };
    }, { path: seed, readOnly: false, busyTimeoutMs: 0 });
    options.assertOwner();
    // worker native路径与Main默认realpath可不同；这里只比较准确打开文件的dev/ino。
    if (!driver.identity || driver.identity.device !== seedIdentity.device.toString() || driver.identity.inode !== seedIdentity.inode.toString()) throw Error('SQLite初始化未打开准确私有seed');
    const initialized = await driver.execute(initialize); options.assertOwner();
    if (initialized.transaction || initialized.statements.length !== 4 || initialized.statements.some(statement => statement.truncated)) throw Error('SQLite空库初始化未取得完整提交事实');
    const schema: SqliteValue[][] = [], integrity: SqliteValue[][] = [];
    const empty = await driver.execute('SELECT count(*) FROM main.sqlite_schema', { maxRows: 2, onBatch: batch => { schema.push(...batch.rows); } }); options.assertOwner();
    if (empty.statements.length !== 1 || empty.statements[0].truncated || schema.length !== 1 || schema[0].length !== 1 || !schema[0][0] || typeof schema[0][0] !== 'object' || schema[0][0].type !== 'integer' || schema[0][0].value !== '0') throw Error('SQLite新库Schema不为空');
    const checked = await driver.execute('PRAGMA integrity_check(1)', { maxRows: 2, onBatch: batch => { integrity.push(...batch.rows); } }); options.assertOwner();
    if (checked.statements.length !== 1 || checked.statements[0].truncated || integrity.length !== 1 || integrity[0].length !== 1 || integrity[0][0] !== 'ok') throw Error('SQLite新库完整性未确认');
  } catch (reason) { errors.push(reason); }
  // 收尾不能被失效owner打断，也不能把kill成功当成正常初始化；所有原异常仍保留。
  if (!errors.length && driver && (!driver.isUsable || resource?.exited)) errors.push(Error('SQLite初始化完成后原会话提前失效，不能当作正常关闭'));
  let normallyClosed = false;
  if (driver) try { await driver.close(); normallyClosed = true; } catch (reason) { errors.push(reason); }
  if (!errors.length && (!normallyClosed || !resource?.exited || resource.result?.code !== 0 || resource.result?.signal !== null || !resource.closedReply || !resource.closeAck)) errors.push(Error('SQLite初始化缺少准确正常close/exit事实'));
  try { options.assertOwner(); } catch (reason) { errors.push(reason); }
  if (resource && !resource.exited) {
    errors.push(Error('SQLite初始化原进程正常退出未确认，禁止创建目标'));
    try { resource.transport.terminate(); } catch (reason) { errors.push(reason); }
    try { await waitExit(resource); } catch (reason) { errors.push(reason); }
    try { options.assertOwner(); } catch (reason) { errors.push(reason); }
  }
  if (descriptor !== undefined) try { closeSync(descriptor); descriptor = undefined; } catch (reason) { errors.push(reason); }
  if ((!resource || resource.exited) && descriptor === undefined) {
    if (!errors.length && seedIdentity) try { options.assertOwner(); bytes = readSeed(seed, seedIdentity); options.assertOwner(); } catch (reason) { errors.push(reason); }
    try {
      if (seedIdentity) cleanSeed(directory, directoryIdentity, seed, seedIdentity);
      else { const current = lstatSync(directory, { bigint: true }); if (!same(current, directoryIdentity) || !current.isDirectory() || current.isSymbolicLink() || readdirSync(directory).length) throw Error('SQLite私有目录清理归属未确认'); rmdirSync(directory); }
    } catch (reason) { errors.push(reason); }
    try { options.assertOwner(); } catch (reason) { errors.push(reason); }
  } else errors.push(Error('SQLite私有进程或seed句柄未确认关闭，seed与准确句柄已保留'));
  if (errors.length || !bytes) throw new AggregateError(errors, 'SQLite私有初始化或收尾未完成，尚未创建目标文件；连接未保存', { cause: errors[0] });
  return bytes;
}

/** 先生成完整合法空库，最后wx独占发布；wx之后迟到撤权只影响登记，不能留下半份固定数据库。 */
export async function createSqliteDatabaseFile(destination: string, options: SqliteDatabaseCreateOptions): Promise<{ path: string; device: bigint; inode: bigint }> {
  options.assertOwner();
  if (typeof destination !== 'string' || !isAbsolute(destination) || destination.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(destination)) throw Error('SQLite新文件路径无效，连接未保存');
  // 仅快速拒绝，最终wx仍是任何文件/链接/目录都不能覆盖的唯一防线。
  let exists = false;
  try { await lstat(destination); exists = true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('SQLite目标路径无法确认，未创建文件；连接未保存', { cause: reason }); }
  options.assertOwner(); if (exists) throw existing();
  assertNoSidecars(destination); options.assertOwner();
  const absolute = resolve(destination), parent = realpathSync(dirname(absolute)); options.assertOwner();
  const parentStat = await lstat(parent, { bigint: true }); options.assertOwner();
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw Error('SQLite目标父目录身份无效，未创建文件；连接未保存');
  const bytes = await prepareEmptyDatabase(options); options.assertOwner();
  const target = join(parent, basename(absolute)); let file: FileHandle;
  try {
    options.assertOwner(); const latestParent = lstatSync(parent, { bigint: true });
    if (realpathSync(dirname(absolute)) !== parent || !latestParent.isDirectory() || latestParent.isSymbolicLink() || !same(latestParent, identity(parentStat))) throw Error('SQLite目标父目录身份已变化');
    assertNoSidecars(target); options.assertOwner();
    file = await open(target, 'wx', 0o600);
  }
  catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'EEXIST') throw existing(); throw Error('SQLite新文件创建未完成，目标路径可能已有文件，请先核对；连接未保存', { cause: reason }); }
  const errors: unknown[] = []; let created: BigIntStats | undefined;
  // 此后不检查owner直到固定字节写完且close确认；始终只操作原wx句柄，不按路径删除。
  try {
    created = await file.stat({ bigint: true }); if (!created.isFile()) throw Error('SQLite新文件句柄不是普通文件');
    let offset = 0;
    while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset, offset); if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > bytes.length - offset) throw Error('SQLite新文件不能继续完整写入'); offset += result.bytesWritten; }
    await file.sync(); const complete = await file.stat({ bigint: true });
    if (!same(complete, identity(created)) || complete.size !== BigInt(bytes.length)) throw Error('SQLite新文件写入身份或字节数变化');
  } catch (reason) { errors.push(reason); }
  try { await file.close(); } catch (reason) { errors.push(reason); unconfirmedFiles.add(file); }
  try { options.assertOwner(); } catch (reason) { errors.push(reason); }
  if (!errors.length && created) try {
    assertNoSidecars(target);
    // 返回Main既有默认realpath协议，不把worker native路径混进文件令牌；同步核原句柄dev/ino。
    const path = realpathSync(target), current = lstatSync(target, { bigint: true }), actual = lstatSync(path, { bigint: true }), directory = lstatSync(parent, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || !actual.isFile() || actual.isSymbolicLink() || !same(current, identity(created)) || !same(actual, identity(created)) || current.size !== BigInt(bytes.length) || !directory.isDirectory() || directory.isSymbolicLink() || !same(directory, identity(parentStat)) || realpathSync(dirname(path)) !== realpathSync(parent)) throw Error('SQLite新文件或父目录身份已变化');
    options.assertOwner(); return { path, ...identity(created) };
  } catch (reason) { errors.push(reason); }
  throw new AggregateError(errors, 'SQLite新文件创建未完成，目标路径可能已有文件，请先核对；连接未保存', { cause: errors[0] });
}
