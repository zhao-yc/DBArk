import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import iconv from 'iconv-lite';
import type { QueryFileEncoding } from '../shared/contracts';

export const queryFileLimit = 20 * 1024 * 1024;
const queryTextLimit = 20_000_000;

/** SQL 编辑文件采用有限读写；更大的脚本应通过独立的流式 SQL 文件任务执行。 */
function checkEncoding(encoding: string): asserts encoding is QueryFileEncoding {
  if (!['utf8', 'utf16le', 'gb18030'].includes(encoding)) throw new Error('SQL 文件编码必须为 UTF-8、UTF-16LE 或 GB18030');
}

/** BOM 优先确定 UTF 编码；没有 BOM 时使用用户指定编码，非法序列不能静默替换。 */
export function decodeQueryFile(bytes: Buffer, requestedEncoding: QueryFileEncoding): { sql: string; encoding: QueryFileEncoding } {
  checkEncoding(requestedEncoding);
  if (bytes.length > queryFileLimit) throw new Error('SQL 文件超过 20 MiB，请使用 SQL 文件导入任务流式执行');
  let encoding = requestedEncoding;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) { encoding = 'utf8'; bytes = bytes.subarray(3); }
  else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) { encoding = 'utf16le'; bytes = bytes.subarray(2); }
  else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) throw new Error('暂不支持 UTF-16BE，请转换为 UTF-16LE 或 UTF-8');
  let sql: string;
  try {
    sql = encoding === 'gb18030' ? iconv.decode(bytes, encoding) : new TextDecoder(encoding === 'utf8' ? 'utf-8' : 'utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { throw new Error('SQL 文件包含无效编码，请检查所选编码'); }
  // 旧编码的解析器可能用替代符处理非法字节，往返核对可在进入编辑器前发现损坏。
  if (encoding === 'gb18030' && !iconv.encode(sql, encoding).equals(bytes)) throw new Error('SQL 文件编码无法无损读取，请检查所选编码');
  if (sql.includes('\0')) throw new Error('SQL 文件包含 NUL 字符，可能选错编码或不是文本文件');
  if (sql.length > queryTextLimit) throw new Error('SQL 正文超过 2000 万字符，请使用 SQL 文件导入任务流式执行');
  return { sql, encoding };
}

/** 原生文件选择授权后调用；按块读取并在文件增长时仍执行同一大小上限。 */
export async function readQueryFile(filePath: string, encoding: QueryFileEncoding): Promise<{ sql: string; encoding: QueryFileEncoding }> {
  checkEncoding(encoding);
  const file = await open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('请选择普通 SQL 文本文件');
    if (stat.size > queryFileLimit) throw new Error('SQL 文件超过 20 MiB，请使用 SQL 文件导入任务流式执行');
    const chunks: Buffer[] = []; let length = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, queryFileLimit + 1 - length));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > queryFileLimit) throw new Error('SQL 文件超过 20 MiB，请使用 SQL 文件导入任务流式执行');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return decodeQueryFile(Buffer.concat(chunks, length), encoding);
  } finally { await file.close(); }
}

/** 保存前验证编码往返，UTF-16LE 明确写 BOM，禁止孤立代理项被悄悄改成替代符。 */
export function encodeQueryFile(sql: string, encoding: QueryFileEncoding): Buffer {
  checkEncoding(encoding);
  if (sql.length > queryTextLimit) throw new Error('SQL 正文超过 2000 万字符，不能保存到编辑文件');
  if (sql.includes('\0')) throw new Error('SQL 正文包含 NUL 字符，不能保存为文本文件');
  const bytes = iconv.encode(sql, encoding);
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== sql) throw new Error('所选编码无法无损保存 SQL 正文');
  if (encoding !== 'gb18030') {
    try { new TextDecoder(encoding === 'utf8' ? 'utf-8' : 'utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new Error('SQL 正文包含非法 Unicode，无法无损保存'); }
  }
  const content = encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]) : bytes;
  if (content.length > queryFileLimit) throw new Error('SQL 文件超过 20 MiB，未写入文件');
  return content;
}

/** 同目录临时文件写完并同步后原子替换；失败不先删除原目标，始终清理临时文件。 */
export async function writeQueryFile(filePath: string, sql: string, encoding: QueryFileEncoding): Promise<void> {
  const bytes = encodeQueryFile(sql, encoding);
  const temporary = `${filePath}.dbark-${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await file.write(bytes, offset, Math.min(64 * 1024, bytes.length - offset));
      if (!bytesWritten) throw new Error('SQL 文件写入未取得进展，原目标未替换');
      offset += bytesWritten;
    }
    await file.sync(); await file.close();
    await rename(temporary, filePath);
  } finally {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
