import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { SqliteValue } from '../../src/engine/sqlite/protocol';
import { sqliteWriteFactSchema } from '../../src/shared/sqliteWriteFact';
import { assertSqliteImportWriteFactTransition, buildSqliteTableImportInsert, buildSqliteTableImportPlan, sqliteImportWriteFactSchema, sqliteTableImportAffinity, sqliteTableImportApplySchema, sqliteTableImportInspectSchema, sqliteTableImportInspectionSchema, sqliteTableImportIssue, sqliteTableImportIssueSchema, sqliteTableImportLimits, sqliteTableImportMappingSchema, SqliteTableImportMappingError, sqliteTableImportOutcomeSchema, sqliteTableImportPreviewOutputSchema, sqliteTableImportPreviewSchema, sqliteTableImportReleaseSchema, sqliteTableImportReportSchema, type SqliteImportWriteFact, type SqliteTableImportColumn, type SqliteTableImportMapping, type SqliteTableImportPlanInput } from '../../src/shared/sqliteTableImport';

const target = { connectionId: 'owned-sqlite', database: 'main' as const, table: '导入"表🚢' }, source = { sha256: 'a'.repeat(64), bytes: 123 }, expiresAt = '2030-01-01T00:00:00.000Z';
function column(name: string, declaredType = 'TEXT', patch: Partial<SqliteTableImportColumn> = {}): SqliteTableImportColumn { return { name, declaredType, nullable: true, hasDefault: false, generated: false, affinity: sqliteTableImportAffinity(declaredType), ...patch }; }
function input(mapping: SqliteTableImportMapping[], patch: Partial<SqliteTableImportPlanInput> = {}): SqliteTableImportPlanInput { return { target, columns: mapping.map(item => column(item.target)), sourceColumns: [...new Set(mapping.map(item => item.source))], mapping, strict: false, ...patch }; }
const mapping = [{ source: 'value', target: 'note', kind: 'text' as const }];
function inspection() { return { inspectionId: 'inspection-owned', target, source, sourceColumns: ['value'], sample: [{ value: '原值' }], sampleOmitted: false, records: 1, columns: [column('note')], strict: false, readOnly: false, expiresAt }; }
const report = { checkedRecords: 1, validRecords: 1, invalidRecords: 0, issueCount: 0, issues: [], truncated: false, complete: true };
function fact(patch: Partial<SqliteImportWriteFact> = {}): SqliteImportWriteFact { return { operationId: '11111111-1111-4111-8111-111111111111', target, phase: 'not-sent', requestedRows: 1000, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, ...patch }; }
/** 独立原生绑定适配仅在测试内，把共享typed结果交给Node SQLite验证，不借生产执行器生成预期。 */
function parameter(value: SqliteValue): SQLInputValue { if (value === null || typeof value === 'string') return value; if (value.type === 'integer') return BigInt(value.value); if (value.type === 'real') return Number(value.value); return Buffer.from(value.base64, 'base64'); }
function database(run: (db: DatabaseSync) => void): void { const db = new DatabaseSync(':memory:'); try { run(db); } finally { db.close(); } }
function quote(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }

describe('SQLite整文件导入的严格公共合同', () => {
  it('inspect只接main文件令牌与固定格式/编码，JSON不接CSV选项，连显式undefined也拒绝', () => {
    const base = { ...target, fileToken: 'owned-token', format: 'json', encoding: 'utf8', taskId: 'inspect-task' }; expect(sqliteTableImportInspectSchema.parse(base)).toEqual(base);
    for (const invalid of [{ ...base, filePath: '/任意路径' }, { ...base, database: 'temp' }, { ...base, format: 'sql' }, { ...base, encoding: 'utf16be' }, { ...base, csvDelimiter: undefined }, { ...base, csvHasHeader: undefined }, { ...base, csvDelimiter: ',' }]) expect(sqliteTableImportInspectSchema.safeParse(invalid).success).toBe(false);
    expect(sqliteTableImportInspectSchema.safeParse({ ...base, format: 'csv', csvHasHeader: false, csvDelimiter: '\t' }).success).toBe(true);
    expect(sqliteTableImportPreviewSchema.safeParse({ inspectionId: 'i', mapping, taskId: 'p', sql: 'INSERT' }).success).toBe(false); expect(sqliteTableImportApplySchema.safeParse({ previewId: 'p', taskId: 'a', confirmation: 'main.x', mapping }).success).toBe(false); expect(sqliteTableImportReleaseSchema.safeParse({}).success).toBe(false); expect(sqliteTableImportReleaseSchema.parse({ inspectionId: 'i', previewId: 'p' })).toEqual({ inspectionId: 'i', previewId: 'p' });
  });

  it('inspect回包严格有界，保NULL/空串/missing/JSON原数字文本，不携带物理路径或未知字段', () => {
    const value = { ...inspection(), sourceColumns: ['', 'value', 'missing', 'nil'], sample: [{ '': '9007199254740993', value: '', nil: null }] }; expect(sqliteTableImportInspectionSchema.parse(value)).toEqual(value);
    expect(Object.hasOwn(sqliteTableImportInspectionSchema.parse(value).sample[0], 'missing')).toBe(false);
    for (const invalid of [{ ...value, path: '/private' }, { ...value, columns: [column('name'), column('NAME')] }, { ...value, columns: [column('name', 'NUMERIC', { affinity: 'text' })] }, { ...value, sample: [{ unknown: 'value' }] }, { ...value, sample: Array.from({ length: 21 }, () => ({})) }, { ...value, sourceColumns: ['value', 'value'] }]) expect(sqliteTableImportInspectionSchema.safeParse(invalid).success).toBe(false);
    expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), columns: [column('computed', 'TEXT', { generated: true })] }).success).toBe(true);
    expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), sample: [{ value: 'x'.repeat(300000) }] }).success).toBe(false);
    expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), sourceColumns: ['x'.repeat(257)], sample: [] }).success).toBe(false); expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), sourceColumns: Array.from({ length: 1001 }, (_, index) => 's' + index), sample: [] }).success).toBe(false);
  });

  it('超限数组及访问器在克隆之前拒绝，不运行用户getter', () => {
    const read = vi.fn(() => mapping[0]), oversized = Array.from({ length: 129 }, () => mapping[0]); Object.defineProperty(oversized, '0', { get: read, enumerable: true }); expect(sqliteTableImportPreviewSchema.safeParse({ inspectionId: 'i', taskId: 'p', mapping: oversized }).success).toBe(false); expect(read).not.toHaveBeenCalled();
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: read }); expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), sample: [accessor] }).success).toBe(false); expect(read).not.toHaveBeenCalled();
    const part = Object.defineProperty({ source: 'value', target: 'note' }, 'kind', { enumerable: true, get: read }); expect(sqliteTableImportMappingSchema.safeParse([part]).success).toBe(false); expect(read).not.toHaveBeenCalled();
    const columns = Array.from({ length: 1025 }, (_, index) => column('c' + index)); Object.defineProperty(columns, '0', { enumerable: true, get: read }); expect(sqliteTableImportInspectionSchema.safeParse({ ...inspection(), columns }).success).toBe(false); expect(read).not.toHaveBeenCalled();
  });

  it('预检必须完整且零错误才签令牌；空文件或有错误只能输出有界报告', () => {
    const success = { ok: true, inspectionId: 'i', target, source, records: 1, report, warnings: [], previewId: 'p', sql: buildSqliteTableImportInsert(target.table, ['note']), confirmation: 'main.' + target.table, expiresAt }; expect(sqliteTableImportPreviewOutputSchema.safeParse(success).success).toBe(true);
    for (const value of [{ ...success, records: 0 }, { ...success, report: { ...report, complete: false } }, { ...success, report: { ...report, checkedRecords: 2, validRecords: 2 } }, { ...success, sample: [] }]) expect(sqliteTableImportPreviewOutputSchema.safeParse(value).success).toBe(false);
    const emptyReport = { checkedRecords: 0, validRecords: 0, invalidRecords: 0, issueCount: 1, issues: [sqliteTableImportIssue('empty-file')], truncated: false, complete: true }, failure = { ok: false, inspectionId: 'i', target, source, records: 0, report: emptyReport, warnings: [] }; expect(sqliteTableImportPreviewOutputSchema.parse(failure)).toEqual(failure); expect(sqliteTableImportPreviewOutputSchema.safeParse({ ...failure, previewId: 'cannot-apply' }).success).toBe(false);
    expect(sqliteTableImportIssueSchema.safeParse({ ...sqliteTableImportIssue('invalid-value'), message: '源秘密值' }).success).toBe(false); expect(sqliteTableImportIssueSchema.safeParse({ ...sqliteTableImportIssue('invalid-value'), value: 'secret' }).success).toBe(false);
  });
});

describe('SQLite固定INSERT与显式动态类型映射', () => {
  it('目标只整体引用，模板固定OR ABORT及位置参数，编译后不共享可变映射', () => {
    const value = input([{ source: 'source";DROP', target: 'target"🚢', kind: 'text' }]), plan = buildSqliteTableImportPlan(value); expect(plan.sql).toBe('INSERT OR ABORT INTO "main"."导入""表🚢" ("target""🚢") VALUES (?)'); expect(plan.sql).not.toContain('source'); expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.mapping)).toBe(true); value.mapping[0].kind = 'integer'; expect(plan.convertRow({ 'source";DROP': "原值'\0🚢;DROP TABLE x" }, 1)).toEqual({ ok: true, parameters: ["原值'\0🚢;DROP TABLE x"] });
  });

  it('同源可明确映射到多个目标，目标ASCII重复/生成列/缺失列或无默认必填列均拒绝', () => {
    expect(buildSqliteTableImportPlan(input([{ source: 's', target: 'a', kind: 'text' }, { source: 's', target: 'b', kind: 'text' }])).convertRow({ s: '原值' }, 1)).toEqual({ ok: true, parameters: ['原值', '原值'] });
    expect(sqliteTableImportMappingSchema.safeParse([{ source: 's', target: 'a', kind: 'text' }, { source: 't', target: 'A', kind: 'text' }]).success).toBe(false);
    for (const patch of [{ columns: [column('note', 'TEXT', { generated: true })] }, { columns: [column('other')] }, { sourceColumns: [] }, { columns: [column('note'), column('required', 'TEXT', { nullable: false })] }]) expect(() => buildSqliteTableImportPlan(input(mapping, patch))).toThrow();
    expect(() => buildSqliteTableImportPlan(input(mapping, { columns: [column('note'), column('id', 'INTEGER', { nullable: false, autoGenerated: true }), column('defaulted', 'TEXT', { nullable: false, hasDefault: true })] }))).not.toThrow();
  });

  it('NULL/空串/缺失严格区分，JSON空键及__proto__源键只从自有数据读取', () => {
    const plan = buildSqliteTableImportPlan(input(mapping)); expect(plan.convertRow({ value: null }, 1)).toEqual({ ok: true, parameters: [null] }); expect(plan.convertRow({ value: '' }, 1)).toEqual({ ok: true, parameters: [''] }); expect(plan.convertRow({}, 2)).toEqual({ ok: false, issues: [sqliteTableImportIssue('missing-source', { record: 2, source: 'value', target: 'note' })], issueCount: 1 });
    const empty = buildSqliteTableImportPlan(input([{ source: '', target: 'note', kind: 'text' }])); expect(empty.convertRow({ '': '空键原值' }, 1)).toEqual({ ok: true, parameters: ['空键原值'] });
    const prototype = buildSqliteTableImportPlan(input([{ source: '__proto__', target: 'note', kind: 'text' }])); expect(prototype.convertRow({}, 1).ok).toBe(false); expect(prototype.convertRow(Object.defineProperty({}, '__proto__', { value: '安全原文', enumerable: true }), 1)).toEqual({ ok: true, parameters: ['安全原文'] });
    const required = buildSqliteTableImportPlan(input(mapping, { columns: [column('note', 'TEXT', { nullable: false })] })); expect(required.convertRow({ value: null }, 1)).toEqual({ ok: false, issues: [sqliteTableImportIssue('null-not-allowed', { record: 1, source: 'value', target: 'note' })], issueCount: 1 });
  });

  it('JSON嵌套值只接受原reader的无损JSON文本，不绑定任意对象/数组或已舍入Number', () => {
    const plan = buildSqliteTableImportPlan(input(mapping)), json = '{"n":9007199254740993,"a":[1.2300,true]}'; expect(plan.convertRow({ value: json }, 1)).toEqual({ ok: true, parameters: [json] });
    for (const value of [{ nested: 1 }, [1, 2], 9007199254740992, 1.25, undefined]) expect(plan.convertRow({ value }, 1).ok).toBe(false);
    const read = vi.fn(() => '不应读取'); expect(plan.convertRow(Object.defineProperty({}, 'value', { enumerable: true, get: read }), 1).ok).toBe(false); expect(read).not.toHaveBeenCalled();
  });

  it('INTEGER signed64只从原字符串解析；REAL必须有限并能数值文本往返', () => {
    const integer = buildSqliteTableImportPlan(input([{ source: 'v', target: 'i', kind: 'integer' }], { columns: [column('i', 'INTEGER')] })); expect(integer.convertRow({ v: '-9223372036854775808' }, 1)).toEqual({ ok: true, parameters: [{ type: 'integer', value: '-9223372036854775808' }] }); expect(integer.convertRow({ v: '+00042' }, 1)).toEqual({ ok: true, parameters: [{ type: 'integer', value: '42' }] });
    for (const v of ['9223372036854775808', '-9223372036854775809', '1e3', '1.5', '1;SELECT 2']) expect(integer.convertRow({ v }, 1).ok).toBe(false);
    const real = buildSqliteTableImportPlan(input([{ source: 'v', target: 'r', kind: 'real' }], { columns: [column('r', 'BLOB')] })); for (const v of ['0.1', '1.2500', '1e2', '-0', '.5']) expect(real.convertRow({ v }, 1).ok).toBe(true);
    for (const v of ['Infinity', 'NaN', '1e309', '1e-400', '0.10000000000000001', '9007199254740993', '1+1']) expect(real.convertRow({ v }, 1).ok).toBe(false);
  });

  it('亲和性和STRICT必须显式匹配，不能把精确小数TEXT悄悄写NUMERIC', () => {
    expect(sqliteTableImportAffinity('ANY', true)).toBe('blob'); expect(sqliteTableImportAffinity('ANY')).toBe('numeric'); expect(sqliteTableImportAffinity('FLOATING POINT')).toBe('integer');
    for (const declaredType of ['INTEGER', 'REAL', 'NUMERIC', 'ANY']) expect(() => buildSqliteTableImportPlan(input(mapping, { columns: [column('note', declaredType)] }))).toThrow(SqliteTableImportMappingError);
    expect(() => buildSqliteTableImportPlan(input(mapping, { columns: [column('note', 'ANY', { affinity: 'blob' })], strict: true }))).not.toThrow(); expect(() => buildSqliteTableImportPlan(input(mapping, { columns: [column('note', 'BLOB')], strict: true }))).toThrow();
    const realTarget = buildSqliteTableImportPlan(input([{ source: 'v', target: 'r', kind: 'integer' }], { columns: [column('r', 'REAL')] })); expect(realTarget.convertRow({ v: '42' }, 1).ok).toBe(true); expect(realTarget.convertRow({ v: '9223372036854775807' }, 1).ok).toBe(false);
    const strictInteger = buildSqliteTableImportPlan(input([{ source: 'v', target: 'i', kind: 'real' }], { columns: [column('i', 'INTEGER')], strict: true })); expect(strictInteger.convertRow({ v: '1.0' }, 1).ok).toBe(true); expect(strictInteger.convertRow({ v: '1.5' }, 1).ok).toBe(false);
    expect(() => buildSqliteTableImportPlan(input([{ source: 'v', target: 'text', kind: 'real' }]))).toThrow();
  });

  it('Hex/Base64按规范字节绑定；CSV协议和JSON binary wrapper可互通，不用Buffer实现共享转换', () => {
    const hex = buildSqliteTableImportPlan(input([{ source: 'v', target: 'b', kind: 'blob-hex' }], { columns: [column('b', 'BLOB')] })), base64 = buildSqliteTableImportPlan(input([{ source: 'v', target: 'b', kind: 'blob-base64' }], { columns: [column('b', 'BLOB')] }));
    vi.stubGlobal('Buffer', undefined); try { expect(hex.convertRow({ v: '00fF7a' }, 1)).toEqual({ ok: true, parameters: [{ type: 'binary', base64: 'AP96' }] }); expect(base64.convertRow({ v: 'base64:AP96' }, 1)).toEqual({ ok: true, parameters: [{ type: 'binary', base64: 'AP96' }] }); expect(base64.convertRow({ v: { type: 'binary', base64: 'AP96' } }, 1)).toEqual({ ok: true, parameters: [{ type: 'binary', base64: 'AP96' }] }); } finally { vi.unstubAllGlobals(); }
    for (const v of ['A', 'AB==', 'AAB=', 'AA', 'AA==\n', 'AA-_', '====']) expect(base64.convertRow({ v }, 1).ok).toBe(false); for (const v of ['0', '0x00', "X'00'"]) expect(hex.convertRow({ v }, 1).ok).toBe(false); expect(hex.convertRow({ v: '' }, 1)).toEqual({ ok: true, parameters: [{ type: 'binary', base64: '' }] });
  });

  it('单值/整行/映射预算和100条诊断上限不丢总错误数，不回显值', () => {
    const plan = buildSqliteTableImportPlan(input(mapping)); expect(plan.convertRow({ value: '🚢'.repeat(16384) }, 1).ok).toBe(true); expect(plan.convertRow({ value: '🚢'.repeat(16385) }, 1).ok).toBe(false); expect(plan.convertRow({ value: '\ud800' }, 1).ok).toBe(false);
    const many = Array.from({ length: 128 }, (_, index) => ({ source: 's' + index, target: 't' + index, kind: 'integer' as const })), manyPlan = buildSqliteTableImportPlan(input(many, { columns: many.map(item => column(item.target, 'INTEGER')) })), failed = manyPlan.convertRow(Object.fromEntries(many.map(item => [item.source, 'PRIVATE_IMPORT_VALUE_19;SQL'])), 7); if (failed.ok) throw Error('本例128个非法整数不能通过预检'); expect(failed.issueCount).toBe(128); expect(failed.issues).toHaveLength(100); expect(JSON.stringify(failed)).not.toContain('PRIVATE_IMPORT_VALUE_19'); expect(sqliteTableImportReportSchema.safeParse({ checkedRecords: 1, validRecords: 0, invalidRecords: 1, issueCount: failed.issueCount, issues: failed.issues, truncated: true, complete: true }).success).toBe(true); expect(sqliteTableImportReportSchema.safeParse({ checkedRecords: 1, validRecords: 0, invalidRecords: 1, issueCount: failed.issueCount, issues: failed.issues, truncated: false, complete: true }).success).toBe(false);
    const rows = Array.from({ length: 17 }, (_, index) => ({ source: 's' + index, target: 't' + index, kind: 'text' as const })), large = buildSqliteTableImportPlan(input(rows)); expect(large.convertRow(Object.fromEntries(rows.map(item => [item.source, 'x'.repeat(65536)])), 1).ok).toBe(false); expect(sqliteTableImportLimits.records).toBe(10000000);
  });
});

describe('SQLite导入原生绑定及独立大行数事实', () => {
  it('真实INSERT保NUL/int64/REAL/BLOB/boolean，未映射id/默认值及生成列由原表执行', () => database(db => {
    db.exec(`CREATE TABLE ${quote(target.table)}(id INTEGER PRIMARY KEY,note TEXT,i INTEGER,r BLOB,b BLOB,flag INTEGER,free TEXT NOT NULL DEFAULT '原默认',"generated" TEXT GENERATED ALWAYS AS (note||'!') STORED)`);
    const map: SqliteTableImportMapping[] = [{ source: 'text', target: 'note', kind: 'text' }, { source: 'integer', target: 'i', kind: 'integer' }, { source: 'real', target: 'r', kind: 'real' }, { source: 'hex', target: 'b', kind: 'blob-hex' }, { source: 'bool', target: 'flag', kind: 'boolean' }], columns = [column('id', 'INTEGER', { nullable: false, autoGenerated: true }), column('note'), column('i', 'INTEGER'), column('r', 'BLOB'), column('b', 'BLOB'), column('flag', 'INTEGER'), column('free', 'TEXT', { nullable: false, hasDefault: true }), column('generated', 'TEXT', { generated: true })], plan = buildSqliteTableImportPlan(input(map, { columns })), text = "原值'🚢\0尾;DROP TABLE x", converted = plan.convertRow({ text, integer: '-9223372036854775808', real: '1.25', hex: '00ff', bool: false }, 1); if (!converted.ok) throw Error('本例显式类型应能完整绑定'); db.prepare(plan.sql).run(...converted.parameters.map(parameter)); expect(db.prepare(`SELECT CAST(id AS TEXT) AS id,note,CAST(i AS TEXT) AS i,typeof(i) AS it,r,typeof(r) AS rt,hex(b) AS b,typeof(b) AS bt,flag,free,generated FROM ${quote(target.table)}`).get()).toEqual({ id: '1', note: text, i: '-9223372036854775808', it: 'integer', r: 1.25, rt: 'real', b: '00FF', bt: 'blob', flag: 0, free: '原默认', generated: text + '!' });
  }));

  it('OR ABORT覆盖表级IGNORE/REPLACE冲突，原控制行不会静默被删/跳过，整文件可ROLLBACK', () => database(db => {
    for (const conflict of ['IGNORE', 'REPLACE']) { const name = 'conflict_' + conflict; db.exec(`CREATE TABLE ${quote(name)}(id INTEGER PRIMARY KEY ON CONFLICT ${conflict},note TEXT); INSERT INTO ${quote(name)} VALUES(1,'原控制行')`); const sql = buildSqliteTableImportInsert(name, ['id', 'note']); db.exec('BEGIN'); db.prepare(sql).run(2n, '本批首行'); expect(() => db.prepare(sql).run(1n, '不得覆盖')).toThrow(); db.exec('ROLLBACK'); expect(db.prepare(`SELECT * FROM ${quote(name)}`).all()).toEqual([{ id: 1, note: '原控制行' }]); }
  }));

  it('只为import扩展百万行事实，不放宽原edit500行；提交/回滚ACK及failure严格对应', () => {
    expect(sqliteImportWriteFactSchema.safeParse(fact()).success).toBe(true); expect(sqliteWriteFactSchema.safeParse(fact()).success).toBe(false); const pending = fact({ phase: 'commit-pending', appliedRows: 1000, commitMayHaveBeenSent: true }), committed = fact({ phase: 'committed', appliedRows: 1000, commitMayHaveBeenSent: true, commitAcknowledged: true }), rolledBack = fact({ phase: 'rolled-back', appliedRows: 1000, rollbackAcknowledged: true }); expect(() => assertSqliteImportWriteFactTransition(pending, committed)).not.toThrow(); expect(() => assertSqliteImportWriteFactTransition(pending, rolledBack)).not.toThrow(); expect(() => assertSqliteImportWriteFactTransition(committed, rolledBack)).toThrow(); expect(sqliteImportWriteFactSchema.safeParse(fact({ phase: 'committed', appliedRows: 999, commitMayHaveBeenSent: true, commitAcknowledged: true })).success).toBe(false);
    const outcome = { operationId: committed.operationId, target, outcome: 'committed', counts: { insert: 1000, update: 0, delete: 0 }, fact: committed, message: '整文件已提交' }; expect(sqliteTableImportOutcomeSchema.safeParse(outcome).success).toBe(true); expect(sqliteTableImportOutcomeSchema.safeParse({ ...outcome, failure: sqliteTableImportIssue('native-rejected', { record: 5 }) }).success).toBe(false); expect(sqliteTableImportOutcomeSchema.safeParse({ ...outcome, outcome: 'rolled-back', fact: rolledBack, failure: sqliteTableImportIssue('native-rejected', { record: 5 }) }).success).toBe(true); expect(sqliteTableImportOutcomeSchema.safeParse({ ...outcome, sql: 'INSERT secret' }).success).toBe(false); expect(sqliteTableImportOutcomeSchema.safeParse({ ...outcome, counts: { insert: 999, update: 0, delete: 0 } }).success).toBe(false);
  });
});
