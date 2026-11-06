import { execFile } from 'node:child_process';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { getCACertificates } from 'node:tls';
import { promisify } from 'node:util';
import { mysqlBackupDatabase, mysqlBackupTunnelHost, type MysqlDatabaseBackupResult } from '../shared/mysqlDatabaseBackup';
import { AtomicFile, privateAtomicFileIO } from './atomicFile';
import { execute } from './connection';
import { mysqlDumpOptionFile } from './databaseBackupNativeOptions';
import { databaseBackupGlobalGrants, databaseBackupSourceSql as sourceSql } from './databaseBackupSource';
import { inspectMysqlBackupHandshake } from './mysqlBackupHandshake';
import { openNativeBackupTunnel } from './nativeBackupTunnel';
import { readMysqlDumpVersion, runMysqlDumpTool, type MysqlDumpTool } from './mysqlDumpTool';
import type { StructureTaskContext } from './structureDefinition';

type Context = Pick<StructureTaskContext, 'managed' | 'commandStarted' | 'checkCancelled'>;
type Profile = Context['managed']['profile'];
type Row = Record<string, unknown>;
const windowsAcl = `
$ErrorActionPreference='Stop'
$p=$env:TABRELIO_BACKUP_CREDENTIAL_DIRECTORY
$dir=[IO.DirectoryInfo]::new($p)
if (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
$dir.SetAccessControl($acl)
$actual=$dir.GetAccessControl()
$rules=$actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or
  $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or
  $rules[0].InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'acl' }
`;

/** Windows 先建立并读回只含当前用户的 ACL，之后才写入口令。macOS 复核 mkdtemp 的 uid 和 0700。 */
async function protectCredentialDirectory(directory: string) {
  const before = await lstat(directory);
  if (!before.isDirectory()) throw Error('备份凭据目录身份无效');
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot;
    if (!root || !/^[a-z]:\\/i.test(root)) throw Error('无法确认 Windows 系统目录');
    try {
      await promisify(execFile)(join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsAcl, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 15_000, maxBuffer: 4096, env: { SystemRoot: root, TABRELIO_BACKUP_CREDENTIAL_DIRECTORY: directory } });
    } catch { throw Error('无法确认 Windows 备份凭据目录的私有访问权限'); }
  } else if (before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o700) {
    throw Error('无法确认备份凭据目录的私有访问权限');
  }
  const after = await lstat(directory);
  if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino) throw Error('备份凭据目录已变化');
}

async function tlsArgs(profile: Profile, family: MysqlDumpTool['family'], directory: string) {
  if (profile.dialect !== family) throw Error('转储工具与连接系列不符');
  const mysql = family === 'mysql', tls = profile.tls;
  if (!tls?.enabled) return mysql ? ['--ssl-mode=DISABLED'] : ['--skip-ssl'];
  const args = mysql ? [tls.rejectUnauthorized ? '--ssl-mode=VERIFY_IDENTITY' : '--ssl-mode=REQUIRED']
    : ['--ssl', tls.rejectUnauthorized ? '--ssl-verify-server-cert' : '--skip-ssl-verify-server-cert'];
  if (tls.rejectUnauthorized) {
    const ca = tls.caPath || join(directory, 'roots.pem');
    if (!tls.caPath) await writeFile(ca, getCACertificates('default').join('\n'), { flag: 'wx', mode: 0o600 });
    args.push('--ssl-ca=' + ca);
  }
  if (tls.certPath || tls.keyPath) {
    if (!tls.certPath || !tls.keyPath) throw Error('客户端 TLS 需要成对的证书和私钥');
    const path = join(directory, 'client.key');
    const key = createPrivateKey({ key: await readFile(tls.keyPath), passphrase: tls.passphrase });
    await writeFile(path, key.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
    args.push('--ssl-cert=' + tls.certPath, '--ssl-key=' + path);
  }
  return args;
}

async function catalogue(context: Context, database: string) {
  const { managed } = context, family = managed.status.dialect;
  if (family !== 'mysql' && family !== 'mariadb') throw Error('整库备份需要 MySQL 或 MariaDB');
  async function read(sql: string, params: string[] = []) {
    const end = context.commandStarted();
    try {
      const { rows } = await execute<Row[]>(managed, sql, params);
      context.checkCancelled();
      if (rows.length > 10_000) throw Error('整库备份对象目录超过预算');
      return rows;
    } finally { end(); }
  }
  const [facts] = await read(sourceSql.facts);
  if (typeof facts?.currentUser !== 'string' || facts.currentRole !== null && facts.currentRole !== 'NONE' ||
    typeof facts.sqlMode !== 'string' || !/^[a-z0-9_,]*$/i.test(facts.sqlMode)) throw Error('无法确认备份账号的直接授权');
  const modes = facts.sqlMode.toUpperCase().split(',');
  const proof = databaseBackupGlobalGrants(await read(sourceSql.grants), facts.currentUser, family, {
    dialect: family, mode: { ansiQuotes: modes.includes('ANSI_QUOTES'), noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES') },
  }, true, true);
  const required = ['SELECT', 'SHOW VIEW', 'TRIGGER', 'EVENT', ...(family === 'mariadb' ? ['SHOW CREATE ROUTINE'] : [])];
  if (!proof.known || required.some(grant => !proof.privileges.has(grant))) throw Error('整库备份需要直接全局授权以证明对象目录完整：' + required.join('、'));
  const schemas = await read(sourceSql.schemas, [database]);
  if (schemas.length !== 1 || schemas[0].name !== database) throw Error('未找到所选数据库的准确名称');
  const tables = await read(sourceSql.tables, [database]);
  if (tables.some(table => table.objectType !== 'VIEW' && (table.objectType !== 'BASE TABLE' || table.engine !== 'InnoDB')))
    throw Error('当前库含非 InnoDB 表或其它关系对象，无法使用一致性快照备份');
  const routines = await read(sourceSql.routines, [database]);
  const triggers = await read(sourceSql.triggers, [database]);
  const events = await read(sourceSql.events, [database]);
  return JSON.stringify({ schemas, tables, routines, triggers, events, account: facts.currentUser });
}

/** MySQL 转储连接持有本任务随机命名锁。只在原锁仍在时结束该服务器线程。 */
async function settleMysqlDumpBackend(managed: Context['managed'], lock: string) {
  const owner = async () => (await execute<Row[]>(managed, 'SELECT IS_USED_LOCK(?) AS id', [lock])).rows[0]?.id;
  const id = await owner();
  if (id === null) return;
  if (!/^\d{1,10}$/.test(String(id)) || Number(id) <= 0 || Number(id) === managed.connection.threadId)
    throw Error('无法确认原生转储线程终态');
  if (await owner() !== id) return;
  try { await execute(managed, 'KILL CONNECTION ' + id); }
  catch (reason) { if ((reason as { errno?: number }).errno !== 1094) throw Error('无法结束原生转储线程'); }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await owner() === null) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('原生转储线程退出尚未确认');
}

export function createMysqlDatabaseBackup(input: { database: string; filePath: string; tool: MysqlDumpTool }) {
  const controller = new AbortController();
  const signal = controller.signal;
  let output: AtomicFile | undefined, result: MysqlDatabaseBackupResult | undefined;
  let publish: (() => void) | undefined;
  return {
    abort() { controller.abort(Error('整库备份已取消')); },
    async stage(context: Context) {
      const { tool, database, filePath } = input;
      const { managed } = context, profile = managed.profile, family = managed.status.dialect;
      if (!mysqlBackupDatabase.safeParse(database).success || !isAbsolute(filePath) || !/\.sql$/i.test(filePath)) throw Error('备份库名或 SQL 目标无效');
      if (family !== tool.family || profile.dialect !== family) throw Error('工具需与实际服务器系列匹配');
      const localHost = mysqlBackupTunnelHost(profile);
      const toolVersion = await readMysqlDumpVersion(tool, signal);
      const serverVersion = managed.status.version;
      if (toolVersion.split('.')[0] !== serverVersion.replace(/^5\.5\.5-/, '').split('.')[0])
        throw Error('请选择与服务器主版本相同的原生转储工具');
      const before = await catalogue(context, database);
      const lock = family === 'mysql' ? 'tabrelio-dump-' + randomUUID() : undefined;
      let uuid: string | undefined;
      if (lock) {
        const end = context.commandStarted();
        try {
          const value = (await execute<Row[]>(managed, sourceSql.uuid)).rows[0]?.serverUuid;
          if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw Error('无法确认 MySQL 来源实例');
          uuid = value;
        } finally { end(); }
      }
      const check = () => { signal.throwIfAborted(); context.checkCancelled(); };
      output = await AtomicFile.create(filePath, 'utf8', check, () => publish?.(), privateAtomicFileIO, 10 * 1024 ** 3, undefined, true);
      const directory = await mkdtemp(join(tmpdir(), 'tabrelio-mysql-dump-'));
      try {
        await protectCredentialDirectory(directory);
        check();
        const defaults = join(directory, 'client.cnf');
        await writeFile(defaults, mysqlDumpOptionFile(profile.user, profile.password ?? ''), { flag: 'wx', mode: 0o600 });
        const mysql = family === 'mysql', tls = await tlsArgs(profile, family, directory);
        check();
        const opening = new AbortController();
        const openChannel = managed.openSshChannel;
        if (localHost && !openChannel) throw Error('原数据库 SSH 会话不可用');
        const tunnel = localHost ? await openNativeBackupTunnel(localHost,
          () => openChannel!(AbortSignal.any([signal, opening.signal, AbortSignal.timeout(15_000)])),
          () => opening.abort(),
          channel => inspectMysqlBackupHandshake(channel, serverVersion, Boolean(profile.tls?.enabled))) : undefined;
        const args = [
          '--defaults-file=' + defaults, ...(mysql ? ['--no-login-paths'] : []),
          '--protocol=TCP', '--host=' + (tunnel?.host ?? profile.host), '--port=' + (tunnel?.port ?? profile.port), ...tls,
          '--default-character-set=utf8mb4', '--single-transaction', '--quick', '--hex-blob',
          '--routines', '--events', '--triggers', '--skip-lock-tables', '--skip-add-locks',
          ...(lock ? ['--set-gtid-purged=OFF', '--column-statistics=0', '--no-tablespaces',
            `--init-command=DO IF(@@server_uuid='${uuid}', GET_LOCK('${lock}',0), JSON_EXTRACT('invalid endpoint','$'))`] : []),
          '--databases', '--', database,
        ];
        let header = '', tail = '';
        const staged = output;
        try {
          await runMysqlDumpTool(tool, args, signal, chunk => {
            if (header.length < 4096) header += chunk.toString('latin1', 0, 4096 - header.length);
            tail = (tail + chunk.subarray(-256).toString('latin1')).slice(-256);
            return staged.writeBytes(chunk);
          });
        } catch (error) {
          if (tunnel?.failed && !signal.aborted) throw Error('备份 SSH 转发未建立，或数据库版本与 TLS 能力未通过检查');
          throw error;
        } finally {
          try { await tunnel?.close(); }
          finally { if (lock && (!tunnel || tunnel.forwardingStarted)) await settleMysqlDumpBackend(managed, lock); }
        }
        const version = /^-- Server version[ \t]+([^\r\n]+)\r?$/m.exec(header)?.[1];
        if (tunnel && !tunnel.forwardingStarted || version !== serverVersion || !/^-- Dump completed on [^\r\n]+\r?$/m.test(tail))
          throw Error('未确认完整的原生转储头尾或实际服务器版本');
      } finally { await rm(directory, { recursive: true, force: true }); }
      if (before !== await catalogue(context, database)) throw Error('备份期间数据库对象目录发生变化，未保存备份');
      await output.prepare(true);
      check();
      result = { bytes: output.bytesWritten, toolVersion, serverVersion };
      return result;
    },
    async commit(check: () => void, start: () => void) {
      if (!output || !result) throw Error('备份未完成暂存');
      check();
      publish = start;
      await output.commit();
      return result;
    },
    committed: () => output?.fileCommitted === true,
    dispose: async () => { await output?.dispose(); },
  };
}
