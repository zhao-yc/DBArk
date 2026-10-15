import { describe, expect, it } from 'vitest';
import { parseJsonLexicalTree, lexicalToken, type LexicalPathSegment, type ReadyLexicalDocument } from '../../src/renderer/jsonLexicalTree';
import { beginJsonNodeInput } from '../../src/renderer/jsonNodeInput';
import { moveJsonObjectMember } from '../../src/renderer/jsonObjectMemberMove';

/** 只使用真实解析器的冻结词法文档，预期不由被测移动函数生成。 */
function ready(source: string): ReadyLexicalDocument { const parsed = parseJsonLexicalTree(source); if (parsed.status !== 'ready') throw Error(parsed.reason); return parsed; }
/** 返回完整字段原文；原选择和原文不能被移动就地修改。 */
function move(source: string, from: number, to: number, path: readonly LexicalPathSegment[] = []) {
  const document = ready(source), selection = beginJsonNodeInput(document, path), next = moveJsonObjectMember(selection, document, from, to);
  expect(document.text).toBe(source); expect(Object.isFrozen(document)).toBe(true); expect(selection.initialToken).toBe(lexicalToken(document, selection.node)); return next;
}

describe('对象成员移动保留完整原文与分隔槽位', () => {
  const source = ' \r\n{\n "a" : 9007199254740993 ,\t"b":-0,\r\n "c" : 1.2300e+09 }\t';
  it.each([
    [0, 2, ' \r\n{\n "b":-0 ,\t"c" : 1.2300e+09,\r\n "a" : 9007199254740993 }\t'],
    [2, 0, ' \r\n{\n "c" : 1.2300e+09 ,\t"a" : 9007199254740993,\r\n "b":-0 }\t'],
    [1, 0, ' \r\n{\n "b":-0 ,\t"a" : 9007199254740993,\r\n "c" : 1.2300e+09 }\t'],
    [1, 2, ' \r\n{\n "a" : 9007199254740993 ,\t"c" : 1.2300e+09,\r\n "b":-0 }\t'],
    [0, 1, ' \r\n{\n "b":-0 ,\t"a" : 9007199254740993,\r\n "c" : 1.2300e+09 }\t'],
    [2, 1, ' \r\n{\n "a" : 9007199254740993 ,\t"c" : 1.2300e+09,\r\n "b":-0 }\t'],
  ] as const)('首中末从%s到%s保留冒号空白及成员间槽位', (from, to, expected) => { expect(move(source, from, to).text).toBe(expected); });
  it('重复及转义同名键按原文序号移动，不按解码名称去重', () => {
    const value = '{"n":9007199254740993,"\\u006e" : -0,"n":1e999,"__proto__":{"x":1,"x":2}}';
    expect(move(value, 1, 3).text).toBe('{"n":9007199254740993,"n":1e999,"__proto__":{"x":1,"x":2},"\\u006e" : -0}');
  });
  it('嵌套逗号冒号引号和原型名称均作为完整键和值token移动', () => {
    const value = '{ "constructor" : ["a,b:c\\\"",{"x":1,"x":2}], "a\\u002eb":9007199254740993, "文🙂":-0 }';
    expect(move(value, 0, 2).text).toBe('{ "a\\u002eb":9007199254740993, "文🙂":-0, "constructor" : ["a,b:c\\\"",{"x":1,"x":2}] }');
  });
  it('孤立surrogate及ZWJ均保留原token，不替换Unicode或重新转义名称', () => {
    const value = '{"\ud800":"\udfff", "👩‍💻":"新🙂值"}'; expect(move(value, 0, 1).text).toBe('{"👩‍💻":"新🙂值", "\ud800":"\udfff"}');
  });
  it('只改变选中的嵌套对象，范围外字段及换行逐字相同', () => {
    const value = ' \n{"outside":1e999, "box" : { "x":-0,  "x":[1,"a,b"] }, "tail":9007199254740993}\r\n';
    expect(move(value, 1, 0, [{ kind: 'member', memberIndex: 1, key: 'box' }]).text).toBe(' \n{"outside":1e999, "box" : { "x":[1,"a,b"],  "x":-0 }, "tail":9007199254740993}\r\n');
  });
  it.each([0, 1, 2])('同位置%s是原文档引用，不制造新文档', position => { const document = ready(source); expect(moveJsonObjectMember(beginJsonNodeInput(document, []), document, position, position)).toBe(document); });
  it('唯一成员及两个完全相同的成员移动不产生内容变化', () => {
    for (const [value, from, to] of [['{ "x":-0 }', 0, 0], ['{"x":1,"x":1}', 0, 1]] as const) { const document = ready(value); expect(moveJsonObjectMember(beginJsonNodeInput(document, []), document, from, to)).toBe(document); }
  });
  it.each([-1, 3, 1.5, NaN, Infinity, 9007199254740992])('非法序号%s在任一方向均整体拒绝', position => {
    const document = ready(source), selection = beginJsonNodeInput(document, []);
    expect(() => moveJsonObjectMember(selection, document, position, 0)).toThrow('范围'); expect(() => moveJsonObjectMember(selection, document, 0, position)).toThrow('范围'); expect(document.text).toBe(source);
  });
  it('空对象、数组和标量没有可移动对象成员', () => {
    expect(() => move('{}', 0, 0)).toThrow('空对象'); for (const value of ['[]', '1', 'null', '"对象"']) expect(() => move(value, 0, 0)).toThrow('只有对象');
  });
  it('相同文本的新文档、旧节点或旧路径不能替代捕获身份，含同位置移动', () => {
    const document = ready(source), selection = beginJsonNodeInput(document, []);
    expect(() => moveJsonObjectMember(selection, ready(source), 0, 0)).toThrow('身份');
    expect(() => moveJsonObjectMember({ ...selection, node: { ...selection.node } }, document, 0, 1)).toThrow('身份');
    expect(() => moveJsonObjectMember({ ...selection, segments: [{ kind: 'member', memberIndex: 0, key: 'a' }] }, document, 0, 1)).toThrow('身份');
    expect(() => moveJsonObjectMember({ ...selection, initialToken: '{}' }, document, 0, 1)).toThrow('身份');
  });
});

describe('对象成员移动沿用完整字段硬预算', () => {
  it('恰好262144 ASCII代码单元及字节的完整字段移动不增删内容', () => {
    const value = '{"a":1,"b":2}'.padEnd(262144, ' '), result = move(value, 0, 1); expect(result.text).toBe('{"b":2,"a":1}'.padEnd(262144, ' ')); expect(result.sourceBytes).toBe(262144);
  });
  it('UTF8恰好上限且UTF16较小的中文及emoji原文完整保留', () => {
    const core = '{"a":"' + '中'.repeat(20000) + '🙂","b":"' + 'x'.repeat(60000) + '"}', value = core + ' '.repeat(262144 - Buffer.byteLength(core));
    const result = move(value, 1, 0); expect(result.sourceBytes).toBe(262144); expect(result.text.length).toBe(value.length); expect(result.text).toBe('{"b":"' + 'x'.repeat(60000) + '","a":"' + '中'.repeat(20000) + '🙂"}' + value.slice(core.length));
  });
  it('2048个同名成员保持完整条目数，不去重或触发对象枚举重排', () => {
    const value = '{' + Array.from({ length: 2048 }, (_, index) => '"x":' + index).join(',') + '}', result = move(value, 2047, 0), root = result.nodes[result.root];
    expect(root.kind).toBe('object'); if (root.kind !== 'object') throw Error('没有对象'); expect(root.members).toHaveLength(2048); expect(root.members.map(member => lexicalToken(result, result.nodes[member.valueNode]))).toEqual(['2047', ...Array.from({ length: 2047 }, (_, index) => String(index))]);
  });
  it('接近8192节点及深度上限的合法对象移动仍重新解析完整字段', () => {
    const array = '[' + Array(4).fill('[' + Array(2046).fill('0').join(',') + ']').join(',') + ']', value = '{"a":' + array + ',"b":-0}', result = move(value, 0, 1);
    expect(result.nodes).toHaveLength(8191); expect(result.text).toBe('{"b":-0,"a":' + array + '}');
    const deep = '['.repeat(62) + '1e999' + ']'.repeat(62); expect(move('{"a":' + deep + ',"b":-0}', 0, 1).text).toBe('{"b":-0,"a":' + deep + '}');
  });
});
