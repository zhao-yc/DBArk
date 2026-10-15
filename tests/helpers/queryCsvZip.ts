import { readFile, stat } from 'node:fs/promises';
import { crc32 } from 'node:zlib';

/** 小型验收文件用独立ZIP64目录解码与Node原生CRC核对，不调用产品ZIP写入代码。 */
export function decodeQueryCsvZip(bytes: Buffer): Map<string, Buffer> {
  const fail = () => { throw new Error('验收ZIP64结构、大小或CRC无效'); };
  const count64 = (at: number) => { const value = bytes.readBigUInt64LE(at); if (value > BigInt(Number.MAX_SAFE_INTEGER)) return fail(); return Number(value); };
  const eocd = bytes.length - 22, locator = eocd - 20;
  if (locator < 0 || bytes.readUInt32LE(eocd) !== 0x06054b50 || bytes.readUInt32LE(locator) !== 0x07064b50) fail();
  const end = count64(locator + 8); if (end + 56 !== locator || bytes.readUInt32LE(end) !== 0x06064b50) fail();
  const count = count64(end + 32), size = count64(end + 40), offset = count64(end + 48); if (count > 201 || offset + size !== end) fail();
  const entries = new Map<string, Buffer>(); let cursor = offset;
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50 || bytes.readUInt16LE(cursor + 10) !== 0 || bytes.readUInt16LE(cursor + 8) !== 0x0808) fail();
    const crc = bytes.readUInt32LE(cursor + 16), nameBytes = bytes.readUInt16LE(cursor + 28), extraBytes = bytes.readUInt16LE(cursor + 30), commentBytes = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameBytes).toString('utf8'), extra = cursor + 46 + nameBytes;
    if (extraBytes !== 28 || bytes.readUInt16LE(extra) !== 1 || bytes.readUInt16LE(extra + 2) !== 24 || entries.has(name) || !/^(manifest\.json|results\/rows-\d{3}\.csv)$/.test(name)) fail();
    const length = count64(extra + 4), compressed = count64(extra + 12), local = count64(extra + 20);
    if (length !== compressed || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== 0) fail();
    const localNameBytes = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), dataAt = local + 30 + localNameBytes + localExtra;
    if (bytes.subarray(local + 30, local + 30 + localNameBytes).toString('utf8') !== name || dataAt + length + 24 > offset) fail();
    const data = bytes.subarray(dataAt, dataAt + length), descriptor = dataAt + length;
    if (crc32(data) !== crc || bytes.readUInt32LE(descriptor) !== 0x08074b50 || bytes.readUInt32LE(descriptor + 4) !== crc || count64(descriptor + 8) !== length || count64(descriptor + 16) !== length) fail();
    entries.set(name, data); cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  if (cursor !== end || !entries.has('manifest.json')) fail(); return entries;
}
/** 只对小型实库和GUI样本整体读取；大规模验收必须另外流式解析CSV，避免测试制造内存替代品。 */
export async function readQueryCsvZip(path: string): Promise<Map<string, Buffer>> { if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error('小型ZIP验收读取上限64MiB'); const bytes = await readFile(path); if (bytes.length > 64 * 1024 * 1024) throw new Error('小型ZIP验收读取上限64MiB'); return decodeQueryCsvZip(bytes); }
