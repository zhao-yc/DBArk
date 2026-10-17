import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') { console.log('此项仅验证 Windows C# 编译，当前平台跳过。'); process.exit(0); }
if (process.arch !== 'x64') throw Error('当前敏感文件helper仅支持Windows x64');
const project = fileURLToPath(new URL('../', import.meta.url));
const file = join(project, 'src/engine/databaseBackupWindowsFiles.helper.cs');
const info = await lstat(file);
if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 65536) throw Error('固定C#资源大小或类型不符');
const bytes = await readFile(file), typescript = await readFile(join(project, 'src/engine/databaseBackupWindowsFiles.ts'), 'utf8');
// 构建检查只提取固定声明，不执行TS源码，也不接受命令行自签摘要。
const declaration = typescript.match(/^export const databaseBackupWindowsFilesSource = Object\.freeze\(\{ name: 'databaseBackupWindowsFiles\.helper\.cs', sha256: '([a-f0-9]{64})', maxBytes: 65536 \}\);$/m);
if (!declaration || bytes.length !== info.size || createHash('sha256').update(bytes).digest('hex') !== declaration[1]) throw Error('C#资源与产品内嵌摘要不一致');
const parent = resolve(tmpdir()), directory = await mkdtemp(join(parent, 'dbark-backup-helper-compile-'));
const systemRoot = process.env.SystemRoot;
if (!systemRoot || !/^[A-Za-z]:\\Windows$/i.test(systemRoot)) throw Error('系统Windows目录未经确认');
// 编译同一份有界公开源码；不调用Program.Run或任何Win32文件协议，不读取认证信息。
const script = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not [Environment]::Is64BitProcess){throw 'x64-required'}
$signature=Get-AuthenticodeSignature -LiteralPath (Join-Path $PSHOME 'powershell.exe')
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft*'){throw 'system-powershell-signature'}
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$encoding=New-Object Text.UTF8Encoding($false,$true)
$reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),$encoding,$false,4096,$true)
$source=$reader.ReadToEnd()
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll' -ErrorAction Stop | Out-Null
[Console]::Out.WriteLine('DBARK_BACKUP_HELPER_COMPILED_WITHOUT_RUN')
`;
const child = spawn(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
  cwd: project, windowsHide: true, env: { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: directory, TMP: directory }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
});
let stdout = '', stderr = '', failed = false, stdinClosed = false, stdoutClosed = false, stderrClosed = false;
child.on('error', () => { failed = true; });
child.stdin.on('error', () => { failed = true; }); child.stdin.on('close', () => { stdinClosed = true; });
for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
  stream.on('error', () => { failed = true; });
  stream.on('close', () => { if (name === 'stdout') stdoutClosed = true; else stderrClosed = true; });
  stream.on('data', value => {
    // 只有自有公开编译源码的诊断，仍限制日志；不保留任意外部输入或真实秘密。
    if (name === 'stdout') { stdout += value.toString('utf8'); if (stdout.length > 65536) { stdout = stdout.slice(0, 65536); failed = true; } }
    else { stderr += value.toString('utf8'); if (stderr.length > 65536) { stderr = stderr.slice(0, 65536); failed = true; } }
  });
}
child.stdin.end(bytes);
const terminal = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
if (terminal.code !== 0 || terminal.signal !== null || failed || !stdinClosed || !stdoutClosed || !stderrClosed || stdout.trim() !== 'DBARK_BACKUP_HELPER_COMPILED_WITHOUT_RUN' || stderr) {
  if (stderr) console.error(stderr);
  throw Error('Windows C#编译或原进程关闭未确认，保留本例临时目录：' + directory);
}
// 编译成功、原进程/三流关闭后才清理本例临时编译目录；失败不删除现场。
if (dirname(directory) !== parent || !basename(directory).startsWith('dbark-backup-helper-compile-') || (await lstat(directory)).isSymbolicLink()) throw Error('拒绝清理非本例编译目录');
await rm(directory, { recursive: true, force: false });
console.log('Windows x64固定C#资源编译通过；未运行helper协议，临时编译目录已清理。');
