import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse/sync';
import { csvExportDelimiter, type CsvExportDelimiter } from '../../shared/csvExport';

const headerLimit = 256 * 1024;
const fileLimit = 10n * 1024n ** 3n;
const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
const changed = 'CSV 文件已变化，请重新选择并核对列映射';
export interface PostgresCopySource {
  path: string;
  version: string;
  bytes: number;
  offset: number;
  delimiter: CsvExportDelimiter;
  header: string[];
}

/** 只打开本地普通文件，版本同时含物理身份和纳秒修改时钟。 */
function version(stat: BigIntStats) {
  if (!stat.isFile() || stat.ino <= 0n || stat.size < 1n || stat.size > fileLimit)
    throw Error('请选择非空且不超过 10 GiB 的普通 CSV 文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

/** 复核打开的句柄及原路径，文件替换或在途修改都不能通过提交门。 */
async function assertVersion(path: string, handle: FileHandle, expected: string) {
  if (version(await handle.stat({ bigint: true })) !== expected ||
      version(await lstat(path, { bigint: true })) !== expected) throw Error(changed);
}

/** 避免被替换为链接或管道后转读其它来源，Windows 仍以句柄和路径身份双核对。 */
function openRead(path: string) {
  return open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
}

/** 只解析第一条 CSV 记录，正文仍交给 PostgreSQL 按原生 CSV 语义处理。 */
export async function inspectPostgresCopySource(path: string, delimiter: CsvExportDelimiter): Promise<PostgresCopySource> {
  if (!isAbsolute(path) || path.includes('\0')) throw Error('未取得授权 CSV 文件路径');
  csvExportDelimiter('csv', delimiter);
  const stat = await lstat(path, { bigint: true });
  const expected = version(stat), bytes = Number(stat.size);
  const handle = await openRead(path);
  try {
    await assertVersion(path, handle, expected);
    const prefix = Buffer.allocUnsafe(Math.min(bytes, headerLimit + 1));
    let length = 0;
    while (length < prefix.length) {
      const { bytesRead } = await handle.read(prefix, length, prefix.length - length, length);
      if (!bytesRead) throw Error(changed);
      length += bytesRead;
    }
    const offset = prefix.subarray(0, 3).equals(utf8Bom) ? 3 : 0;
    let header: string[];
    try {
      const input = prefix.subarray(offset);
      const [first] = parse(input, { delimiter, encoding: null, info: true, to: 1 }) as
        unknown as { record: Buffer[]; info: { bytes: number } }[];
      const end = first?.info.bytes ?? 0;
      if (!end || end > headerLimit || bytes > length && ![10, 13].includes(input[end - 1])) throw Error();
      const decode = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      header = first.record.map(field => decode.decode(field));
      if (!header.length || header.length > 1022 || header.some(field => field.length > 512 || field.includes('\0'))) throw Error();
    } catch { throw Error('CSV 表头无效、超过大小限制或与所选分隔符不符，请检查 UTF-8 文件'); }
    await assertVersion(path, handle, expected);
    return { path, version: expected, bytes, offset, delimiter, header };
  } finally { await handle.close(); }
}

/** 按已检查文件的准确字节范围推送 COPY，读完再核路径和版本。 */
export async function readPostgresCopySource(source: PostgresCopySource,
  consume: (stream: Readable) => Promise<number>): Promise<number> {
  const { path, version: expected, offset, bytes } = source;
  if (version(await lstat(path, { bigint: true })) !== expected) throw Error(changed);
  const handle = await openRead(path);
  try {
    await assertVersion(path, handle, expected);
    const stream = handle.createReadStream({ autoClose: false, start: offset, end: bytes - 1 });
    const checked = Readable.from(checkCopyEndMarker(stream), { objectMode: false });
    try {
      const rows = await consume(checked);
      if (stream.bytesRead !== bytes - offset) throw Error(changed);
      await assertVersion(path, handle, expected);
      return rows;
    } finally { checked.destroy(); stream.destroy(); }
  } finally { await handle.close(); }
}

/** 旧版本可能把单独一行的未引用反斜线加句点解释为结束标记。跨块追踪原字节及引号，避免静默丢尾行。 */
async function* checkCopyEndMarker(stream: Readable): AsyncGenerator<Buffer> {
  let quoted = false, marker = 0;
  const check = () => {
    if (marker === 2) throw Error('CSV 中单独一行的反斜线加句点需要用双引号包围');
  };
  for await (const chunk of stream) {
    for (const byte of chunk as Buffer) {
      if (byte === 34) quoted = !quoted;
      if (!quoted && (byte === 10 || byte === 13)) { check(); marker = 0; }
      else if (marker === 0 && byte === 92) marker = 1;
      else if (marker === 1 && byte === 46) marker = 2;
      else marker = -1;
    }
    yield chunk;
  }
  check();
}
