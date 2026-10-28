import { describe, expect, it } from 'vitest';
import { tableCreateDraftSchema, tableCreateLegacyDesign, tableCreateRequiredAcknowledgements, type TableCreateDraft } from '../../src/shared/tableCreate';
import { assertTableCreateChecks, tableCreateHasChecks, tableCreateChecksAcknowledgement } from '../../src/shared/tableCreateChecks';
import { validateCommand } from '../../src/shared/validation';
import { generatedColumnAcknowledgement } from '../../src/shared/tableGeneratedColumn';

/** 合成设计只用于严格合同，不连接数据库或生成任何实际对象。 */
function draft(): TableCreateDraft { return { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'amount', type: 'decimal(65,10)', nullable: true, autoIncrement: false, comment: '' }], indexes: [], foreignKeys: [] }; }
const check = { name: '金额检查', expression: 'amount >= 12345678901234567890.1234567890 OR amount IS NULL', enforced: true };

describe('新表CHECK严格设计及IPC合同', () => {
  it('省略保持旧设计和两确认，显式请求完整保留Unicode/数值原文并阻止旧生成器丢弃', () => {
    const original = draft(); expect(tableCreateDraftSchema.parse(original)).toEqual(original); expect(tableCreateHasChecks(original)).toBe(false); expect(tableCreateLegacyDesign(original)).toEqual(original);
    const design = { ...original, checks: [{ ...check }] }; expect(tableCreateDraftSchema.parse(design)).toEqual(design); expect(tableCreateHasChecks(design)).toBe(true);
    expect(() => tableCreateLegacyDesign(design)).toThrow('不能静默丢弃'); expect(tableCreateRequiredAcknowledgements(original)).toEqual(['ddl-implicit-commit', 'create-only-no-replay']);
    expect(tableCreateRequiredAcknowledgements(design)).toEqual(['ddl-implicit-commit', 'create-only-no-replay', tableCreateChecksAcknowledgement]);
  });
  it.each([undefined, null, [], [{}], [{ ...check, enforced: 'true' }], [{ ...check, sql: 'DROP TABLE x' }], [{ ...check, checkRef: 'other-purpose' }], [{ ...check, name: '' }], [{ ...check, expression: '' }], [{ ...check, name: '\uD800' }], [{ ...check, expression: '\uDC00' }], [{ ...check, name: 'a\n' }]].map(checks => ({ checks })))('显式无效checks不能作为无请求绕回旧路径：%j', ({ checks: value }) => {
    expect(() => tableCreateDraftSchema.parse({ ...draft(), checks: value })).toThrow(); expect(() => assertTableCreateChecks({ checks: value })).toThrow();
  });
  it('重复、过预算和未知字段拒绝，最大有效Unicode名称及精确表达式不截断', () => {
    for (const checks of [[{ ...check, name: 'Check_A' }, { ...check, name: 'check_a' }], Array.from({ length: 513 }, (_, i) => ({ ...check, name: 'c' + i })), [{ ...check, expression: '字'.repeat(32768) }], [{ ...check, name: '字'.repeat(65) }]]) expect(() => tableCreateDraftSchema.parse({ ...draft(), checks })).toThrow();
    const value = { ...draft(), checks: [{ ...check, name: '𐐀'.repeat(64), expression: "CASE WHEN amount IS NULL THEN TRUE ELSE amount >= 0 END /* 原文 */" }] }; expect(tableCreateDraftSchema.parse(value)).toEqual(value);
    expect(() => tableCreateDraftSchema.parse({ ...value, checksSql: 'CHECK (1)' })).toThrow();
  });
  it('能力仅允许结构化读取开关，不能注入结果、SQL或私有facts', () => {
    for (const includeCheckFacts of [true, false]) { const input = { connectionId: 'c', database: 'db', taskId: 'get', includeCheckFacts }; expect(validateCommand('schema.tableCreate.get', input)).toEqual(input); }
    for (const patch of [{ includeCheckFacts: '1' }, { checksAccess: { editable: true } }, { checksFacts: { version: '8.4.11' } }, { sql: 'CREATE TABLE x()' }]) expect(() => validateCommand('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 'get', ...patch })).toThrow();
  });
  it('正式预览保留checks，旧通用schema.preview不可接新属性', () => {
    const design = { ...draft(), checks: [check] }; expect(validateCommand('schema.tableCreate.preview', { snapshotId: 's', taskId: 'p', design })).toEqual({ snapshotId: 's', taskId: 'p', design });
    expect(() => validateCommand('schema.preview', { connectionId: 'c', design })).toThrow();
  });
  it('生成列和CHECK并存四项确认，不接受重复/越用途/缺原确认', () => {
    const design = { ...draft(), columns: [{ ...draft().columns[0], generated: { storage: 'VIRTUAL' as const, expression: '1 + 2' } }], checks: [check] };
    const acknowledgements = tableCreateRequiredAcknowledgements(design); expect(acknowledgements).toEqual(['ddl-implicit-commit', 'create-only-no-replay', generatedColumnAcknowledgement, tableCreateChecksAcknowledgement]);
    const input = { previewToken: 'p', taskId: 'a', confirmation: 'db.subject', acknowledgements }; expect(validateCommand('schema.tableCreate.apply', input)).toEqual(input);
    for (const values of [[...acknowledgements, tableCreateChecksAcknowledgement], ['ddl-implicit-commit', tableCreateChecksAcknowledgement], ['create-only-no-replay', tableCreateChecksAcknowledgement], ['ddl-implicit-commit', 'create-only-no-replay', 'check-removal']]) expect(() => validateCommand('schema.tableCreate.apply', { ...input, acknowledgements: values })).toThrow();
  });
});
