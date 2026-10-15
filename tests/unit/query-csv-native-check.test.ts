import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, rmdir, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { checkWindowsQueryCsvZip, queryCsvNativeGate, queryCsvNativeLimits } from '../helpers/queryCsvZip';

// 本文件全部外部命令均为端口故障注入，不运行系统tar，不将这些断言作为原生解包通过证据。
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
const directories: string[] = [];
beforeEach(() => { mocks.execFile.mockReset(); vi.stubEnv('DBARK_QUERY_CSV_NATIVE_ARCHIVE_CHECK', '0'); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const path of directories.splice(0)) { for (const name of await readdir(path)) await rm(join(path, name)); await rmdir(path); } });
/** 这里只准备lstat输入；条目已验证状态和系统命令输出由下方端口模拟，绝不声称是真实tar结果。 */
async function sample() { const directory = await mkdtemp(join(tmpdir(), 'dbark-native-zip-')); directories.push(directory); const path = join(directory, '样本 ; &.zip'); await writeFile(path, '受控小样本'); const entries = new Map([['results/rows-001.csv', Buffer.from('值\r\n\0字节\r\n')], ['manifest.json', Buffer.from('{"version":1}\n')]]); return { path, entries }; }
/** 模拟命令只向回调交付固定字节，确认调用方式与脱敏错误路径；没有子进程被启动。 */
function succeed(entries: Map<string, Buffer>) { mocks.execFile.mockImplementation((_exe, args, _options, callback) => { const output = args[0] === '-tf' ? Buffer.from([...entries.keys()].join('\r\n') + '\r\n') : entries.get(args.at(-1)); callback(null, output ?? Buffer.alloc(0), Buffer.alloc(0)); }); }

describe('Windows原生ZIP检查的双门槛', () => {
  it.each([undefined, '', '0', 'true'])('开关%j不启动程序且不读取无效路径', async optIn => { if (optIn === undefined) delete process.env.DBARK_QUERY_CSV_NATIVE_ARCHIVE_CHECK; else vi.stubEnv('DBARK_QUERY_CSV_NATIVE_ARCHIVE_CHECK', optIn); expect(await checkWindowsQueryCsvZip('不存在的文件', new Map())).toEqual({ status: 'skipped', reason: 'disabled' }); expect(mocks.execFile).not.toHaveBeenCalled(); });
  it('显式开关与win32必须同时满足，不能由普通实库开关间接开启', () => { expect(queryCsvNativeGate('win32', '1')).toBe('enabled'); expect(queryCsvNativeGate('linux', '1')).toBe('platform'); expect(queryCsvNativeGate('darwin', '1')).toBe('platform'); expect(queryCsvNativeGate('win32', undefined)).toBe('disabled'); });
});

describe.skipIf(process.platform !== 'win32')('原生命令控制流程（全部execFile模拟）', () => {
  beforeEach(() => { vi.stubEnv('DBARK_QUERY_CSV_NATIVE_ARCHIVE_CHECK', '1'); vi.stubEnv('SystemRoot', 'C:\\Windows'); });
  it('固定系统exe及参数数组列目录、逐entry输出并比对字节/CRC，不使用shell或落盘展开', async () => {
    const { path, entries } = await sample(); succeed(entries); const result = await checkWindowsQueryCsvZip(path, entries);
    expect(result).toEqual({ status: 'verified', entries: 2, bytes: [...entries.values()].reduce((sum, value) => sum + value.length, 0) });
    expect(mocks.execFile.mock.calls.map(call => call[1])).toEqual([['-tf', resolve(path)], ['-xOf', resolve(path), '--', 'results/rows-001.csv'], ['-xOf', resolve(path), '--', 'manifest.json']]);
    for (const [executable, , options] of mocks.execFile.mock.calls) { expect(executable).toBe(win32.resolve('C:\\Windows', 'System32', 'tar.exe')); expect(options).toMatchObject({ shell: false, windowsHide: true, encoding: 'buffer', timeout: 5000 }); expect(options.maxBuffer).toBeLessThanOrEqual(queryCsvNativeLimits.entryBytes + 1); }
    expect((console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join('')).not.toContain('字节\r\n'); expect(await readdir(directories.at(-1)!)).toEqual(['样本 ; &.zip']);
  });
  it.each(['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])('系统tar失败%s明确未通过，不泄露stdout/stderr或伪造成功', async code => {
    const { path, entries } = await sample(); mocks.execFile.mockImplementation((_exe, _args, _options, callback) => callback(Object.assign(Error('原始秘密'), { code }), Buffer.from('用户结果秘密'), Buffer.from('用户路径秘密')));
    const error = await checkWindowsQueryCsvZip(path, entries).catch(error => error); expect(error.message).toContain(code); expect(error.message).toContain('未通过'); expect(error.message).not.toContain('秘密'); expect(console.log).not.toHaveBeenCalled();
  });
  it.each(['listing', 'bytes', 'warning'])('目录/字节/警告异常%s不得通过', async fault => {
    const { path, entries } = await sample(); succeed(entries); const success = mocks.execFile.getMockImplementation()!;
    mocks.execFile.mockImplementation((exe, args, options, callback) => { if (fault === 'listing' && args[0] === '-tf') callback(null, Buffer.from('manifest.json\n'), Buffer.alloc(0)); else if (fault === 'bytes' && args[0] === '-xOf') callback(null, Buffer.from('错误字节'), Buffer.alloc(0)); else if (fault === 'warning') callback(null, Buffer.alloc(0), Buffer.from('包含结果的原始警告')); else success(exe, args, options, callback); });
    await expect(checkWindowsQueryCsvZip(path, entries)).rejects.toThrow(); expect(console.log).not.toHaveBeenCalled();
  });
  it('危险名、无效序号与超过预算在启动程序前拒绝', async () => {
    const { path, entries } = await sample();
    for (const name of ['../escape', 'results/rows-000.csv', 'results/rows-201.csv', '/manifest.json', 'results\\rows-001.csv']) await expect(checkWindowsQueryCsvZip(path, new Map([...entries, [name, Buffer.from('x')]]))).rejects.toThrow('安全entry');
    await expect(checkWindowsQueryCsvZip(path, new Map([['manifest.json', Buffer.alloc(queryCsvNativeLimits.entryBytes + 1)]]))).rejects.toThrow('单entry');
    const large = Buffer.alloc(queryCsvNativeLimits.entryBytes); await expect(checkWindowsQueryCsvZip(path, new Map([['manifest.json', Buffer.from('x')], ['results/rows-001.csv', large], ['results/rows-002.csv', large]]))).rejects.toThrow('总16MiB');
    await truncate(path, queryCsvNativeLimits.archiveBytes + 1); await expect(checkWindowsQueryCsvZip(path, entries)).rejects.toThrow('16MiB'); expect(mocks.execFile).not.toHaveBeenCalled();
  });
  it('缺失SystemRoot不回退PATH查找其它tar', async () => { const { path, entries } = await sample(); delete process.env.SystemRoot; await expect(checkWindowsQueryCsvZip(path, entries)).rejects.toThrow('未验'); expect(mocks.execFile).not.toHaveBeenCalled(); });
});
