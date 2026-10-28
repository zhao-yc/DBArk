import { describe, expect, it } from 'vitest';
import { tableCheckApplySchema, tableCheckChangeSchema, tableCheckConfirmationsMatch, tableCheckGetSchema, tableCheckRequiredAcknowledgements } from '../../src/shared/tableChecks';
import { validateCommand as validateMainCommand } from '../../src/shared/validation';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';

const target = { connectionId: 'connection', database: '甲库', table: '表一' };
describe('CHECK跨进程严格合同', () => {
  it('四种变更与真实Main入口保留完整表达式，不接受客户端SQL/修订/范围字段', () => {
    const change = { op: 'add', name: '约束一', expression: "CASE WHEN a IS NULL THEN TRUE ELSE a BETWEEN 1 AND 20 END", enforced: true };
    expect(validateMainCommand('schema.tableChecks.get', { ...target, taskId: 'get' })).toEqual({ ...target, taskId: 'get' });
    expect(validateMainCommand('schema.tableChecks.preview', { snapshotId: 'snapshot', taskId: 'preview', change })).toEqual({ snapshotId: 'snapshot', taskId: 'preview', change });
    for (const field of ['sql', 'connectionRevision', 'expressionRange', 'source']) expect(() => validateMainCommand('schema.tableChecks.preview', { snapshotId: 'snapshot', taskId: 'preview', change, [field]: '伪造' })).toThrow();
    expect(tableCheckChangeSchema.parse({ op: 'drop', checkRef: 'ref' })).toEqual({ op: 'drop', checkRef: 'ref' });
    expect(tableCheckChangeSchema.parse({ ...change, op: 'replace', checkRef: 'ref' })).toEqual({ ...change, op: 'replace', checkRef: 'ref' });
    expect(tableCheckChangeSchema.parse({ op: 'enforcement', checkRef: 'ref', enforced: false }).op).toBe('enforcement');
    expect(() => tableCheckChangeSchema.parse({ op: 'drop', checkRef: 'ref', name: '其它约束' })).toThrow();
  });
  it('精确分段确认，缺失、重复或未知确认项不进入执行合同', () => {
    const input = { previewToken: 'p', taskId: 'a', databaseConfirmation: target.database, tableConfirmation: target.table, acknowledgements: ['ddl-implicit-commit', 'external-ddl-window', 'check-removal'] };
    expect(tableCheckConfirmationsMatch(tableCheckApplySchema.parse(input), target)).toBe(true);
    expect(tableCheckConfirmationsMatch({ ...input, databaseConfirmation: '甲库 ' }, target)).toBe(false);
    expect(tableCheckConfirmationsMatch({ ...input, tableConfirmation: '表二' }, target)).toBe(false);
    expect(() => tableCheckApplySchema.parse({ ...input, acknowledgements: ['check-removal', 'check-removal'] })).toThrow();
    expect(() => tableCheckApplySchema.parse({ ...input, acknowledgements: ['自动重放'] })).toThrow();
    expect(() => tableCheckApplySchema.parse({ ...input, databaseConfirmation: undefined })).toThrow();
    expect(() => validateMainCommand('schema.tableChecks.release', {})).toThrow();
  });
  it('预算、非法Unicode、控制字符和名称尾空白整份拒绝，不trim或截断', () => {
    expect(tableCheckGetSchema.parse({ ...target, table: '表'.repeat(64), taskId: 'g' }).table).toHaveLength(64);
    for (const value of ['表'.repeat(65), '表\0', '表\ud800', '表\n', '表 ']) expect(() => tableCheckGetSchema.parse({ ...target, table: value, taskId: 'g' })).toThrow();
    for (const value of ['\ud800', '\0', 'x'.repeat(32769), '界'.repeat(32768)]) expect(() => tableCheckChangeSchema.parse({ op: 'add', name: 'ck', expression: value, enforced: true })).toThrow();
  });
  it('新增/替换/删除/启停的风险确认按动作完整产生', () => {
    const base = ['ddl-implicit-commit', 'external-ddl-window'];
    expect(tableCheckRequiredAcknowledgements({ op: 'add', name: 'ck', expression: 'a>0', enforced: true })).toEqual([...base, 'check-existing-rows']);
    expect(tableCheckRequiredAcknowledgements({ op: 'replace', checkRef: 'r', name: 'ck', expression: 'a>1', enforced: false })).toEqual([...base, 'check-removal', 'check-disabled']);
    expect(tableCheckRequiredAcknowledgements({ op: 'drop', checkRef: 'r' })).toEqual([...base, 'check-removal']);
    expect(tableCheckRequiredAcknowledgements({ op: 'enforcement', checkRef: 'r', enforced: true })).toEqual([...base, 'check-existing-rows']);
  });
});

it('真实通用定义入口分别保留同列多个合法CHECK，其它重复属性仍拒绝', () => {
  const context = { dialect: 'mariadb' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
  const source = 'CREATE TABLE `t` (`a` int CHECK (`a` > 0) CONSTRAINT `a_upper` CHECK (`a` < 100), `b` int DEFAULT 2) ENGINE=InnoDB';
  const parsed = parseTableColumnDefinition(source, context), checks = parsed.columns[0].attributes.filter(attribute => attribute.kind === 'check');
  expect(checks.map(check => check.raw)).toEqual(['CHECK (`a` > 0)', 'CONSTRAINT `a_upper` CHECK (`a` < 100)']);
  expect(checks.map(check => source.slice(check.range.start, check.range.end))).toEqual(checks.map(check => check.raw));
  expect(() => parseTableColumnDefinition('CREATE TABLE `t` (`a` int NULL NOT NULL)', context)).toThrow('重复');
  expect(() => parseTableColumnDefinition("CREATE TABLE `t` (`a` int DEFAULT 1 DEFAULT 2)", context)).toThrow('重复');
});
