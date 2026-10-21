import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const scriptSource = readFileSync('scripts/check-backup-windows-helper.mjs', 'utf8');
const helperBytes = readFileSync('src/engine/databaseBackupWindowsFiles.helper.cs');
const helperDeclaration = readFileSync('src/engine/databaseBackupWindowsFiles.ts', 'utf8');
// 独立列出正式协议顺序，不从产品expectedLines反推成功回包。
const labels = ['DBARK_COMPILE_SIGNATURE_BEGIN', 'DBARK_COMPILE_SIGNATURE_PATH_READY', 'DBARK_COMPILE_SIGNATURE_CALL_BEGIN', 'DBARK_COMPILE_SIGNATURE_CALL_RETURN', 'DBARK_COMPILE_SIGNATURE_ACCEPTED', 'DBARK_COMPILE_ENCODING_READY', 'DBARK_COMPILE_SOURCE_READ_BEGIN', 'DBARK_COMPILE_ADD_TYPE_BEGIN', 'DBARK_BACKUP_HELPER_COMPILED_WITHOUT_RUN'];
interface Outcome { lines?: string[]; code?: number | null; signal?: string | null; stderr?: string; unclosed?: 'stdin' | 'stdout' | 'stderr'; finish?: boolean; overflow?: boolean; }

/** 运行真实脚本及摘要声明；文件/进程/三流全由RAM端口承接，绝不启动PowerShell。 */
function fixture(outcome: Outcome = {}) {
  const removed = vi.fn(async () => {}), errors: string[] = [], logs: string[] = [];
  const stdin = new EventEmitter() as EventEmitter & { end(value: Buffer): void }, stdout = new EventEmitter(), stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr });
  let supplied: Buffer | undefined, clock = 0n;
  stdin.end = value => {
    supplied = value;
    // end之后排队，保证真实脚本已注册原child的close监听；不留未等待的定时器。
    queueMicrotask(() => {
      if (outcome.finish !== false) stdin.emit('finish');
      stdout.emit('data', Buffer.from((outcome.lines ?? labels).join('\r\n') + '\r\n'));
      if (outcome.overflow) stdout.emit('data', Buffer.alloc(65537, 65));
      if (outcome.stderr) stderr.emit('data', Buffer.from(outcome.stderr));
      for (const [name, stream] of [['stdin', stdin], ['stdout', stdout], ['stderr', stderr]] as const) if (outcome.unclosed !== name) stream.emit('close');
      child.emit('close', outcome.code === undefined ? 0 : outcome.code, outcome.signal ?? null);
    });
  };
  const spawn = vi.fn(() => child), metadata = { size: helperBytes.length, isFile: () => true, isSymbolicLink: () => false };
  const ports = {
    'node:crypto': { createHash }, 'node:child_process': { spawn },
    'node:fs/promises': { readFile: vi.fn(async (file: string) => file.endsWith('.helper.cs') ? helperBytes : helperDeclaration), lstat: vi.fn(async () => metadata), mkdtemp: vi.fn(async () => 'C:\\RAM\\tmp\\dbark-backup-helper-compile-owned'), rm: removed },
    'node:os': { tmpdir: () => 'C:\\RAM\\tmp' }, 'node:path': win32,
    'node:url': { fileURLToPath: () => 'C:\\RAM\\DBArk\\' },
  };
  const imports = /^import \{ ([^\r\n]+) \} from '(node:[^']+)';\r?$/gm;
  const executable = scriptSource.replace(imports, (_match, names: string, name: string) => `const { ${names} } = ports[${JSON.stringify(name)}];`).replaceAll('import.meta.url', JSON.stringify('file:///C:/RAM/DBArk/scripts/check-backup-windows-helper.mjs'));
  const run = () => runInNewContext('(async () => {\n' + executable + '\n})()', {
    ports, Buffer, URL,
    process: { platform: 'win32', arch: 'x64', env: { SystemRoot: 'C:\\Windows' }, hrtime: { bigint: () => { clock += 1000000n; return clock; } } },
    console: { error: (value: string) => errors.push(value), log: (value: string) => logs.push(value) },
  }) as Promise<void>;
  return { run, spawn, removed, errors, logs, supplied: () => supplied };
}

describe('Windows固定helper编译诊断（仅RAM，不执行PowerShell）', () => {
  it('真实脚本保留精确签名要求、源码读取和有序完整阶段，成功后才清理', async () => {
    const f = fixture(); await f.run();
    expect(f.spawn).toHaveBeenCalledOnce();
    const args = f.spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(args[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args[1].slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    const powershell = Buffer.from(args[1].at(-1)!, 'base64').toString('utf16le');
    expect(powershell).toContain("$signaturePath=Join-Path $PSHOME 'powershell.exe'");
    expect(powershell).toContain('$signature=Get-AuthenticodeSignature -LiteralPath $signaturePath');
    expect(powershell).toContain("if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft*'){throw 'system-powershell-signature'}");
    expect(powershell).toContain('$source=$reader.ReadToEnd()');
    expect(powershell).toContain("Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll' -ErrorAction Stop | Out-Null");
    expect(powershell).not.toContain('Program]::Run');
    expect([...powershell.matchAll(/\[Console\]::Out\.WriteLine\('([^']+)'\)/g)].map(match => match[1])).toEqual(labels);
    expect(args[2]).toEqual({ cwd: 'C:\\RAM\\DBArk\\', windowsHide: true, env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', TEMP: 'C:\\RAM\\tmp\\dbark-backup-helper-compile-owned', TMP: 'C:\\RAM\\tmp\\dbark-backup-helper-compile-owned' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    expect(f.supplied()).toEqual(helperBytes); expect(f.errors).toEqual([]);
    expect(f.removed).toHaveBeenCalledExactlyOnceWith('C:\\RAM\\tmp\\dbark-backup-helper-compile-owned', { recursive: true, force: false });
    expect(f.logs).toHaveLength(1);
  });

  it.each(labels)('缺失阶段%s时失败并保留目录', async missing => {
    const f = fixture({ lines: labels.filter(label => label !== missing) });
    await expect(f.run()).rejects.toThrow('保留本例临时目录'); expect(f.removed).not.toHaveBeenCalled();
  });

  it('阶段乱序或重复不能用最终成功标记代替完整验证', async () => {
    for (const lines of [[labels[1], labels[0], ...labels.slice(2)], [...labels, labels.at(-1)!]]) {
      const f = fixture({ lines }); await expect(f.run()).rejects.toThrow('保留本例临时目录'); expect(f.removed).not.toHaveBeenCalled();
    }
  });

  it('签名调用期间超时保留原SIGTERM、源长度和stdin相对事件，不清理', async () => {
    const f = fixture({ lines: labels.slice(0, 3), code: null, signal: 'SIGTERM' });
    await expect(f.run()).rejects.toThrow('保留本例临时目录'); expect(f.removed).not.toHaveBeenCalled();
    const diagnostic = JSON.parse(f.errors[0].slice(f.errors[0].indexOf('{')));
    expect(diagnostic).toMatchObject({ reached: 'DBARK_COMPILE_SIGNATURE_CALL_BEGIN', code: null, signal: 'SIGTERM', failed: false, stdinClosed: true, stdoutClosed: true, stderrClosed: true, sourceBytes: helperBytes.length, stdinFinishedAtMs: 1, stdinClosedAtMs: 2 });
    expect(f.errors[0]).not.toContain(helperBytes.toString('utf8'));
  });

  it.each(['stdin', 'stdout', 'stderr'] as const)('原%s未关闭时即使全部标记齐全也不清理', async unclosed => {
    const f = fixture({ unclosed }); await expect(f.run()).rejects.toThrow('保留本例临时目录'); expect(f.removed).not.toHaveBeenCalled();
  });

  it.each([{ code: 1 }, { stderr: '固定RAM错误' }, { overflow: true }])('退出失败、stderr或有界日志溢出均保留失败', async outcome => {
    const f = fixture(outcome); await expect(f.run()).rejects.toThrow('保留本例临时目录'); expect(f.removed).not.toHaveBeenCalled();
    expect(f.errors.join('\n').length).toBeLessThan(66000);
  });
});
