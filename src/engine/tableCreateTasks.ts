import { tableCreateDraftSchema, tableCreateHasPrefix, tableCreateIndexParts, tableCreateLegacyDesign, type TableCreateDraft, type TableCreatePrefixFacts } from '../shared/tableCreate';
import { readTableCreateIndexFacts } from './tableCreateIndexFacts';
import { planTableCreateIndexes, type TableCreateIndexPlan } from './tableCreateIndexPlan';
import { verifyCreatedPrefixIndexes } from './tableCreateIndexVerification';
import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery as query, type StructureTaskContext, type StructureTaskHost } from './structureDefinition';
import { buildDesign, buildPrefixTableDesign, qualified, mariaDefault, temporalDefault } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { readCreatedForeignKeys, verifyCreatedForeignKeyCatalog } from './tableCreateForeignKeyVerification';
import { readTableDefaultEncodingCatalog } from './tableDefaultEncodingCatalog';
import { readTableDefaultEncodingDefinition } from './tableDefaultEncodingSql';
import { validateTableEncodingPair, sameTableEncodingPair } from '../shared/tableDefaultEncoding';
import type { TableCreateEncodingCatalog } from '../shared/tableCreate';
import { readMysql57CreateCapabilities, assertMysql57CreateDesign, type Mysql57CreateCapabilities } from './tableCreateMysql57';
import { definitionOmittingSqlModes } from '../shared/tableColumnPatches';
import { tableCreateAcknowledgements, tableCreateConfirmation, tableCreateDesignSchema, tableCreateMessages as text, type TableCreateDesign, type TableCreateGetInput, type TableCreateGetOutput, type TableCreatePreviewInput, type TableCreatePreviewOutput, type TableCreateApplyInput, type TableCreateApplyOutput, type TableCreateReleaseInput, type TableCreateProgress } from '../shared/tableCreate';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
const progressOf = (): TableCreateProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
interface Read { identity: string; serverKey: string; mode: string; noBackslash: boolean; bytes: number; version: string; lowerNames: number; mysql57?: Mysql57CreateCapabilities; }
interface Snapshot extends Read { connectionId: string; database: string; revision: number; expires: number; encodings?: TableCreateEncodingCatalog; prefixFacts?: TableCreatePrefixFacts; }
interface Preview { snapshotId: string; snapshot: Snapshot; design: TableCreateDraft; prefixPlan?: TableCreateIndexPlan; target: { connectionId: string; database: string; table: string }; designDigest: string; sql: string; bytes: number; expires: number; }
/** 选项只能来自完整实际目录；没有显式collation的旧调用不读取目录、不猜默认值。 */
function selectedEncoding(design: TableCreateDraft, snapshot: Snapshot) {
  if (design.collation === undefined) return;
  const selection = validateTableEncodingPair({ charset: design.charset, collation: design.collation });
  if (!snapshot.encodings?.digest || snapshot.encodings.reasons.length || !snapshot.encodings.candidates.some(pair => sameTableEncodingPair(pair, selection))) throw Error(text.encodingInvalid);
  return selection;
}
/** 目录摘要含完整候选及警告；取消、权限、预算或目录变化均不能沿旧配对继续发送。 */
async function recheckEncoding(context: StructureTaskContext, snapshot: Snapshot, design: TableCreateDraft) {
  if (!selectedEncoding(design, snapshot)) return;
  const current = await readTableDefaultEncodingCatalog(context);
  if (current.digest !== snapshot.encodings!.digest) throw Error(text.encodingStale);
}
/** 前缀事实仅在专用请求读取；预览与执行重读同一完整摘要，旧无前缀路径不增加能力门。 */
async function recheckPrefix(context: StructureTaskContext, snapshot: Snapshot, design: TableCreateDraft) {
  if (!tableCreateHasPrefix(design)) return;
  if (!snapshot.prefixFacts || (await readTableCreateIndexFacts(context)).digest !== snapshot.prefixFacts.digest) throw Error('前缀新表服务器能力或MAXLEN目录已变化，请重新准备');
}
/** 读取实际会话与准确数据库；保留编码目录绑定，5.x追加准确能力，8.x/Maria沿原路径。 */
async function read(context: StructureTaskContext, database: string): Promise<Read> {
  if (['mysql', 'information_schema', 'performance_schema', 'sys'].includes(database.toLowerCase())) throw Error(text.database);
  const rows = (await query<Record<string, unknown>[]>(context, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS currentUser,@@sql_mode AS sqlMode,@@lower_case_table_names AS lowerNames,@@character_set_connection AS charset,@@collation_connection AS collation')).rows;
  const row = rows?.[0];
  if (rows?.length !== 1 || !row || ['hostname', 'currentUser', 'sqlMode', 'charset', 'collation'].some(key => typeof row[key] !== 'string') || ![0, 1, 2].includes(Number(row.lowerNames)) || !/^\d+$/.test(String(row.port)) || !/^\d+$/.test(String(row.serverId))) throw Error(text.identity);
  let uuid: string | undefined;
  if (context.managed.status.dialect === 'mysql') { const values = (await query<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows; if (values?.length !== 1 || !values[0].uuid) throw Error(text.identity); uuid = values[0].uuid; }
  const schemas = (await query<{ name: string; charset: string; collation: string }[]>(context, `SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=${literal(database)} LIMIT 2`)).rows;
  if (schemas?.length !== 1 || schemas[0].name !== database || !schemas[0].charset || !schemas[0].collation) throw Error(text.database);
  // 5.x不能仅凭通用列目录被当成已准备版本；准确5.7事实纳入每次身份重核，其他方言沿原边界。
  const mysql57 = context.managed.status.dialect === 'mysql' && /^5(?:\.|$)/.test(context.managed.status.version) ? await readMysql57CreateCapabilities(context) : undefined;
  return { identity: hash([row, uuid, context.managed.status.dialect, context.managed.status.version, schemas[0], ...(mysql57 ? [mysql57] : [])]), serverKey: hash([row.hostname, row.port, row.serverId, uuid, context.managed.status.dialect]), mode: String(row.sqlMode), noBackslash: String(row.sqlMode).split(',').includes('NO_BACKSLASH_ESCAPES'), bytes: 8192 + (mysql57 ? Buffer.byteLength(JSON.stringify(mysql57)) : 0), version: context.managed.status.version, lowerNames: Number(row.lowerNames), ...(mysql57 ? { mysql57 } : {}) };
}
/** 预查不替代CREATE自身的并发裁决，大小写映射由服务器实际目录决定。 */
async function absent(context: StructureTaskContext, database: string, table: string): Promise<void> {
  const rows = (await query<unknown[]>(context, `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=${literal(database)} AND TABLE_NAME=${literal(table)} LIMIT 2`)).rows;
  if (!Array.isArray(rows) || rows.length) throw Error(text.occupied);
}
/** NULL字符集补证只允许设计器能表达的表选项；通用编码解析器认可的其余属性不能当作已核验。 */
function verifyMariaCreateOptions(document: ReturnType<typeof parseTableColumnDefinition>, design: Pick<TableCreateDraft, 'engine' | 'charset' | 'comment'>, actual: { engine: string; collation: string; comment: string }): boolean {
  const tokens = tableDefinitionTokens(document.tail.raw, document.context), options = new Map<string, { kind: string; value: string }>();
  if (tokens[0]?.kind !== 'symbol' || tokens[0].value !== ')') return false;
  let cursor = 1;
  while (cursor < tokens.length) {
    if (tokens[cursor].kind === 'symbol' && tokens[cursor].value === ';' && cursor === tokens.length - 1) break;
    let token = tokens[cursor++], isDefault = false;
    if (token.kind === 'word' && token.value.toUpperCase() === 'DEFAULT') { isDefault = true; token = tokens[cursor++]; }
    if (token?.kind !== 'word') return false;
    let key = token.value.toUpperCase();
    if (key === 'CHARACTER') { const set = tokens[cursor++]; if (set?.kind !== 'word' || set.value.toUpperCase() !== 'SET') return false; key = 'CHARSET'; }
    if (!['ENGINE', 'CHARSET', 'COLLATE', 'COMMENT'].includes(key) || options.has(key) || isDefault && !['CHARSET', 'COLLATE'].includes(key)) return false;
    if (tokens[cursor]?.kind === 'symbol' && tokens[cursor].value === '=') cursor++;
    const value = tokens[cursor++];
    if (!value || (key === 'COMMENT' ? value.kind !== 'string' : !['word', 'identifier'].includes(value.kind))) return false;
    options.set(key, value);
  }
  // 省略空注释可由设计和目录共同确认；引擎与完整编码必须显式出现，且两份实际证据不能互相矛盾。
  const engine = options.get('ENGINE')?.value, comment = options.get('COMMENT')?.value ?? '';
  return typeof engine === 'string' && typeof actual.engine === 'string' && engine.toUpperCase() === design.engine.toUpperCase() && engine.toUpperCase() === actual.engine.toUpperCase() && options.get('CHARSET')?.value === design.charset && options.get('COLLATE')?.value === actual.collation && comment === design.comment && comment === actual.comment;
}
/** 只读核指定新表的列、索引和外键；未知规范化一律保守未核验，不能反推同名对象归属。 */
async function verify(context: StructureTaskContext, preview: Preview): Promise<boolean> {
  const { database, table } = preview.target, design = preview.design;
  const ddl = (await query<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(database, table)}`)).rows;
  if (ddl?.length !== 1 || typeof ddl[0]['Create Table'] !== 'string' || Buffer.byteLength(String(ddl[0]['Create Table'])) > 2 * 1024 * 1024) return false;
  if (preview.snapshot.mode.split(',').some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode.toUpperCase()))) return false;
  const document = parseTableColumnDefinition(String(ddl[0]['Create Table']), { dialect: context.managed.status.dialect, mode: { noBackslashEscapes: preview.snapshot.noBackslash, ansiQuotes: preview.snapshot.mode.split(',').includes('ANSI_QUOTES') } });
  if (design.collation !== undefined) {
    const actual = readTableDefaultEncodingDefinition(document.source, document.context);
    if (actual.reasons.length || actual.charset !== design.charset || actual.collation !== design.collation) return false;
  }
  const foreignKeys = design.foreignKeys.length ? readCreatedForeignKeys(document, tableCreateLegacyDesign(design), context.managed.status.version) : undefined;
  // 只排除已按完整语义证明的FK原范围；未知约束和自动新增索引仍交给原索引守卫拒绝。
  const indexDocument = foreignKeys ? { ...document, items: document.items.filter(item => !foreignKeys.foreignKeys.some(key => key.range.start === item.range.start && key.range.end === item.range.end)) } : document;
  if (document.table !== table || document.database !== undefined && document.database !== database || document.columns.length !== design.columns.length || indexDocument.items.filter(item => item.kind === 'constraint').length !== design.indexes.length || indexDocument.items.some(item => item.kind === 'constraint' && !['PRIMARY', 'UNIQUE', 'KEY', 'INDEX'].includes(item.constraintKind)) || document.columns.some(column => !column.type.known || column.attributes.some(attribute => !['nullable', 'default', 'comment', 'auto-increment'].includes(attribute.kind)))) return false;
  /** 仅规范化未引用关键字和无ZEROFILL整数显示宽度；ENUM/SET文字量逐字保留解码后的值。 */
  const type = (value: string) => {
    const tokens = tableDefinitionTokens(value, document.context).map(token => ({ kind: token.kind, value: token.kind === 'word' ? token.value.toUpperCase() : token.value }));
    if (!tokens.length || tokens.some(token => !['word', 'number', 'string', 'symbol'].includes(token.kind))) throw Error('字段类型包含未证明的词法属性');
    if (tokens[0].kind === 'word' && tokens[0].value === 'INTEGER') tokens[0].value = 'INT';
    if (/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)$/.test(tokens[0].value) && !tokens.some(token => token.kind === 'word' && token.value === 'ZEROFILL') && tokens[1]?.value === '(' && tokens[2]?.kind === 'number' && /^\d+$/.test(tokens[2].value) && tokens[3]?.value === ')') tokens.splice(1, 3);
    return JSON.stringify(tokens);
  };
  const temporal = (value: string) => value.toUpperCase().replace(/\(\)$/, '');
  // SHOW CREATE与目录必须同时支持本次设计，不能将两次不一致的读取拼成一次核验成功。
  if (document.columns.some((column, index) => {
    const expected = design.columns[index], value = column.default;
    if (column.name !== expected.name || type(column.type.raw) !== type(expected.type) || column.attributes.some(attribute => attribute.kind === 'auto-increment') !== expected.autoIncrement || column.comment !== undefined && column.comment !== expected.comment || column.nullable !== undefined && column.nullable !== expected.nullable) return true;
    if (expected.defaultValue === undefined) return value.kind !== 'none' && !(expected.nullable && value.kind === 'null');
    if (expected.defaultValue === null) return value.kind !== 'null';
    if (/^(?:DATE|TIME|DATETIME|TIMESTAMP)\b/i.test(expected.type) && temporalDefault(expected.defaultValue)) return value.kind !== 'expression' || temporal(value.sql) !== temporal(expected.defaultValue);
    return value.kind !== 'literal' || value.value !== expected.defaultValue;
  })) return false;
  if (!preview.prefixPlan) {
  // 设计器仅表达普通完整列索引；SHOW中的前缀、方法、方向及未知属性不能靠名称/列序补证。
  const parsedIndexes = readTableIndexDefinition(indexDocument);
  if (parsedIndexes.otherConstraintRanges.length || parsedIndexes.indexes.length !== design.indexes.length || design.indexes.some(expected => {
    const actual = parsedIndexes.indexes.find(index => index.name === expected.name);
    return !actual || actual.kind !== (expected.name === 'PRIMARY' ? 'primary' : expected.unique ? 'unique' : 'ordinary') || actual.method !== 'BTREE' || actual.comment !== '' || actual.opaqueReasons.length > 0 || actual.attributes.some(attribute => attribute.kind !== 'method') || actual.parts.length !== tableCreateIndexParts(expected).length || actual.parts.some((part, index) => part.columnName !== tableCreateIndexParts(expected)[index].columnName || part.prefixLength !== undefined || part.direction !== 'asc' || part.expressionSql !== undefined || part.opaqueReasons.length > 0);
  })) return false;
  }
  const tables = (await query<{ name: string; engine: string; charset: string | null; collation: string; comment: string }[]>(context, `SELECT t.TABLE_NAME AS name,t.ENGINE AS engine,c.CHARACTER_SET_NAME AS charset,t.TABLE_COLLATION AS collation,t.TABLE_COMMENT AS comment FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME=t.TABLE_COLLATION WHERE t.TABLE_SCHEMA=${literal(database)} AND t.TABLE_NAME=${literal(table)} LIMIT 2`)).rows;
  if (tables?.length !== 1 || tables[0].name !== table || tables[0].engine?.toUpperCase() !== design.engine.toUpperCase() || tables[0].comment !== design.comment) return false;
  let actualCharset = tables[0].charset;
  // Maria通用UCA排序规则可能没有一对一目录映射；仅用完整SHOW的显式编码与TABLES实际排序规则交叉补证。
  if (context.managed.status.dialect === 'mariadb' && actualCharset === null) {
    const encoding = readTableDefaultEncodingDefinition(document.source, document.context);
    if (encoding.reasons.length || !encoding.charset || !encoding.collation || typeof tables[0].collation !== 'string' || !tables[0].collation || encoding.charset !== design.charset || encoding.collation !== tables[0].collation || !verifyMariaCreateOptions(document, design, tables[0])) return false;
    actualCharset = encoding.charset;
  }
  if (actualCharset !== design.charset) return false;
  if (design.collation !== undefined && tables[0].collation !== design.collation) return false;
  const condition = `TABLE_SCHEMA=${literal(database)} AND TABLE_NAME=${literal(table)}`;
  const columns = (await query<{ name: string; type: string; nullable: string; defaultValue: string | null; extra: string; comment: string }[]>(context, `SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${condition} ORDER BY ORDINAL_POSITION LIMIT 1001`)).rows;
  if (!Array.isArray(columns) || columns.length !== design.columns.length || columns.some((column, index) => {
    const expected = design.columns[index], actualDefault = context.managed.status.dialect === 'mariadb' ? mariaDefault(column.defaultValue, preview.snapshot.noBackslash) : column.defaultValue;
    const sameDefault = expected.defaultValue === undefined ? actualDefault === null : expected.defaultValue === null ? actualDefault === null : temporalDefault(expected.defaultValue) && /^(?:DATE|TIME|DATETIME|TIMESTAMP)\b/i.test(expected.type) ? String(actualDefault).toUpperCase().replace(/\(\)$/, '') === expected.defaultValue.toUpperCase().replace(/\(\)$/, '') : actualDefault === expected.defaultValue;
    return column.name !== expected.name || type(column.type) !== type(expected.type) || !['YES', 'NO'].includes(column.nullable) || (column.nullable === 'YES') !== expected.nullable || /auto_increment/i.test(column.extra) !== expected.autoIncrement || column.comment !== expected.comment || !sameDefault;
  })) return false;
  if (preview.prefixPlan) return !!preview.snapshot.prefixFacts && await verifyCreatedPrefixIndexes(context, preview.target, design, preview.prefixPlan, preview.snapshot.prefixFacts, document);
  const indexes = (await query<{ name: string; nonUnique: number; column: string; sequence: number; subPart: number | null; method: string; direction: string | null; comment: string }[]>(context, `SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,COLUMN_NAME AS \`column\`,SEQ_IN_INDEX AS sequence,SUB_PART AS subPart,INDEX_TYPE AS method,COLLATION AS direction,INDEX_COMMENT AS comment FROM information_schema.STATISTICS WHERE ${condition} ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 4097`)).rows;
  if (!Array.isArray(indexes) || indexes.length >= 4097) return false;
  const actual = new Map<string, { name: string; unique: boolean; columns: string[] }>();
  for (const index of indexes) {
    const entry = actual.get(index.name) ?? { name: index.name, unique: !Number(index.nonUnique), columns: [] };
    if (typeof index.name !== 'string' || !index.name || typeof index.column !== 'string' || index.subPart !== null || index.method !== 'BTREE' || index.direction !== 'A' || index.comment !== '' || ![0, 1].includes(Number(index.nonUnique)) || entry.unique !== !Number(index.nonUnique) || Number(index.sequence) !== entry.columns.length + 1) return false;
    entry.columns.push(index.column); actual.set(index.name, entry);
  }
  if (actual.size !== design.indexes.length || design.indexes.some(index => JSON.stringify(actual.get(index.name)) !== JSON.stringify({ name: index.name, unique: index.name === 'PRIMARY' || index.unique, columns: tableCreateIndexParts(index).map(part => part.columnName) }))) return false;
  // 无FK路径不增加目录或SHOW读取；有FK时两套目录和复读SHOW全部完成才可报告完整核验。
  return !foreignKeys || await verifyCreatedForeignKeyCatalog(context, { database, table }, document, foreignKeys);
}
/** 新建表独立用途，预览持有完整设计且有界；同步目标锁一直覆盖实际会话收尾。 */
export class TableCreateTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  private readonly executing = new Set<string>();
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('tableCreate', 'snapshot', value => ({ connectionId: value.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('tableCreate', 'preview', value => ({ connectionId: value.snapshot.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 修订来自主进程，不接受renderer覆盖；非法修订不形成能力。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw Error(text.stale); return value as number; }
  /** 释放只撤销本用途的能力，不取消执行或放开未确认的目标锁。 */
  releaseTokens(input: TableCreateReleaseInput): void { if (input.snapshotId) { this.snapshots.delete(input.snapshotId); for (const [id, value] of this.previews) if (value.snapshotId === input.snapshotId) this.previews.delete(id); } if (input.previewToken) this.previews.delete(input.previewToken); }
  /** 只读实际服务器与库，短会话完整释放后才发布快照。 */
  async get(input: TableCreateGetInput, revision: unknown): Promise<TableCreateGetOutput> {
    const parsed = tableCreateDesignSchema.shape.database.safeParse(input.database); if (!parsed.success) throw Error(text.database);
    const actualRevision = this.revision(revision), progress = progressOf(), id = randomUUID(); let snapshot!: Snapshot;
    const result = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const actual = await read(context, input.database);
      let encodings: TableCreateEncodingCatalog | undefined, catalogBytes = 0;
      if (input.includeEncodings) {
        try { const catalog = await readTableDefaultEncodingCatalog(context); catalogBytes = catalog.bytes; encodings = { candidates: catalog.candidates, digest: catalog.digest, warnings: catalog.warnings, reasons: [] }; }
        catch { context.checkCancelled(); encodings = { candidates: [], warnings: [], reasons: [text.encodingUnavailable] }; }
      }
      const prefixFacts = input.includePrefixFacts ? await readTableCreateIndexFacts(context) : undefined;
      snapshot = { ...actual, bytes: actual.bytes + catalogBytes + (prefixFacts ? Buffer.byteLength(JSON.stringify(prefixFacts)) : 0), ...(prefixFacts ? { prefixFacts } : {}), ...(encodings ? { encodings } : {}), connectionId: input.connectionId, database: input.database, revision: actualRevision, expires: this.now() + structureCacheLimits.ttlMs }; this.cache.capacity(snapshot.bytes, 'snapshot');
      return { target: { connectionId: input.connectionId, database: input.database }, snapshotId: id, expiresAt: new Date(snapshot.expires).toISOString(), serverVersion: actual.version, warnings: [...text.warnings], ...(prefixFacts ? { prefixFacts: structuredClone(prefixFacts) } : {}), ...(encodings ? { encodings: structuredClone(encodings) } : {}) };
    }, { label: text.labels.get, purpose: 'tableCreate', progress });
    this.snapshots.set(id, snapshot); return result;
  }
  /** 固定结构化草稿、模式和准确目标；重核完成且来源仍有效才签发预览。 */
  async preview(input: TableCreatePreviewInput, revision: unknown): Promise<TableCreatePreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error(text.stale);
    const parsed = tableCreateDraftSchema.safeParse(input.design); if (!parsed.success) throw Error(text.invalid);
    const design = structuredClone(parsed.data); if (design.database !== snapshot.database) throw Error(text.invalid);
    if (snapshot.mysql57) assertMysql57CreateDesign(tableCreateLegacyDesign(design), snapshot.mysql57, snapshot.mode);
    const designDigest = hash(design); if (Buffer.byteLength(JSON.stringify(design)) > 2 * 1024 * 1024) throw Error(text.size);
    const encoding = selectedEncoding(design, snapshot);
    const prefix = tableCreateHasPrefix(design); if (prefix && !snapshot.prefixFacts) throw Error('前缀新表缺少本次实际服务器能力快照');
    const prefixPlan = prefix ? planTableCreateIndexes(design, snapshot.prefixFacts!) : undefined;
    const generated = prefix ? buildPrefixTableDesign(design, snapshot.prefixFacts!, snapshot.noBackslash, encoding) : buildDesign(tableCreateLegacyDesign(design), undefined, snapshot.noBackslash, encoding); if (generated.statements.length !== 1 || !generated.sql.startsWith('CREATE TABLE ')) throw Error(text.invalid);
    const token = randomUUID(), preview: Preview = { snapshotId: input.snapshotId, snapshot, design, ...(prefixPlan ? { prefixPlan } : {}), target: { connectionId: snapshot.connectionId, database: snapshot.database, table: design.name }, designDigest, sql: generated.sql, bytes: snapshot.bytes + Buffer.byteLength(JSON.stringify(design)) + Buffer.byteLength(generated.sql) + (prefixPlan ? Buffer.byteLength(JSON.stringify(prefixPlan)) : 0) + 2048, expires: snapshot.expires }, progress = progressOf();
    await this.host.run(snapshot.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); if ((await read(context, snapshot.database)).identity !== snapshot.identity) throw Error(text.identity); await absent(context, snapshot.database, design.name);
      await recheckEncoding(context, snapshot, design); await recheckPrefix(context, snapshot, design);
    }, { label: text.labels.preview, purpose: 'tableCreate', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error(text.stale);
    this.previews.set(token, preview); return { target: { ...preview.target }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), designDigest, sql: preview.sql, warnings: [...text.warnings, ...(design.foreignKeys.length ? [text.foreignKeys] : [])], requiredAcknowledgements: [...tableCreateAcknowledgements], ...(encoding ? { encoding: { selection: encoding, catalogDigest: snapshot.encodings!.digest! } } : {}) };
  }
  /** 第一次await前消费预览并占用目标；任何失败都不重放、覆盖或DROP补救。 */
  async apply(input: TableCreateApplyInput, revision: unknown): Promise<TableCreateApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now() || preview.snapshot.revision !== this.revision(revision)) throw Error(text.stale);
    if (input.confirmation !== tableCreateConfirmation(preview.target) || input.acknowledgements.length !== tableCreateAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || tableCreateAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw Error(text.confirmation);
    const snapshot = preview.snapshot, key = JSON.stringify([snapshot.serverKey, snapshot.database.toLowerCase(), preview.target.table.toLowerCase()]);
    if (this.executing.has(key) || this.executing.size >= 32) throw Error(text.busy); this.executing.add(key);
    const progress = progressOf(); let output: TableCreateApplyOutput | undefined, released = false;
    try {
      const result = await this.host.run(snapshot.connectionId, input.taskId, async context => {
        progress.phase = 'rechecking'; context.report(); if ((await read(context, snapshot.database)).identity !== snapshot.identity) throw Error(text.identity); await absent(context, snapshot.database, preview.target.table);
        await recheckEncoding(context, snapshot, preview.design); await recheckPrefix(context, snapshot, preview.design);
        if (this.snapshots.get(preview.snapshotId) !== snapshot || preview.expires <= this.now()) throw Error(text.stale);
        progress.phase = 'executing'; context.report();
        const result = (await query<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
        if (!result || typeof result.affectedRows !== 'number') throw Error(text.ack);
        progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
        output = { target: { ...preview.target }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, resourcesReleased: false, warnings: [] };
        try { await recheckEncoding(context, snapshot, preview.design); await recheckPrefix(context, snapshot, preview.design); output.definitionVerified = progress.definitionVerified = (await read(context, snapshot.database)).identity === snapshot.identity && await verify(context, preview); } catch { /* ACK事实已成立，后核失败不能变回未执行或自动重放。 */ }
        if (!output.definitionVerified) output.warnings.push(text.verify); if (result.warningStatus) output.warnings.push(text.serverWarning);
        context.report(); this.releaseTokens({ snapshotId: preview.snapshotId }); return output;
      }, { label: text.labels.apply, purpose: 'tableCreate', progress, executionTarget: { database: snapshot.database, table: preview.target.table }, onResourcesReleased: () => { released = true; } });
      result.resourcesReleased = released; return result;
    } catch (reason) {
      // 成功ACK后关闭失败仍回传独立事实；未确认收尾的目标锁保留，避免另一窗口再次投递。
      if (output?.ddlCompleted) { output.resourcesReleased = released; if (!released) output.warnings.push(text.cleanup); return output; } throw reason;
    } finally {
      // 必须同时有可信收尾事实和确定的DDL状态；发送前正常取消可新预览，DDL/关闭未知仍锁定。
      if (released && (!progress.ddlSubmitted || progress.ddlCompleted)) this.executing.delete(key);
    }
  }
}
