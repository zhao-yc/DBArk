import { describe, expect, it } from 'vitest';
import { sqlFileImportLocationSchema, sqlFileImportMessage, sqlFileImportReceiptSchema, type SqlFileImportReceipt } from '../../src/shared/sqlFileImport';

/** 基准回执只描述完整响应和无活动事务，不以影响数推断最终持久化行数。 */
function receipt(): SqlFileImportReceipt {
  return { version: 1, taskId: 'sql-file-test', encoding: 'utf8', positionBasis: 'decoded-utf16', termination: 'completed', completedStatements: 2, serverReportedAffectedRows: 3, rollback: { state: 'not-needed' }, transaction: 'closed' };
}
describe('SQL文件导入结构化回执与预算', () => {
  it('接受完成及三种明确选定的编码，未知影响计数不转为0', () => {
    for (const encoding of ['utf8', 'utf16le', 'gb18030'] as const) expect(sqlFileImportReceiptSchema.parse({ ...receipt(), encoding, serverReportedAffectedRows: null }).serverReportedAffectedRows).toBeNull();
  });
  it('执行失败属于下一条，刷新失败仍属于上一条，回滚确认需要闭合事务', () => {
    for (const [phase, ordinal] of [['execute', 3], ['mode-refresh', 2]] as const) {
      const value = { ...receipt(), termination: 'failed', failure: { phase, message: '原始错误', statement: { ordinal } }, rollback: { state: 'confirmed' } };
      expect(sqlFileImportReceiptSchema.parse(value).failure?.statement?.ordinal).toBe(ordinal);
    }
  });
  it('取消保留未确认回滚和未知状态，不伪造成功或下一条执行', () => {
    const value = { ...receipt(), termination: 'cancelled', failure: { phase: 'read', message: '已停止读取，提交状态不得推断' }, rollback: { state: 'unconfirmed', message: '原连接已断开' }, transaction: 'unknown' };
    expect(sqlFileImportReceiptSchema.parse(value)).toEqual(value);
  });
  it.each([
    { termination: 'completed', failure: { phase: 'read', message: '失败' } },
    { transaction: 'unknown' }, { rollback: { state: 'confirmed' } }, { termination: 'failed' },
    { termination: 'failed', failure: { phase: 'execute', message: '失败', statement: { ordinal: 2 } } },
    { termination: 'failed', failure: { phase: 'execute', message: '失败' } },
    { termination: 'failed', failure: { phase: 'mode-refresh', message: '失败', statement: { ordinal: 3 } } },
    { termination: 'failed', failure: { phase: 'read', message: '失败', statement: { ordinal: 3 } } },
    { termination: 'failed', failure: { phase: 'rollback', message: '失败' }, rollback: { state: 'confirmed' }, transaction: 'open' },
    { serverReportedAffectedRows: -1 }, { serverReportedAffectedRows: 0.5 }, { serverReportedAffectedRows: Number.MAX_SAFE_INTEGER + 1 },
    { completedStatements: -1 }, { completedStatements: Number.MAX_SAFE_INTEGER + 1 }, { positionBasis: 'file-bytes' },
    { taskId: '' }, { encoding: 'auto' }, { sourceSql: '不得携带原文件' },
    { cleanupWarning: '中'.repeat(4096) }, { cleanupWarning: '\n'.repeat(4096) },
  ])('拒绝不一致、未知字段或超预算回执 %#', patch => {
    expect(sqlFileImportReceiptSchema.safeParse({ ...receipt(), ...patch }).success).toBe(false);
  });
  it('UTF16列含代理对，半开位置不能倒退或把字符偏移称为字节', () => {
    expect(sqlFileImportLocationSchema.parse({ start: { offset: 10, line: 3, column: 2 }, end: { offset: 14, line: 3, column: 6 } }).end.column).toBe(6);
    for (const end of [{ offset: 9, line: 3, column: 2 }, { offset: 14, line: 2, column: 6 }, { offset: 14, line: 3, column: 5 }]) expect(sqlFileImportLocationSchema.safeParse({ start: { offset: 10, line: 3, column: 2 }, end }).success).toBe(false);
  });
  it.each(['短文字', '中'.repeat(10000), '😀'.repeat(10000), '\n'.repeat(10000), '\\'.repeat(10000)])('摘要同时限制UTF8及JSON转义，保留可见截断说明 %#', value => {
    const text = sqlFileImportMessage(value), encoder = new TextEncoder();
    expect(encoder.encode(text).byteLength).toBeLessThanOrEqual(4096);
    expect(encoder.encode(JSON.stringify(text)).byteLength - 2).toBeLessThanOrEqual(4096);
    expect(text.length).toBeLessThanOrEqual(4096);
    if (text !== value) expect(text).toMatch(/［内容已截断］$/u); else expect(text).toBe(value);
  });
});
