import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { q05IsolatedPorts, requireQ05IsolatedPort } from './q05-isolated-port.mjs';

const run = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache', 'q05-million-archive');
const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (['--preflight', '--self-check', '--run'].includes(key)) options.set(key, true);
  else if (['--config-env-file', '--port', '--expected-hostname', '--python'].includes(key) && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) options.set(key, process.argv[++index]);
  else throw new Error('未知或缺值参数；使用 --preflight、--self-check 或 --run');
}
if (['--preflight', '--self-check', '--run'].filter(key => options.has(key)).length > 1) throw new Error('一次只能选择一种模式');
let directory = '', secrets = [];
/** 凭据只留在进程环境；子进程的错误及输出在落盘和显示前一律脱敏。 */
function redact(value) { let text = String(value); for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[凭据已隐藏]').replaceAll(JSON.stringify(secret).slice(1, -1), '[凭据已隐藏]'); return text; }
/** 子进程始终使用参数数组和隐藏窗口，输出设预算，不经shell解释参数。 */
async function invoke(executable, args, extra = {}) { return run(executable, args, { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024, ...extra }); }
/** 只接受普通文件和明确的本地绝对路径，不扫描或猜测已有凭据位置。 */
async function regularAbsolute(path) { if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('必须提供本地绝对文件路径'); const status = await lstat(path); if (!status.isFile() || status.isSymbolicLink()) throw new Error('拒绝符号链接或非普通文件'); return realpath(path); }
/** 只有本克隆.cache下新建的目录可以写入；本入口不递归清理验收证据。 */
async function ownDirectory() {
  await mkdir(cache, { recursive: true });
  if ((await realpath(cache)).toLowerCase() !== cache.toLowerCase()) throw new Error('证据父目录不能通过链接跳出本克隆');
  return mkdtemp(join(cache, 'dbark-q05-million-'));
}

try {
  // 纯预检可显式核端口；真实入口在读取env文件前先拒绝业务端口或空目标。
  if (options.has('--run') || options.has('--port')) requireQ05IsolatedPort(options.get('--port'), options.get('--port'));
  const sha = (await invoke('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const sources = {};
  for (const path of ['src/engine/index.ts', 'src/engine/connection.ts', 'src/engine/queryCsvZip.ts', 'src/engine/queryStreamFile.ts', 'src/engine/atomicFile.ts', 'src/shared/queryStreamExport.ts']) sources[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  if (!options.has('--run') && !options.has('--self-check')) {
    const disk = await statfs(root, { bigint: true });
    console.log(JSON.stringify({ 模式: '只读安全预检', 当前提交: sha, 默认关闭: true, 已读凭据: false, 已执行SSH: false, 已连接数据库: false, 专用隔离端口: q05IsolatedPorts, 请求端口: options.get('--port') ?? null, 本地可用字节: String(disk.bavail * disk.bsize), 产品文件上限GiB: 10, 待写队列上限: '8行/1MiB', 源码指纹: sources }, null, 2));
  } else if (options.has('--self-check')) {
    const python = await regularAbsolute(options.get('--python'));
    await mkdir(cache, { recursive: true });
    if ((await realpath(cache)).toLowerCase() !== cache.toLowerCase()) throw new Error('自检目录不在本克隆内');
    const result = await invoke(python, ['-B', join(root, 'scripts', 'verify-q05-million-archive.py'), '--self-check-root', cache], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    console.log(result.stdout.trim());
  } else {
    if (process.env.DBARK_Q05_MILLION_ARCHIVE_ENABLED !== '1') throw new Error('真实执行必须同时提供 --run 和 DBARK_Q05_MILLION_ARCHIVE_ENABLED=1');
    const envPath = await regularAbsolute(options.get('--config-env-file')), python = await regularAbsolute(options.get('--python'));
    if ((await lstat(envPath)).size > 64 * 1024) throw new Error('本地env文件超过64KiB');
    const config = parseEnv(await readFile(envPath, 'utf8'));
    secrets = [config.DBARK_TEST_PASSWORD, config.DBARK_TEST_USER].filter(Boolean);
    const port = String(options.get('--port') ?? ''), hostname = String(options.get('--expected-hostname') ?? '');
    requireQ05IsolatedPort(port, config.DBARK_TEST_PORT);
    if (config.DBARK_TEST_HOST !== '192.168.31.200' || !config.DBARK_TEST_USER || config.DBARK_TEST_PASSWORD === undefined || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(hostname)) throw new Error('必须显式指定与已有env完全相符的200隔离端口、账号以及预期服务器主机名');
    if (config.DBARK_TEST_SSH === '1') throw new Error('此入口只验直连200指定端口，不自动使用另一条数据库SSH隧道');
    const disk = await statfs(root, { bigint: true });
    if (disk.bavail * disk.bsize < 12n * 1024n ** 3n) throw new Error('本地可用空间不足12GiB，保留10GiB产品上限及安全余量');
    directory = await ownDirectory();
    const owner = randomUUID(), database = `dbark_stream_${Date.now()}_${owner.replaceAll('-', '').slice(0, 8)}`;
    const marker = { owner, database, sha, sources, createdAt: new Date().toISOString(), localAvailableBytes: String(disk.bavail * disk.bsize) };
    await writeFile(join(directory, 'owner.json'), JSON.stringify(marker, null, 2), { flag: 'wx' });
    // 只读SSH先验身份和Docker数据卷所在文件系统空间；不执行任何Docker命令。
    const identity = await invoke('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'server-200', 'hostname; hostname -I; df -Pk /var/lib/docker'], { timeout: 20000 });
    const lines = identity.stdout.trim().split(/\r?\n/), actualHost = lines[0]?.trim(), addresses = lines[1]?.trim().split(/\s+/) ?? [];
    const freeKiB = lines.at(-1)?.trim().split(/\s+/)[3];
    await writeFile(join(directory, 'server-identity-observed.json'), redact(JSON.stringify({ owner, expectedHostname: hostname, actualHostname: actualHost, addresses, dockerFilesystemAvailableKiB: freeKiB, stderr: identity.stderr }, null, 2)), { flag: 'wx' });
    if (identity.stderr.trim() || actualHost !== hostname || !addresses.includes('192.168.31.200') || !/^\d+$/.test(freeKiB ?? '') || BigInt(freeKiB) < 2n * 1024n ** 2n) throw new Error('server-200身份、200地址或远程至少2GiB可用空间核验失败');
    await writeFile(join(directory, 'server-identity.json'), JSON.stringify({ owner, alias: 'server-200', hostname: actualHost, addresses, databaseHost: '192.168.31.200', port: Number(port), dockerFilesystemAvailableKiB: freeKiB, checkedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
    const manualConfig = join(directory, 'manual-vitest.config.mjs');
    await writeFile(manualConfig, "export default {test:{include:['tests/manual/query-csv-million.manual.ts'],environment:'node',fileParallelism:false,maxWorkers:1,testTimeout:900000,hookTimeout:120000}};\n", { flag: 'wx' });
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) if (key.startsWith('DBARK_TEST_') || key.startsWith('DBARK_Q05_')) delete childEnv[key];
    for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_TLS', 'DBARK_TEST_CA']) if (config[key] !== undefined) childEnv[key] = config[key];
    Object.assign(childEnv, { DBARK_Q05_MILLION_ARCHIVE_ENABLED: '1', DBARK_Q05_MANUAL_DIRECTORY: directory, DBARK_Q05_MANUAL_OWNER: owner, DBARK_Q05_IDENTITY_CHECKED: owner, DBARK_Q05_PYTHON: python });
    const result = await invoke(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', manualConfig, '--maxWorkers=1'], { env: childEnv });
    await writeFile(join(directory, 'runner.log'), redact(result.stdout + result.stderr));
    console.log(redact(result.stdout.trim())); console.log('手动验收证据目录：' + directory);
  }
} catch (error) {
  // 原错误由手动夹具在evidence.json中保留结构；外层同时保留脱敏的原始子进程输出。
  if (directory) await writeFile(join(directory, 'runner-failure.log'), redact([error.stack, error.stdout, error.stderr].filter(Boolean).join('\n'))).catch(() => undefined);
  console.error(redact('验收入口失败：' + (error instanceof Error ? error.message : String(error))));
  if (directory) console.error('失败证据已保留：' + directory);
  process.exitCode = 1;
}
