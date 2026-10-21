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
[Console]::Out.WriteLine('DBARK_COMPILE_SIGNATURE_BEGIN')
$signaturePath=Join-Path $PSHOME 'powershell.exe'
[Console]::Out.WriteLine('DBARK_COMPILE_SIGNATURE_PATH_READY')
[Console]::Out.WriteLine('DBARK_COMPILE_SIGNATURE_CALL_BEGIN')
$signature=Get-AuthenticodeSignature -LiteralPath $signaturePath
[Console]::Out.WriteLine('DBARK_COMPILE_SIGNATURE_CALL_RETURN')
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft*'){throw 'system-powershell-signature'}
[Console]::Out.WriteLine('DBARK_COMPILE_SIGNATURE_ACCEPTED')
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$encoding=New-Object Text.UTF8Encoding($false,$true)
[Console]::Out.WriteLine('DBARK_COMPILE_ENCODING_READY')
[Console]::Out.WriteLine('DBARK_COMPILE_SOURCE_READ_BEGIN')
$reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),$encoding,$false,4096,$true)
$source=$reader.ReadToEnd()
[Console]::Out.WriteLine('DBARK_COMPILE_ADD_TYPE_BEGIN')
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll' -ErrorAction Stop | Out-Null
[Console]::Out.WriteLine('DBARK_BACKUP_HELPER_COMPILED_WITHOUT_RUN')
`;
const startedAt = process.hrtime.bigint();
const child = spawn(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
  cwd: project, windowsHide: true, env: { SystemRoot: systemRoot, WINDIR: systemRoot, TEMP: directory, TMP: directory }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
});
let processErrorCode, stdinErrorCode;
let stdinFinishedAtMs, stdinClosedAtMs;
// 只记录原stdin事件的单调相对时间；close不冒充源码已经被子进程读取。
const elapsedMs = () => Number((process.hrtime.bigint() - startedAt) / 1000000n);
let stdout = '', stderr = '', failed = false, stdinClosed = false, stdoutClosed = false, stderrClosed = false;
child.on('error', error => { failed = true; processErrorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN'; });
child.stdin.on('error', error => { failed = true; stdinErrorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'UNKNOWN'; });
child.stdin.once('finish', () => { stdinFinishedAtMs = elapsedMs(); });
child.stdin.on('close', () => { stdinClosed = true; stdinClosedAtMs ??= elapsedMs(); });
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
// 固定阶段只定位编译停在哪里；不改变原60秒、签名验证、成功标记和真实三流关闭门。
const expectedLines = ['DBARK_COMPILE_SIGNATURE_BEGIN', 'DBARK_COMPILE_SIGNATURE_PATH_READY', 'DBARK_COMPILE_SIGNATURE_CALL_BEGIN', 'DBARK_COMPILE_SIGNATURE_CALL_RETURN', 'DBARK_COMPILE_SIGNATURE_ACCEPTED', 'DBARK_COMPILE_ENCODING_READY', 'DBARK_COMPILE_SOURCE_READ_BEGIN', 'DBARK_COMPILE_ADD_TYPE_BEGIN', 'DBARK_BACKUP_HELPER_COMPILED_WITHOUT_RUN'];
const actualLines = stdout.trim().split(/\r?\n/);
if (terminal.code !== 0 || terminal.signal !== null || failed || !stdinClosed || !stdoutClosed || !stderrClosed || actualLines.join('\n') !== expectedLines.join('\n') || stderr) {
  let reached = 'not-started';
  for (let index = 0; index < expectedLines.length && actualLines[index] === expectedLines[index]; index++) reached = expectedLines[index];
  console.error('固定编译阶段及原资源状态：' + JSON.stringify({ reached, code: terminal.code, signal: terminal.signal, processErrorCode, stdinErrorCode, failed, stdinClosed, stdoutClosed, stderrClosed, sourceBytes: bytes.length, stdinFinishedAtMs, stdinClosedAtMs }));
  if (stderr) console.error(stderr);
  throw Error('Windows C#编译或原进程关闭未确认，保留本例临时目录：' + directory);
}
// 编译成功、原进程/三流关闭后才清理本例临时编译目录；失败不删除现场。
if (dirname(directory) !== parent || !basename(directory).startsWith('dbark-backup-helper-compile-') || (await lstat(directory)).isSymbolicLink()) throw Error('拒绝清理非本例编译目录');
await rm(directory, { recursive: true, force: false });
console.log('Windows x64固定C#资源编译通过；未运行helper协议，临时编译目录已清理。');
