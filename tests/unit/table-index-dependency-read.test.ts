import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { readIndexDependencies, type IndexDependencyFacts } from '../../src/engine/tableIndexDependencyRead';
import { planTableIndexPatches } from '../../src/engine/tableIndexPatchSql';
import type { IndexPlanOptions, IndexPlanSnapshot, TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

type Row = Record<string, unknown>;
type Reply = Row[] | Error;
const facts: IndexDependencyFacts = { dialect: 'mysql', serverVersion: '8.4.11', compileOs: 'Linux', lowerCaseTableNames: 0 };
const plain = 'CREATE TABLE t(id int NOT NULL,a int,b int,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB';
const noPartition = [{ PARTITION_NAME: null, PARTITION_METHOD: null, PARTITION_EXPRESSION: null, SUBPARTITION_METHOD: null, SUBPARTITION_EXPRESSION: null }];
const selfSql = 'CREATE TABLE t(id int NOT NULL,a int,PRIMARY KEY(id),KEY ia(a),CONSTRAINT fk_self FOREIGN KEY(a) REFERENCES t(id)) ENGINE=InnoDB';

/** 只替换驱动响应；取消、命令终态及 SQL 生成都执行生产模块。 */
function fixture(sql = plain, options: { facts?: IndexDependencyFacts; database?: string; headers?: Reply; parts?: Reply; kcu?: Reply; partition?: Reply; hold?: string } = {}) {
  const actualFacts = options.facts ?? facts, definition = parseTableColumnDefinition(sql, { dialect: actualFacts.dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } });
  const columns = new Map<string, TrustedIndexColumn>(definition.columns.map(column => ['c:' + column.name, { name: column.name, nullable: column.nullable !== false, dataType: 'INT', columnType: column.type.raw, generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '数值字段' } }]));
  const indexDocument = readTableIndexDefinition(definition);
  const indexes = new Map(indexDocument.indexes.map(parsed => ['i:' + parsed.name, { parsed, definition: editableIndexDefinition(parsed, columns), visible: true as const, generated: false as const }]));
  const target = { connectionId: 'stored-connection', database: options.database ?? 'db', table: definition.table };
  const controller = new AbortController(), connection = new EventEmitter(), sent: string[] = [];
  let active = 0, cancelled = false;
  Object.assign(connection, { threadId: 71, query(query: string, callback: (error: Error | null, rows?: Row[], fields?: unknown[]) => void) {
    sent.push(query);
    if (options.hold && query.includes(options.hold)) return;
    const reply = query.includes('FOREIGN_COLS') ? options.parts ?? [] : query.includes('INNODB_') ? options.headers ?? [] : query.includes('KEY_COLUMN_USAGE') ? options.kcu ?? [] : query.includes('PARTITIONS') ? options.partition ?? noPartition : new Error('测试未定义该目录查询');
    queueMicrotask(() => reply instanceof Error ? callback(reply) : callback(null, reply, []));
  } });
  const context: StructureTaskContext = { managed: { connection, broken: false, signal: controller.signal } as unknown as ManagedConnection, checkCancelled() { if (cancelled) throw new Error('测试取消'); }, report() {}, commandStarted() { active++; return () => { active--; }; } };
  return { definition, columns, indexes, indexDocument, target, context, actualFacts, sent, connection, controller, get active() { return active; }, cancel() { cancelled = true; controller.abort(); }, read: () => readIndexDependencies(context, target, definition, columns, indexes, actualFacts) };
}
function header(child = 'other/child', parent = 'db/t', count = 1): Row { return { ID: 'opaque/fk-name', FOR_NAME: child, REF_NAME: parent, N_COLS: count, TYPE: 0 }; }
function part(pos = 1, child = 'a', parent = 'id'): Row { return { ID: 'opaque/fk-name', FOR_COL_NAME: child, REF_COL_NAME: parent, POS: pos }; }
function kcu(parentDatabase = 'db', parentTable = 't', name = 'fk_self'): Row[] { return [{ CONSTRAINT_NAME: name, COLUMN_NAME: 'a', ORDINAL_POSITION: '1', REFERENCED_TABLE_SCHEMA: parentDatabase, REFERENCED_TABLE_NAME: parentTable, REFERENCED_COLUMN_NAME: 'id' }]; }
function failure(code: string, errno?: number): Error { return Object.assign(new Error('真实驱动错误占位'), { code, errno }); }
function planOptions(): IndexPlanOptions { return { database: 'db', dialect: 'mysql', serverVersion: facts.serverVersion, engine: 'InnoDB', sqlMode: { ansiQuotes: false, noBackslashEscapes: false }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 }, capabilities: { renameIndex: true, descendingIndexes: true, maxKeyParts: 32, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 } }; }

describe('可信有界索引依赖读取', () => {
  it('无外键且显式主键时完整目录允许普通旧索引删除，摘要可重复', async () => {
    const source = fixture(), first = await source.read(), second = await source.read();
    expect(first.digest).toBe(second.digest); expect(first.bytes).toBeGreaterThan(0);
    expect(first.dependencies).toMatchObject({ incomingCoverage: { kind: 'complete' }, outgoingComplete: true, foreignKeys: [], partition: { kind: 'none' }, hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } });
    const snapshot: IndexPlanSnapshot = { ...source, dependencies: first.dependencies };
    expect(planTableIndexPatches(snapshot, [{ op: 'drop', indexRef: 'i:ia' }], planOptions()).kind).toBe('ready');
    expect(source.sent.every(query => / LIMIT (257|8193|4097)$/.test(query))).toBe(true);
    expect(source.active).toBe(0); expect(source.connection.listenerCount('error')).toBe(0);
  });

  it.each([
    ['mysql', '5.7.44', 0, 'INNODB_SYS_FOREIGN'], ['mysql', '8.0.46', 1, 'INNODB_FOREIGN'], ['mysql', '8.4.11', 1, 'INNODB_FOREIGN'],
    ['mariadb', '10.11.19-MariaDB', 0, 'INNODB_SYS_FOREIGN'], ['mariadb', '11.4.13-MariaDB', 0, 'INNODB_SYS_FOREIGN']
  ] as const)('%s %s 按受证目录及 POS=%s 读取跨库入向键', async (dialect, serverVersion, pos, directory) => {
    const source = fixture(plain, { facts: { ...facts, dialect, serverVersion }, headers: [header()], parts: [part(pos)] });
    const result = await source.read();
    expect(result.dependencies.incomingCoverage.kind).toBe('complete');
    expect(result.dependencies.foreignKeys).toEqual([{ foreignKeyRef: expect.any(String), direction: 'incoming', targetColumnRefs: ['c:id'], support: { kind: 'unknown', reason: expect.stringContaining('父索引') } }]);
    expect(source.sent[0]).toContain(`information_schema.${directory} WHERE`);
    expect(source.sent[1]).toContain('WHERE BINARY ID IN (BINARY CONVERT(X\''); expect(source.sent[1]).toContain('LIMIT 8193');
    expect(result.dependencies.automaticForeignKeyIndexProvenance).toEqual({ kind: 'known', indexRefs: [] });
    const snapshot: IndexPlanSnapshot = { ...source, dependencies: result.dependencies };
    expect(planTableIndexPatches(snapshot, [{ op: 'drop', indexRef: 'i:PRIMARY' }], planOptions()).kind).toBe('blocked');
  });

  it('自引用外键分别输出子表和父表有序列组，共享同一不透明引用', async () => {
    const result = await fixture(selfSql, { headers: [header('db/t')], parts: [part()], kcu: kcu() }).read();
    expect(result.dependencies.outgoingComplete).toBe(true);
    expect(result.dependencies.foreignKeys).toHaveLength(2);
    expect(result.dependencies.foreignKeys[0]).toMatchObject({ direction: 'self', targetColumnRefs: ['c:a'], support: { kind: 'known', candidateIndexRefs: ['i:ia'], rule: 'child-leading-full' } });
    expect(result.dependencies.foreignKeys[1]).toMatchObject({ direction: 'self', targetColumnRefs: ['c:id'], support: { kind: 'unknown' } });
    expect(result.dependencies.foreignKeys[0].foreignKeyRef).toBe(result.dependencies.foreignKeys[1].foreignKeyRef);
    expect(result.dependencies.automaticForeignKeyIndexProvenance.kind).toBe('unknown');
  });

  it('复合子键只接受完整前导顺序，前缀键不被当作支持证明', async () => {
    const sql = 'CREATE TABLE t(id int NOT NULL,a varchar(20),b int,PRIMARY KEY(id),KEY wrong(b,a),KEY shortkey(a(3),b),CONSTRAINT fk FOREIGN KEY(a,b) REFERENCES other.p(x,y))';
    const source = fixture(sql, { headers: [header('db/t', 'other/p', 2)], parts: [part(1, 'a', 'x'), part(2, 'b', 'y')] });
    const result = await source.read();
    expect(result.dependencies.outgoingComplete).toBe(true);
    expect(result.dependencies.foreignKeys[0]).toMatchObject({ targetColumnRefs: ['c:a', 'c:b'], support: { kind: 'unknown' } });
  });

  it('MySQL8 特殊名称按逻辑原文精确 hex 绑定，不拆约束 ID', async () => {
    const source = fixture('CREATE TABLE `表 @``名` (`__proto__` int NOT NULL, PRIMARY KEY(`__proto__`))', { database: '库 @', headers: [{ ...header('外库/子表', '库 @/表 @`名'), ID: '不可拆/库/约束@0060' }], parts: [{ ...part(1, 'constructor', '__proto__'), ID: '不可拆/库/约束@0060' }] });
    const result = await source.read();
    expect(result.dependencies.incomingCoverage.kind).toBe('complete'); expect(result.dependencies.foreignKeys[0].targetColumnRefs).toEqual(['c:__proto__']);
    expect(source.sent[0]).toContain(Buffer.from('库 @/表 @`名').toString('hex')); expect(source.sent.join(' ')).not.toContain('库 @');
    expect(source.sent[1]).toContain(Buffer.from('不可拆/库/约束@0060').toString('hex'));
  });

  it.each([
    { ...facts, compileOs: 'Win64' }, { ...facts, lowerCaseTableNames: 1 }, { ...facts, serverVersion: '8.0.99' }, { ...facts, dialect: 'mariadb' as const, serverVersion: '11.4.13-MariaDB' }
  ])('未证明平台/版本/文件名映射不伪造无入向外键', async value => {
    const source = fixture('CREATE TABLE `表`(id int NOT NULL,PRIMARY KEY(id))', { facts: value });
    const result = await source.read(); expect(result.dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'identity-unproven' });
    expect(source.sent.some(query => query.includes('INNODB_'))).toBe(false); expect(result.dependencies.outgoingComplete).toBe(true);
  });

  it.each(['10.11.19-MariaDB-ubu2204', '11.4.13-MariaDB-ubu2404'])('MariaDB %s 已证 Debian Linux 构建按 SYS 目录和零基 POS 证明完整', async serverVersion => {
    const source = fixture(plain, { facts: { ...facts, dialect: 'mariadb', serverVersion, compileOs: 'debian-linux-gnu' }, headers: [header()], parts: [part(0)] });
    const result = await source.read(); expect(result.dependencies.incomingCoverage.kind).toBe('complete');
    expect(source.sent[0]).toContain('INNODB_SYS_FOREIGN WHERE'); expect(result.dependencies.foreignKeys[0].targetColumnRefs).toEqual(['c:id']);
  });

  it.each(['not-linux', 'linux-custom', 'debian-linux-gnu-attacker', 'x-debian-linux-gnu', 'DEBIAN-LINUX-GNU'])('未证 Linux 子串 %s 不构成目录身份授权', async compileOs => {
    const source = fixture(plain, { facts: { ...facts, dialect: 'mariadb', serverVersion: '10.11.19-MariaDB', compileOs } });
    const result = await source.read(); expect(result.dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'identity-unproven' });
    expect(source.sent.some(query => query.includes('INNODB_'))).toBe(false);
  });

  it.each(['10.11.20-MariaDB', '11.4.14-MariaDB', '11.4.130-MariaDB'])('MariaDB 未证版本 %s 不继承 Debian Linux 白名单', async serverVersion => {
    const source = fixture(plain, { facts: { ...facts, dialect: 'mariadb', serverVersion, compileOs: 'debian-linux-gnu' } });
    expect((await source.read()).dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'identity-unproven' });
  });

  it.each(['ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'])('明确目录错误 %s 降级，源 FK 不被空 KCU 隐藏', async code => {
    const result = await fixture(selfSql, { headers: failure(code) }).read();
    expect(result.dependencies.incomingCoverage.kind).toBe('partial'); expect(result.dependencies.outgoingComplete).toBe(false);
    expect(result.dependencies.foreignKeys).toHaveLength(2); expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('完整全局目录与源元组一致时，即使 KCU 拒绝也可证明出向完整', async () => {
    const result = await fixture(selfSql, { headers: [header('db/t')], parts: [part()], kcu: failure('ER_TABLEACCESS_DENIED_ERROR') }).read();
    expect(result.dependencies.outgoingComplete).toBe(true); expect(result.dependencies.incomingCoverage.kind).toBe('complete');
  });

  it('KCU 与源一致不能掩盖完整全局目录缺少源 FK', async () => {
    const result = await fixture(selfSql, { kcu: kcu() }).read();
    expect(result.dependencies.outgoingComplete).toBe(false); expect(result.warnings.join(' ')).toContain('无法唯一对应');
  });

  it.each([
    { headers: [header(), header()], parts: [part()] }, { headers: [header('other/x', 'wrong/table')], parts: [] },
    { headers: [header()], parts: [part(0)] }, { headers: [header()], parts: [part(2)] },
    { headers: [header('other/x', 'db/t', 2)], parts: [part(1)] }, { headers: [header()], parts: [{ ...part(), ID: 'other-id' }] }
  ])('头/列身份、计数或 POS 不一致时拒完整证明 %#', async options => {
    const result = await fixture(plain, options).read();
    expect(result.dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'inconsistent' }); expect(result.dependencies.foreignKeys).toHaveLength(0);
  });

  it.each(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ER_PARSE_ERROR'])('非权限错误 %s 原样传播，不降为成功空目录', async code => {
    const error = failure(code), source = fixture(plain, { headers: error });
    await expect(source.read()).rejects.toBe(error); expect(source.sent).toHaveLength(1); expect(source.active).toBe(0);
  });

  it('等待真实目录命令时取消释放监听和命令登记，不继续后续查询', async () => {
    const source = fixture(plain, { hold: 'INNODB_' }), pending = source.read();
    expect(source.active).toBe(1); source.cancel();
    await expect(pending).rejects.toThrow('测试取消'); expect(source.active).toBe(0); expect(source.sent).toHaveLength(1);
    expect(source.connection.listenerCount('error')).toBe(0); expect(source.connection.listenerCount('end')).toBe(0);
  });

  it('底层连接 end 走真实查询终态且保持断线失败', async () => {
    const source = fixture(plain, { hold: 'INNODB_' }), pending = source.read(); source.connection.emit('end');
    await expect(pending).rejects.toThrow('断开'); expect(source.active).toBe(0); expect(source.sent).toHaveLength(1);
  });

  it.each([
    { headers: Array.from({ length: 257 }, (_, i) => ({ ...header(), ID: String(i) })) },
    { headers: [header()], parts: Array.from({ length: 8193 }, () => part()) },
    { headers: [{ ...header(), ID: '字'.repeat(1500000) }] }
  ])('数量/累计字节超限保留 partial，不截成完整 %#', async options => {
    const result = await fixture(plain, options).read(); expect(result.dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'budget' });
    expect(result.warnings.join(' ')).toContain('预算');
  });

  it('外键目录新增入向关系即改变摘要，而稳定 refs 重复读取不漂移', async () => {
    const empty = await fixture().read(), incoming = await fixture(plain, { headers: [header()], parts: [part()] }).read();
    expect(empty.digest).not.toBe(incoming.digest);
  });

  it.each([
    { head: { TYPE: 1 } }, { head: { FOR_NAME: 'another/child' } }, { head: { ID: 'another-opaque-id' } },
    { child: 'another_child_column' }, { parent: 'b' }
  ])('动作、外侧身份及任一有序列组变化均改变语义引用 %#', async change => {
    const before = await fixture(plain, { headers: [header()], parts: [part()] }).read();
    const changedHeader: Row = { ...header(), ...change.head };
    const after = await fixture(plain, { headers: [changedHeader], parts: [{ ...part(1, change.child ?? 'a', change.parent ?? 'id'), ID: changedHeader.ID }] }).read();
    expect(after.dependencies.incomingCoverage.kind).toBe('complete');
    expect(after.dependencies.foreignKeys[0].foreignKeyRef).not.toBe(before.dependencies.foreignKeys[0].foreignKeyRef);
  });

  it('外键列顺序改变不能保留旧语义引用', async () => {
    const headers = [header('other/child', 'db/t', 2)];
    const before = await fixture(plain, { headers, parts: [part(1, 'x', 'a'), part(2, 'y', 'b')] }).read();
    const after = await fixture(plain, { headers, parts: [part(1, 'y', 'b'), part(2, 'x', 'a')] }).read();
    expect(after.dependencies.foreignKeys[0].foreignKeyRef).not.toBe(before.dependencies.foreignKeys[0].foreignKeyRef);
  });

  it('新增等价支持索引仅改变候选，不改变同一外键 self 双角色引用', async () => {
    const options = { headers: [header('db/t')], parts: [part()], kcu: kcu() };
    const before = await fixture(selfSql, options).read();
    const after = await fixture(selfSql.replace('KEY ia(a),', 'KEY ia(a),KEY additional(a),'), options).read();
    expect(after.dependencies.foreignKeys.map(key => key.foreignKeyRef)).toEqual(before.dependencies.foreignKeys.map(key => key.foreignKeyRef));
    expect(after.dependencies.foreignKeys[0].support).toMatchObject({ kind: 'known', candidateIndexRefs: ['i:ia', 'i:additional'] });
  });

  it('JSON 转义累计字节超限立即停止后续目录，不继续缓冲额外行集', async () => {
    const source = fixture(plain, { headers: [{ ...header(), ID: '\u0001'.repeat(710000) }] });
    const result = await source.read();
    expect(result.dependencies.incomingCoverage).toEqual({ kind: 'partial', reason: 'budget' });
    expect(result.dependencies.outgoingComplete).toBe(false); expect(result.dependencies.partition.kind).toBe('unknown');
    expect(source.sent).toHaveLength(1);
  });

  it.each([
    ['PARTITION BY KEY (`a`) PARTITIONS 2', 'KEY', '`a`', 'explicit'],
    ['/*!50100 PARTITION BY HASH (`a`) PARTITIONS 2 */', 'HASH', '`a`', 'explicit'],
    ['PARTITION BY KEY () PARTITIONS 2', 'KEY', null, 'implicit-key'],
    ['PARTITION BY HASH (a + b) PARTITIONS 2', 'HASH', 'a + b', 'unknown'],
    ['PARTITION BY KEY (a) PARTITIONS 2', 'KEY', '`b`', 'unknown']
  ])('分区源与目录交叉 %s => %s', async (tail, method, expression, expected) => {
    const partition = [{ PARTITION_NAME: 'p0', PARTITION_METHOD: method, PARTITION_EXPRESSION: expression, SUBPARTITION_METHOD: null, SUBPARTITION_EXPRESSION: null }];
    const result = await fixture(plain + ' ' + tail, { partition }).read(); expect(result.dependencies.partition.kind).toBe(expected);
    if (expected === 'explicit') expect(result.dependencies.partition).toEqual({ kind: 'explicit', requiredColumnRefs: ['c:a'] });
  });

  it('分区目录缺失/无权/超限不允许声称非分区', async () => {
    for (const partition of [[], failure('ER_TABLEACCESS_DENIED_ERROR'), Array.from({ length: 4097 }, () => noPartition[0])]) {
      const result = await fixture(plain, { partition }).read(); expect(result.dependencies.partition.kind).toBe('unknown');
    }
  });

  it('自增列取稳定 ref；隐式聚簇与不透明索引分别保护', async () => {
    const source = fixture('CREATE TABLE t(id int NOT NULL AUTO_INCREMENT,a int,UNIQUE KEY u(id),KEY opaque(a) INVISIBLE)');
    const result = await source.read(); expect(result.dependencies.autoIncrementColumnRefs).toEqual(['c:id']);
    expect(result.dependencies.hiddenDependencies).toEqual(expect.arrayContaining([{ indexRefs: ['i:opaque'], reason: expect.any(String) }, { indexRefs: [], reason: expect.stringContaining('聚簇') }]));
    const snapshot: IndexPlanSnapshot = { ...source, dependencies: result.dependencies };
    expect(planTableIndexPatches(snapshot, [{ op: 'add', clientKey: 'new', definition: { kind: 'ordinary', name: 'new_index', method: 'BTREE', comment: '', keyParts: [{ columnRef: 'c:a', direction: 'asc' }] } }], planOptions()).kind).toBe('ready');
  });

  it('目录列映射失败不遗失保护；目标身份不一致零查询拒绝', async () => {
    const source = fixture(plain, { headers: [header()], parts: [part(1, 'a', 'not_a_column')] });
    const result = await source.read(); expect(result.dependencies.hiddenDependencies).toContainEqual({ indexRefs: ['i:PRIMARY', 'i:ia'], reason: expect.stringContaining('无法') });
    const mismatch = fixture(); await expect(readIndexDependencies(mismatch.context, { ...mismatch.target, table: 'other' }, mismatch.definition, mismatch.columns, mismatch.indexes, facts)).rejects.toThrow('不一致'); expect(mismatch.sent).toHaveLength(0);
  });
});
