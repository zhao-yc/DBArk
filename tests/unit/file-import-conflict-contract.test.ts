import { describe, expect, it } from 'vitest';
import {
  fileImportConflict, fileImportConflictCountsSchema, fileImportConflictMessage, fileImportConflictModes,
  fileImportConflictReportSchema, fileImportConflictSelectionSchema, fileImportKeyCatalogSchema,
  type FileImportConflictReport, type FileImportConflictSelection,
} from '../../src/shared/fileImportConflict';
import { validateCommand } from '../../src/shared/validation';

const hash = 'a'.repeat(64);
/** 合成身份明确包含原型同名列，不能靠普通对象原型判断合法数据库标识符。 */
function selection(mode: FileImportConflictSelection['mode'] = 'upsert'): FileImportConflictSelection {
  return { mode, schemaHash: hash, key: { name: 'PRIMARY', columns: ['tenant', 'external_key'] } };
}
const zeros = () => ({ inserted: 0, matchedUpdates: 0, skippedExisting: 0, skippedMissing: 0 });
function report(): FileImportConflictReport {
  return { version: 1, taskId: 'conflict-task', mode: 'upsert', termination: 'completed', readRecords: 3,
    acknowledged: { ...zeros(), inserted: 1, matchedUpdates: 2 }, committed: { ...zeros(), inserted: 1, matchedUpdates: 2 }, currentBatch: 'none' };
}
const input = () => ({ connectionId: 'c', database: 'fixture', table: 'subject', fileToken: 'file', taskId: 'task', format: 'csv', encoding: 'utf8', mapping: { tenant: 'tenant', external_key: 'external_key', amount: 'amount' } });

describe('CSV/JSON显式冲突策略契约', () => {
  it('省略保持旧对象形状，三策略仅在CSV/JSON显式出现', () => {
    expect(fileImportConflict('csv', {})).toBeUndefined();
    expect(validateCommand('files.import', input())).toEqual(input());
    expect(fileImportConflictModes).toEqual(['skip-existing', 'upsert', 'update-existing']);
    for (const format of ['csv', 'json']) for (const mode of fileImportConflictModes) {
      const conflict = selection(mode);
      expect(fileImportConflict(format, { conflict })).toEqual(conflict);
      expect(validateCommand('files.import', { ...input(), format, conflict })).toMatchObject({ format, conflict });
    }
    for (const format of ['sql', 'xlsx', 'unknown']) expect(() => fileImportConflict(format, { conflict: selection() })).toThrow();
  });
  it.each([undefined, null, false, true, 1, 'upsert', {}, { ...selection(), mode: 'insert-only' }, { ...selection(), mode: 'UPSERT' }, { ...selection(), sql: 'UPDATE anything' }])('拒绝显式空值及未声明策略 %#', conflict => {
    expect(() => fileImportConflict('csv', { conflict })).toThrow();
    expect(() => validateCommand('files.import', { ...input(), conflict })).toThrow();
  });
  it('不领取继承值、不执行策略和嵌套getter、不接收不可枚举授权', () => {
    let reads = 0;
    const inherited = Object.assign(Object.create({ conflict: selection() }), input());
    const accessor = { ...input(), get conflict() { reads++; return selection(); } };
    const hidden = { ...input() }; Object.defineProperty(hidden, 'conflict', { value: selection(), enumerable: false });
    const nested = { ...selection(), get key() { reads++; return selection().key; } };
    const columnGetter = ['tenant', 'external_key']; Object.defineProperty(columnGetter, '0', { get() { reads++; return 'tenant'; }, enumerable: true });
    for (const value of [inherited, accessor, hidden, { ...input(), conflict: nested }, { ...input(), conflict: { ...selection(), key: { name: 'PRIMARY', columns: columnGetter } } }]) expect(() => validateCommand('files.import', value)).toThrow();
    expect(reads).toBe(0);
  });
  it('配置深复制，列顺序精确且不能稀疏、重复或借数组附加属性', () => {
    const source = selection(), parsed = fileImportConflict('json', { conflict: source })!;
    source.key.columns[0] = 'changed'; expect(parsed.key.columns).toEqual(['tenant', 'external_key']);
    const sparse = new Array(2); sparse[1] = 'external_key';
    const extra = ['tenant']; Object.assign(extra, { extra: '不得携带' });
    for (const columns of [[], ['tenant', 'tenant'], sparse, extra, Array.from({ length: 65 }, (_, index) => 'c' + index)]) expect(() => fileImportConflict('csv', { conflict: { ...selection(), key: { name: 'PRIMARY', columns } } })).toThrow();
    const prototypeNames = { ...selection(), key: { name: 'constructor', columns: ['__proto__', 'toString'] } };
    expect(fileImportConflict('csv', { conflict: prototypeNames })).toEqual(prototypeNames);
  });
  it.each(['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])('结构hash必须规范SHA256 %#', schemaHash => {
    expect(fileImportConflictSelectionSchema.safeParse({ ...selection(), schemaHash }).success).toBe(false);
  });
  it('文件目录请求严格限制目标和task，不能接收SQL、路径或写入策略', () => {
    const target = { connectionId: 'c', database: 'fixture', table: 'subject', taskId: 'read-key-task' };
    expect(validateCommand('files.importKeys', target)).toEqual(target);
    for (const patch of [{ sql: 'SELECT 1' }, { path: 'private.csv' }, { conflict: selection() }, { global: true }]) expect(() => validateCommand('files.importKeys', { ...target, ...patch })).toThrow();
  });
  it('目录保留明确的不可靠原因，可靠键必须完整非空且列身份唯一', () => {
    const catalog = { connectionId: 'c', database: 'fixture', table: 'subject', schemaHash: hash, keys: [{ name: 'PRIMARY', columns: ['tenant', 'external_key'], reliable: true }, { name: 'prefix', columns: ['key'], reliable: false, reason: '仅前缀唯一' }] };
    expect(fileImportKeyCatalogSchema.parse(catalog)).toEqual(catalog);
    for (const key of [{ name: 'bad', columns: [], reliable: true }, { name: 'bad', columns: ['id', 'id'], reliable: true }, { name: 'bad', columns: ['id'], reliable: false }, { name: 'bad', columns: ['id'], reliable: true, expression: 'lower(id)' }]) expect(fileImportKeyCatalogSchema.safeParse({ ...catalog, keys: [key] }).success).toBe(false);
  });
});

describe('冲突导入回执计数不能混同物理更改和提交', () => {
  it('matchedUpdates包含完整ACK的noop命令，完成时保留完整计数', () => {
    expect(fileImportConflictReportSchema.parse(report())).toEqual(report());
    expect(fileImportConflictCountsSchema.safeParse({ ...zeros(), changedRows: 2 }).success).toBe(false);
  });
  it('551记录失败保留550处理ACK与前500提交，atomic则550ACK但零提交', () => {
    for (const committed of [500, 0]) {
      const value: FileImportConflictReport = { ...report(), termination: 'failed', readRecords: 551, acknowledged: { ...zeros(), inserted: 550 }, committed: { ...zeros(), inserted: committed }, currentBatch: 'rolled-back', failure: { stage: 'insert', record: 551, message: '其他唯一键冲突' } };
      expect(fileImportConflictReportSchema.parse(value)).toEqual(value);
    }
  });
  it('取消保留当前批回滚或提交未知事实，不把ACK升级为已提交', () => {
    for (const currentBatch of ['rolled-back', 'rollback-unconfirmed', 'commit-unknown'] as const) {
      const value = { ...report(), termination: 'cancelled', acknowledged: { ...zeros(), inserted: 3 }, committed: zeros(), currentBatch, failure: { stage: 'match', record: 3, message: '原任务已取消' } };
      expect(fileImportConflictReportSchema.parse(value).committed).toEqual(zeros());
    }
  });
  it.each([
    { readRecords: -1 }, { readRecords: 0.1 }, { readRecords: Number.MAX_SAFE_INTEGER + 1 },
    { acknowledged: { ...zeros(), inserted: -1 } }, { acknowledged: { ...zeros(), inserted: 1n } },
    { committed: { ...zeros(), inserted: 2, matchedUpdates: 2 } }, { currentBatch: 'pending' },
    { termination: 'failed' }, { failure: { stage: 'record', record: 4, message: '未读取' } },
    { failure: { stage: 'read', record: 0, message: '无效编号' } }, { sql: '不得附整份文件' },
  ])('拒绝不一致、额外字段和非规范数字 %#', patch => {
    expect(fileImportConflictReportSchema.safeParse({ ...report(), ...patch }).success).toBe(false);
  });
  it('完成意味着每个读取记录均完整归入一种处理事实，不能静默丢行', () => {
    expect(fileImportConflictReportSchema.safeParse({ ...report(), readRecords: 4 }).success).toBe(false);
  });
  it('策略不允许混入该模式不可能发生的处理分类', () => {
    for (const mode of ['skip-existing', 'update-existing'] as const) expect(fileImportConflictReportSchema.safeParse({ ...report(), mode }).success).toBe(false);
    const impossible = { ...report(), acknowledged: { ...zeros(), inserted: 1, skippedExisting: 2 }, committed: { ...zeros(), inserted: 1, skippedExisting: 2 } };
    expect(fileImportConflictReportSchema.safeParse(impossible).success).toBe(false);
  });
  it.each(['短消息', '中'.repeat(6000), '😀'.repeat(6000), '\n'.repeat(6000), '\\'.repeat(6000)])('错误摘要UTF16/UTF8/JSON预算且不拆代理对 %#', source => {
    const value = fileImportConflictMessage(source), encoder = new TextEncoder();
    expect(value.length).toBeLessThanOrEqual(4096); expect(encoder.encode(value).length).toBeLessThanOrEqual(4096); expect(encoder.encode(JSON.stringify(value)).length - 2).toBeLessThanOrEqual(4096);
    if (value && value.length < source.length) expect(/[\uD800-\uDBFF]$/u.test(value)).toBe(false);
  });
});
