import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { runNativeProcess } from './nativeProcess';

type Family = 'mysql' | 'mariadb';
export interface MysqlDumpTool { path: string; family: Family; identity: string }

export async function inspectMysqlDumpTool(selected: string): Promise<MysqlDumpTool> {
  if (!isAbsolute(selected)) throw Error('请使用系统对话框选择原生转储工具');
  const path = await realpath(selected), name = basename(path).toLowerCase();
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const family = name === 'mysqldump' + suffix ? 'mysql' : name === 'mariadb-dump' + suffix ? 'mariadb' : undefined;
  if (!family) throw Error('请选择已安装的 mysqldump 或 mariadb-dump');
  await access(path, constants.X_OK);
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || !stat.size) throw Error('请选择数据库客户端安装中的普通可执行文件');
  const identity = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(':');
  return { path, family, identity };
}

export async function runMysqlDumpTool(tool: MysqlDumpTool, args: readonly string[], signal: AbortSignal, write: (chunk: Buffer) => Promise<void>) {
  const assertTool = async () => {
    const current = await inspectMysqlDumpTool(tool.path);
    if (current.family !== tool.family || current.identity !== tool.identity) throw Error('原生转储工具已变化，请重新选择');
  };
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' };
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  await assertTool();
  const warning = await runNativeProcess(tool.path, basename(tool.path), args, env, signal, write);
  await assertTool();
  // 原生 stderr 可能含连接身份、SQL 或样本内容，只报告异常事实。
  if (warning) throw Error('原生转储工具返回诊断信息，备份未保存。请核对工具版本、源权限和连接设置');
}

export async function readMysqlDumpVersion(tool: MysqlDumpTool, signal: AbortSignal) {
  let output = '';
  const mysql = tool.family === 'mysql';
  await runMysqlDumpTool(tool, ['--no-defaults', ...(mysql ? ['--no-login-paths'] : []), '--version'], signal, async chunk => {
    output += chunk.toString('utf8');
    if (output.length > 1024) throw Error('原生转储版本输出超出预算');
  });
  const version = parseMysqlDumpVersion(tool.family, output);
  if (!version || Number(version.split('.')[0]) < (mysql ? 8 : 11))
    throw Error('请选择匹配的 MySQL 8 或更新版本 mysqldump，或 MariaDB 11 或更新版本 mariadb-dump');
  return version;
}

/** 当前原生工具使用不同版本首行，必须证明分发系列与完整版本号。 */
export function parseMysqlDumpVersion(family: MysqlDumpTool['family'], output: string) {
  const line = output.trim();
  return family === 'mysql'
    ? /(?:^|[\\/])mysqldump(?:\.exe)?\s+Ver\s+(\d+\.\d+\.\d+)\b(?![^\n]*MariaDB)/i.exec(line)?.[1]
    : /(?:^|[\\/])(?:mariadb-dump|mysqldump)(?:\.exe)?\s+(?:from|Ver\s+\S+\s+Distrib)\s+(\d+\.\d+\.\d+)-MariaDB\b/i.exec(line)?.[1];
}
