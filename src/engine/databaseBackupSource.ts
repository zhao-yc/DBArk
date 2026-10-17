import { createHash } from 'node:crypto';
import { databaseBackupKinds, type DatabaseBackupBlocker, type DatabaseBackupKind, type DatabaseBackupObject } from '../shared/databaseBackup';
import { definitionOmittingSqlModes, readControlledTimestampDefault, type TableDefinitionContext } from '../shared/tableColumnPatches';
import type { DatabaseBackupSourceEvidence } from './databaseBackupPlan';
import type { StructureTaskContext } from './structureDefinition';
import { identifier, qualified } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import { readTableForeignKeyDefinition } from './tableForeignKeyDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';

type Row = Record<string, unknown>;
export const databaseBackupSourceSql = {
  version: 'SELECT VERSION() AS version, @@version_comment AS versionComment',
  facts: 'SELECT @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CURRENT_ROLE() AS currentRole, CONNECTION_ID() AS connectionId, @@SESSION.sql_mode AS sqlMode, @@SESSION.sql_quote_show_create AS quoteShowCreate, @@SESSION.character_set_connection AS characterSetConnection, @@SESSION.collation_connection AS collationConnection, @@lower_case_table_names AS identifierCase',
  uuid: 'SELECT @@server_uuid AS serverUuid', grants: 'SHOW GRANTS FOR CURRENT_USER()',
  gipk: 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS generatedPrimaryKeyVisible',
  schemas: 'SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS characterSet, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ? LIMIT 2',
  tables: 'SELECT TABLE_NAME AS name, TABLE_TYPE AS objectType, ENGINE AS engine FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA = BINARY ? ORDER BY TABLE_NAME LIMIT 10001',
  views: 'SELECT TABLE_NAME AS name, DEFINER AS definer FROM information_schema.VIEWS WHERE BINARY TABLE_SCHEMA = BINARY ? ORDER BY TABLE_NAME LIMIT 10001',
  triggers: 'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName, DEFINER AS definer FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA = BINARY ? ORDER BY TRIGGER_NAME LIMIT 10001',
  routines: 'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS routineType, DEFINER AS definer FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA = BINARY ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME LIMIT 10001',
  events: 'SELECT EVENT_NAME AS name, DEFINER AS definer FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA = BINARY ? ORDER BY EVENT_NAME LIMIT 10001',
} as const;
export interface DatabaseBackupSourceRead {
  id: keyof typeof databaseBackupSourceSql | `show-${DatabaseBackupKind}`;
  sql: string; params: readonly string[]; maxRows: number; maxBytes: number; sensitiveResult: true;
}
/** Root 用已登记 StructureTaskContext 包装实际参数化发送/限流/退出；本模块从不碰连接生命周期。 */
export interface DatabaseBackupSourceContext extends Pick<StructureTaskContext, 'checkCancelled'> {
  read(statement: DatabaseBackupSourceRead): Promise<{ rows: readonly Row[]; complete: boolean }>;
}
export interface DatabaseBackupSourceBinding {
  connectionId: string; database: string; connectionRevision: string; sourceLease: string;
  endpoint: 'direct-pinned' | 'unproven'; threadId: number;
  expectedInstance?: { family: 'mysql' | 'mariadb'; version: string; hostname: string; port: number; serverId: string; serverUuid: string | null };
  /** 只由 Root 版本能力注册表提供，不接受 renderer 提交；不表示当前已持锁。 */
  lockCapability?: { evidenceId: string; family: 'mysql' | 'mariadb'; version: string; profileId: string; ddlCoverage: DatabaseBackupSourceEvidence['visibility'] };
}
export interface DatabaseBackupSourceInspection {
  evidence: DatabaseBackupSourceEvidence;
  facts: { family: 'mysql' | 'mariadb'; version: string; versionText: string; versionComment: string; hostname: string; port: number; serverId: string; serverUuid: string | null; generatedPrimaryKeyVisible: boolean | null; currentUser: string; currentRole: string | null; connectionId: number; sqlMode: string; quoteShowCreate: number; characterSetConnection: string; collationConnection: string; identifierCase: number; ansiQuotes: boolean; noBackslashEscapes: boolean; identityAssurance: 'mysql-uuid' | 'mariadb-session-and-endpoint' };
  blockers: readonly DatabaseBackupBlocker[];
  unclassified: readonly { name: string; objectType: string }[];
  definers: readonly { kind: DatabaseBackupKind; name: string; account: string | null }[];
  metadataBytes: number; actualLockHeld: false;
}
export class DatabaseBackupSourceLimitError extends Error { readonly code = 'DBARK_BACKUP_SOURCE_LIMIT'; }
const limits = { objects: 10_000, bytes: 2 * 1024 * 1024 };
const permissionNames = ['SELECT', 'SHOW VIEW', 'SHOW DATABASES', 'TRIGGER', 'EVENT', 'RELOAD', 'LOCK TABLES', 'PROCESS', 'SHOW CREATE ROUTINE'];

/** 值始终是参数，SHOW CREATE 名称只经项目既有标识符引用；不调整原名大小写。 */
function name(value: unknown): string { if (typeof value !== 'string') throw Error('源对象名称类型无效'); identifier(value); return value; }
/** 只从未引用词识别语法；字符串、注释与包含关键字的名称不能伪造权限或依赖。 */
function word(token: TableDefinitionToken | undefined): string { return token?.kind === 'word' ? token.value.toUpperCase() : ''; }
/** 当前账号的简单全局授权才可采信；角色、部分撤销、认证后缀或未知语法整体降为未知。 */
function grants(rows: readonly Row[], currentUser: string, family: 'mysql' | 'mariadb', context: TableDefinitionContext): { known: boolean; privileges: Set<string> } {
  const privileges = new Set<string>(); let known = rows.length > 0;
  for (const row of rows) {
    const values = Object.values(row); if (values.length !== 1 || typeof values[0] !== 'string') { known = false; continue; }
    let tokens: TableDefinitionToken[]; try { tokens = tableDefinitionTokens(values[0], context); } catch { known = false; continue; }
    if (tokens.at(-1)?.value === ';') tokens.pop();
    const on = tokens.findIndex(token => word(token) === 'ON'), to = tokens.findIndex((token, index) => index > on && word(token) === 'TO');
    if (word(tokens[0]) !== 'GRANT' || on < 2 || to < 0) { known = false; continue; }
    const account = tokens.slice(to + 1), isAccount = (token: TableDefinitionToken | undefined) => token && ['identifier', 'string', 'word'].includes(token.kind);
    if (!isAccount(account[0]) || account[1]?.value !== '@' || !isAccount(account[2]) || `${account[0].value}@${account[2].value}` !== currentUser || account.length !== 3 && !(account.length === 6 && word(account[3]) === 'WITH' && word(account[4]) === 'GRANT' && word(account[5]) === 'OPTION')) { known = false; continue; }
    const scope = tokens.slice(on + 1, to);
    // PROXY 只增加其它身份切换能力，不作为备份权限证据；仍严格核本账号和完整语法。
    if (on === 2 && word(tokens[1]) === 'PROXY' && scope.length === 3 && isAccount(scope[0]) && scope[1]?.value === '@' && isAccount(scope[2])) continue;
    if (scope.length !== 3 || scope.map(token => token.value).join('') !== '*.*' || scope.some(token => token.kind !== 'symbol')) { known = false; continue; }
    const parts: string[] = []; let part: string[] = [];
    for (const token of tokens.slice(1, on)) { if (token.kind === 'symbol' && token.value === ',') { parts.push(part.join(' ')); part = []; } else if (token.kind === 'word') part.push(token.value.toUpperCase()); else known = false; }
    parts.push(part.join(' '));
    if (parts.some(value => !value)) known = false;
    if (parts.includes('ALL') || parts.includes('ALL PRIVILEGES')) {
      if (family !== 'mariadb' || parts.length !== 1) known = false; else permissionNames.forEach(value => privileges.add(value));
    } else parts.forEach(value => privileges.add(value));
  }
  return { known, privileges };
}

/** 数据库选项只接受完整的已知选项语法，原生版本注释也按精确白名单解开，不正则猜依赖。 */
function databaseIndependent(sql: string, database: string, encoding: { characterSet: string; collation: string }, context: TableDefinitionContext): boolean {
  const tokens = tableDefinitionTokens(sql, context); let cursor = 0;
  if (word(tokens[cursor++]) !== 'CREATE' || word(tokens[cursor++]) !== 'DATABASE') return false;
  if (word(tokens[cursor]) === 'IF' && word(tokens[cursor + 1]) === 'NOT' && word(tokens[cursor + 2]) === 'EXISTS') cursor += 3;
  if (tokens[cursor]?.kind !== 'identifier' || tokens[cursor++]?.value !== database) return false;
  const options: TableDefinitionToken[] = [];
  for (const token of tokens.slice(cursor)) {
    if (token.kind !== 'executable') options.push(token);
    else {
      const match = /^\/\*!(40100|80016)\s+([\s\S]*?)\*\/$/.exec(token.value);
      if (!match || match[1] === '80016' && context.dialect !== 'mysql') return false;
      const inner = tableDefinitionTokens(match[2], context); if (inner.some(value => value.kind === 'executable')) return false; options.push(...inner);
    }
  }
  let charset: string | undefined, collation: string | undefined, encryption = false;
  for (let index = 0; index < options.length;) {
    if (options[index].value === ';' && index === options.length - 1) break;
    if (word(options[index++]) !== 'DEFAULT') return false;
    if (word(options[index]) === 'CHARACTER' && word(options[index + 1]) === 'SET') { if (charset !== undefined) return false; index += 2; if (options[index]?.value === '=') index++; if (!['word', 'identifier'].includes(options[index]?.kind ?? '')) return false; charset = options[index++].value; }
    else if (word(options[index]) === 'ENCRYPTION') { if (encryption) return false; encryption = true; index++; if (options[index]?.value === '=') index++; if (options[index]?.kind !== 'string' || options[index++].value !== 'N') return false; }
    else return false;
    if (word(options[index]) === 'COLLATE') { if (collation !== undefined) return false; index++; if (options[index]?.value === '=') index++; if (!['word', 'identifier'].includes(options[index]?.kind ?? '')) return false; collation = options[index++].value; }
  }
  return charset === encoding.characterSet && collation === encoding.collation;
}
/** 复用已有保偏移定义解析器，复杂表达式/未知约束/表尾一律保留摘要并阻断。 */
function tableDependencies(sql: string, database: string, table: string, engine: string, tables: ReadonlySet<string>, version: string, context: TableDefinitionContext): string[] {
  const dependencies: string[] = [], document = parseTableColumnDefinition(sql, context);
  if (document.table !== table || document.database !== undefined && document.database !== database) return ['表定义目标与目录不一致'];
  if (tableDefinitionTokens(sql, context).some(token => token.kind === 'executable')) dependencies.push('表定义含尚未核准的版本可执行片段');
  for (const column of document.columns) {
    if (!column.type.known || column.attributes.some(item => !['nullable', 'default', 'comment', 'charset', 'collation', 'auto-increment', 'on-update', 'visibility'].includes(item.kind)) || column.default.kind === 'opaque' || column.default.kind === 'expression' && !readControlledTimestampDefault(column.default.sql)) dependencies.push(`字段 ${JSON.stringify(column.name)} 的完整依赖尚未证明`);
  }
  const foreign = readTableForeignKeyDefinition(document, database, version), indexes = readTableIndexDefinition(document);
  if (!foreign.complete || indexes.indexes.some(index => index.opaqueReasons.length || !['ordinary', 'primary', 'unique'].includes(index.kind) || index.parts.some(part => !part.columnName || part.expressionSql))) dependencies.push('约束、表达式索引或外键语法尚未完整证明');
  const covered = new Set([...indexes.indexes.map(index => index.range.start), ...foreign.foreignKeys.map(key => key.range.start)]);
  if (document.items.some(item => item.kind === 'constraint' && !covered.has(item.range.start))) dependencies.push('存在尚未证明依赖的约束');
  for (const key of foreign.foreignKeys) if (!key.parentTarget || key.parentTarget.database !== database || !tables.has(key.parentTarget.table)) dependencies.push(`外键 ${JSON.stringify(key.name ?? '')} 引用库外或清单外对象`);
  const tail = tableDefinitionTokens(document.tail.raw, context), options = new Set<string>(); let cursor = 1;
  while (cursor < tail.length) {
    if (tail[cursor].value === ';' && cursor === tail.length - 1) break;
    let key = word(tail[cursor++]); if (key === 'DEFAULT') key = word(tail[cursor++]);
    if (key === 'CHARACTER' && word(tail[cursor]) === 'SET') { cursor++; key = 'CHARSET'; }
    if (!['ENGINE', 'CHARSET', 'COLLATE', 'AUTO_INCREMENT', 'COMMENT'].includes(key)) { dependencies.push('表尾选项、表空间或外部目录依赖尚未证明'); break; }
    if (options.has(key)) { dependencies.push('表尾选项重复，不能证明完整定义'); break; } options.add(key);
    if (tail[cursor]?.value === '=') cursor++;
    const value = tail[cursor++];
    if (!value || key === 'COMMENT' && value.kind !== 'string' || key === 'AUTO_INCREMENT' && (value.kind !== 'number' || !/^\d+$/.test(value.value)) || !['COMMENT', 'AUTO_INCREMENT'].includes(key) && !['word', 'identifier'].includes(value.kind)) { dependencies.push('表尾选项值不完整'); break; }
    if (key === 'ENGINE' && value.value !== engine) dependencies.push('表引擎目录与完整定义不一致');
  }
  if (!options.has('ENGINE')) dependencies.push('表完整定义缺少明确引擎');
  return [...new Set(dependencies)];
}

/** 固定只读源检查：参数化目录、全局权限证明、全类别清单及定义摘要；没有任意 SQL 或会话写入口。 */
export async function inspectDatabaseBackupSource(context: DatabaseBackupSourceContext, binding: DatabaseBackupSourceBinding): Promise<DatabaseBackupSourceInspection> {
  binding = structuredClone(binding);
  name(binding.database);
  if ([binding.connectionId, binding.connectionRevision, binding.sourceLease].some(value => typeof value !== 'string' || !value || value.length > 200 || value.includes('\0')) || !Number.isSafeInteger(binding.threadId) || binding.threadId < 1) throw Error('源检查需要 Root 已登记的连接、修订、租约及物理会话');
  if (/^(mysql|sys|information_schema|performance_schema)$/i.test(binding.database)) throw Error('首阶段不检查系统库备份');
  let used = 0; const blockers: DatabaseBackupBlocker[] = [], dependencies = new Set<string>(), unclassified: { name: string; objectType: string }[] = [], definers: { kind: DatabaseBackupKind; name: string; account: string | null }[] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (binding.endpoint !== 'direct-pinned') block('endpoint-unproven', 'Root 尚未证明直接固定端点与当前源租约，不能将检查结果用于原生备份');
  /** 所有返回字节累计预算；Root 也必须按传入上限在实际读取中拒绝溢出，不可截断后报 complete。 */
  async function read(id: DatabaseBackupSourceRead['id'], sql: string, params: readonly string[] = [], maxRows = 1): Promise<readonly Row[]> {
    context.checkCancelled(); if (used >= limits.bytes) throw new DatabaseBackupSourceLimitError('源元数据超过 2 MiB，未返回截断清单');
    const result = await context.read({ id, sql, params, maxRows, maxBytes: limits.bytes - used, sensitiveResult: true }); context.checkCancelled();
    if (result.complete !== true || !Array.isArray(result.rows) || result.rows.length > maxRows) throw new DatabaseBackupSourceLimitError('源读取未完整结束或行数超出预算，未采信部分结果');
    for (const row of result.rows) for (const [key, value] of Object.entries(row)) {
      used += Buffer.byteLength(key, 'utf8');
      if (typeof value === 'string') used += Buffer.byteLength(value, 'utf8'); else if (Buffer.isBuffer(value)) used += value.length; else if (value instanceof Date) used += 32; else if (value === null || typeof value === 'number' || typeof value === 'boolean') used += 16; else throw Error('源元数据字段类型未知');
      if (used > limits.bytes) throw new DatabaseBackupSourceLimitError('源元数据超过 2 MiB，未返回截断清单');
    }
    return result.rows;
  }
  /** 查询失败只返回安全状态，原 SQL/SHOW GRANTS/驱动错误不缓存、不哈希、不透传。 */
  async function optional(id: DatabaseBackupSourceRead['id'], sql: string, params: readonly string[] = [], maxRows = 1): Promise<readonly Row[] | null> {
    try { return await read(id, sql, params, maxRows); } catch (error) { context.checkCancelled(); if (error instanceof DatabaseBackupSourceLimitError) throw error; if ((error as { code?: unknown })?.code === 'DBARK_BACKUP_SOURCE_LIMIT') throw new DatabaseBackupSourceLimitError('源读取预算超限，未采信部分结果'); block(`read-${id}`, `${id.startsWith('show-') ? '对象定义' : '源目录或权限'}读取未获完整证明`); return null; }
  }
  const versions = await read('version', databaseBackupSourceSql.version), versionRow = versions[0];
  if (versions.length !== 1 || typeof versionRow?.version !== 'string' || typeof versionRow.versionComment !== 'string') throw Error('源数据库版本事实无效');
  const family = /^(?:5\.5\.5-)?\d+\.\d+\.\d+-MariaDB(?:-|$)/i.test(versionRow.version) && !/Percona/i.test(versionRow.versionComment) ? 'mariadb' : /MySQL/i.test(versionRow.versionComment) && !/Percona|MariaDB/i.test(versionRow.versionComment) ? 'mysql' : null;
  const version = versionRow.version.replace(/^5\.5\.5-/, '').match(/^\d+\.\d+\.\d+/)?.[0];
  if (!family || !(family === 'mysql' && version === '8.4.11' && /^8\.4\.11(?:-commercial)?$/.test(versionRow.version) || family === 'mariadb' && version === '11.4.13')) throw Error('源检查当前只验证 MySQL 8.4.11 和 MariaDB 11.4.13 的准确组合');
  /** 会话与实例事实前后核对，MariaDB 不伪造 UUID，实例保证仍依赖 Root 端点/物理会话租约。 */
  async function facts(): Promise<DatabaseBackupSourceInspection['facts']> {
    const rows = await read('facts', databaseBackupSourceSql.facts), row = rows[0]; if (rows.length !== 1 || !row) throw Error('源实例事实数量无效');
    const text = (key: string, max = 300): string => { const value = row[key]; if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw Error('源实例事实字段无效'); return value; };
    const integer = (key: string, min: number, max: number): number => { const value = row[key]; if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw Error('源实例数字事实无效'); return Number(value); };
    const sqlMode = text('sqlMode', 2048); if (!/^[A-Z0-9_,]*$/i.test(sqlMode) || integer('connectionId', 1, 0xffffffff) !== binding.threadId) throw Error('源 SQL 模式或物理会话身份未知');
    const uuidRows = family === 'mysql' ? await read('uuid', databaseBackupSourceSql.uuid) : null, serverUuid = uuidRows?.[0]?.serverUuid;
    if (family === 'mysql' && (uuidRows?.length !== 1 || typeof serverUuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid))) throw Error('MySQL 实例 UUID 未获证明');
    // MySQL 可用会话变量隐藏生成不可见主键；仅读事实，不借 SHOW 零项推断不存在。
    const gipkRows = family === 'mysql' ? await read('gipk', databaseBackupSourceSql.gipk) : null, gipk = gipkRows?.[0]?.generatedPrimaryKeyVisible;
    if (family === 'mysql' && (gipkRows?.length !== 1 || ![0, 1, '0', '1'].includes(gipk as number))) throw Error('生成不可见主键的显示状态未获证明');
    if (row.currentRole !== null && typeof row.currentRole !== 'string') throw Error('当前角色事实无效');
    if (!row.hostname || !row.currentUser) throw Error('源实例主机或当前账号为空');
    return { family: family!, version: version!, versionText: versionRow.version as string, versionComment: versionRow.versionComment as string, hostname: text('hostname'), port: integer('port', 1, 65535), serverId: String(integer('serverId', 0, 0xffffffff)), serverUuid: typeof serverUuid === 'string' ? serverUuid.toLowerCase() : null, generatedPrimaryKeyVisible: family === 'mysql' ? Number(gipk) === 1 : null, currentUser: text('currentUser', 512), currentRole: row.currentRole as string | null, connectionId: binding.threadId, sqlMode, quoteShowCreate: integer('quoteShowCreate', 0, 1), characterSetConnection: text('characterSetConnection', 64), collationConnection: text('collationConnection', 64), identifierCase: integer('identifierCase', 0, 2), ansiQuotes: sqlMode.toUpperCase().split(',').includes('ANSI_QUOTES'), noBackslashEscapes: sqlMode.toUpperCase().split(',').includes('NO_BACKSLASH_ESCAPES'), identityAssurance: family === 'mysql' ? 'mysql-uuid' : 'mariadb-session-and-endpoint' };
  }
  const before = await facts(), lexical: TableDefinitionContext = { dialect: family, mode: { ansiQuotes: before.ansiQuotes, noBackslashEscapes: before.noBackslashEscapes } };
  if (binding.expectedInstance && (Object.entries(binding.expectedInstance).some(([key, value]) => before[key as keyof typeof before] !== value))) throw Error('源实例与 Root 已绑定的事实不一致');
  const normalized = before.quoteShowCreate === 1 && (family !== 'mysql' || before.generatedPrimaryKeyVisible === true) && before.characterSetConnection === 'utf8mb4' && before.collationConnection === 'utf8mb4_bin' && !before.sqlMode.toUpperCase().split(',').some(mode => [...definitionOmittingSqlModes, 'NO_DIR_IN_CREATE'].includes(mode as never));
  if (!normalized) { block('session-definition-incomplete', 'Root 私有会话未提供完整 SHOW CREATE 模式/字符集/引用条件；本模块不会执行 SET 修复'); dependencies.add('完整定义会话条件尚未证明'); }
  const grantRows = await optional('grants', databaseBackupSourceSql.grants, [], 256);
  const grantProof = grantRows ? grants(grantRows, before.currentUser, family, lexical) : { known: false, privileges: new Set<string>() };
  const rolesUnproven = before.currentRole !== null && before.currentRole !== 'NONE';
  if (rolesUnproven || !grantProof.known) block('global-grants-unproven', '当前权限含角色、部分撤销或未识别授权范围，不能证明全局完整可见性');
  const has = (privilege: string) => !rolesUnproven && grantProof.known && grantProof.privileges.has(privilege);
  const evidence: DatabaseBackupSourceEvidence = { connectionId: binding.connectionId, database: binding.database, connectionRevision: binding.connectionRevision, sourceLease: binding.sourceLease, family, version: version!, endpoint: binding.endpoint,
    visibility: Object.fromEntries(databaseBackupKinds.map(kind => [kind, 'unknown'])) as DatabaseBackupSourceEvidence['visibility'], objects: [],
    permissions: { data: has('SELECT') ? 'proven' : 'unknown', definitions: has('SELECT') && has('SHOW VIEW') ? 'proven' : 'unknown', routines: has('SELECT') && (family === 'mysql' || has('SHOW CREATE ROUTINE')) ? 'proven' : 'unknown', events: has('EVENT') ? 'proven' : 'unknown', globalReadLock: (has('RELOAD') || has('FLUSH_TABLES')) && has('LOCK TABLES') ? 'proven' : 'unknown', tablespaces: has('PROCESS') ? 'proven' : 'unknown' },
    lockCapability: { profileId: family === 'mysql' ? 'mysql-8.4-global-read-lock-v1' : 'mariadb-11.4-global-read-lock-v1', versionValidated: '', ddlCoverage: Object.fromEntries(databaseBackupKinds.map(kind => [kind, 'unknown'])) as DatabaseBackupSourceEvidence['visibility'] }, externalDependencies: [] };
  if (binding.lockCapability && binding.lockCapability.evidenceId && binding.lockCapability.family === family && binding.lockCapability.version === version && binding.lockCapability.profileId === evidence.lockCapability.profileId) {
    evidence.lockCapability.versionValidated = version!;
    evidence.lockCapability.ddlCoverage = Object.fromEntries(databaseBackupKinds.map(kind => [kind, binding.lockCapability!.ddlCoverage[kind] === 'proven' ? 'proven' : 'unknown'])) as DatabaseBackupSourceEvidence['visibility'];
  }
  if (databaseBackupKinds.some(kind => evidence.lockCapability.ddlCoverage[kind] !== 'proven')) block('lock-capability-unproven', '全对象锁能力仍未知，只接受 Root 的准确版本证明，未假定 FTWRL 覆盖所有 DDL');
  const schemas = await optional('schemas', databaseBackupSourceSql.schemas, [binding.database], 2);
  if (!schemas || schemas.length !== 1 || schemas[0].name !== binding.database) throw Error('未能证明所选数据库唯一存在且原名一致');
  if (typeof schemas[0].characterSet !== 'string' || !schemas[0].characterSet || typeof schemas[0].collation !== 'string' || !schemas[0].collation) throw Error('数据库字符集或排序规则目录事实缺失');
  const databaseEncoding = { characterSet: schemas[0].characterSet, collation: schemas[0].collation };
  const entries: { kind: DatabaseBackupKind; name: string; engine?: string; definer?: string | null }[] = [{ kind: 'database', name: binding.database }];
  const catalogs: Partial<Record<'tables' | 'triggers' | 'routines' | 'events', boolean>> = {};
  for (const id of ['tables', 'triggers', 'routines', 'events'] as const) {
    const rows = await optional(id, databaseBackupSourceSql[id], [binding.database], 10001); catalogs[id] = rows !== null; if (!rows) continue;
    for (const row of rows) {
      const objectName = name(row.name); let kind: DatabaseBackupKind | undefined;
      if (id === 'tables') kind = row.objectType === 'BASE TABLE' ? 'table' : row.objectType === 'VIEW' ? 'view' : undefined;
      else if (id === 'routines') kind = row.routineType === 'PROCEDURE' ? 'procedure' : row.routineType === 'FUNCTION' ? 'function' : undefined;
      else kind = id === 'triggers' ? 'trigger' : 'event';
      if (!kind) { unclassified.push({ name: objectName, objectType: String(row.objectType ?? row.routineType ?? '未知') }); dependencies.add(`未覆盖对象类型：${JSON.stringify(objectName)}`); block('unknown-object-type', `保留未覆盖对象 ${JSON.stringify(objectName)}，不能称整库范围完整`); }
      else entries.push({ kind, name: objectName, ...(kind === 'table' ? { engine: typeof row.engine === 'string' ? row.engine : '' } : {}), ...(['view', 'trigger', 'procedure', 'function', 'event'].includes(kind) ? { definer: typeof row.definer === 'string' ? row.definer : null } : {}) });
      if (entries.length + unclassified.length > limits.objects) throw new DatabaseBackupSourceLimitError('源对象超过 10000，未截断或降级为部分备份');
    }
  }
  const viewRows = await optional('views', databaseBackupSourceSql.views, [binding.database], 10001), viewEntries = entries.filter(entry => entry.kind === 'view'), viewSeen = new Set<string>();
  if (viewRows) for (const row of viewRows) { const viewName = name(row.name), entry = viewEntries.find(value => value.name === viewName); if (!entry || viewSeen.has(viewName)) throw Error('视图与表目录不一致或重复'); viewSeen.add(viewName); entry.definer = typeof row.definer === 'string' && row.definer.length <= 600 ? row.definer : null; }
  if (viewRows && viewSeen.size !== viewEntries.length) throw Error('视图目录缺少已发现对象，未采信部分范围');
  const visible = { database: has('SHOW DATABASES') && has('SELECT'), table: has('SELECT') && catalogs.tables, view: has('SELECT') && has('SHOW VIEW') && catalogs.tables && viewRows !== null, trigger: has('TRIGGER') && catalogs.triggers, procedure: evidence.permissions.routines === 'proven' && catalogs.routines, function: evidence.permissions.routines === 'proven' && catalogs.routines, event: has('EVENT') && catalogs.events };
  for (const kind of databaseBackupKinds) evidence.visibility[kind] = visible[kind] && normalized && !unclassified.length ? 'proven' : 'unknown';
  const seen = new Set<string>(), tableNames = new Set(entries.filter(entry => entry.kind === 'table').map(entry => entry.name)), objects: DatabaseBackupObject[] = [];
  const show = { database: ['DATABASE', 'Create Database', 'Database'], table: ['TABLE', 'Create Table', 'Table'], view: ['VIEW', 'Create View', 'View'], trigger: ['TRIGGER', 'SQL Original Statement', 'Trigger'], procedure: ['PROCEDURE', 'Create Procedure', 'Procedure'], function: ['FUNCTION', 'Create Function', 'Function'], event: ['EVENT', 'Create Event', 'Event'] } as const;
  for (const entry of entries) {
    const key = JSON.stringify([entry.kind, entry.name]); if (seen.has(key)) throw Error('源清单存在重复对象身份'); seen.add(key);
    if (!['database', 'table'].includes(entry.kind)) definers.push({ kind: entry.kind, name: entry.name, account: entry.definer ?? null });
    const [verb, field, identity] = show[entry.kind], rows = await optional(`show-${entry.kind}`, `SHOW CREATE ${verb} ${entry.kind === 'database' ? identifier(entry.name) : qualified(binding.database, entry.name)}`);
    const sql = rows?.length === 1 && rows[0][identity] === entry.name && typeof rows[0][field] === 'string' && (rows[0][field] as string).length ? rows[0][field] as string : null;
    objects.push({ kind: entry.kind, name: entry.name, definitionSha256: sql === null ? null : createHash('sha256').update(sql, 'utf8').digest('hex'), ...(entry.engine === undefined ? {} : { engine: entry.engine }) });
    if (sql === null) { block('definition-missing', `${entry.kind} ${JSON.stringify(entry.name)} 缺少完整 SHOW CREATE 定义`); evidence.visibility[entry.kind] = 'unknown'; continue; }
    try {
      if (entry.kind === 'database') { if (!databaseIndependent(sql, binding.database, databaseEncoding, lexical)) dependencies.add('数据库完整选项、字符集/排序规则或加密依赖尚未证明'); }
      else if (entry.kind === 'table') {
        if (!['InnoDB', 'MyISAM', 'MEMORY'].includes(entry.engine ?? '')) dependencies.add(`表 ${JSON.stringify(entry.name)} 的引擎依赖尚未验证`);
        tableDependencies(sql, binding.database, entry.name, entry.engine ?? '', tableNames, version!, lexical).forEach(reason => dependencies.add(`表 ${JSON.stringify(entry.name)}：${reason}`));
      } else dependencies.add(`${entry.kind} ${JSON.stringify(entry.name)} 的 DEFINER/完整程序依赖待验证`);
    } catch { dependencies.add(`${entry.kind} ${JSON.stringify(entry.name)} 的完整依赖解析未通过`); }
  }
  const grantsAfter = await optional('grants', databaseBackupSourceSql.grants, [], 256), afterGrantProof = grantsAfter ? grants(grantsAfter, before.currentUser, family, lexical) : { known: false, privileges: new Set<string>() };
  if (grantProof.known !== afterGrantProof.known || JSON.stringify([...grantProof.privileges].sort()) !== JSON.stringify([...afterGrantProof.privileges].sort())) throw Error('全局权限证据在检查期间变化，未采信该批范围');
  const after = await facts(); if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('源实例、账号或会话事实在检查期间变化；未采信该批证据');
  evidence.objects = objects; evidence.externalDependencies = [...dependencies];
  for (const [permission, proof] of Object.entries(evidence.permissions)) if (proof !== 'proven') block(`permission-${permission}`, '原生整库备份所需的全局权限不足或未知');
  for (const kind of databaseBackupKinds) if (evidence.visibility[kind] !== 'proven') block(`visibility-${kind}`, `${kind} 类别的完整可见性未获证明，即使当前目录返回零项也不能当作不存在`);
  if (dependencies.size) block('dependencies-unproven', '保留了全部可见定义摘要，但存在跨库、DEFINER 或未知依赖，禁止声明可独立恢复');
  context.checkCancelled(); return { evidence, facts: before, blockers, unclassified, definers, metadataBytes: used, actualLockHeld: false };
}
