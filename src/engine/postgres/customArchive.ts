import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { postgresArchiveListLimit, type PostgresArchiveExportInput,
  type PostgresArchiveListing, type PostgresArchiveSqlExport } from '../../shared/postgresArchive';
import { postgresSqlFileLimits } from '../../shared/postgresSqlFile';
import { AtomicFile, privateAtomicFileIO } from '../atomicFile';
import { postgresToolEnvironment, readPostgresToolVersion, runPostgresNativeTool, type PostgresNativeTool } from './nativeTool';

export interface PostgresArchiveSource { path: string; stamp: BigIntStats }
type RestoreTool = PostgresNativeTool<'pg_restore'>;

const changed = () => Error('PostgreSQL 归档已变化，请重新选择');
const sameObject = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const sameRevision = (a: BigIntStats, b: BigIntStats) => b.isFile() && sameObject(a, b) &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

async function withArchive<T>(source: PostgresArchiveSource, check: () => void, read: (file: FileHandle) => Promise<T>) {
  check();
  const current = () => lstat(source.path, { bigint: true }).catch(() => { throw changed(); });
  if (!sameRevision(source.stamp, await current())) throw changed();
  const flags = process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const file = await open(source.path, flags);
  try {
    const verify = async () => {
      check();
      if (!sameRevision(source.stamp, await file.stat({ bigint: true })) || !sameRevision(source.stamp, await current())) throw changed();
    };
    await verify();
    const magic = Buffer.alloc(5);
    const header = await file.read(magic, 0, magic.length, 0);
    if (header.bytesRead !== magic.length || magic.toString('ascii') !== 'PGDMP')
      throw Error('文件没有 PostgreSQL 自定义归档标记');
    const result = await read(file);
    await verify();
    return result;
  } finally { await file.close(); }
}

/** 只接受普通 PGDMP 文件。打开前后复核身份，后续向原生工具传递只读句柄。 */
export async function inspectPostgresArchive(path: string, check: () => void): Promise<PostgresArchiveSource> {
  if (!isAbsolute(path) || path.includes('\0')) throw Error('请选择本机 PostgreSQL 自定义归档');
  const stamp = await lstat(path, { bigint: true });
  if (!stamp.isFile() || stamp.ino <= 0n || stamp.size < 5n || stamp.size > BigInt(postgresSqlFileLimits.bytes))
    throw Error('请选择不超过 10 GiB 的普通 PostgreSQL 自定义归档');
  const source = { path, stamp };
  await withArchive(source, check, async () => undefined);
  return source;
}

export async function listPostgresArchive(source: PostgresArchiveSource, tool: RestoreTool,
  signal: AbortSignal, check: () => void): Promise<PostgresArchiveListing> {
  const toolVersion = await readPostgresToolVersion(tool, signal);
  const chunks: Buffer[] = [];
  let bytes = 0;
  const warning = await withArchive(source, check, file =>
    runPostgresNativeTool(tool, ['--format=custom', '--list', '--no-password'], postgresToolEnvironment(), signal, async chunk => {
      check();
      bytes += chunk.length;
      if (bytes > postgresArchiveListLimit) throw Error('归档目录超过 2 MiB 显示预算，可以直接导出 SQL');
      chunks.push(chunk);
    }, file.fd));
  const text = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks));
  if (!text.trim()) throw Error('pg_restore 未返回归档目录');
  return { text, toolVersion, ...(warning ? { warning } : {}) };
}

/** 转换只写标准输出，既不传连接信息，也不向目标库执行 SQL。 */
export async function exportPostgresArchiveSql(source: PostgresArchiveSource, tool: RestoreTool, target: string,
  options: Pick<PostgresArchiveExportInput, 'portable' | 'content'>, signal: AbortSignal,
  check: () => void, publishing: () => void): Promise<PostgresArchiveSqlExport> {
  if (!isAbsolute(target) || !/\.sql$/i.test(target)) throw Error('请选择 .sql 目标文件');
  const targetStat = await lstat(target, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  if (target === source.path || targetStat && sameObject(source.stamp, targetStat)) throw Error('导出目标不能是原归档');
  const toolVersion = await readPostgresToolVersion(tool, signal);
  const staged = await AtomicFile.create(target, 'utf8', check, publishing, privateAtomicFileIO, postgresSqlFileLimits.bytes, undefined, true);
  try {
    const decoder = new TextDecoder('utf8', { fatal: true });
    let header = '', utf8 = false;
    const warning = await withArchive(source, check, file => runPostgresNativeTool(tool, [
      '--format=custom', '--file=-', '--no-password',
      ...(options.content === 'schema' ? ['--schema-only'] : options.content === 'data' ? ['--data-only'] : []),
      ...(options.portable ? ['--no-owner', '--no-privileges'] : []),
    ], postgresToolEnvironment(), signal, async chunk => {
      check();
      const text = decoder.decode(chunk, { stream: true });
      if (!utf8) {
        header += text.slice(0, 64 * 1024 - header.length);
        utf8 = /^SET client_encoding = 'UTF8';\r?$/m.test(header);
        if (!utf8 && header.length >= 64 * 1024) throw Error('归档 SQL 未声明 UTF-8 客户端编码');
      }
      await staged.writeBytes(chunk);
    }, file.fd));
    decoder.decode();
    if (!utf8) throw Error('归档 SQL 未声明 UTF-8 客户端编码');
    await staged.prepare(true);
    if (!sameRevision(source.stamp, await lstat(source.path, { bigint: true }).catch(() => { throw changed(); }))) throw changed();
    await staged.commit();
    return { name: basename(target), bytes: staged.bytesWritten, toolVersion, ...(warning ? { warning } : {}) };
  } finally { await staged.dispose(); }
}
