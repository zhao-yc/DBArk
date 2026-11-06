import { runNativeProcess } from '../nativeProcess';
import { constants, type BigIntStats } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
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
  const detail = await runNativeProcess(tool.path, tool.kind, args, env, signal, write, inputFd, true);
  await assertTool(tool);
  return detail;
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
