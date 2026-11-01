import { describe, expect, it } from 'vitest';
import { foldSqliteCompletionName, quoteSqliteCompletionName, sqliteCompletionInputSchema, sqliteCompletionOutputSchema, sqliteCompletionTaskPrefix } from '../../src/shared/sqliteCompletion';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';

const input = { connectionId: '连接🚢', taskId: sqliteCompletionTaskPrefix + '目录', prefix: '', kind: 'relations' as const };
describe('SQLite补全受限跨进程合同', () => {
  it('公开命令仅包含有界标识符，无SQL／路径／profile执行能力', () => {
    expect(publicCommands['sqlite.completion']).toBe(true); expect(validateCommand('sqlite.completion', input)).toEqual(input);
    expect(sqliteCompletionInputSchema.parse({ ...input, sessionId: 'sqlite:原会话', kind: 'columns', schema: 'temp', table: '引号"🚢' })).toMatchObject({ schema: 'temp', table: '引号"🚢' });
    for (const extra of [{ sql: 'DROP TABLE subject' }, { filePath: 'private.sqlite' }, { profile: {} }, { parameters: [] }]) expect(sqliteCompletionInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it.each(['temp2', 'aux', 'MAIN', '', null])('拒绝任意schema：%s', schema => { expect(sqliteCompletionInputSchema.safeParse({ ...input, schema }).success).toBe(false); });
  it.each(['目录', sqliteCompletionTaskPrefix, 'mysql:任务', 'x'.repeat(201)])('只允许专属有界task命名空间：%s', taskId => { expect(sqliteCompletionInputSchema.safeParse({ ...input, taskId }).success).toBe(false); });
  it('百分号下划线引号和emoji是字面前缀，NUL／坏Unicode／超长输入拒绝', () => {
    expect(sqliteCompletionInputSchema.parse({ ...input, prefix: '%_\'"🚢' }).prefix).toBe('%_\'"🚢');
    for (const prefix of ['x\0y', '\ud800', '\udc00', 'x'.repeat(129)]) expect(sqliteCompletionInputSchema.safeParse({ ...input, prefix }).success).toBe(false);
    expect(sqliteCompletionInputSchema.safeParse({ ...input, kind: 'stamp', table: 'subject' }).success).toBe(false);
    expect(sqliteCompletionInputSchema.safeParse({ ...input, kind: 'columns' }).success).toBe(false);
  });
  it('输出准确区分generated与hidden，不添加行值／SQL或任意schema', () => {
    const output = { entries: [{ name: '计算🚢', kind: 'column', schema: 'main', table: 'subject', declaredType: 'TEXT', generated: true, hidden: false }], incomplete: false, stamp: '-1:0', sessionRevision: 4 };
    expect(sqliteCompletionOutputSchema.parse(output)).toEqual(output);
    for (const extra of [{ sql: 'SELECT 1' }, { rows: [] }, { filePath: 'private.sqlite' }]) expect(sqliteCompletionOutputSchema.safeParse({ ...output, ...extra }).success).toBe(false);
    expect(sqliteCompletionOutputSchema.safeParse({ ...output, sessionRevision: -1 }).success).toBe(false); expect(sqliteCompletionOutputSchema.safeParse({ ...output, stamp: '1:2:3' }).success).toBe(false);
  });
  it('256项和2MiB UTF8分别封顶，不能以UTF16长度冒充实际输出字节', () => {
    const entry = { name: '表', kind: 'table', schema: 'main' }, output = { entries: Array.from({ length: 256 }, () => entry), incomplete: true, stamp: '0:0' };
    expect(sqliteCompletionOutputSchema.safeParse(output).success).toBe(true); expect(sqliteCompletionOutputSchema.safeParse({ ...output, entries: [...output.entries, entry] }).success).toBe(false);
    const wide = { name: '列', kind: 'column', schema: 'main', table: '表', declaredType: '汉'.repeat(4096), generated: false, hidden: false };
    expect(sqliteCompletionOutputSchema.safeParse({ ...output, entries: Array.from({ length: 256 }, () => wide) }).success).toBe(false);
  });
  it('名称仅ASCII折叠，引用保完整引号及Unicode，不把建议当可执行SQL', () => {
    expect(foldSqliteCompletionName('ABC_ΔÄ')).toBe('abc_ΔÄ'); expect(foldSqliteCompletionName('Δ')).not.toBe(foldSqliteCompletionName('δ'));
    expect(quoteSqliteCompletionName('a";DROP TABLE x;--🚢')).toBe('"a"";DROP TABLE x;--🚢"'); expect(() => quoteSqliteCompletionName('x\0y')).toThrow();
  });
});
