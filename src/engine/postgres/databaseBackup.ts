import { spawn } from 'node:child_process';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { access, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, isIP, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { Duplex } from 'node:stream';
import { getCACertificates } from 'node:tls';
import type { PostgresDatabaseBackupInput, PostgresDatabaseBackupResult } from '../../shared/postgresDatabaseBackup';
import { postgresSqlFileLimits } from '../../shared/postgresSqlFile';
import { AtomicFile, privateAtomicFileIO } from '../atomicFile';
import type { PostgresConnection } from './connection';

export interface PostgresDumpTool { path: string; version: string }
export type PostgresDatabaseBackupRequest = PostgresDatabaseBackupInput & { filePath: string; tool: PostgresDumpTool };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>) => Promise<T>;

function toolVersion(stat: BigIntStats) {
  if (!stat.isFile() || !stat.size) throw Error('请选择 PostgreSQL 安装中的 pg_dump 可执行文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(':');
}

/** 系统选择器授权实际文件。记录文件身份，禁止选中后用另一个程序替换。 */
export async function inspectPostgresDumpTool(selected: string): Promise<PostgresDumpTool> {
  const path = await realpath(selected);
  const name = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (!isAbsolute(selected) || basename(path).toLowerCase() !== name) throw Error('请选择 PostgreSQL 安装中的 pg_dump 可执行文件');
  await access(path, constants.X_OK);
  return { path, version: toolVersion(await lstat(path, { bigint: true })) };
}

async function assertTool(tool: PostgresDumpTool) {
  if (tool.version !== (await inspectPostgresDumpTool(tool.path)).version) throw Error('pg_dump 在选择后发生变化，请重新选择');
}

/** 仅启动选定的原生工具，不经 shell。取消时结束子进程并等待实际 close，避免遗留数据库任务。 */
async function runDump(tool: PostgresDumpTool, args: readonly string[], env: NodeJS.ProcessEnv, signal: AbortSignal,
  write: (chunk: Buffer) => Promise<void>): Promise<string> {
  signal.throwIfAborted();
  await assertTool(tool);
  signal.throwIfAborted();
  const child = spawn(tool.path, args, { env, cwd: tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let launchError: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
  child.on('error', error => { launchError = error; });
  const terminal = new Promise<number | null>(resolve => child.once('close', resolve));
  const stderr: Buffer[] = [];
  let available = 4096;
  child.stderr.on('data', (chunk: Buffer) => {
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
    for await (const chunk of child.stdout) {
      signal.throwIfAborted();
      await write(chunk as Buffer);
    }
    const status = await terminal;
    signal.throwIfAborted();
    const detail = Buffer.concat(stderr).toString('utf8').trim();
    if (launchError || status !== 0) throw Error('pg_dump 未正常完成' + (detail ? '\n' + detail : ''));
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

function cleanEnvironment(): NodeJS.ProcessEnv {
  // 固定 libpq 参数。宿主 PG* 配置、加载器注入变量和凭据环境变量不传给子进程。
  const env: NodeJS.ProcessEnv = { LC_ALL: 'C' };
  for (const name of ['SystemRoot', 'WINDIR', 'SystemDrive', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

/** 已核验的 SSH 会话额外开启一个单次使用的回环端口，libpq 仍对数据库服务器完成独立 TLS。 */
async function dumpTunnel(connection: PostgresConnection) {
  if (!connection.profile.ssh?.enabled) return;
  let local: Socket | undefined, remote: Duplex | undefined, opening: Promise<void> | undefined, stopping = false;
  const server = createServer({ pauseOnConnect: true }, socket => {
    if (local || stopping) { socket.destroy(); return; }
    local = socket;
    socket.on('error', () => remote?.destroy());
    socket.once('close', () => remote?.destroy());
    opening = connection.openSshChannel().then(channel => {
      remote = channel;
      channel.on('error', () => socket.destroy());
      channel.once('close', () => socket.destroy());
      if (stopping || socket.destroyed) { channel.destroy(); return; }
      socket.pipe(channel).pipe(socket);
      socket.resume();
    }, () => socket.destroy()).then(() => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('pg_dump SSH 回环端口未建立');
  return {
    port: address.port,
    async close() {
      stopping = true;
      local?.destroy();
      remote?.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      // 如果 pg_dump 已结束但 SSH 建通道还在等待，关闭原连接才有可验证的收尾。
      if (opening && !remote) connection.abort();
      await opening;
    },
  };
}

async function dumpEnvironment(connection: PostgresConnection, directory: string, applicationName: string, tunnel?: { port: number }) {
  const profile = connection.profile;
  if (!isIP(profile.host) && !/^[a-z0-9._-]+$/i.test(profile.host)) throw Error('pg_dump 需要单一 PostgreSQL 主机地址');
  const secret = profile.password ?? '';
  if (/[\r\n\0]/.test(secret)) throw Error('原生备份的 libpq 密码文件无法表示换行或空字符');
  const passfile = join(directory, 'pgpass');
  const escaped = secret.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  await writeFile(passfile, '*:*:*:*:' + escaped + '\n', { flag: 'wx', mode: 0o600 });
  const unused = join(directory, 'unused');
  const env: NodeJS.ProcessEnv = {
    ...cleanEnvironment(), PGHOST: profile.host, PGPORT: String(tunnel?.port ?? profile.port),
    PGUSER: profile.user, PGCONNECT_TIMEOUT: '15', PGPASSFILE: passfile, PGGSSENCMODE: 'disable',
    PGAPPNAME: applicationName, PGSSLMODE: 'disable', PGSSLROOTCERT: unused, PGSSLCERT: unused, PGSSLKEY: unused,
    ...(tunnel ? { PGHOSTADDR: '127.0.0.1' } : {}),
  };
  const tls = profile.tls;
  if (tls?.enabled) {
    env.PGSSLMODE = tls.rejectUnauthorized ? 'verify-full' : 'require';
    if (tls.rejectUnauthorized) {
      if (tls.caPath) env.PGSSLROOTCERT = tls.caPath;
      else {
        env.PGSSLROOTCERT = join(directory, 'roots.pem');
        await writeFile(env.PGSSLROOTCERT, getCACertificates('default').join('\n'), { flag: 'wx', mode: 0o600 });
      }
    }
    if (tls.certPath || tls.keyPath) {
      if (!tls.certPath || !tls.keyPath) throw Error('pg_dump 客户端 TLS 需要成对配置证书和私钥');
      env.PGSSLCERT = tls.certPath;
      env.PGSSLKEY = join(directory, 'client.key');
      const key = createPrivateKey({ key: await readFile(tls.keyPath), passphrase: tls.passphrase });
      await writeFile(env.PGSSLKEY, key.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
    }
  }
  return env;
}

const queryBudget = () => ({ rows: 1, bytes: 1024 });
const quoteConnectionValue = (value: string) => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";

/** 子进程已退出时，服务端仍可能在等锁。仅结束本任务标记、角色、数据库、PID 和启动时间都相符的会话。 */
async function stopDumpBackend(connection: PostgresConnection, applicationName: string) {
  const scope = ' FROM pg_catalog.pg_stat_activity WHERE application_name=$1 AND datname=pg_catalog.current_database() ' +
    'AND usename=current_user AND pid<>pg_catalog.pg_backend_pid()';
  const clear = () => connection.query('SELECT pg_catalog.pg_stat_clear_snapshot()', undefined, queryBudget());
  await clear();
  const current = (await connection.query('SELECT pid::text, extract(epoch FROM backend_start)::text' + scope,
    [applicationName], { rows: 2, bytes: 2048 })).rows;
  if (!current.length) return;
  const { c0: pid, c1: started } = current[0];
  if (current.length !== 1 || typeof pid !== 'string' || typeof started !== 'string')
    throw Error('PostgreSQL 整库备份的原后端身份未确认');
  const exact = scope + ' AND pid=$2::int AND extract(epoch FROM backend_start)::text=$3';
  const values = [applicationName, pid, started];
  await connection.query('SELECT pg_catalog.pg_terminate_backend(pid)' + exact, values, queryBudget());
  for (let attempt = 0; attempt < 50; attempt++) {
    await clear();
    if (!(await connection.query('SELECT pid' + exact, values, queryBudget())).rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('PostgreSQL 整库备份的原后端退出尚未确认');
}

/** 原会话导出只读快照，pg_dump 必须从同一数据库导入；子进程和原会话结束后才发布完整 SQL。 */
export async function exportPostgresDatabaseBackup(input: PostgresDatabaseBackupRequest, connect: Connect,
  signal: AbortSignal, protect: () => void): Promise<PostgresDatabaseBackupResult> {
  if (!isAbsolute(input.filePath) || !/\.sql$/i.test(input.filePath)) throw Error('请选择 SQL 备份文件路径');
  let file: AtomicFile | undefined;
  const check = () => signal.throwIfAborted();
  try {
    let toolVersionText = '';
    await runDump(input.tool, ['--version'], cleanEnvironment(), signal, async chunk => {
      toolVersionText += chunk.toString('utf8');
      if (toolVersionText.length > 1024) throw Error('无法确认 pg_dump 版本');
    });
    const toolVersion = /^pg_dump \(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)(?: [^\r\n]*)?$/.exec(toolVersionText.trim())?.[1];
    if (!toolVersion || Number(toolVersion.split('.')[0]) < 14) throw Error('请选择 PostgreSQL 14 或更新版本的原生 pg_dump');
    const warning = await connect(async connection => {
      check();
      if ((await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', undefined, queryBudget())).postgresCommand !== 'BEGIN')
        throw Error('PostgreSQL 整库备份的只读事务未建立');
      const snapshot = (await connection.query('SELECT pg_catalog.pg_export_snapshot()', undefined, queryBudget())).rows[0]?.c0;
      if (typeof snapshot !== 'string' || !/^[0-9a-f]+-[0-9a-f]+-\d+$/i.test(snapshot)) throw Error('PostgreSQL 备份快照未确认');
      check();
      let tunnel: Awaited<ReturnType<typeof dumpTunnel>>;
      let detail: string;
      const applicationName = 'tabrelio-pg-dump-' + randomUUID();
      const staged = file = await AtomicFile.create(input.filePath, 'utf8', check, protect,
        privateAtomicFileIO, postgresSqlFileLimits.bytes, undefined, true);
      const directory = await mkdtemp(join(tmpdir(), 'tabrelio-pg-dump-'));
      try {
        tunnel = await dumpTunnel(connection);
        const env = await dumpEnvironment(connection, directory, applicationName, tunnel);
        try {
          detail = await runDump(input.tool, [
            '--format=plain', '--encoding=UTF8', '--no-password', '--snapshot=' + snapshot,
            '--dbname=dbname=' + quoteConnectionValue(input.database),
            ...(input.portable ? ['--no-owner', '--no-privileges'] : []),
          ], env, signal, chunk => staged.writeBytes(chunk));
        } catch (reason) {
          await stopDumpBackend(connection, applicationName);
          throw reason;
        }
      } finally {
        try { await tunnel?.close(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
      await staged.prepare(true);
      if (!staged.bytesWritten) throw Error('pg_dump 未生成备份内容');
      check();
      if ((await connection.query('COMMIT', undefined, queryBudget())).postgresCommand !== 'COMMIT' ||
          !connection.state().transactionKnown || connection.state().transactionOpen)
        throw Error('PostgreSQL 备份的原只读事务未确认结束');
      return detail ? connection.error(detail).message : undefined;
    });
    check();
    if (!file) throw Error('PostgreSQL 未生成整库备份文件');
    await file.commit();
    return { bytes: file.bytesWritten, toolVersion, ...(warning ? { warning } : {}) };
  } finally {
    await file?.dispose();
  }
}
