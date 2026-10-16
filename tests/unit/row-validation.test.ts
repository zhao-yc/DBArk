import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { collectChanges } from '../../src/renderer/dataChanges';
import { buildChanges } from '../../src/engine/sql';
import type { CommandMap, DataRow, RowChange, TableInfo } from '../../src/shared/contracts';

const target = { connectionId: '连接', database: '库', table: '表' };
const info: TableInfo = { database: '库', name: '表', engine: 'InnoDB', ddl: '', indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], columns: [
  ['id', 'bigint unsigned'], ['title', 'varchar(100)'], ['__proto__', 'varchar(100)'], ['constructor', 'varchar(100)'], ['amount', 'decimal(30,6)'], ['binary', 'blob'], ['nullable', 'varchar(100)'],
].map(([name, type]) => ({ name, type, nullable: name !== 'id', defaultValue: null, generated: false, extra: '', comment: '' })) };
/** 与真实查询页一致，使用自有数据属性表示包括原型同名列在内的完整原始行。 */
function original(): DataRow { return Object.fromEntries([['id', '18446744073709551615'], ['title', '原标题'], ['__proto__', '原型旧值'], ['constructor', '构造旧值'], ['amount', '12345678901234567890.123456'], ['binary', { type: 'binary', base64: 'AP8=' }], ['nullable', null]]); }
/** 请求实际经过生产 IPC 校验，再交给生产 SQL 构造器；不模拟任何数据行解析。 */
function preview(changes: RowChange[]) { return validateCommand('table.preview', { ...target, changes }) as CommandMap['table.preview']['input']; }

describe('合法原型列跨草稿、IPC 和 SQL 完整旧值校验', () => {
  it.each(['table.preview', 'table.apply'] as const)('%s 保留 __proto__ 原值与新值，精确数值、NULL和二进制不改变', command => {
    const before = original(); const data = { ...before, ['__proto__']: '$& 新原型', title: '新标题' };
    const changes = collectChanges([{ id: 'row', data, original: before, inserted: false, deleted: false }]);
    expect(Object.hasOwn((changes[0] as Extract<RowChange, { kind: 'update' }>).before, '__proto__')).toBe(true);
    const parsed = validateCommand(command, { ...target, changes, ...(command === 'table.apply' ? { taskId: 'task' } : {}) }) as CommandMap['table.preview']['input'];
    const update = parsed.changes[0] as Extract<RowChange, { kind: 'update' }>;
    expect(Object.hasOwn(update.before, '__proto__')).toBe(true); expect(Object.hasOwn(update.values, '__proto__')).toBe(true);
    expect(update.before).toEqual(before); expect(update.before).not.toBe(before); expect(update.values['__proto__']).toBe('$& 新原型');
    expect(Object.getPrototypeOf(update.before)).toBe(Object.prototype); expect(Object.getPrototypeOf(update.values)).toBe(Object.prototype);
    const result = buildChanges(info, parsed.changes); expect(result.statements).toHaveLength(1);
    expect(result.statements[0].sql).toContain('`__proto__` = ?'); expect(result.statements[0].sql).toContain('BINARY CONVERT(`__proto__` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)');
    expect(result.statements[0].params).toEqual(['新标题', '$& 新原型', before.id, before.title, before['__proto__'], before.constructor, before.amount, before.binary, null]);
    expect(before['__proto__']).toBe('原型旧值'); expect(data['__proto__']).toBe('$& 新原型');
  });
  it('删除仍校验原型列旧值，真正缺失的原始字段仍被拒绝', () => {
    const before = original(); const complete = preview([{ kind: 'delete', before }]);
    const result = buildChanges(info, complete.changes); expect(result.statements[0].sql).toContain('BINARY CONVERT(`__proto__` USING utf8mb4)'); expect(result.statements[0].params).toContain('原型旧值');
    const missing = { ...before }; delete missing['__proto__'];
    const parsed = preview([{ kind: 'update', before: missing, values: { title: '新标题' } }]);
    expect(() => buildChanges(info, parsed.changes)).toThrow('缺少完整原始行：__proto__');
    expect(() => buildChanges(info, preview([{ kind: 'delete', before: missing }]).changes)).toThrow('缺少完整原始行：__proto__');
  });
  it('插入保留原型自有列，缺省与显式 NULL 继续产生不同 SQL', () => {
    const explicit = preview([{ kind: 'insert', values: Object.fromEntries([['__proto__', null], ['constructor', '构造新值'], ['prototype', '尚无此字段']]) }]);
    expect(Object.hasOwn((explicit.changes[0] as Extract<RowChange, { kind: 'insert' }>).values, '__proto__')).toBe(true);
    expect(() => buildChanges(info, explicit.changes)).toThrow('未知字段：prototype');
    const inserted = buildChanges(info, preview([{ kind: 'insert', values: Object.fromEntries([['__proto__', null], ['constructor', '构造新值']]) }]).changes);
    expect(inserted.statements[0].sql).toBe('INSERT INTO `库`.`表` (`__proto__`, `constructor`) VALUES (?, ?)'); expect(inserted.statements[0].params).toEqual([null, '构造新值']);
    const defaults = buildChanges(info, preview([{ kind: 'insert', values: {} }]).changes);
    expect(defaults.statements[0].sql).toBe('INSERT INTO `库`.`表` () VALUES ()'); expect(defaults.statements[0].params).toEqual([]);
  });
  it('每个原型列同样验证类型，不接受对象注入、缺失值、非法数字或额外二进制字段', () => {
    for (const value of [undefined, Infinity, NaN, 1n, [], { polluted: true }, { type: 'default' }, { type: 'binary', base64: 'AA==', extra: '不可信字段' }]) {
      const values = Object.fromEntries([['__proto__', value]]);
      expect(() => validateCommand('table.preview', { ...target, changes: [{ kind: 'insert', values }] })).toThrow('参数无效');
    }
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    const inherited = Object.create({ ['__proto__']: '继承值' }); inherited.title = '自有值';
    expect(() => validateCommand('table.preview', { ...target, changes: [{ kind: 'insert', values: inherited }] })).toThrow('普通字段对象');
    const accessor = Object.defineProperty({}, '__proto__', { enumerable: true, get() { throw new Error('不得访问 getter'); } });
    expect(() => validateCommand('table.preview', { ...target, changes: [{ kind: 'insert', values: accessor }] })).toThrow('可枚举');
    const nullPrototype = Object.assign(Object.create(null), { title: '普通值' });
    expect(preview([{ kind: 'insert', values: nullPrototype }]).changes).toEqual([{ kind: 'insert', values: { title: '普通值' } }]);
  });
  it('外层严格形状与原 5000 行上限保持，不能夹带额外写入字段', () => {
    expect(() => validateCommand('table.preview', { ...target, changes: [{ kind: 'insert', values: {}, sql: 'DROP TABLE x' }] })).toThrow('参数无效');
    expect(() => validateCommand('table.preview', { ...target, changes: Array.from({ length: 5001 }, () => ({ kind: 'insert', values: {} })) })).toThrow('参数无效');
    expect(preview([{ kind: 'insert', values: {} }]).changes).toHaveLength(1);
  });
  it('导入映射保留原型同名表头和列名，只接受自有字符串映射', () => {
    const mapping = Object.fromEntries([['__proto__', '__proto__'], ['constructor', 'constructor']]);
    const input = { ...target, fileToken: 'file', format: 'csv', encoding: 'utf8', taskId: 'import', mapping };
    const parsed = validateCommand('files.import', input) as CommandMap['files.import']['input'];
    expect(Object.hasOwn(parsed.mapping, '__proto__')).toBe(true); expect(parsed.mapping).toEqual(mapping); expect(Object.getPrototypeOf(parsed.mapping)).toBe(Object.prototype);
    for (const invalid of [Object.fromEntries([['__proto__', { type: 'binary', base64: 'AA==' }]]), new Map([['a', 'b']]), ['a'], new Date(), Object.create({ inherited: 'value' })]) expect(() => validateCommand('files.import', { ...input, mapping: invalid })).toThrow('参数无效');
    expect(validateCommand('files.import', { ...input, mapping: Object.assign(Object.create(null), mapping) })).toEqual(input);
  });
});
