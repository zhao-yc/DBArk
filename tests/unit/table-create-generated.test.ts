import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { compileGeneratedColumnExpression, compileResolvedGeneratedColumnExpression } from '../../src/engine/tableGeneratedColumn';
import { assertTableCreateGeneratedFacts, planTableCreateGeneratedColumns, readTableCreateGeneratedFacts, verifyCreatedGeneratedColumns, type TableCreateGeneratedFacts } from '../../src/engine/tableCreateGeneratedColumns';
import { tableCreateAcknowledgements, tableCreateDraftSchema, tableCreateHasGenerated, tableCreateLegacyDesign, tableCreateRequiredAcknowledgements, type TableCreateDraft } from '../../src/shared/tableCreate';
import { assertTableCreateGenerated, tableCreateGeneratedReferenceColumns, tableCreateNumericType } from '../../src/shared/tableCreateGenerated';
import { parseGeneratedColumnExpression } from '../../src/shared/tableGeneratedColumn';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';

/** 全部为待建声明；不存在COLUMNS、access或伪造的既有字段身份。 */
function draft(): TableCreateDraft {
  return { database: '库`名', name: '新`表', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [
    { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, autoIncrement: true, comment: '' },
    { name: '数量', type: 'INT', nullable: false, autoIncrement: false, comment: '' },
    { name: '单`价', type: 'DECIMAL(35,30)', nullable: true, autoIncrement: false, comment: '' },
    { name: '虚拟', type: 'DECIMAL(65,30)', nullable: true, autoIncrement: false, comment: '原虚拟', generated: { storage: 'VIRTUAL', expression: '`数量` * `单``价` + +1.00' } },
    { name: '旁列', type: 'VARCHAR(20)', nullable: true, autoIncrement: false, comment: '' },
    { name: '存储', type: 'DECIMAL(65,30)', nullable: true, autoIncrement: false, comment: '原存储', generated: { storage: 'STORED', expression: '`数量` * `单``价` + 2.00' } },
  ], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_qty', unique: false, columns: ['数量'] }], foreignKeys: [{ name: 'fk_qty', columns: ['数量'], referencedDatabase: 'parent_db', referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }] };
}
function facts(dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13'): TableCreateGeneratedFacts {
  const content = { dialect, serverVersion: version, os: 'Linux', lowerNames: 0 as const, sqlMode: 'STRICT_TRANS_TABLES', quoteShowCreate: 1 as const, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', engineSupport: 'DEFAULT' as const, serverIdentity: 'a'.repeat(64) };
  return { ...content, digest: sha(content) };
}

describe('新表生成列严格声明与独立计划', () => {
  it('普通创建合同与两项确认保持，生成设计不能静默走legacy', () => {
    const normal = draft(); normal.columns = normal.columns.filter(column => !column.generated);
    expect(tableCreateDraftSchema.parse(normal)).toEqual(normal); expect(tableCreateHasGenerated(normal)).toBe(false);
    expect(tableCreateRequiredAcknowledgements(normal)).toEqual([...tableCreateAcknowledgements]); expect(tableCreateLegacyDesign(normal)).toEqual(normal);
    expect(tableCreateDraftSchema.parse(draft())).toEqual(draft()); expect(tableCreateRequiredAcknowledgements(draft())).toEqual([...tableCreateAcknowledgements, 'generated-column-computation']);
    expect(() => tableCreateLegacyDesign(draft())).toThrow('不能静默丢弃');
  });
  it('原ASCII普通草稿保持原合同，ASCII生成声明与Unicode使用同一安全编译器', () => {
    const normal: TableCreateDraft = { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'qty', type: 'INT', nullable: true, autoIncrement: false, comment: '' }], indexes: [], foreignKeys: [] };
    expect(tableCreateLegacyDesign(normal)).toEqual(normal); expect(tableCreateRequiredAcknowledgements(normal)).toEqual([...tableCreateAcknowledgements]);
    normal.columns.push({ name: 'total', type: 'DECIMAL(20,2)', nullable: true, autoIncrement: false, comment: '', generated: { storage: 'VIRTUAL', expression: 'qty + 1.00' } });
    expect(planTableCreateGeneratedColumns(normal, facts()).columns[0]).toMatchObject({ name: 'total', ordinal: 1, sql: '(`qty` + 1.00)', referencedColumns: ['qty'] });
  });
  it.each([{ nullable: false }, { autoIncrement: true }, { type: 'DOUBLE' }, { type: 'INT ZEROFILL' }, { defaultValue: null }, { defaultValue: undefined }, { onUpdate: null }, { onUpdate: undefined }, { generated: undefined }, { generated: { storage: 'VIRTUAL', expression: '数量', sql: 'DROP TABLE p' } }])('不安全生成属性%j由原严格schema拒绝', patch => {
    const value = draft(); Object.assign(value.columns[3], patch); expect(tableCreateDraftSchema.safeParse(value).success).toBe(false);
  });
  it('候选只有当前0基位置之前普通非自增数值字段，多生成列可与普通列交错', () => {
    expect(tableCreateGeneratedReferenceColumns(draft(), 3).map(column => [column.name, column.ordinal])).toEqual([['数量', 1], ['单`价', 2]]);
    expect(tableCreateGeneratedReferenceColumns(draft(), 5).map(column => column.name)).toEqual(['数量', '单`价']);
    const plan = planTableCreateGeneratedColumns(draft(), facts());
    expect(plan.columns.map(column => [column.name, column.ordinal, column.storage])).toEqual([['虚拟', 3, 'VIRTUAL'], ['存储', 5, 'STORED']]);
    expect(plan.columns[0].sql).toBe('((`数量` * `单``价`) + (+1.00))');
    expect(plan.columns[0].referencedColumns).toEqual(['数量', '单`价']);
    expect(plan.columns[0].fingerprint).toContain('1.00'); expect(plan.columns[0].fingerprint).not.toContain('unary');
    expect(() => assertTableCreateGenerated(draft())).not.toThrow();
  });
  it.each(['id + 1', '虚拟 + 1', '存储 + 1', '旁列 + 1', 'missing + 1', '`数量`; DROP TABLE p', '`数量` / 2'])('自身/前向/自增/生成链或任意SQL %s 不进入计划', expression => {
    const value = draft(); value.columns[3].generated!.expression = expression; expect(() => planTableCreateGeneratedColumns(value, facts())).toThrow();
  });
  it('只拒绝生成列自身键成员，普通PK/index/FK与生成表达式可同时保留', () => {
    expect(() => planTableCreateGeneratedColumns(draft(), facts())).not.toThrow();
    for (const kind of ['index', 'prefix', 'foreign', 'self-parent']) {
      const value = draft();
      if (kind === 'index') value.indexes.push({ name: 'ix_gen', unique: false, columns: ['虚拟'] });
      if (kind === 'prefix') value.indexes.push({ name: 'ix_gen', unique: false, keyParts: [{ columnName: '虚拟', prefixLength: 1 }] });
      if (kind === 'foreign') value.foreignKeys[0].columns = ['虚拟'];
      if (kind === 'self-parent') Object.assign(value.foreignKeys[0], { referencedDatabase: value.database, referencedTable: value.name, referencedColumns: ['虚拟'] });
      expect(() => planTableCreateGeneratedColumns(value, facts())).toThrow('键部分');
    }
  });
  it('MySQL精确30位与Maria38位尺度分别由真实能力决定，来源列也不能绕过', () => {
    const value = draft(); value.columns[3].type = 'DECIMAL(65,31)';
    expect(() => planTableCreateGeneratedColumns(value, facts())).toThrow(); expect(() => planTableCreateGeneratedColumns(value, facts('mariadb'))).not.toThrow();
    value.columns[3].type = 'DECIMAL(65,38)'; expect(() => planTableCreateGeneratedColumns(value, facts('mariadb'))).not.toThrow();
    value.columns[3].type = 'DECIMAL(65,30)'; value.columns[2].type = 'DECIMAL(65,31)'; expect(() => planTableCreateGeneratedColumns(value, facts())).toThrow();
    expect(() => planTableCreateGeneratedColumns(value, facts('mariadb'))).not.toThrow();
  });
  it.each(['5.7.44', '8.0.46', '8.4.11'])('准确MySQL%s可规划，未知补丁不借大版本', version => {
    expect(planTableCreateGeneratedColumns(draft(), facts('mysql', version)).serverVersion).toBe(version);
    expect(() => planTableCreateGeneratedColumns(draft(), facts('mysql', version + '.1'))).toThrow();
  });
  it('声明解析保留数值精度而不接受类型外溢；重复名和实际输出膨胀都在DDL前拒绝', () => {
    expect(tableCreateNumericType(' INTEGER(11) UNSIGNED ')).toEqual({ kind: 'integer', type: 'INT', unsigned: true });
    expect(tableCreateNumericType('NUMERIC(65,38)')).toEqual({ kind: 'decimal', precision: 65, scale: 38, unsigned: false });
    for (const type of ['DECIMAL(66,0)', 'DECIMAL(10,11)', 'DECIMAL(65,39)', 'INT(256)', 'INT DEFAULT 1', 'INT;SELECT 1']) expect(tableCreateNumericType(type)).toBeUndefined();
    const repeated = draft(); repeated.columns[1].name = 'ID'; expect(() => planTableCreateGeneratedColumns(repeated, facts())).toThrow('名称重复');
    const value = draft(); value.columns[3].generated!.expression = '- '.repeat(9) + '`数量`';
    expect(() => parseGeneratedColumnExpression(value.columns[3].generated!.expression)).not.toThrow(); expect(() => planTableCreateGeneratedColumns(value, facts())).toThrow('16层');
    expect(() => compileResolvedGeneratedColumnExpression('n', () => undefined)).toThrow();
    expect(() => compileResolvedGeneratedColumnExpression('n', () => 'N')).toThrow();
    const document = parseTableColumnDefinition('CREATE TABLE t(n int NULL,g int GENERATED ALWAYS AS(n+1) VIRTUAL)', { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    expect(() => compileGeneratedColumnExpression(document, 'g+1')).toThrow();
  });
  it('能力内容漂移、未知模式、错误系统、摘要损坏均拒绝，不靠调用者事实字样放行', () => {
    expect(() => assertTableCreateGeneratedFacts({ ...facts(), digest: 'b'.repeat(64) })).toThrow();
    for (const patch of [{ os: 'Darwin' }, { lowerNames: 1 }, { quoteShowCreate: 0 }, { sqlMode: 'NO_FIELD_OPTIONS' }, { engineSupport: 'NO' }]) {
      const { digest: _digest, ...old } = facts(), changed = { ...old, ...patch };
      expect(() => assertTableCreateGeneratedFacts({ ...changed, digest: sha(changed) } as TableCreateGeneratedFacts)).toThrow();
    }
  });
});

/** 原query回调/commandStarted收尾透传，只有服务器响应由RAM样本提供；不执行Engine或数据库。 */
function server(dialect: 'mysql' | 'mariadb' = 'mysql') {
  const design = draft(), version = dialect === 'mysql' ? '8.4.11' : '11.4.13', controller = new AbortController();
  const source = `CREATE TABLE ${quote(design.name)} (${design.columns.map(column => {
    const generated = column.generated;
    return `${quote(column.name)} ${column.type.toLowerCase()}${generated ? ' GENERATED ALWAYS AS ((' + quote('数量') + ' * ' + quote('单`价') + ') + ' + (generated.storage === 'VIRTUAL' ? '1.00' : '2.00') + ') ' + generated.storage : column.nullable ? '' : ' NOT NULL'}${column.autoIncrement ? ' AUTO_INCREMENT' : ''}${column.comment ? " COMMENT '" + column.comment + "'" : ''}`;
  }).join(',')},PRIMARY KEY (id),KEY ix_qty (${quote('数量')}),CONSTRAINT fk_qty FOREIGN KEY (${quote('数量')}) REFERENCES parent_db.parent(id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB`;
  const document = parseTableColumnDefinition(source, { dialect, mode: { noBackslashEscapes: false, ansiQuotes: false } });
  const metadata = design.columns.map((column, index) => ({ name: column.name, ordinal: String(index + 1), typeSql: column.type.toLowerCase(), dataType: column.type.split('(')[0].split(' ')[0].toLowerCase(), nullable: column.nullable ? 'YES' : 'NO', defaultValue: null as string | null, extra: column.generated ? column.generated.storage + ' GENERATED' : column.autoIncrement ? 'auto_increment' : '', generationExpression: column.generated ? '(' + quote('数量') + ' * ' + quote('单`价') + ') + ' + (column.generated.storage === 'VIRTUAL' ? '1.00' : '2.00') : '', charset: column.type.startsWith('VARCHAR') ? 'utf8mb4' : null, collation: column.type.startsWith('VARCHAR') ? 'utf8mb4_bin' : null, comment: column.comment }));
  const row = { version, os: 'Linux', lowerNames: '0', sqlMode: 'STRICT_TRANS_TABLES', quoteShowCreate: '1', hostname: 'synthetic', port: '3306', serverId: '1', currentUser: 'unit@localhost', charset: 'utf8mb4', collation: 'utf8mb4_bin' };
  const queries: string[] = []; let pending = 0, afterSource = source, tableName = design.name, failure: Error | undefined, onColumns: (() => void) | undefined;
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    queries.push(sql); queueMicrotask(() => {
      if (failure) { callback(failure); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT VERSION() AS version,')) rows = [row];
      else if (sql === 'SELECT @@server_uuid AS uuid') rows = [{ uuid: '00000000-0000-0000-0000-000000000001' }];
      else if (sql.startsWith('SELECT ENGINE AS engine,')) rows = [{ engine: 'InnoDB', support: 'DEFAULT' }];
      else if (sql.startsWith('SELECT TABLE_SCHEMA AS databaseName,')) rows = [{ databaseName: design.database, tableName, kind: 'BASE TABLE', engine: 'InnoDB' }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,')) { onColumns?.(); rows = metadata; }
      else if (sql.startsWith('SHOW CREATE TABLE ')) rows = [{ 'Create Table': afterSource }];
      else { callback(Error('未批准RAM查询')); return; }
      callback(null, rows, []);
    });
  } });
  const context: StructureTaskContext = { managed: { connection, status: { dialect, version }, signal: controller.signal, broken: false } as unknown as ManagedConnection, checkCancelled() { if (controller.signal.aborted) throw controller.signal.reason; }, report() {}, commandStarted() { pending++; return () => { pending--; }; } };
  return { design, document, metadata, row, context, queries, controller, pending: () => pending, changedSource(value: string) { afterSource = value; }, changedName(value: string) { tableName = value; }, fail(value: Error) { failure = value; }, onColumns(action: () => void) { onColumns = action; } };
}

describe('新表生成列真实目录后核的RAM响应', () => {
  it.each(['mysql', 'mariadb'] as const)('%s支持Unicode/反引号准确名字及普通索引/FK，真实COLUMNS补证NULL不修改原document权限', async dialect => {
    const f = server(dialect), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual);
    const original = f.document.columns.map(column => ({ nullable: column.nullable, access: column.access }));
    if (dialect === 'mariadb') f.metadata.filter(column => column.extra.includes('GENERATED')).forEach(column => { column.defaultValue = 'NULL'; });
    expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(true);
    expect(f.document.columns.map(column => ({ nullable: column.nullable, access: column.access }))).toEqual(original);
    expect(f.queries.some(sql => sql.includes(Buffer.from(f.design.database).toString('hex')) && sql.includes(Buffer.from(f.design.name).toString('hex')))).toBe(true);
    expect(f.queries.at(-1)).toBe('SHOW CREATE TABLE ' + quote(f.design.database) + '.' + quote(f.design.name));
    expect(f.queries.every(sql => /^(SELECT|SHOW) /.test(sql))).toBe(true); expect(f.pending()).toBe(0);
  });
  it.each(['INVISIBLE', 'future_marker', 'DEFAULT_GENERATED', 'auto_increment', 'on update CURRENT_TIMESTAMP(3)', 'VIRTUAL GENERATED', 'DEFAULT_GENERATED INVISIBLE'])('普通被引用列EXTRA=%s与SHOW矛盾时不得核验成功', async extra => {
    const f = server(), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual);
    f.metadata[2].extra = extra;
    expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(false);
    expect(f.pending()).toBe(0);
  });
  it('普通真实自增属性不得缺失、重复或混入额外标记', async () => {
    for (const extra of ['', 'auto_increment auto_increment', 'auto_increment INVISIBLE', 'DEFAULT_GENERATED auto_increment']) {
      const f = server(), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual); f.metadata[0].extra = extra;
      expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(false);
    }
  });
  it.each([
    ['mysql', 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)', true],
    ['mysql', 'on update CURRENT_TIMESTAMP(3)', true],
    ['mariadb', 'on update current_timestamp(3)', true],
    ['mysql', 'DEFAULT_GENERATED', false],
  ] as const)('%s普通时间列合法EXTRA=%s仍能与SHOW交叉证明', async (dialect, extra, update) => {
    const f = server(dialect);
    const time: TableCreateDraft['columns'][number] = { name: 'updated_at', type: 'DATETIME(3)', nullable: true, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP(3)', comment: '', ...(update ? { onUpdate: { kind: 'expression' as const, expression: 'current-timestamp' as const, precision: 3 } } : {}) };
    f.design.columns.push(time);
    const source = f.document.source.replace(',PRIMARY KEY', ',`updated_at` datetime(3) DEFAULT current_timestamp(3)' + (update ? ' ON UPDATE current_timestamp(3)' : '') + ',PRIMARY KEY');
    f.document = parseTableColumnDefinition(source, f.document.context); f.changedSource(source);
    f.metadata.push({ name: time.name, ordinal: String(f.design.columns.length), typeSql: 'datetime(3)', dataType: 'datetime', nullable: 'YES', defaultValue: 'current_timestamp(3)', extra, generationExpression: '', charset: null, collation: null, comment: '' });
    const actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual);
    expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(true);
    const invalid = update ? ['DEFAULT_GENERATED DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)', 'on DEFAULT_GENERATED update CURRENT_TIMESTAMP(3)', 'on update CURRENT_TIMESTAMP(3) DEFAULT_GENERATED', 'on update CURRENT_TIMESTAMP(2)', 'on update CURRENT_TIMESTAMP(3) INVISIBLE', 'DEFAULT_GENERATED'] : ['DEFAULT_GENERATED DEFAULT_GENERATED', 'DEFAULT_GENERATED INVISIBLE', 'on update CURRENT_TIMESTAMP(3)'];
    for (const value of invalid) {
      f.metadata.at(-1)!.extra = value;
      expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(false);
    }
    expect(f.pending()).toBe(0);
  });
  it.each(['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'comment'] as const)('目录字段%s矛盾不能报告核验成功', async field => {
    const f = server(), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual);
    const values = { name: '虚拟_替换', ordinal: '05', typeSql: 'decimal(64,30)', dataType: 'int', nullable: 'NO', defaultValue: '1', extra: 'VIRTUAL GENERATED DEFAULT_GENERATED', generationExpression: '`数量` + 2.00', charset: 'utf8mb4', comment: '已变化' };
    Object.assign(f.metadata[3], { [field]: values[field] });
    expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(false); expect(f.pending()).toBe(0);
  });
  it('准确名称/SHOW/能力漂移、源列目录不完整均拒绝', async () => {
    for (const mode of ['table', 'show', 'mode', 'missing']) {
      const f = server(), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual);
      if (mode === 'table') f.changedName('新表');
      if (mode === 'show') f.changedSource(f.document.source + ' COMMENT=\'外部变化\'');
      if (mode === 'mode') f.row.sqlMode += ',NO_BACKSLASH_ESCAPES';
      if (mode === 'missing') f.metadata.splice(1, 1);
      expect(await verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).toBe(false);
      expect(f.pending()).toBe(0);
    }
  });
  it('权限错误和取消保留reject及原callback收尾，不在helper内当作普通只读成功', async () => {
    const f = server(), actual = await readTableCreateGeneratedFacts(f.context), plan = planTableCreateGeneratedColumns(f.design, actual), denied = Error('原目录拒绝');
    f.fail(denied); await expect(verifyCreatedGeneratedColumns(f.context, { database: f.design.database, table: f.design.name }, f.design, plan, f.document)).rejects.toBe(denied); expect(f.pending()).toBe(0);
    const cancelled = server(), facts = await readTableCreateGeneratedFacts(cancelled.context), cancelledPlan = planTableCreateGeneratedColumns(cancelled.design, facts);
    cancelled.onColumns(() => cancelled.controller.abort(Error('原任务取消')));
    await expect(verifyCreatedGeneratedColumns(cancelled.context, { database: cancelled.design.database, table: cancelled.design.name }, cancelled.design, cancelledPlan, cancelled.document)).rejects.toThrow(); expect(cancelled.pending()).toBe(0);
  });
  it('真实能力读取拒未知实际版本/名称映射/系统，身份变化进入摘要且不执行写入', async () => {
    for (const mode of ['version', 'lowerNames', 'os', 'quote']) {
      const f = server();
      if (mode === 'version') { f.context.managed.status.version = '8.4.12'; f.row.version = '8.4.12'; }
      if (mode === 'lowerNames') f.row.lowerNames = '1';
      if (mode === 'os') f.row.os = 'Darwin';
      if (mode === 'quote') f.row.quoteShowCreate = '0';
      await expect(readTableCreateGeneratedFacts(f.context)).rejects.toThrow(); expect(f.pending()).toBe(0); expect(f.queries.every(sql => sql.startsWith('SELECT '))).toBe(true);
    }
    const f = server(), before = await readTableCreateGeneratedFacts(f.context); f.row.hostname = 'another-server';
    const after = await readTableCreateGeneratedFacts(f.context); expect(after.serverIdentity).not.toBe(before.serverIdentity); expect(after.digest).not.toBe(before.digest);
    let invoked = false; Object.defineProperty(f.row, 'hostname', { enumerable: true, get() { invoked = true; return 'hidden'; } });
    await expect(readTableCreateGeneratedFacts(f.context)).rejects.toThrow(); expect(invoked).toBe(false); expect(f.pending()).toBe(0);
  });
});
