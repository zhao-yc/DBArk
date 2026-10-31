import { describe, expect, it } from 'vitest';
import { sqliteTablePageSchema } from '../../src/shared/sqliteTableBrowse';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';

const base = { connectionId: 'file', database: 'main', table: '中文"表🚢', taskId: 'read', offset: 0, limit: 100, mode: 'and', filters: [], sort: [] };
/** 严格IPC只接收结构化条件，不接受SQL或文件能力，也不会借用网络表协议。 */
describe('SQLite表浏览严格合同及动态类型条件', () => {
  it('只公开明确main页请求，拒绝原始SQL/路径/凭据和其它数据库', () => {
    expect(publicCommands['sqlite.tablePage']).toBe(true); expect(validateCommand('sqlite.tablePage', base)).toEqual(base);
    for (const value of [{ ...base, database: 'other' }, { ...base, sql: 'DELETE FROM subject' }, { ...base, filePath: '外部文件' }, { ...base, profile: { dialect: 'sqlite' } }, { ...base, offset: -1 }, { ...base, offset: 1000000001 }, { ...base, limit: 1001 }]) expect(sqliteTablePageSchema.safeParse(value).success).toBe(false);
  });
  it('类型和值必须显式匹配，NULL无值、二进制完整字节，排序列唯一且有界', () => {
    for (const value of [{ column: 'x', operator: 'eq' }, { column: 'x', operator: 'isNull', value: { kind: 'text', value: '' } }, { column: 'x', operator: 'contains', value: { kind: 'integer', value: '1' } }, { column: 'x', operator: 'gt', value: { kind: 'blob', value: '00ff' } }, { column: 'x', operator: 'eq', value: { kind: 'blob', value: '0' } }]) expect(sqliteTablePageSchema.safeParse({ ...base, filters: [value] }).success).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, filters: [{ column: 'x', operator: 'isNull' }, { column: 'x', operator: 'eq', value: { kind: 'blob', value: '' } }] }).success).toBe(true);
    expect(sqliteTablePageSchema.safeParse({ ...base, sort: [{ column: 'x', direction: 'asc' }, { column: 'x', direction: 'desc' }] }).success).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, filters: Array.from({ length: 33 }, () => ({ column: 'x', operator: 'notNull' })) }).success).toBe(false);
  });
  it('有符号64位边界保留原文，有限REAL与有效Unicode受控，文本NUL仍为合法参数', () => {
    const check = (kind: string, value: string) => sqliteTablePageSchema.safeParse({ ...base, filters: [{ column: 'x', operator: 'eq', value: { kind, value } }] }).success;
    for (const value of ['9223372036854775807', '-9223372036854775808', '-0']) expect(check('integer', value)).toBe(true);
    for (const value of ['9223372036854775808', '-9223372036854775809', '1.0', '01', '9'.repeat(1000)]) expect(check('integer', value)).toBe(false);
    for (const value of ['-.5', '+1.25e2', '-0']) expect(check('real', value)).toBe(true);
    for (const value of ['Infinity', 'NaN', '1e999', '1;DROP TABLE x']) expect(check('real', value)).toBe(false);
    expect(check('text', '中文\0🚢')).toBe(true); expect(check('text', '\ud800')).toBe(false);
    expect(sqliteTablePageSchema.safeParse({ ...base, table: '\udc00' }).success).toBe(false);
  });
});
