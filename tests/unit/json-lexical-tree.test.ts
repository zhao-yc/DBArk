import { describe, expect, it, vi } from 'vitest';
import { boundedUtf8Bytes, jsonLexicalLimits, lexicalNodeAtPath, lexicalToken, parseJsonLexicalTree, type ReadyLexicalDocument } from '../../src/renderer/jsonLexicalTree';

/** 只有完整解析才允许测试访问节点，避免错误结果被测试强制当作部分树。 */
function ready(text: string): ReadyLexicalDocument { const result = parseJsonLexicalTree(text); expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error(result.reason); return result; }

describe('JSON 词法树保留客户端原文而不重建对象', () => {
  it.each(['900719925474099312345678901234567890', '-0', '1.2300', '1e+09', '-1E-009', '1e9999'])('数字 %s 只有原 token 与精确范围', text => {
    const doc = ready(` \n${text}\t`); const node = doc.nodes[doc.root];
    expect(node).toEqual({ kind: 'number', start: 2, end: 2 + text.length }); expect(lexicalToken(doc, node)).toBe(text); expect(Object.hasOwn(node, 'value')).toBe(false);
  });
  it('重复成员、转义同名和纯数字键都保有原序号，原型键无特殊含义', () => {
    const source = '{"10":0,"2":1,"a":2,"\\u0061":3,"__proto__":{"constructor":4},"a":5}'; const doc = ready(source); const root = doc.nodes[0];
    expect(root.kind).toBe('object'); if (root.kind !== 'object') throw new Error('不是对象');
    expect(root.members.map(member => [member.memberIndex, member.key, lexicalToken(doc, doc.nodes[member.valueNode])])).toEqual([[0, '10', '0'], [1, '2', '1'], [2, 'a', '2'], [3, 'a', '3'], [4, '__proto__', '{"constructor":4}'], [5, 'a', '5']]);
    expect(root.members.map(member => source.slice(member.keySpan.start, member.keySpan.end))).toEqual(['"10"', '"2"', '"a"', '"\\u0061"', '"__proto__"', '"a"']);
    const node = lexicalNodeAtPath(doc, { document: doc, segments: [{ kind: 'member', memberIndex: 3, key: 'a' }] })!; expect(lexicalToken(doc, node)).toBe('3');
    expect(lexicalNodeAtPath(doc, { document: doc, segments: [{ kind: 'member', memberIndex: 3, key: 'wrong' }] })).toBeUndefined();
  });
  it('嵌套数组、点/斜线/波浪线/Unicode键以结构片段定位', () => {
    const doc = ready('{"a.b/~汉":[null,{"a.b/~汉":"😀\\n\\u0061"}]}');
    const segments = [{ kind: 'member', memberIndex: 0, key: 'a.b/~汉' }, { kind: 'element', index: 1 }, { kind: 'member', memberIndex: 0, key: 'a.b/~汉' }] as const;
    const node = lexicalNodeAtPath(doc, { document: doc, segments })!; expect(lexicalToken(doc, node)).toBe('"😀\\n\\u0061"');
    expect(lexicalNodeAtPath(doc, { document: ready(doc.text), segments })).toBeUndefined();
    expect(lexicalNodeAtPath(doc, { document: doc, segments: [{ kind: 'element', index: 0 }] })).toBeUndefined();
    expect(() => lexicalToken(doc, ready('1').nodes[0])).toThrow('不属于');
  });
  it.each(['"root"', 'true', 'false', 'null', '[]', '{}', '"\\uD800"', '"\ud800"'])('允许标量及空容器 %s；原文代码单元不归一化', source => {
    const doc = ready(source); expect(doc.text).toBe(source); expect(lexicalToken(doc, doc.nodes[0])).toBe(source);
  });
  it('冻结文档、节点及成员，展示消费者不能改写节点身份或范围', () => {
    const doc = ready('{"a":[1]}'); const root = doc.nodes[0]; expect(Object.isFrozen(doc)).toBe(true); expect(Object.isFrozen(doc.nodes)).toBe(true); expect(Object.isFrozen(root)).toBe(true);
    if (root.kind !== 'object') throw new Error('不是对象'); expect(Object.isFrozen(root.members)).toBe(true); expect(Object.isFrozen(root.members[0])).toBe(true); expect(Object.isFrozen(root.members[0].keySpan)).toBe(true);
  });
  it('实际解码调用仅接收定位好的成员字符串token，不把对象或数组交给JSON.parse', () => {
    const spy = vi.spyOn(JSON, 'parse');
    try {
      const doc = ready('{"a":[9007199254740993,{"\\u0061":-0}],"a":1e9999}');
      expect(doc.nodes[0].kind).toBe('object'); expect(spy.mock.calls.map(call => call[0])).toEqual(['"a"', '"\\u0061"', '"a"']);
    } finally { spy.mockRestore(); }
  });
});

describe('完整语法和独立资源边界', () => {
  it.each(['', ' ', '01', '-01', '+1', '1.', '.1', '1e', '1e+', '--1', 'NaN', 'Infinity', '{"a":1,}', '[1,]', '[,1]', '{a:1}', '{"a" 1}', '{"a":}', 'true false', '{} trailing', '"unterminated', '"\\x01"', '"\\u12zz"', '"\n"', '\ufeff{}', '/*x*/1'])('非法全文 %j 不暴露部分树', source => {
    const result = parseJsonLexicalTree(source); expect(result.status).toBe('invalid'); expect(Object.hasOwn(result, 'nodes')).toBe(false); expect(Object.hasOwn(result, 'root')).toBe(false);
    if (result.status !== 'ready') { expect(result.offset).toBeGreaterThanOrEqual(0); expect(result.offset).toBeLessThanOrEqual(source.length); expect(result.text).toBe(source); }
  });
  it('尾部与分隔符错误偏移指向当前读取边界', () => {
    expect(parseJsonLexicalTree('{"a":1} x')).toMatchObject({ status: 'invalid', offset: 8 }); expect(parseJsonLexicalTree('[1,]')).toMatchObject({ status: 'invalid', offset: 3 });
  });
  it('UTF-16 与 UTF-8 限额分别计量，不先编码再截断', () => {
    expect(boundedUtf8Bytes('a汉😀\ud800', 11)).toBe(11); expect(boundedUtf8Bytes('a汉😀\ud800', 10)).toBeUndefined();
    expect(parseJsonLexicalTree('"汉"', { sourceBytes: 5, sourceUnits: 3 }).status).toBe('ready'); expect(parseJsonLexicalTree('"汉"', { sourceBytes: 4 }).status).toBe('limited'); expect(parseJsonLexicalTree('"汉"', { sourceUnits: 2 }).status).toBe('limited');
  });
  it('深度、节点和每容器成员各在准确边界拒绝，不返回已完成前缀', () => {
    expect(parseJsonLexicalTree('[[0]]', { depth: 3 }).status).toBe('ready'); expect(parseJsonLexicalTree('[[0]]', { depth: 2 }).status).toBe('limited');
    expect(parseJsonLexicalTree('[0,1]', { nodes: 3, containerItems: 2 }).status).toBe('ready'); expect(parseJsonLexicalTree('[0,1]', { nodes: 2 }).status).toBe('limited'); expect(parseJsonLexicalTree('[0,1]', { containerItems: 1 }).status).toBe('limited');
    expect(parseJsonLexicalTree('{"a":1,"a":2}', { containerItems: 1 })).not.toHaveProperty('nodes');
  });
  it('字符串 token 含转义开销，数字长度单独有界', () => {
    expect(parseJsonLexicalTree('"abcd"', { stringUnits: 4 }).status).toBe('ready'); expect(parseJsonLexicalTree('"abcde"', { stringUnits: 4 }).status).toBe('limited');
    expect(parseJsonLexicalTree('"\\u0061"', { stringUnits: 5 }).status).toBe('limited'); expect(parseJsonLexicalTree('1234', { numberUnits: 4 }).status).toBe('ready'); expect(parseJsonLexicalTree('12345', { numberUnits: 4 }).status).toBe('limited');
  });
  it('真实硬限额阻止大输入和深层栈增长，调用方不得扩大限额', () => {
    expect(parseJsonLexicalTree(' '.repeat(jsonLexicalLimits.sourceUnits + 1)).status).toBe('limited'); expect(parseJsonLexicalTree('['.repeat(65) + '0' + ']'.repeat(65)).status).toBe('limited');
    expect(() => parseJsonLexicalTree('1', { nodes: 8193 })).toThrow('只能降低');
    let invoked = false; expect(() => parseJsonLexicalTree('1', Object.defineProperty({}, 'nodes', { enumerable: true, get() { invoked = true; return 8; } }))).toThrow('访问器'); expect(invoked).toBe(false);
  });
  it('默认字节/节点/深度硬边界本身可达，非仅降低预算的镜像测试', () => {
    expect(parseJsonLexicalTree(' '.repeat(262_143) + '0').status).toBe('ready');
    expect(parseJsonLexicalTree('['.repeat(63) + '0' + ']'.repeat(63)).status).toBe('ready');
    expect(parseJsonLexicalTree('['.repeat(64) + '0' + ']'.repeat(64)).status).toBe('limited');
    const array = (count: number) => '[' + Array.from({ length: count }, () => '0').join(',') + ']';
    const exact = parseJsonLexicalTree('[' + [array(2047), array(2047), array(2047), array(2046)].join(',') + ']');
    expect(exact.status).toBe('ready'); if (exact.status === 'ready') expect(exact.nodes).toHaveLength(8192);
    expect(parseJsonLexicalTree('[' + [array(2047), array(2047), array(2047), array(2047)].join(',') + ']').status).toBe('limited');
    expect(parseJsonLexicalTree(array(2049)).status).toBe('limited');
  });
});
