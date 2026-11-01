import { describe, expect, it, vi } from 'vitest';
import { sqliteTableRebuildChangesSchema, sqliteTableRebuildInspectSchema, sqliteTableRebuildInspectionSchema, sqliteTableRebuildPreviewSchema, sqliteTableRebuildPreviewOutputSchema, sqliteTableRebuildApplySchema, sqliteTableRebuildReleaseSchema, sqliteTableRebuildFactSchema, sqliteTableRebuildLimits, type SqliteTableRebuildInspectOutput } from '../../src/shared/sqliteTableRebuild';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';

const target = { connectionId: 'owned-sqlite', database: 'main' as const, table: '原"表🚢' };
/** 只构造跨进程契约；不是文件读取、native复制或提交证据。 */
function inspection(): SqliteTableRebuildInspectOutput { return { catalogueId: 'catalogue', target, tableSql: 'CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)', columns: [{ cid: 0, name: 'id', declaredType: 'INTEGER', notNull: false, defaultSql: null, primaryKey: 1, hidden: 0 }, { cid: 1, name: 'note', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKey: 0, hidden: 0 }], relatedObjects: [], strict: false, withoutRowid: false, rowIdentity: { kind: 'rowid', source: 'id' }, sequence: { present: false }, readOnly: false, expiresAt: '2030-01-01T00:00:00Z' }; }
const change = { column: 'note', declaredType: '', default: { kind: 'text' as const, value: "引号'🚢\0; DEFAULT SQL" } };

describe('SQLite表重建严格合同', () => {
  it('四命令仅接收typed补丁及准确cap确认，不暴露私有随机名、任意SQL、路径或回执', () => {
    const inspect = { ...target, taskId: 'inspect' }, preview = { catalogueId: 'c', changes: [change], taskId: 'preview' }, apply = { previewId: 'p', taskId: 'apply', confirmation: 'main.' + target.table };
    for (const command of ['sqlite.tableRebuild.inspect', 'sqlite.tableRebuild.preview', 'sqlite.tableRebuild.apply', 'sqlite.tableRebuild.release'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('sqlite.tableRebuild.inspect', inspect)).toEqual(inspect); expect(validateCommand('sqlite.tableRebuild.preview', preview)).toEqual(preview); expect(validateCommand('sqlite.tableRebuild.apply', apply)).toEqual(apply); expect(validateCommand('sqlite.tableRebuild.release', { catalogueId: 'c' })).toEqual({ catalogueId: 'c' });
    for (const key of ['sql', 'filePath', 'profile', 'assertCurrent', 'operationId', 'recordRebuildFact', 'rebuildNames', 'acknowledgements']) { expect(sqliteTableRebuildInspectSchema.safeParse({ ...inspect, [key]: 'PRIVATE' }).success).toBe(false); expect(sqliteTableRebuildPreviewSchema.safeParse({ ...preview, [key]: 'PRIVATE' }).success).toBe(false); expect(sqliteTableRebuildApplySchema.safeParse({ ...apply, [key]: 'PRIVATE' }).success).toBe(false); }
    expect(sqliteTableRebuildInspectSchema.safeParse({ ...inspect, database: 'temp' }).success).toBe(false); expect(sqliteTableRebuildReleaseSchema.safeParse({}).success).toBe(false);
  });
  it('空type明确移除声明，typed默认值含NUL保持原文，不允许表达式或缺失补丁', () => {
    expect(sqliteTableRebuildChangesSchema.parse([change])).toEqual([change]); expect(sqliteTableRebuildChangesSchema.parse([{ column: 'note', default: { kind: 'current-timestamp' } }])).toHaveLength(1);
    for (const changes of [[], [{ column: 'x' }], [{ column: 'x', declaredType: undefined, default: undefined }], [{ column: 'x', default: { kind: 'expression', value: 'SELECT 1' } }], [{ column: 'A', declaredType: '' }, { column: 'a', declaredType: '' }], [{ column: 'x', declaredType: 'TEXT', sql: 'DROP' }]]) expect(sqliteTableRebuildChangesSchema.safeParse(changes).success).toBe(false);
  });
  it('完整目录及rowid身份保留；WR必须给完整按主键序的真实列且不继承rowid', () => {
    const value = inspection(); expect(sqliteTableRebuildInspectionSchema.parse(value)).toEqual(value);
    const wr = { ...value, withoutRowid: true, rowIdentity: { kind: 'primary-key' as const, columns: ['id'] } }; expect(sqliteTableRebuildInspectionSchema.parse(wr)).toEqual(wr);
    for (const patch of [{ withoutRowid: true }, { rowIdentity: { kind: 'primary-key', columns: ['id'] } }, { withoutRowid: true, rowIdentity: { kind: 'primary-key', columns: ['note'] } }, { withoutRowid: true, rowIdentity: { kind: 'primary-key', columns: ['id', 'ID'] } }, { columns: [value.columns[0], { ...value.columns[1], name: 'ID' }] }, { columns: [value.columns[0], { ...value.columns[1], cid: 0 }] }, { tableSql: '' }, { truncated: true }]) expect(sqliteTableRebuildInspectionSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  });
  it.each(['0', '-9223372036854775808', '9223372036854775807'])('sequence有符号64位准确值%s不经Number', value => { expect(sqliteTableRebuildInspectionSchema.parse({ ...inspection(), sequence: { present: true, value } }).sequence?.value).toBe(value); });
  it('sequence存在性与值矛盾、非canonical/越界或SQL值拒绝，safeParse不抛原生BigInt异常', () => {
    for (const sequence of [{ present: true }, { present: false, value: '1' }, { present: true, value: '-0' }, { present: true, value: '+1' }, { present: true, value: '9223372036854775808' }, { present: true, value: '-9223372036854775809' }, { present: true, value: 'oops' }]) expect(sqliteTableRebuildInspectionSchema.safeParse({ ...inspection(), sequence }).success).toBe(false);
  });
  it('预览只交完整SQL和固定观察警告，准确目标、修改计数及语句总预算不可矛盾', () => {
    const value = { previewId: 'p', catalogueId: 'c', target, sql: ['CREATE TABLE candidate(x)', 'INSERT OR ABORT INTO candidate SELECT * FROM source'], confirmation: 'main.' + target.table, changedTypes: 1, changedDefaults: 0, warnings: ['任何值损失将整批回滚'], expiresAt: '2030-01-01T00:00:00Z' };
    expect(sqliteTableRebuildPreviewOutputSchema.parse(value)).toEqual(value); for (const patch of [{ confirmation: 'main.other' }, { changedTypes: 0 }, { sql: [] }, { requiredAcknowledgements: [] }, { sql: Array.from({ length: sqliteTableRebuildLimits.statements + 1 }, () => 'SELECT 1') }]) expect(sqliteTableRebuildPreviewOutputSchema.safeParse({ ...value, ...patch }).success).toBe(false);
  });
  it('getter、原型、稀疏数组、坏Unicode/超字段或总UTF8预算在深复制前拒绝', () => {
    const getter = vi.fn(() => 'PRIVATE'), input = { declaredType: 'TEXT' }; Object.defineProperty(input, 'column', { enumerable: true, get: getter }); expect(sqliteTableRebuildChangesSchema.safeParse([input]).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    for (const changes of [[{ column: '\ud800', declaredType: '' }], [{ column: 'nul\0', declaredType: '' }], Array(2), Array.from({ length: 129 }, (_, i) => ({ column: 'c' + i, declaredType: '' })), Array.from({ length: 40 }, (_, i) => ({ column: 'c' + i, default: { kind: 'text', value: 'x'.repeat(65536) } }))]) expect(sqliteTableRebuildChangesSchema.safeParse(changes).success).toBe(false);
    expect(sqliteTableRebuildInspectSchema.safeParse(Object.assign(Object.create({ inherited: true }), { ...target, taskId: 'x' })).success).toBe(false);
  });
  it('fact计数非法字符串和访问器仅返回校验失败，不能触发BigInt或getter副作用', () => {
    const base = { operationId: 'o', target, phase: 'writing', requestedStatements: 1, completedStatements: 0, sourceRows: '0', copiedRows: '0', verifiedRows: '0', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false };
    for (const count of ['001', '-1', '1.5', 'NaN', '1e2', '9223372036854775808']) expect(sqliteTableRebuildFactSchema.safeParse({ ...base, sourceRows: count }).success).toBe(false);
    const getter = vi.fn(() => '0'), input = { ...base }; Object.defineProperty(input, 'sourceRows', { enumerable: true, get: getter }); expect(sqliteTableRebuildFactSchema.safeParse(input).success).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
});
