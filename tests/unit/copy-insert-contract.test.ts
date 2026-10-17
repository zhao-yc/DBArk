import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';

const input = { database: '明确库', table: '明确表', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '' }], rows: [{ id: '18446744073709551615' }] };
describe('表行 INSERT 专用复制命令', () => {
  it('公开严格的已加载行参数，不把 INSERT 字符串交给对象链接或查询执行命令', () => {
    expect(validateCommand('table.copyInsertSql', input)).toEqual(input);
    expect(Object.hasOwn(publicCommands, 'table.copyInsertSql')).toBe(true);
  });
  it('拒绝任意文本、未知参数和 SQL 执行参数', () => {
    for (const value of ['INSERT INTO x VALUES(1)', { text: '任意剪贴板文字' }, { ...input, sql: 'DELETE FROM x' }, { ...input, connectionId: '伪造连接' }]) expect(() => validateCommand('table.copyInsertSql', value)).toThrow();
  });
});
