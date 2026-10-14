import { describe, expect, it } from 'vitest';
import { jsonLexicalLimits, lexicalToken, parseJsonLexicalTree, parseRecordInputDocumentTree, recordInputLexicalLimits } from '../../src/renderer/jsonLexicalTree';

describe('整行输入候选的固定词法策略', () => {
  it('完整大输入仅通过专用策略，单JSON字段的262144硬上限不变', () => {
    const source = JSON.stringify({ fields: [{ name: 'payload', mode: 'text', text: 'x'.repeat(300_000) }] });
    expect(parseJsonLexicalTree(source).status).toBe('limited'); expect(parseRecordInputDocumentTree(source).status).toBe('ready'); expect(jsonLexicalLimits.sourceUnits).toBe(262_144);
    expect(() => parseJsonLexicalTree(source, { sourceUnits: 2_097_152 })).toThrow('只能降低');
  });
  it('独立策略不可经对象属性修改放宽', () => {
    expect(Reflect.set(recordInputLexicalLimits, 'sourceUnits', 16_777_216)).toBe(false); expect(recordInputLexicalLimits.sourceUnits).toBe(2_097_152); expect(Object.isFrozen(recordInputLexicalLimits)).toBe(true);
  });
  it('恰好2MiB的ASCII词法输入可以完整通过，多一个单元整体拒绝', () => {
    const source = '"' + 'x'.repeat(2_097_150) + '"'; const result = parseRecordInputDocumentTree(source); expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error(result.reason);
    expect(result.text).toBe(source); expect(result.sourceBytes).toBe(2_097_152); expect(lexicalToken(result, result.nodes[result.root])).toBe(source);
    const tooLong = parseRecordInputDocumentTree(source + ' '); expect(tooLong.status).toBe('limited'); expect(Object.hasOwn(tooLong, 'nodes')).toBe(false);
  });
  it('UTF16未超限但UTF8超过2MiB的中文同样拒绝，不先建大字节缓冲', () => {
    const result = parseRecordInputDocumentTree('"' + '中'.repeat(699_051) + '"'); expect(result.status).toBe('limited'); expect(Object.hasOwn(result, 'nodes')).toBe(false);
  });
  it('深度16完整通过，17不提供部分树，原字段策略仍允许更深合法输入', () => {
    const at = '['.repeat(15) + '0' + ']'.repeat(15), over = '['.repeat(16) + '0' + ']'.repeat(16);
    expect(parseRecordInputDocumentTree(at).status).toBe('ready'); const rejected = parseRecordInputDocumentTree(over); expect(rejected.status).toBe('limited'); expect(Object.hasOwn(rejected, 'nodes')).toBe(false); expect(parseJsonLexicalTree(over).status).toBe('ready');
  });
  it('4096容器条目完整通过，4097整体拒绝', () => {
    expect(parseRecordInputDocumentTree('[' + Array(4096).fill('0').join(',') + ']').status).toBe('ready'); const rejected = parseRecordInputDocumentTree('[' + Array(4097).fill('0').join(',') + ']'); expect(rejected.status).toBe('limited'); expect(Object.hasOwn(rejected, 'nodes')).toBe(false);
  });
  it('32768节点预算独立于每容器限制，超额不暴露部分节点', () => {
    const inner = '[' + Array(4095).fill('0').join(',') + ']'; const result = parseRecordInputDocumentTree('[' + Array(8).fill(inner).join(',') + ']'); expect(result.status).toBe('limited'); if (result.status === 'ready') throw Error('不应发布超额树'); expect(result.reason).toContain('节点'); expect(Object.hasOwn(result, 'nodes')).toBe(false);
  });
  it('版本等非字符串数字token最多16单元，长数字不转换为Number', () => {
    const result = parseRecordInputDocumentTree('12345678901234567'); expect(result.status).toBe('limited'); expect(parseJsonLexicalTree('12345678901234567').status).toBe('ready');
  });
  it('重复及转义同名成员仍完整保留，解码器可在JSON.parse前拒绝重复', () => {
    const result = parseRecordInputDocumentTree('{"format":"x","format":"y","\\u0066ormat":"z","__proto__":1}'); expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error(result.reason);
    const root = result.nodes[result.root]; if (root.kind !== 'object') throw Error('应是完整对象'); expect(root.members.map(member => member.key)).toEqual(['format', 'format', 'format', '__proto__']); expect(root.members.map(member => member.memberIndex)).toEqual([0, 1, 2, 3]);
  });
  it('非法尾部不因更大策略而被忽略', () => {
    for (const source of ['{"fields":[]} tail', '{"fields":[}', '{"x":1,}', '']) { const result = parseRecordInputDocumentTree(source); expect(result.status).toBe('invalid'); expect(Object.hasOwn(result, 'nodes')).toBe(false); }
  });
});
