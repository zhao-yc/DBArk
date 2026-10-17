import { describe, expect, it, vi } from 'vitest';
import { validateColumnPatches } from '../../src/shared/tableColumnPatches';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { buildTableColumnPatchSql } from '../../src/engine/tableColumnPatchSql';

const pair = { charset: 'utf8mb4', collation: 'utf8mb4_0900_as_cs' };
/** 这里只构造补丁语法，不提供服务器事实或执行授权。 */
const alter = (value: unknown) => ({ kind: 'alter', columnRef: 'original-column', changes: { collation: value } });

describe('列排序规则共享合同及旧计划器隔离', () => {
  it('接受独立配对并复制输入，修改调用方对象不改变已验补丁', () => {
    const value = { ...pair }, output = validateColumnPatches([alter(value)]);
    value.collation = '另一个值';
    expect(output).toEqual([alter(pair)]);
  });
  it.each([null, undefined, {}, { charset: 'utf8mb4' }, { ...pair, sql: '不可执行' }, { ...pair, collation: 'x;DROP TABLE x' }, { ...pair, charset: ' utf8mb4' }, { ...pair, collation: 'x'.repeat(65) }])('拒绝缺失、非数据或越界配对 %#', value => {
    expect(() => validateColumnPatches([alter(value)])).toThrow();
  });
  it('拒绝访问器、toJSON、继承字段和符号；不执行调用方代码', () => {
    const getter = vi.fn(() => pair.collation), json = vi.fn(() => pair);
    const accessor = { charset: pair.charset }; Object.defineProperty(accessor, 'collation', { get: getter, enumerable: true });
    for (const value of [accessor, { ...pair, toJSON: json }, Object.assign(Object.create({ charset: pair.charset }), { collation: pair.collation }), { ...pair, [Symbol('unknown')]: 'x' }]) expect(() => validateColumnPatches([alter(value)])).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...alter(pair), changes: { collation: pair, comment: '不能混改' } }],
    [alter(pair), { kind: 'drop', columnRef: 'another' }],
    [alter(pair), { ...alter(pair), columnRef: 'another' }],
    [{ ...alter(pair), changes: { collation: pair, onUpdate: null } }],
  ].map(patches => ({ patches })))('拒绝多列或旁属性，绝不自动拆分 %#', ({ patches }) => {
    expect(() => validateColumnPatches(patches)).toThrow('单列单属性');
  });
  it('已有注释补丁保持原合同；新配对进入旧计划器必须显式拒绝', () => {
    expect(validateColumnPatches([{ kind: 'alter', columnRef: 'original-column', changes: { comment: '原路径' } }])).toHaveLength(1);
    const document = parseTableColumnDefinition('CREATE TABLE `subject` (`note` VARCHAR(40)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } });
    expect(() => buildTableColumnPatchSql(document, [alter(pair)], { database: 'example', serverVersion: '8.4.11', columnRefs: new Map([['original-column', 'note']]) })).toThrow('专用受控计划');
  });
});
