import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinitionRead, StructureTaskContext } from '../../src/engine/structureDefinition';
import { readTableChecks, assertTableChecksUnchanged, verifyTableCheckBase } from '../../src/engine/tableCheckRead';
import { tableCheckMessages as text } from '../../src/shared/tableChecks';

const port = vi.hoisted(() => ({ base: undefined as unknown, read: (_sql: string): unknown => [] }));
vi.mock('../../src/engine/structureDefinition', async original => ({ ...await original<typeof import('../../src/engine/structureDefinition')>(), readStructureDefinition: vi.fn(async () => structuredClone(port.base)), structureTaskQuery: vi.fn(async (_context, sql: string) => ({ rows: port.read(sql), fields: [] })) }));
const target = { connectionId: 'c', database: 'fixture', table: 'subject' };
/** 目录与SHOW独立声明；原CHECK定义解析器、目录映射、能力和物理身份门均真实执行。 */
function fixture(dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.1' : '10.11.19-MariaDB') {
  const state = {
    cancelled: false, physical: '101', calls: [] as string[], denied: '', fk: 1, checks: 1,
    tc: [{ schemaName: 'fixture', databaseName: 'fixture', tableName: 'subject', name: 'positive', type: 'CHECK', enforced: dialect === 'mysql' ? 'YES' : null }] as Record<string, unknown>[],
    cc: [{ schemaName: 'fixture', tableName: 'subject', name: 'positive', expression: '(`amount` > 0)' }] as Record<string, unknown>[],
    namespace: [{ checkName: 'positive', name: 'positive', type: 'CHECK' }] as Record<string, unknown>[],
    transform: undefined as ((sql: string, rows: unknown) => unknown) | undefined,
  };
  const base: StructureDefinitionRead = { source: 'CREATE TABLE `subject` (`id` int NOT NULL, `amount` decimal(20,4) DEFAULT NULL, CONSTRAINT `positive` CHECK ((`amount` > 0))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin', context: { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }, originalMode: '', normalizedMode: '', identity: 'server-identity', serverVersion: version, nullability: [['id', false], ['amount', true]], encodings: [{ name: 'id', charset: null, collation: null }, { name: 'amount', charset: null, collation: null }], tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } };
  port.base = base;
  port.read = sql => {
    state.calls.push(sql); if (state.denied && sql.includes(state.denied)) throw Error('合成目录权限不足'); let rows: unknown;
    if (sql.startsWith('SET SESSION')) rows = [];
    else if (sql.includes('AS fk')) rows = [{ fk: state.fk, uq: 1 }];
    else if (sql.includes('AS checks')) rows = [{ checks: state.checks }];
    else if (sql.includes('AS showGipk')) rows = [{ showGipk: 1 }];
    else if (sql.includes('FROM information_schema.TABLES')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', autoIncrement: '18446744073709551615' }];
    else if (sql.includes('version_compile_os')) rows = [{ os: 'Linux', lowerNames: 0 }];
    else if (sql.includes('information_schema.PARTITIONS')) rows = [{ name: null }];
    else if (sql.includes('information_schema.INNODB_')) rows = [{ id: state.physical, name: 'fixture/subject' }];
    else if (sql.includes('FROM information_schema.CHECK_CONSTRAINTS')) rows = state.cc;
    else if (sql.includes('FROM information_schema.TABLE_CONSTRAINTS a JOIN')) rows = state.namespace;
    else if (sql.includes('FROM information_schema.TABLE_CONSTRAINTS')) rows = state.tc;
    else throw Error('未声明查询：' + sql);
    return state.transform ? state.transform(sql, rows) : rows;
  };
  const context: StructureTaskContext = { managed: { status: { dialect, version } } as StructureTaskContext['managed'], checkCancelled() { if (state.cancelled) throw Error('原任务已取消'); }, report() {}, commandStarted() { return () => {}; } };
  return { state, base, context, run: () => readTableChecks(context, target) };
}

describe('CHECK真实目录与定义只读交叉核验', () => {
  it('MySQL完整目录、CHECK表达式和物理表一致才可写，精确计数和其它属性不转换Number', async () => {
    const f = fixture(), read = await f.run(); expect(read.coverage).toBe('complete'); expect(read.writable).toBe(true); expect(read.tableId).toBe('101'); expect(read.autoIncrement).toBe('18446744073709551615');
    const [{ view }] = [...read.checks.values()]; expect(view).toMatchObject({ name: 'positive', expression: '(`amount` > 0)', enforced: true, location: 'table' }); expect(view.checkRef).toMatch(/^[a-f0-9-]{36}$/); expect(view.access.drop.allowed).toBe(true); expect(view.access.enforcement.allowed).toBe(true);
    expect(f.state.calls.some(sql => sql.includes('ENFORCED AS enforced'))).toBe(true); expect(f.state.calls.some(sql => sql.includes('JOIN information_schema.TABLE_CONSTRAINTS'))).toBe(true);
    expect(f.state.calls.every(sql => /^(?:SET SESSION|SELECT)/.test(sql))).toBe(true); expect(read.constraintNames).toEqual(['positive']);
    expect(f.state.calls.some(sql => sql.includes('TABLE_CONSTRAINTS a JOIN'))).toBe(false);
  });

  it.each(['10.11.19-MariaDB', '11.4.13-MariaDB'])('Maria%s读真实TABLE_NAME而不猜ENFORCED/LEVEL，保持会话检查开启且不暴露逐条停用', async version => {
    const f = fixture('mariadb', version), read = await f.run(); expect(read.writable).toBe(true); expect(read.allowsNotEnforced).toBe(false); const [{ view }] = [...read.checks.values()]; expect(view.enforced).toBe(true); expect(view.access.drop.allowed).toBe(true); expect(view.access.enforcement.allowed).toBe(false);
    expect(f.state.calls).toContain('SET SESSION check_constraint_checks = ON'); expect(f.state.calls.some(sql => sql.includes('NULL AS enforced'))).toBe(true); expect(f.state.calls.some(sql => /\bENFORCED\b|\bLEVEL\b/.test(sql))).toBe(false);
    const namespace = f.state.calls.find(sql => sql.includes('TABLE_CONSTRAINTS a JOIN'))!;
    expect(namespace).toContain('ON a.CONSTRAINT_NAME=b.CONSTRAINT_NAME');
    for (const field of ['a.TABLE_SCHEMA', 'a.TABLE_NAME', 'b.TABLE_SCHEMA', 'b.TABLE_NAME']) expect(namespace).toContain('CAST(' + field + ' AS BINARY)');
  });

  it.each(['5.7.44', '8.0.15', '9.0.0'])('MySQL%s明确不支持生效且只读，不访问不存在CHECK/ENFORCED目录', async version => {
    const f = fixture('mysql', version), read = await f.run(); expect(read.writable).toBe(false); expect(read.coverage).toBe('unknown'); expect(read.reasons).toContain(text.unsupported); expect([...read.checks.values()].every(item => item.view.enforced === null && !item.view.access.drop.allowed)).toBe(true); expect(f.state.calls.some(sql => /CHECK_CONSTRAINTS|TABLE_CONSTRAINTS|ENFORCED AS/.test(sql))).toBe(false);
  });

  it.each(['TABLE_CONSTRAINTS', 'CHECK_CONSTRAINTS'])('权限不足%s不降格为空且可写的目录，保留定义视图并标范围未知', async catalog => {
    const f = fixture(); f.state.denied = catalog; const read = await f.run(); expect(read.coverage).toBe('unknown'); expect(read.writable).toBe(false); expect(read.reasons).toContain(text.incomplete); expect([...read.checks.values()]).toHaveLength(1); expect([...read.checks.values()][0].view.access.drop.allowed).toBe(false);
  });

  it('支持版本只有真实TC/CC/SHOW三方均确认零CHECK时才能开放新增，不把未知空目录混入', async () => {
    const f = fixture(); f.base.source = f.base.source.replace(', CONSTRAINT `positive` CHECK ((`amount` > 0))', ''); f.state.tc = []; f.state.cc = [];
    const read = await f.run(); expect(read.coverage).toBe('complete'); expect(read.checks.size).toBe(0); expect(read.writable).toBe(true);
  });

  it.each(['empty', 'expression', 'target', 'enforced'] as const)('%s不一致不能授予CHECK操作能力', async kind => {
    const f = fixture(); if (kind === 'empty') f.state.cc = []; else if (kind === 'expression') f.state.cc[0].expression = '`amount` > 10'; else if (kind === 'target') f.state.cc[0].tableName = 'different'; else f.state.tc[0].enforced = 'NO';
    const read = await f.run(); expect(read.writable).toBe(false); expect(read.coverage).toBe('unknown'); expect([...read.checks.values()].every(item => !item.view.access.drop.allowed)).toBe(true);
  });

  it('Maria同名非CHECK约束不能被generic DROP误删，即使CHECK本身完整匹配', async () => {
    const f = fixture('mariadb'); f.state.tc.push({ ...f.state.tc[0], type: 'UNIQUE' }); f.state.namespace.push({ checkName: 'positive', name: 'positive', type: 'UNIQUE' });
    const read = await f.run(), [{ view }] = [...read.checks.values()]; expect(view.access.drop.allowed).toBe(false); expect(view.access.replace.allowed).toBe(false); expect(read.constraintNames).toEqual(['positive', 'positive']); expect(read.coverage).toBe('unknown');
  });

  it('Maria服务器将不同Unicode/重音名判等时，以真实namespace多匹配拒绝DROP/replace', async () => {
    const f = fixture('mariadb'); f.base.source = f.base.source.replace('`positive`', '`résumé`'); f.state.tc[0].name = 'résumé'; f.state.cc[0].name = 'résumé'; f.state.tc.push({ ...f.state.tc[0], name: 'resume', type: 'UNIQUE' });
    f.state.namespace = [{ checkName: 'résumé', name: 'résumé', type: 'CHECK' }, { checkName: 'résumé', name: 'resume', type: 'UNIQUE' }];
    const read = await f.run(), [{ view }] = [...read.checks.values()]; expect(read.writable).toBe(false); expect(read.coverage).toBe('unknown'); expect(view.name).toBe('résumé'); expect(view.access.drop.allowed).toBe(false); expect(view.access.replace.allowed).toBe(false);
    const normal = fixture('mariadb'); expect((await normal.run()).writable).toBe(true);
  });

  it.each(['missing', 'denied', 'rows', 'bytes'] as const)('Maria名称目录%s不能伪报唯一可删，保持有界只读和范围未知', async kind => {
    const f = fixture('mariadb');
    if (kind === 'missing') f.state.namespace = []; else if (kind === 'denied') f.state.denied = 'TABLE_CONSTRAINTS a'; else if (kind === 'rows') f.state.namespace = Array(4097); else f.state.namespace[0].name = 'x'.repeat(2 * 1024 * 1024 + 1);
    const read = await f.run(); expect(read.coverage).toBe('unknown'); expect(read.writable).toBe(false); expect([...read.checks.values()].every(item => !item.view.access.drop.allowed && !item.view.access.replace.allowed)).toBe(true);
  });

  it('无物理身份或Oracle兼容模式不因规范化SHOW成功而变成可写', async () => {
    const f = fixture(); f.state.physical = ''; let read = await f.run(); expect(read.writable).toBe(false); expect(read.tableId).toBeUndefined();
    f.state.physical = '101'; f.base.originalMode = 'ORACLE'; read = await f.run(); expect(read.writable).toBe(false); expect(read.reasons.some(reason => reason.includes('兼容SQL模式'))).toBe(true);
  });

  it('访问器目录零执行、超限目录和取消都不能伪报完整；取消继续拒绝原任务', async () => {
    const f = fixture(); let reads = 0; Object.defineProperty(f.state.cc[0], 'expression', { enumerable: true, get() { reads++; throw Error('不能执行'); } }); const read = await f.run(); expect(read.writable).toBe(false); expect(reads).toBe(0);
    const second = fixture(); second.state.transform = (sql, value) => sql.includes('CHECK_CONSTRAINTS') ? Array(513) : value; expect((await second.run()).writable).toBe(false);
    const cancelled = fixture(); cancelled.state.denied = 'CHECK_CONSTRAINTS'; cancelled.state.cancelled = true; await expect(cancelled.run()).rejects.toThrow('原任务已取消');
  });

  it('fresh表编号/目录/源定义变化拒绝原快照，DDL后其它属性变化也不能当已核验', async () => {
    const f = fixture(), before = await f.run(); const same = await f.run(); expect(() => assertTableChecksUnchanged(before, same)).not.toThrow(); expect(verifyTableCheckBase(before, same)).toBe(true);
    f.state.physical = '202'; const changed = await f.run(); expect(() => assertTableChecksUnchanged(before, changed)).toThrow(text.stale); expect(verifyTableCheckBase(before, changed)).toBe(false);
    const altered = { ...same, catalogFingerprint: 'different' }; expect(() => assertTableChecksUnchanged(before, altered)).toThrow(text.stale);
    expect(verifyTableCheckBase(before, { ...same, rowFormat: 'Compact' })).toBe(false);
  });
});
