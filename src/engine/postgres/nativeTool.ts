import { spawn } from 'node:child_process';
import { constants, type BigIntStats } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute } from 'node:path';

type ToolKind = 'pg_dump' | 'pg_restore';
export interface PostgresNativeTool<T extends ToolKind = ToolKind> { path: string; kind: T; version: string }

function toolVersion(stat: BigIntStats) {
  if (!stat.isFile() || !stat.size) throw Error('请选择 PostgreSQL 安装中的普通可执行文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(':');
}

/** 系统选择器授权实际文件。记录文件身份，禁止选中后用另一个程序替换。 */
export async function inspectPostgresNativeTool<T extends ToolKind>(selected: string, kind: T): Promise<PostgresNativeTool<T>> {
  if (!isAbsolute(selected)) throw Error('请通过系统对话框选择 PostgreSQL 工具');
  const path = await realpath(selected);
  const name = process.platform === 'win32' ? kind + '.exe' : kind;
  if (basename(path).toLowerCase() !== name) throw Error('请选择 PostgreSQL 安装中的 ' + name);
  await access(path, constants.X_OK);
  return { path, kind, version: toolVersion(await lstat(path, { bigint: true })) };
}

async function assertTool(tool: PostgresNativeTool) {
  if (tool.version !== (await inspectPostgresNativeTool(tool.path, tool.kind)).version) throw Error(tool.kind + ' 在选择后发生变化，请重新选择');
}

/** 仅启动选定的原生工具，不经 shell。取消时结束子进程并等待实际 close，避免遗留数据库任务。 */
export async function runPostgresNativeTool(tool: PostgresNativeTool, args: readonly string[], env: NodeJS.ProcessEnv, signal: AbortSignal,
  write: (chunk: Buffer) => Promise<void>, inputFd?: number): Promise<string> {
  signal.throwIfAborted();
  await assertTool(tool);
  signal.throwIfAborted();
  const child = spawn(tool.path, args, { env, cwd: tmpdir(), windowsHide: true, stdio: [inputFd ?? 'ignore', 'pipe', 'pipe'] });
  let launchError: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  child.on('error', error => { launchError = error; });
  const terminal = new Promise<number | null>(resolve => child.once('close', resolve));
  const stderr: Buffer[] = [];
  let available = 4096;
  child.stderr!.on('data', (chunk: Buffer) => {
    const keep = Math.min(available, chunk.length);
    if (keep) { stderr.push(Buffer.from(chunk.subarray(0, keep))); available -= keep; }
  });
  const stop = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null || killTimer) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000);
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for await (const chunk of child.stdout!) {
      signal.throwIfAborted();
      await write(chunk as Buffer);
    }
    const status = await terminal;
    signal.throwIfAborted();
    const detail = Buffer.concat(stderr).toString('utf8').trim();
    if (launchError || status !== 0) throw Error(tool.kind + ' 未正常完成' + (detail ? '\n' + detail : ''));
    await assertTool(tool);
    return detail;
  } catch (error) {
    stop();
    await terminal;
    throw error;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener('abort', stop);
  }
}

export function postgresToolEnvironment(): NodeJS.ProcessEnv {
  // 固定 libpq 参数。宿主 PG* 配置、加载器注入变量和凭据环境变量不传给子进程。
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' };
  for (const name of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

/** 版本只来自选定进程的受限输出，避免把大体积输出当作版本文本。 */
export async function readPostgresToolVersion(tool: PostgresNativeTool, signal: AbortSignal): Promise<string> {
  let output = '';
  await runPostgresNativeTool(tool, ['--version'], postgresToolEnvironment(), signal, async chunk => {
    output += chunk.toString('utf8');
    if (output.length > 1024) throw Error('无法确认 ' + tool.kind + ' 版本');
  });
  const match = /^(pg_dump|pg_restore) \(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)(?: [^\r\n]*)?$/.exec(output.trim());
  if (match?.[1] !== tool.kind || Number(match[2].split('.')[0]) < 14)
    throw Error('请选择 PostgreSQL 14 或更新版本的原生 ' + tool.kind);
  return match[2];
}
