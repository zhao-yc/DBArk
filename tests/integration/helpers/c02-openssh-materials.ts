import { randomBytes, createHash } from 'node:crypto';
import { utils } from 'ssh2';
import { lstat, realpath, open, mkdir, writeFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { c02Failure } from './c02-mtls-policy';
import { c02OpenSshCheck as check, c02OpenSshManifest, c02OpenSshPurpose, type C02OpenSshManifest as Manifest } from './c02-openssh-policy';

export interface C02OpenSshMaterials { manifest: Manifest; hostPrivate: string; clientPrivate: string; password: string; passphrase: string; }
const names = ['manifest.json', 'host.key', 'client.key', 'ssh-password', 'key-passphrase', 'server-proof.json'] as const;

/** 只生成本片内存身份；现代OpenSSH格式、bcrypt及AES真实加密，不读任何现有文件。 */
export function generateC02OpenSshMaterials(port: number): C02OpenSshMaterials {
  check(Number.isInteger(port) && port >= 20000 && port <= 29999, 'C02必须由ROOT核空闲后明确选择专用端口');
  try {
    const run = randomBytes(16).toString('hex'), password = randomBytes(36).toString('base64url'), passphrase = randomBytes(36).toString('base64url');
    const host = utils.generateKeyPairSync('ed25519', { comment: 'dbark-c02-host' });
    const client = utils.generateKeyPairSync('ed25519', { comment: 'dbark-c02-client', passphrase, cipher: 'aes256-ctr', rounds: 16 });
    const parsed = utils.parseKey(host.private); check(!(parsed instanceof Error) && !Array.isArray(parsed), 'C02临时主机公钥解析失败');
    const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
    return { manifest: c02OpenSshManifest({ purpose: c02OpenSshPurpose, run, user: `c02_${run.slice(0, 12)}`, port, fingerprint, clientPublic: client.public.trim() }), hostPrivate: host.private, clientPrivate: client.private, password, passphrase };
  } catch (error) { throw c02Failure('C02新测试密钥生成失败', error); }
}

/** 文件始终以无跟随方式打开并复核BigInt对象身份；读取只限本片固定文件名。 */
async function ownedRead(directory: string, name: typeof names[number]): Promise<Buffer> {
  const path = join(directory, name), initial = await lstat(path, { bigint: true }); check(initial.isFile() && !initial.isSymbolicLink(), 'C02材料必须为自有普通文件');
  if (process.platform !== 'win32') check((initial.mode & 0o077n) === 0n && initial.uid === BigInt(process.getuid!()), 'C02材料必须当前用户独占0600');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const actual = await file.stat({ bigint: true }); check(actual.dev === initial.dev && actual.ino === initial.ino && actual.isFile() && actual.size <= 65536n, 'C02材料文件身份变化或超预算'); return await file.readFile(); }
  finally { await file.close(); }
}

/** 真实入口仅由ROOT显式准备；纯检查也只写本例新目录并在检查后逐文件归还。 */
export async function writeC02OpenSshMaterials(parent: string, value: C02OpenSshMaterials): Promise<string> {
  check(isAbsolute(parent), 'C02必须明确指定新临时父目录绝对路径');
  c02OpenSshManifest(value.manifest); const actualParent = await realpath(parent), directory = join(actualParent, `dbark-c02-openssh-${value.manifest.run}`);
  check(!/(^|[\\/])\.ssh([\\/]|$)/i.test(actualParent), 'C02新材料不能放入既有SSH身份目录');
  const info = await lstat(actualParent); check(info.isDirectory() && !info.isSymbolicLink(), 'C02临时父目录不是普通目录');
  await mkdir(directory, { mode: 0o700 });
  // wx拒绝覆盖同名材料；失败保留精确随机目录供ROOT核对，不尝试清理归属未知内容。
  for (const [name, content] of [['manifest.json', JSON.stringify(value.manifest)], ['host.key', value.hostPrivate], ['client.key', value.clientPrivate], ['ssh-password', value.password], ['key-passphrase', value.passphrase]] as const) await writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 });
  return directory;
}

/** 客户端只消费本片加密身份；不接收任意key路径，也不读取主机私钥内容。 */
export async function readC02OpenSshMaterials(directory: string): Promise<{ manifest: Manifest; keyPath: string; password: string; passphrase: string }> {
  const expected = resolve(directory), initial = await lstat(expected, { bigint: true }), actual = await realpath(expected);
  check(initial.isDirectory() && !initial.isSymbolicLink() && actual === expected && /^dbark-c02-openssh-[a-f0-9]{32}$/.test(basename(actual)), 'C02材料目录不是本片规范独占目录');
  if (process.platform !== 'win32') check((initial.mode & 0o077n) === 0n && initial.uid === BigInt(process.getuid!()), 'C02材料目录必须当前用户独占0700');
  const manifest = c02OpenSshManifest(JSON.parse((await ownedRead(actual, 'manifest.json')).toString('utf8')));
  check(basename(actual) === `dbark-c02-openssh-${manifest.run}`, 'C02材料目录令牌不匹配');
  const password = (await ownedRead(actual, 'ssh-password')).toString('utf8'), passphrase = (await ownedRead(actual, 'key-passphrase')).toString('utf8'), key = await ownedRead(actual, 'client.key');
  check([password, passphrase].every(value => /^[A-Za-z0-9_-]{48}$/.test(value)), 'C02秘密材料格式无效');
  const good = utils.parseKey(key, passphrase), absent = utils.parseKey(key), wrong = utils.parseKey(key, passphrase + '-wrong');
  check(!(good instanceof Error) && !Array.isArray(good) && good.isPrivateKey() && absent instanceof Error && wrong instanceof Error && good.getPublicSSH().equals(Buffer.from(manifest.clientPublic.split(' ')[1], 'base64')), 'C02必须使用真实加密且公钥匹配的本片私钥');
  const after = await lstat(actual, { bigint: true }); check(after.dev === initial.dev && after.ino === initial.ino && dirname(join(actual, 'client.key')) === actual, 'C02材料目录身份变化');
  return { manifest, keyPath: join(actual, 'client.key'), password, passphrase };
}

/** 无跟随读取本片公开核对记录，错误原文不能把被替换的文件内容带入报告。 */
export async function readC02OpenSshProofRecord(directory: string): Promise<unknown> {
  try { const bytes = await ownedRead(directory, 'server-proof.json'); check(bytes.length <= 16384, 'C02核对记录超预算'); return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw c02Failure('C02本轮核对记录读取失败', error); }
}

/** 仅由ROOT确认容器及客户端全部结束后调用；遇到任何额外文件/替换均保留，不递归删除。 */
export async function removeC02OpenSshMaterials(directory: string, expectedRun: string): Promise<void> {
  const value = await readC02OpenSshMaterials(directory); check(value.manifest.run === expectedRun, 'C02拒绝删除其它轮次材料');
  const entries = await readdir(directory), initial = await lstat(directory, { bigint: true });
  check(entries.every(name => (names as readonly string[]).includes(name)) && names.filter(name => name !== 'server-proof.json').every(name => entries.includes(name)), 'C02材料目录有额外内容或缺少材料，保留待核对');
  if (entries.includes('server-proof.json')) { const proof = await readC02OpenSshProofRecord(directory) as { purpose?: string; run?: string }; check(proof.purpose === c02OpenSshPurpose && proof.run === expectedRun, 'C02核对记录归属不匹配，拒绝删除'); }
  for (const name of names) {
    if (!entries.includes(name)) continue;
    const actual = await lstat(directory, { bigint: true }); check(actual.isDirectory() && !actual.isSymbolicLink() && actual.dev === initial.dev && actual.ino === initial.ino && await realpath(directory) === resolve(directory), 'C02材料目录替换，拒绝删除');
    await ownedRead(directory, name); await unlink(join(directory, name));
  }
  await rmdir(directory);
}
