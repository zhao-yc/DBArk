import { constants, type BigIntStats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { mysqlSqlFileMaxBytes, type MysqlSqlFileChooseInput } from '../shared/mysqlSqlFile';

export interface MysqlSqlFileSource { path: string; version: string; bytes: number }

function version(stat: BigIntStats) {
  if (!stat.isFile() || stat.ino <= 0n || stat.size < 1n || stat.size > BigInt(mysqlSqlFileMaxBytes))
    throw Error('请选择非空且不超过 10 GiB 的普通 SQL 文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export async function inspectMysqlSqlFile(path: string): Promise<MysqlSqlFileSource> {
  if (!isAbsolute(path) || path.includes('\0') || !/\.sql$/i.test(path)) throw Error('请选择普通的 SQL 文件');
  const stat = await lstat(path, { bigint: true });
  return { path, version: version(stat), bytes: Number(stat.size) };
}

/** 固定文件描述符并逐块复核文件代次。若执行期间文件变化，停止发送后续 SQL。 */
export async function* readMysqlSqlFile(source: MysqlSqlFileSource, encoding: MysqlSqlFileChooseInput['encoding'],
  family: 'mysql' | 'mariadb', check: () => void): AsyncGenerator<string> {
  const assertPath = async () => {
    check();
    if (version(await lstat(source.path, { bigint: true })) !== source.version) throw Error('SQL 文件已变化，请重新选择');
  };
  await assertPath();
  const flags = process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(source.path, flags);
  try {
    const assertCurrent = async () => {
      await assertPath();
      if (version(await handle.stat({ bigint: true })) !== source.version) throw Error('SQL 文件已变化，请重新选择');
      check();
    };
    await assertCurrent();
    const stream = handle.createReadStream({ autoClose: false, end: source.bytes - 1 });
    async function* checkedBytes(): AsyncGenerator<Uint8Array> {
      for await (const bytes of stream) {
        await assertCurrent();
        yield bytes as Buffer;
      }
      await assertCurrent();
    }
    try { yield* decodeMysqlSql(checkedBytes(), encoding, family); }
    finally { stream.destroy(); }
  } finally { await handle.close(); }
}

/** MariaDB 转储首行是命令行客户端指令。只屏蔽固定标记，并保留原字符位置。 */
export async function* decodeMysqlSql(bytes: AsyncIterable<Uint8Array>, encoding: MysqlSqlFileChooseInput['encoding'],
  family: 'mysql' | 'mariadb'): AsyncGenerator<string> {
  const sandbox = '/*M!999999\\- enable the sandbox mode */';
  let prefix = '', first = family === 'mariadb';
  const decoder = new TextDecoder({ utf8: 'utf-8', utf16le: 'utf-16le', gb18030: 'gb18030' }[encoding], { fatal: true });
  for await (const block of bytes) {
    const chunk = decoder.decode(block, { stream: true });
    if (!first) { yield chunk; continue; }
    prefix += chunk;
    if (sandbox.startsWith(prefix) || prefix === sandbox + '\r') continue;
    first = false;
    yield prefix.startsWith(sandbox) && /^\r?\n/.test(prefix.slice(sandbox.length))
      ? ' '.repeat(sandbox.length) + prefix.slice(sandbox.length) : prefix;
    prefix = '';
  }
  const tail = decoder.decode();
  if (prefix || tail) yield prefix === sandbox ? ' '.repeat(sandbox.length) + tail : prefix + tail;
}
