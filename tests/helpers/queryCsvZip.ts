import { lstat, readFile, stat } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { execFile } from 'node:child_process';
import { resolve, win32 } from 'node:path';

/** 原生解包只用于显式开启的小样本验收，不是产品依赖或大文件验收器。 */
export const queryCsvNativeLimits = { archiveBytes: 16 * 1024 * 1024, entryBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, entries: 201 } as const;
export type QueryCsvNativeCheck = { status: 'skipped'; reason: 'disabled' | 'platform' } | { status: 'verified'; entries: number; bytes: number };
/** 平台与显式开关必须同时满足；默认不定位或启动任何外部程序。 */
export function queryCsvNativeGate(platform: NodeJS.Platform, optIn: string | undefined): 'enabled' | 'disabled' | 'platform' { return optIn !== '1' ? 'disabled' : platform !== 'win32' ? 'platform' : 'enabled'; }

/** 系统tar以参数数组启动，不经shell；stdout只在内存比对，任何失败不透传归档内容或原始stderr。 */
async function queryCsvNativeTar(executable: string, args: string[], maxBuffer: number): Promise<Buffer> {
  return new Promise((done, fail) => {
    execFile(executable, args, { encoding: 'buffer', shell: false, windowsHide: true, timeout: 5000, maxBuffer }, (error, stdout, stderr) => {
      if (error || stderr.length) {
        const code = error?.code, safe = typeof code === 'number' ? String(code) : typeof code === 'string' && ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(code) ? code : '执行失败';
        fail(new Error(`Windows系统tar不可用或解包失败（${safe}），原生小样本校验未通过`)); return;
      }
      done(stdout);
    });
  });
}

/** 对已经独立ZIP/CRC解码的小包列出真实entry，再逐文件标准解包到stdout做字节与CRC比对。 */
export async function checkWindowsQueryCsvZip(path: string, verified: ReadonlyMap<string, Buffer>): Promise<QueryCsvNativeCheck> {
  const gate = queryCsvNativeGate(process.platform, process.env.DBARK_QUERY_CSV_NATIVE_ARCHIVE_CHECK);
  if (gate !== 'enabled') return { status: 'skipped', reason: gate };
  const status = await lstat(path), names = [...verified.keys()];
  if (!status.isFile() || status.isSymbolicLink() || status.size > queryCsvNativeLimits.archiveBytes || !names.length || names.length > queryCsvNativeLimits.entries || !verified.has('manifest.json')) throw new Error('Windows原生ZIP校验仅接受普通文件和16MiB以内的小样本');
  let total = 0;
  for (const [name, bytes] of verified) {
    if (name !== 'manifest.json' && !/^results\/rows-(?:00[1-9]|0[1-9]\d|1\d{2}|200)\.csv$/.test(name)) throw new Error('Windows原生ZIP校验拒绝非固定安全entry名');
    total += bytes.length; if (bytes.length > queryCsvNativeLimits.entryBytes || total > queryCsvNativeLimits.totalBytes) throw new Error('Windows原生ZIP校验超过单entry8MiB或总16MiB小样本上限');
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[A-Za-z]:[\\/]/.test(systemRoot) || !win32.isAbsolute(systemRoot) || systemRoot.includes('\0')) throw new Error('SystemRoot无效，无法定位固定系统tar，原生小样本未验');
  const executable = win32.resolve(systemRoot, 'System32', 'tar.exe'), archive = resolve(path);
  const listing = (await queryCsvNativeTar(executable, ['-tf', archive], 64 * 1024)).toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  if (listing.length !== names.length || listing.some((name, index) => name !== names[index])) throw new Error('Windows原生tar目录与已验证固定entry清单不一致');
  for (const [name, bytes] of verified) {
    const actual = await queryCsvNativeTar(executable, ['-xOf', archive, '--', name], Math.max(64 * 1024, bytes.length + 1));
    if (!actual.equals(bytes) || crc32(actual) !== crc32(bytes)) throw new Error('Windows原生tar解包字节或CRC与独立ZIP核对不一致');
  }
  // 仅打印核对摘要，不打印目标路径、entry内容或用户结果值。
  console.log(JSON.stringify({ 验收说明: 'Windows系统tar小型ZIP独立解包', 条目数: names.length, 解包字节数: total, 结果: '通过' }));
  return { status: 'verified', entries: names.length, bytes: total };
}

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
export async function readQueryCsvZip(path: string): Promise<Map<string, Buffer>> { if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error('小型ZIP验收读取上限64MiB'); const bytes = await readFile(path); if (bytes.length > 64 * 1024 * 1024) throw new Error('小型ZIP验收读取上限64MiB'); const entries = decodeQueryCsvZip(bytes); await checkWindowsQueryCsvZip(path, entries); return entries; }
