import { createPrivateKey, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { getCACertificates } from 'node:tls';
import { isPostgresCustomArchiveDestination, type PostgresDatabaseBackupInput, type PostgresDatabaseBackupResult } from '../../shared/postgresDatabaseBackup';
import { postgresSqlFileLimits } from '../../shared/postgresSqlFile';
import { AtomicFile, privateAtomicFileIO } from '../atomicFile';
import { openNativeBackupTunnel } from '../nativeBackupTunnel';
import type { PostgresConnection } from './connection';
import { postgresToolEnvironment, readPostgresToolVersion, runPostgresNativeTool, type PostgresNativeTool } from './nativeTool';

export type PostgresDatabaseBackupRequest = PostgresDatabaseBackupInput & { filePath: string; tool: PostgresNativeTool<'pg_dump'> };
type Connect = <T>(action: (connection: PostgresConnection) => Promise<T>) => Promise<T>;

function dumpTunnel(connection: PostgresConnection) {
  if (!connection.profile.ssh?.enabled) return;
  return openNativeBackupTunnel('127.0.0.1', () => connection.openSshChannel(), () => connection.abort());
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
    ...postgresToolEnvironment(), PGHOST: profile.host, PGPORT: String(tunnel?.port ?? profile.port),
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

/** 原会话导出只读快照，pg_dump 必须从同一数据库导入；子进程和原会话结束后才发布完整备份。 */
export async function exportPostgresDatabaseBackup(input: PostgresDatabaseBackupRequest, connect: Connect,
  signal: AbortSignal, protect: () => void): Promise<PostgresDatabaseBackupResult> {
  const custom = input.format === 'custom';
  if (!isAbsolute(input.filePath) || !(custom ? isPostgresCustomArchiveDestination(input.filePath) : /\.sql$/i.test(input.filePath)))
    throw Error('请选择与备份格式匹配的文件路径');
  if (input.tool.kind !== 'pg_dump' || custom && input.portable) throw Error('PostgreSQL 整库备份参数不匹配');
  let file: AtomicFile | undefined;
  const check = () => signal.throwIfAborted();
  try {
    const toolVersion = await readPostgresToolVersion(input.tool, signal);
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
        let magic = '';
        try {
          detail = await runPostgresNativeTool(input.tool, [
            custom ? '--format=custom' : '--format=plain', '--encoding=UTF8', '--no-password', '--snapshot=' + snapshot,
            '--dbname=dbname=' + quoteConnectionValue(input.database),
            ...(input.portable ? ['--no-owner', '--no-privileges'] : []),
          ], env, signal, chunk => {
            if (custom && magic.length < 5) magic += chunk.toString('latin1', 0, 5 - magic.length);
            return staged.writeBytes(chunk);
          });
          if (custom && magic !== 'PGDMP') throw Error('pg_dump 输出未包含 PostgreSQL 自定义归档标记');
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
