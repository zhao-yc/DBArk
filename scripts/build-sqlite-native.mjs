import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sqliteNativeSource = join(root, 'src/engine/sqlite/nativeRows.c');
export const sqliteNativeHeaders = Object.freeze({
  'sqlite3.h': '8e43a79982422f4720685f62839718f0e41410c1b71355aa32af3615ccd9e31d',
  'sqlite3ext.h': 'ac9645e5c9ff0cf176efdd6e75cb5e98f46295d38e02db5c4d208826a39ab4be',
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** 固定公共SDK逐字节校验；临时文件写完才发布，不把半份下载交给其它构建。 */
export async function prepareSqliteNativeSdk() {
  const directory = join(root, '.cache/sqlite-raw-sdk-node24.17.0'); mkdirSync(directory, { recursive: true });
  for (const [name, hash] of Object.entries(sqliteNativeHeaders)) {
    const target = join(directory, name);
    if (!existsSync(target)) {
      const response = await fetch('https://raw.githubusercontent.com/nodejs/node/v24.17.0/deps/sqlite/' + name, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error('SQLite公共SDK下载失败');
      const bytes = Buffer.from(await response.arrayBuffer()); if (digest(bytes) !== hash) throw Error('SQLite公共SDK摘要不符');
      const temporary = join(mkdtempSync(join(directory, 'download-')), name); writeFileSync(temporary, bytes); renameSync(temporary, target);
    }
    if (digest(readFileSync(target)) !== hash) throw Error('SQLite公共SDK缓存摘要不符');
  }
  return directory;
}

/** Windows编译器仅放项目忽略目录；固定版本与官方ZIP摘要，不安装到系统或读取CC注入。 */
async function compiler() {
  if (process.platform !== 'win32') return { executable: 'cc', prefix: [] };
  if (process.arch !== 'x64') throw Error('当前Windows原生构建仅支持x64');
  const directory = join(root, '.tools/zig'), executable = join(directory, 'zig-x86_64-windows-0.15.2/zig.exe');
  if (!existsSync(executable)) {
    mkdirSync(directory, { recursive: true }); const archive = join(directory, 'archive.zip');
    if (!existsSync(archive)) {
      const response = await fetch('https://ziglang.org/download/0.15.2/zig-x86_64-windows-0.15.2.zip', { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error('SQLite原生编译器下载失败'); writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    if (digest(readFileSync(archive)) !== '3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c') throw Error('SQLite原生编译器官方摘要不符');
    const script = join(mkdtempSync(join(directory, 'extract-')), 'extract.ps1');
    writeFileSync(script, 'param([string]$Archive,[string]$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n');
    const install = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Archive', archive, '-Destination', directory], { shell: false, windowsHide: true, encoding: 'utf8' });
    if (install.error || install.status !== 0) throw Error('SQLite原生编译器解包未完成');
  }
  return { executable, prefix: ['cc'] };
}

/** 只编译自研C源码，不链接另一个SQLite；macOS产物同时包含两架构并保持开发签名。 */
export async function compileSqliteNative(output) {
  const sdk = await prepareSqliteNativeSdk(), cc = await compiler();
  const args = [...cc.prefix, process.platform === 'darwin' ? '-dynamiclib' : '-shared', ...(process.platform === 'win32' ? [] : ['-fPIC']), ...(process.platform === 'darwin' ? ['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0'] : []), '-O2', '-Wall', '-Wextra', '-Werror', '-I', sdk, sqliteNativeSource, '-o', output];
  const cache = join(root, '.cache'); mkdirSync(dirname(output), { recursive: true });
  const result = spawnSync(cc.executable, args, { cwd: dirname(output), shell: false, windowsHide: true, encoding: 'utf8', env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(cache, 'zig-global'), ZIG_LOCAL_CACHE_DIR: join(cache, 'zig-local') } });
  const record = { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  writeFileSync(join(dirname(output), 'compile.json'), JSON.stringify(record, null, 2));
  if (result.error || result.status !== 0 || result.signal) throw Error('SQLite自研原生模块编译失败，原记录保留');
  if (process.platform === 'darwin') {
    const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', output], { shell: false, windowsHide: true, encoding: 'utf8' });
    if (signed.error || signed.status !== 0 || signed.signal) throw Error('SQLite开发原生模块签名失败');
  }
  return record;
}

/** 内容寻址文件避免覆盖仍被旧worker加载的库；只替换本构建拥有的固定清单。 */
export async function buildSqliteNative(outputDirectory) {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) throw Error('当前平台尚无SQLite原生构建');
  const cache = join(root, '.cache/sqlite-native-build'); mkdirSync(cache, { recursive: true });
  const sourceHash = digest(readFileSync(sqliteNativeSource)), builderHash = digest(readFileSync(fileURLToPath(import.meta.url))), key = digest(Buffer.from(JSON.stringify({ sourceHash, builderHash, platform: process.platform, arch: process.platform === 'darwin' ? 'universal' : process.arch, headers: sqliteNativeHeaders }))), pointer = join(cache, key + '.json');
  let artifact;
  if (existsSync(pointer)) {
    artifact = JSON.parse(readFileSync(pointer, 'utf8')); const file = join(cache, artifact.directory, artifact.manifest.file);
    if (digest(readFileSync(file)) !== artifact.manifest.sha256) throw Error('SQLite原生构建缓存损坏，保留现场');
  } else {
    const directory = mkdtempSync(join(cache, 'compile-')), extension = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so', raw = join(directory, 'native.' + extension);
    await compileSqliteNative(raw); const bytes = readFileSync(raw), sha256 = digest(bytes), file = 'dbark-sqlite-' + sha256 + '.' + extension;
    copyFileSync(raw, join(directory, file));
    artifact = { directory: basename(directory), manifest: { version: 1, platform: process.platform, architectures: process.platform === 'darwin' ? ['arm64', 'x64'] : [process.arch], file, bytes: bytes.length, sha256, sourceHash } };
    const temporary = join(directory, 'cache.json'); writeFileSync(temporary, JSON.stringify(artifact)); renameSync(temporary, pointer);
  }
  mkdirSync(outputDirectory, { recursive: true }); const manifest = artifact.manifest;
  const target = join(outputDirectory, manifest.file);
  // 同名就是同内容；禁止覆盖Windows仍映射的DLL，损坏文件也不得静默修复。
  if (existsSync(target)) {
    if (digest(readFileSync(target)) !== manifest.sha256) throw Error('SQLite目标原生资源损坏，保留现场');
  } else copyFileSync(join(cache, artifact.directory, manifest.file), target);
  const temporary = join(mkdtempSync(join(outputDirectory, 'manifest-')), 'manifest.json'); writeFileSync(temporary, JSON.stringify(manifest)); renameSync(temporary, join(outputDirectory, 'manifest.json'));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('SQLite原生构建不接受额外参数');
  await buildSqliteNative(join(root, 'src/engine/sqlite/sqlite-native'));
  await buildSqliteNative(join(root, 'dist/main/sqlite-native'));
  console.log('SQLite固定原生资源已构建并核摘要');
}
