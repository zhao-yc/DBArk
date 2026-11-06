import type { DatabaseBackupManifest } from '../shared/databaseBackup';
import type { DatabaseBackupRestoreTargetAudit } from '../shared/databaseBackupArchiveFiles';
import { execute } from './connection';
import { databaseBackupGlobalGrants, databaseBackupSourceSql } from './databaseBackupSource';
import type { StructureTaskContext } from './structureDefinition';

type Context = Pick<StructureTaskContext, 'managed' | 'commandStarted' | 'checkCancelled'>;
type Row = Record<string, unknown>;
type Manifest = Pick<DatabaseBackupManifest, 'family' | 'serverVersion' | 'database'>;
const factsSql = `SELECT VERSION() AS version, @@version_comment AS versionComment,
  @@lower_case_table_names AS identifierCase, CAST(@@GLOBAL.event_scheduler AS CHAR) AS scheduler`;
const visibleSql = `SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA = BINARY ? AND TABLE_TYPE <> 'VIEW') AS relations,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA = BINARY ? AND TABLE_TYPE = 'VIEW') AS views,
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA = BINARY ?) AS routines,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA = BINARY ?) AS triggers,
  (SELECT COUNT(*) FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA = BINARY ?) AS events`;

async function read(context: Context, sql: string, parameters: string[] = []): Promise<Row[]> {
  const end = context.commandStarted();
  try {
    const { rows } = await execute<Row[]>(context.managed, sql, parameters);
    context.checkCancelled();
    return rows;
  } finally { end(); }
}

/** 只采信已知版本系列、当前账号直接全局权限和无活动角色的证明。授权原文可能含认证哈希，仅留在引擎。 */
async function visibility(context: Context, family: Manifest['family'], version: string) {
  const unknown = { schemas: false, objects: false };
  // 旧版服务器可能没有 CURRENT_ROLE()，仍可读取已知对象，只有零行判定需要授权证明。
  if (!(family === 'mysql' ? /^8\.4\./ : /^11\.4\./).test(version)) return unknown;
  let facts: Row | undefined;
  let rows: Row[];
  try {
    [facts] = await read(context, 'SELECT CURRENT_USER() AS account, CURRENT_ROLE() AS activeRole, @@SESSION.sql_mode AS sqlMode');
    if (typeof facts?.account !== 'string' || typeof facts.sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(facts.sqlMode) ||
      facts.activeRole !== null && facts.activeRole !== 'NONE') return unknown;
    rows = await read(context, databaseBackupSourceSql.grants);
  } catch { context.checkCancelled(); return unknown; }
  if (rows.length > 256 || rows.reduce((total, row) => total + Object.values(row)
    .reduce<number>((bytes, value) => bytes + (typeof value === 'string' ? Buffer.byteLength(value) : 0), 0), 0) > 512 * 1024)
    return unknown;
  const modes = facts.sqlMode.toUpperCase().split(',');
  const proof = databaseBackupGlobalGrants(rows, facts.account, family, { dialect: family,
    mode: { ansiQuotes: modes.includes('ANSI_QUOTES'), noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES') } }, true);
  const schemas = proof.known && ['SELECT', 'SHOW DATABASES'].every(grant => proof.privileges.has(grant));
  const objects = schemas && ['SHOW VIEW', 'TRIGGER', 'EVENT', ...(family === 'mariadb' ? ['SHOW CREATE ROUTINE'] : [])]
    .every(grant => proof.privileges.has(grant));
  return { schemas, objects };
}

function count(value: unknown): number {
  if ((typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= 0) return Number(value);
  throw Error('目标目录返回了无效对象数量');
}

/** 只发送固定元数据查询。归档库名始终走绑定参数，清单中的 SQL、对象名和权限声明均不参与执行。 */
export async function auditDatabaseBackupTarget(context: Context, manifest: Manifest): Promise<DatabaseBackupRestoreTargetAudit> {
  const { database } = manifest;
  if (typeof database !== 'string' || !database || [...database].length > 64 || database.includes('\0') ||
    /^(mysql|information_schema|performance_schema|sys)$/i.test(database)) throw Error('归档库名无效或指向系统库');

  const [facts] = await read(context, factsSql);
  if (typeof facts?.version !== 'string' || typeof facts.versionComment !== 'string') throw Error('目标服务器版本未知');
  const family = context.managed.status.dialect;
  const version = facts.version.replace(/^5\.5\.5-/, '').match(/^\d+\.\d+\.\d+/)?.[0];
  if (!version || family !== 'mysql' && family !== 'mariadb') throw Error('目标需要 MySQL 或 MariaDB 连接');
  const canonicalServer = family === 'mariadb' ? /-MariaDB(?:-|$)/i.test(facts.version)
    : /MySQL/i.test(facts.versionComment) && !/MariaDB|Percona/i.test(facts.version + facts.versionComment);
  const versionMatches = canonicalServer && family === manifest.family && version === manifest.serverVersion;
  const before = canonicalServer ? await visibility(context, family, version) : { schemas: false, objects: false };
  const identifierCase = Number(facts.identifierCase);
  if (![0, 1, 2].includes(identifierCase) || facts.identifierCase === null) throw Error('目标库名大小写规则未知');
  const schemaMatch = identifierCase === 0 ? 'BINARY SCHEMA_NAME = BINARY ?' : 'BINARY LOWER(SCHEMA_NAME) = BINARY LOWER(?)';
  const schemas = await read(context, `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE ${schemaMatch} LIMIT 2`, [database]);
  const actualDatabase = schemas.length === 1 && typeof schemas[0].name === 'string' ? schemas[0].name : null;
  let visible: DatabaseBackupRestoreTargetAudit['visible'] = null;
  if (actualDatabase !== null) {
    const [row] = await read(context, visibleSql, Array<string>(5).fill(actualDatabase));
    visible = { relations: count(row?.relations), views: count(row?.views), routines: count(row?.routines),
      triggers: count(row?.triggers), events: count(row?.events) };
  }
  const after = before.schemas ? await visibility(context, family, version) : before;
  const [last] = await read(context, factsSql);
  const sameSession = last && ['version', 'versionComment', 'identifierCase']
    .every(key => facts[key] === last[key]);
  if (!sameSession) throw Error('检查期间目标服务器或会话条件已变化，请重新检查');
  // 大小写折叠规则跨版本存在差异，非 ASCII 库名在折叠模式下的零行不据此认定为缺失。
  const absenceProven = before.schemas && after.schemas && (identifierCase === 0 || /^[\x20-\x7e]+$/.test(database));
  const state = visible && Object.values(visible).some(value => value > 0) ? 'occupied'
    : visible && before.objects && after.objects ? 'empty'
      : schemas.length === 0 && absenceProven ? 'absent' : 'unknown';
  const scheduler = facts.scheduler !== last.scheduler ? 'unknown' : last.scheduler === 'ON' ? 'enabled'
    : last.scheduler === 'OFF' || last.scheduler === 'DISABLED' ? 'disabled' : 'unknown';
  const blockers: DatabaseBackupRestoreTargetAudit['blockers'] = [];
  if (!versionMatches) blockers.push({ code: 'version-mismatch', message: '实际服务器系列或版本与归档清单不一致。' });
  if (actualDatabase !== null && actualDatabase !== database) blockers.push({ code: 'case-mismatch', message: '同名库的实际拼写与清单不同。' });
  if (state === 'occupied') blockers.push({ code: 'occupied', message: '同名库已有对象，恢复可能覆盖现有数据。' });
  if (state === 'unknown') blockers.push({ code: 'visibility', message: '现有权限或库名匹配结果无法证明同名库不存在或为空。' });
  if (scheduler !== 'disabled') blockers.push({ code: 'event-scheduler', message: '事件调度器未确认关闭。' });
  return { family, version, versionMatches, database, actualDatabase, state, visible, scheduler, blockers };
}
