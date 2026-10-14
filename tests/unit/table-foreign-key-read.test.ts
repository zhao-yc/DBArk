import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readForeignKeyStructure, assertForeignKeyStructureUnchanged, foreignKeyReferenceNames, type ForeignKeyReadIO } from '../../src/engine/tableForeignKeyRead';
import { planTableForeignKeyPatches } from '../../src/engine/tableForeignKeyPatchSql';
import { structureTaskQuery, type StructureTaskContext } from '../../src/engine/structureDefinition';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition, editableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import type { IndexStructureRead, IndexReferenceNames } from '../../src/engine/tableIndexRead';
import type { TrustedIndexColumn } from '../../src/shared/tableIndexPatches';

const target = { connectionId: 'connection', database: 'db', table: 'child' };
const clause = 'CONSTRAINT `fk_parent` FOREIGN KEY (`pid`) REFERENCES `parent` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT';
const childSql = (fk = clause) => `CREATE TABLE child (id int NOT NULL,pid int,PRIMARY KEY(id),KEY support_child(pid)${fk ? ',' + fk : ''}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`;
const parentSql = (name = 'parent') => `CREATE TABLE \`${name}\` (id int NOT NULL,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`;
const key = (database: string, table: string) => JSON.stringify([database, table]);
/** 纯组合测试注入已核验的索引读取结果；外键 SQL 和取消生命周期仍经过生产 structureTaskQuery。 */
function harness() {
  const sources = new Map([[key('db', 'child'), childSql()], [key('db', 'parent'), parentSql()]]);
  const reads = new Map<string, IndexStructureRead>(), sent: string[] = [], requested: string[] = [], endReads: string[] = [];
  const rc: Record<string, unknown>[] = [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_parent', TABLE_NAME: 'child', UNIQUE_CONSTRAINT_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', UNIQUE_CONSTRAINT_NAME: 'PRIMARY', MATCH_OPTION: 'NONE', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }];
  const kcu: Record<string, unknown>[] = [{ CONSTRAINT_SCHEMA: 'db', CONSTRAINT_NAME: 'fk_parent', TABLE_SCHEMA: 'db', TABLE_NAME: 'child', COLUMN_NAME: 'pid', ORDINAL_POSITION: 1, POSITION_IN_UNIQUE_CONSTRAINT: 1, REFERENCED_TABLE_SCHEMA: 'db', REFERENCED_TABLE_NAME: 'parent', REFERENCED_COLUMN_NAME: 'id' }];
  const state = { rc, kcu, permission: false, queryError: undefined as Error | undefined, parentError: undefined as Error | undefined, cancelled: false, commands: 0, finish: 0, version: '8.4.11', mutate: undefined as ((read: IndexStructureRead, name: string) => void) | undefined, endMutate: undefined as ((read: IndexStructureRead, name: string) => IndexStructureRead) | undefined };
  const connection = new EventEmitter();
  Object.assign(connection, { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    queueMicrotask(() => {
      if (state.queryError) return callback(state.queryError);
      if (state.permission) return callback(Object.assign(new Error('读取目录拒绝'), { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142 }));
      if (sql.includes('REFERENTIAL_CONSTRAINTS')) callback(null, state.rc, []);
      else if (sql.includes('KEY_COLUMN_USAGE')) callback(null, state.kcu, []);
      else callback(new Error('测试出现未预期 SQL'));
    });
  } });
  const controller = new AbortController();
  const context = { managed: { connection, broken: false, signal: controller.signal }, checkCancelled() { if (state.cancelled) throw new Error('已取消'); }, report() {}, commandStarted() { state.commands++; return () => { state.finish++; }; } } as unknown as StructureTaskContext;
  const make = (source: string, name: string, refs?: IndexReferenceNames): IndexStructureRead => {
    const definition = parseTableColumnDefinition(source, { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
    const columns = new Map<string, TrustedIndexColumn>();
    for (const column of definition.columns) {
      const ref = [...(refs?.columns ?? [])].find(([, name]) => name === column.name)?.[0] ?? randomUUID();
      columns.set(ref, { name: column.name, nullable: column.nullable !== false, dataType: 'INT', columnType: 'int', generated: false, hidden: false, fullKeyBytes: 4, prefix: { kind: 'forbidden', reason: '整数不使用前缀' } });
    }
    const indexDocument = readTableIndexDefinition(definition), indexes = new Map(indexDocument.indexes.map(index => [[...(refs?.indexes ?? [])].find(([, name]) => name === index.name)?.[0] ?? randomUUID(), { parsed: index, definition: editableIndexDefinition(index, columns), visible: true as const, generated: false as const }]));
    return { source, context: definition.context, originalMode: '', normalizedMode: '', identity: 'server', serverVersion: state.version,
      nullability: definition.columns.map(column => [column.name, column.nullable !== false]), encodings: definition.columns.map(column => ({ name: column.name, charset: null, collation: null })), tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' },
      options: { database: 'db', dialect: 'mysql', serverVersion: state.version, engine: 'InnoDB', sqlMode: definition.context.mode, capabilities: { renameIndex: true, descendingIndexes: true, maxKeyParts: 16, maxIndexNameCharacters: 64, maxIndexCommentBytes: 1024, maxKeyBytes: 3072 }, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } },
      model: { definition, indexDocument, columns, indexes, dependencies: { incomingCoverage: { kind: 'complete', source: 'innodb-dictionary' }, outgoingComplete: true, foreignKeys: [], partition: { kind: 'none' }, autoIncrementColumnRefs: [], hiddenDependencies: [], automaticForeignKeyIndexProvenance: { kind: 'known', indexRefs: [] } } },
      catalogDigest: name + '-catalog', dependencyDigest: '可信原始依赖证据:' + [...columns.keys()].join(','), warnings: [], bytes: 2000 };
  };
  const io: ForeignKeyReadIO = {
    query: structureTaskQuery,
    async readIndex(_context, value, refs) {
      context.checkCancelled(); const id = key(value.database, value.table); requested.push(id);
      if (value.table !== 'child' && state.parentError) throw state.parentError;
      const source = sources.get(id); if (!source) throw Object.assign(new Error('目标表不存在'), { errno: 1146 });
      const read = make(source, value.table, refs); state.mutate?.(read, value.table); reads.set(id, read); return read;
    },
    async readDefinition(_context, value) {
      context.checkCancelled(); const id = key(value.database, value.table); endReads.push(id);
      const read = reads.get(id)!; return state.endMutate?.(read, value.table) ?? read;
    },
  };
  return { state, context, io, sources, reads, requested, endReads, sent, controller };
}

describe('外键组合只读结构读取', () => {
  it('读取直接父表、交叉真实 SQL 投影、有界查询，并在组合末尾重核所有定义', async () => {
    const h = harness(), result = await readForeignKeyStructure(h.context, target, {}, h.io);
    expect(result.snapshot.outgoingComplete).toBe(true); expect(result.snapshot.parents.size).toBe(2);
    const fk = [...result.snapshot.foreignKeys.values()][0]; expect(fk.opaqueReasons).toEqual([]);
    expect(fk.definition?.pairs).toHaveLength(1); expect(result.options?.checks).toEqual({ foreignKeyChecks: 1, uniqueChecks: 1 });
    expect(result.snapshot.namespaceNames.complete).toBe(false);
    expect(h.requested).toEqual([key('db', 'child'), key('db', 'parent')]); expect(h.endReads).toEqual(h.requested);
    expect(h.sent[0]).toContain('UNIQUE_CONSTRAINT_NAME, MATCH_OPTION, UPDATE_RULE, DELETE_RULE'); expect(h.sent[0]).toContain('LIMIT 257');
    expect(h.sent[1]).toContain('POSITION_IN_UNIQUE_CONSTRAINT'); expect(h.sent[1]).toContain('REFERENCED_TABLE_NAME IS NOT NULL'); expect(h.sent[1]).toContain('LIMIT 8193');
    expect(h.sent.every(sql => sql.startsWith('SELECT'))).toBe(true); expect(h.state.finish).toBe(h.state.commands);
  });
  it('传回内部 refs 时列、索引、父和外键引用都稳定；新随机 refs 不影响语义重读', async () => {
    const h = harness(), first = await readForeignKeyStructure(h.context, target, {}, h.io);
    const repeated = await readForeignKeyStructure(h.context, target, { refs: foreignKeyReferenceNames(first) }, h.io);
    expect([...repeated.snapshot.child.columns.keys()]).toEqual([...first.snapshot.child.columns.keys()]);
    expect([...repeated.snapshot.child.indexes.keys()]).toEqual([...first.snapshot.child.indexes.keys()]);
    expect([...repeated.snapshot.parents.keys()]).toEqual([...first.snapshot.parents.keys()]);
    expect([...repeated.snapshot.foreignKeys.keys()]).toEqual([...first.snapshot.foreignKeys.keys()]);
    expect(() => assertForeignKeyStructureUnchanged(first, repeated)).not.toThrow();
    const newRefs = await readForeignKeyStructure(h.context, target, {}, h.io);
    expect([...newRefs.snapshot.child.columns.keys()]).not.toEqual([...first.snapshot.child.columns.keys()]);
    expect(() => assertForeignKeyStructureUnchanged(first, newRefs)).not.toThrow();
  });
  it('self 直接复用子表对象和列/索引 refs，不额外读取同表', async () => {
    const h = harness(); h.sources.set(key('db', 'child'), childSql(clause.replace('`parent`', '`child`')));
    h.state.rc[0].REFERENCED_TABLE_NAME = 'child'; h.state.kcu[0].REFERENCED_TABLE_NAME = 'child';
    const result = await readForeignKeyStructure(h.context, target, {}, h.io);
    expect([...result.snapshot.parents.values()][0]).toBe(result.snapshot.child); expect(h.requested).toEqual([key('db', 'child')]); expect(h.endReads).toEqual(h.requested);
    expect([...result.snapshot.foreignKeys.values()][0].definition?.pairs[0].parentColumnRef).toBe([...result.snapshot.child.columns].find(([, column]) => column.name === 'id')![0]);
  });
  it('没有旧self时默认父选项包含子表，能直接规划新增自引用且不额外查询', async () => {
    const h = harness(); h.sources.set(key('db', 'child'), childSql('')); h.state.rc = []; h.state.kcu = [];
    const result = await readForeignKeyStructure(h.context, target, { namespaceNames: { complete: true, names: [], comparisons: new Map([['self_new', 'available']]) } }, h.io);
    expect(h.requested).toEqual([key('db', 'child')]); expect(h.endReads).toEqual(h.requested);
    const [parentRef, parent] = [...result.snapshot.parents][0]; expect(parent).toBe(result.snapshot.child);
    const columnRef = (name: string) => [...parent.columns].find(([, column]) => column.name === name)![0];
    const plan = planTableForeignKeyPatches(result.snapshot, [{ op: 'add', clientKey: 'self', definition: { name: 'self_new', parentRef, pairs: [{ childColumnRef: columnRef('pid'), parentColumnRef: columnRef('id') }], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' } }], result.options!);
    expect(plan.kind).toBe('ready'); if (plan.kind === 'ready') expect(plan.sql).toContain('REFERENCES `db`.`child` (`id`)');
  });
  it('复用相同refs时原始依赖摘要漂移即拒，不能被相同语义投影掩盖', async () => {
    const h = harness(), first = await readForeignKeyStructure(h.context, target, {}, h.io);
    h.state.mutate = read => { read.dependencyDigest = '目录未解释证据已变化'; };
    const second = await readForeignKeyStructure(h.context, target, { refs: first.refs }, h.io);
    expect(second.childRead.catalogDigest).toBe(first.childRead.catalogDigest);
    expect(() => assertForeignKeyStructureUnchanged(first, second)).toThrow('原始依赖目录证据');
  });
  it('父表自身还引用别表也不递归；额外目标仅明确输入才读取', async () => {
    const h = harness(); h.sources.set(key('db', 'parent'), parentSql().replace(') ENGINE', ',CONSTRAINT deeper FOREIGN KEY(id) REFERENCES unseen(id)) ENGINE'));
    h.sources.set(key('other', 'selected'), parentSql('selected'));
    const result = await readForeignKeyStructure(h.context, target, { additionalParents: [{ database: 'other', table: 'selected' }] }, h.io);
    expect(result.parentReads.size).toBe(3); expect(h.requested).not.toContain(key('db', 'unseen'));
  });
  it('retainedParents 明确保留 DROP 后旧父，但 refs 本身不触发目标读取', async () => {
    const h = harness(), before = await readForeignKeyStructure(h.context, target, {}, h.io);
    h.sources.set(key('db', 'child'), childSql('')); h.state.rc = []; h.state.kcu = []; h.requested.length = 0;
    const noAuthorization = await readForeignKeyStructure(h.context, target, { refs: before.refs }, h.io);
    expect(noAuthorization.parentReads.size).toBe(1); expect(h.requested).toEqual([key('db', 'child')]);
    const retained = await readForeignKeyStructure(h.context, target, { refs: before.refs, retainedParents: [...before.snapshot.parents.values()].map(table => table.target) }, h.io);
    expect([...retained.parentReads.keys()]).toEqual([...before.parentReads.keys()]);
  });
  it.each([1142, 1146, 1227])('父读取失败 errno %i 整体只读且不补造旧 FK definition', async errno => {
    const h = harness(); h.state.parentError = Object.assign(new Error('父表读取失败'), { errno });
    const result = await readForeignKeyStructure(h.context, target, {}, h.io);
    expect(result.snapshot.outgoingComplete).toBe(false); expect(result.snapshot.parents.size).toBe(1);
    expect([...result.snapshot.foreignKeys.values()][0].definition).toBeUndefined(); expect(result.warnings.join()).toContain('只读');
  });
  it('逻辑目录权限空集或与源字段矛盾不能当作无外键', async () => {
    const h = harness(); h.state.rc = []; h.state.kcu = [];
    const hidden = await readForeignKeyStructure(h.context, target, {}, h.io); expect(hidden.snapshot.outgoingComplete).toBe(false); expect(hidden.snapshot.foreignKeys.size).toBe(1);
    const bad = harness(); bad.state.kcu[0].COLUMN_NAME = 'id';
    expect((await readForeignKeyStructure(bad.context, target, {}, bad.io)).snapshot.outgoingComplete).toBe(false);
  });
  it('目录权限拒绝只读；断线和取消向上传播且生产命令登记平衡', async () => {
    const denied = harness(); denied.state.permission = true; expect((await readForeignKeyStructure(denied.context, target, {}, denied.io)).snapshot.outgoingComplete).toBe(false);
    const network = harness(); network.state.queryError = Object.assign(new Error('网络断开'), { code: 'ECONNRESET' });
    await expect(readForeignKeyStructure(network.context, target, {}, network.io)).rejects.toThrow('网络断开'); expect(network.state.finish).toBe(network.state.commands);
    const parent = harness(); parent.state.parentError = Object.assign(new Error('父网络失败'), { code: 'ETIMEDOUT' });
    await expect(readForeignKeyStructure(parent.context, target, {}, parent.io)).rejects.toThrow('父网络失败');
    const cancelled = harness(); cancelled.state.cancelled = true; await expect(readForeignKeyStructure(cancelled.context, target, {}, cancelled.io)).rejects.toThrow('取消'); expect(cancelled.sent).toEqual([]);
  });
  it('真实 AbortSignal 在驱动等待时结束命令，不把取消降为只读', async () => {
    const h = harness(); Object.assign(h.context.managed.connection, { query() { queueMicrotask(() => h.controller.abort()); } });
    await expect(readForeignKeyStructure(h.context, target, {}, h.io)).rejects.toThrow('中止'); expect(h.state.finish).toBe(h.state.commands);
  });
  it.each(['child', 'parent'])('组合结束 %s 已被改定义即失败，不拼接跨时刻快照', async table => {
    const h = harness(); h.state.endMutate = (read, name) => name === table ? { ...read, source: read.source + " COMMENT='外部变更'" } : read;
    await expect(readForeignKeyStructure(h.context, target, {}, h.io)).rejects.toThrow('表定义已变化');
  });
  it.each(['identity', 'mode'])('父表 %s 不同不能映射为同服务器授权', async kind => {
    const h = harness(); h.state.mutate = (read, name) => { if (name === 'parent') { if (kind === 'identity') read.identity = 'other'; else read.normalizedMode = 'ANSI_QUOTES'; } };
    const result = await readForeignKeyStructure(h.context, target, {}, h.io); expect(result.snapshot.outgoingComplete).toBe(false); expect(result.parentReads.size).toBe(1);
  });
  it('额外目标超过16和内部保留超过31在网络读取前拒绝', async () => {
    const h = harness();
    await expect(readForeignKeyStructure(h.context, target, { additionalParents: Array(17).fill({ database: 'db', table: 'parent' }) }, h.io)).rejects.toThrow('16');
    await expect(readForeignKeyStructure(h.context, target, { retainedParents: Array(32).fill({ database: 'db', table: 'parent' }) }, h.io)).rejects.toThrow('31'); expect(h.requested).toEqual([]);
  });
  it('源父加额外目标共计最多32，截断使整体只读且绝不静默漏范围', async () => {
    const h = harness(), parents = Array.from({ length: 31 }, (_, i) => ({ database: 'db', table: 'p' + i }));
    for (const parent of parents) h.sources.set(key(parent.database, parent.table), parentSql(parent.table));
    const result = await readForeignKeyStructure(h.context, target, { retainedParents: parents }, h.io);
    expect(h.requested).toHaveLength(32); expect(result.snapshot.outgoingComplete).toBe(false); expect(result.warnings.join()).toContain('32');
  });
  it('父定义2MiB和总快照16MiB超预算保只读；子表超额不能返回', async () => {
    const h = harness(); h.state.mutate = (read, name) => { read.bytes = name === 'child' ? 15 * 1024 * 1024 : 2 * 1024 * 1024; };
    const result = await readForeignKeyStructure(h.context, target, {}, h.io); expect(result.snapshot.parents.size).toBe(1); expect(result.snapshot.outgoingComplete).toBe(false); expect(result.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    const large = harness(); large.state.mutate = (read, name) => { if (name === 'parent') read.source += ' '.repeat(2 * 1024 * 1024); };
    expect((await readForeignKeyStructure(large.context, target, {}, large.io)).snapshot.parents.size).toBe(1);
    const child = harness(); child.state.mutate = read => { read.bytes = 17 * 1024 * 1024; };
    await expect(readForeignKeyStructure(child.context, target, {}, child.io)).rejects.toThrow('预算');
  });
  it.each(['rc', 'kcu'] as const)('%s LIMIT+1 返回超预算不能宣称完整', async name => {
    const h = harness(); h.state[name] = Array(name === 'rc' ? 257 : 8193).fill(h.state[name][0]);
    const result = await readForeignKeyStructure(h.context, target, {}, h.io); expect(result.snapshot.outgoingComplete).toBe(false);
  });
  it('未知版本或缺失物理能力不伪造可写 options/完整父子映射', async () => {
    const h = harness(); h.state.version = '8.4.12'; expect((await readForeignKeyStructure(h.context, target, {}, h.io)).options).toBeUndefined();
    const noProof = harness(); noProof.state.mutate = read => { read.options = undefined; };
    const result = await readForeignKeyStructure(noProof.context, target, {}, noProof.io); expect(result.options).toBeUndefined(); expect(result.snapshot.child.engine).toBe('unknown'); expect([...result.snapshot.foreignKeys.values()][0].definition).toBeUndefined();
  });
  it('externalIncomingDigest 只含真正入向语义，随机 refs/self/出向不污染', async () => {
    const h = harness(); let incoming = 'incoming-stable', outgoing = 'outgoing-before';
    h.state.mutate = (read, name) => { if (name !== 'child') return; const ref = [...read.model.columns.keys()][0]; read.model.dependencies.foreignKeys = ['incoming', 'self', 'outgoing'].map(direction => ({ direction: direction as 'incoming' | 'self' | 'outgoing', foreignKeyRef: direction === 'incoming' ? incoming : outgoing, targetColumnRefs: [ref], support: { kind: 'unknown', reason: '实际绑定未知' } })); };
    const first = await readForeignKeyStructure(h.context, target, {}, h.io); outgoing = 'changed';
    const second = await readForeignKeyStructure(h.context, target, {}, h.io); expect(second.snapshot.externalIncomingDigest).toBe(first.snapshot.externalIncomingDigest);
    incoming = 'changed'; const third = await readForeignKeyStructure(h.context, target, {}, h.io); expect(third.snapshot.externalIncomingDigest).not.toBe(first.snapshot.externalIncomingDigest);
  });
  it.each(['catalog', 'dependency', 'namespace', 'logical', 'parent', 'mode'] as const)('重读 %s 漂移必须拒绝', async kind => {
    const h = harness(), first = await readForeignKeyStructure(h.context, target, {}, h.io);
    if (kind === 'catalog') h.state.mutate = read => { read.catalogDigest = 'drift'; };
    if (kind === 'dependency') h.state.mutate = read => { read.model.dependencies.incomingCoverage = { kind: 'partial', reason: 'permission' }; };
    if (kind === 'logical') h.state.rc[0].UNIQUE_CONSTRAINT_NAME = 'different';
    if (kind === 'parent') h.sources.set(key('db', 'parent'), parentSql() + " COMMENT='changed'");
    if (kind === 'mode') h.state.mutate = read => { read.originalMode = 'ANSI_QUOTES'; };
    const second = await readForeignKeyStructure(h.context, target, kind === 'namespace' ? { namespaceNames: { complete: true, names: ['fk_parent'], comparisons: new Map([['new', 'available']]) } } : {}, h.io);
    expect(() => assertForeignKeyStructureUnchanged(first, second)).toThrow();
  });
  it('命名空间数组和比较 Map 排序不影响重读，但外部后续修改输入 Map 不污染快照', async () => {
    const h = harness(), comparisons = new Map([['a', 'available' as const], ['b', 'available' as const]]);
    const first = await readForeignKeyStructure(h.context, target, { namespaceNames: { complete: true, names: ['a', 'b'], comparisons } }, h.io);
    comparisons.delete('a'); expect(first.snapshot.namespaceNames.comparisons?.has('a')).toBe(true);
    const second = await readForeignKeyStructure(h.context, target, { namespaceNames: { complete: true, names: ['b', 'a'], comparisons: new Map([['b', 'available'], ['a', 'available']]) } }, h.io);
    expect(() => assertForeignKeyStructureUnchanged(first, second)).not.toThrow();
  });
});
