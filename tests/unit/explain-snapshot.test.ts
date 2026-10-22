import { describe, expect, it } from 'vitest';
import type { CellValue, QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan } from '../../src/shared/explain';
import { captureExplainSnapshot, decodeExplainSnapshot, encodeExplainSnapshot, explainSnapshotLimits, explainSnapshotOutcome, parseExplainSnapshot, type ExplainSnapshotDocument } from '../../src/shared/explainSnapshot';

const raw = '{"query_block":{"table":{"table_name":"客户","rows_examined_per_scan":900719925474099312345,"future_value":"保留"}}}';

/** 使用真实解析器生成来源，派生字段故意加入不能被持久化的数据。 */
function outcome(format: 'json' | 'text' = 'json', values: CellValue[] = [raw]): QueryOutcome {
  return {
    elapsedMs: 35, transactionOpen: true,
    explain: { ...parseExplainPlan(raw, 'mysql', '8.4.0'), format, raw: format === 'json' ? raw : '', warnings: ['原始警告'], rawTruncated: true },
    results: [{ columns: values.map((_, index) => ({ key: `c${index}`, name: `列${index}`, type: '原始类型' })), rows: [Object.fromEntries(values.map((value, index) => [`c${index}`, value]))], truncated: true, elapsedMs: 25, statement: 'SELECT 秘密内容' }],
  };
}

/** 每例产生独立文档，以便确认非法输入没有被修正或重写。 */
function snapshot(): ExplainSnapshotDocument { return captureExplainSnapshot(outcome()); }

describe('执行计划离线快照的原始数据合同', () => {
  it('JSON 原文、未知字段、原始警告和截断保留；派生树只从原文重建', () => {
    const original = outcome(); original.explain!.nodes[0].kind = '伪造节点';
    const captured = captureExplainSnapshot(original), encoded = encodeExplainSnapshot(captured);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded).not.toContain('伪造节点'); expect(encoded).not.toContain('秘密内容');
    for (const field of ['statement', 'elapsedMs', 'transactionOpen', 'nodes', 'connectionId', 'sessionId']) expect(encoded).not.toContain(`"${field}"`);
    const reopened = explainSnapshotOutcome(decodeExplainSnapshot(encoded));
    expect(reopened.explain!.raw).toBe(raw); expect(reopened.explain!.nodes[0].kind).toBe('plan');
    expect(reopened.explain!.nodes.find(node => node.kind === 'table')?.rows?.value).toBe('900719925474099312345');
    expect(reopened.explain!.warnings).toEqual(['原始警告']); expect(reopened.explain!.rawTruncated).toBe(true);
    expect(reopened.results[0].statement).toBe(''); expect(reopened.elapsedMs).toBe(0); expect(reopened.results[0].elapsedMs).toBe(0);
    expect(reopened.results[0].truncated).toBe(true); expect(reopened).not.toHaveProperty('transactionOpen');
  });
  it('文本原始表格完整往返精确文本、微秒、NULL、空串、布尔、字节、负零和有限 Number', () => {
    const values: CellValue[] = ['9223372036854775807', '1234567890.123456789000', '2026-10-22 12:34:56.123456', null, '', true, false, { type: 'binary', base64: 'AP8=' }, -0, 0, Number.MIN_VALUE, Number.MAX_VALUE, 1 / 3];
    const captured = captureExplainSnapshot(outcome('text', values)), restored = explainSnapshotOutcome(decodeExplainSnapshot(encodeExplainSnapshot(captured)));
    expect(captured.result.rows[0].c8).toEqual({ type: 'number', text: '-0' });
    values.forEach((value, index) => expect(restored.results[0].rows[0][`c${index}`]).toEqual(value));
    expect(Object.is(restored.results[0].rows[0].c8, -0)).toBe(true);
    expect(restored.explain).toMatchObject({ format: 'text', raw: '', nodes: [], warnings: ['原始警告'], rawTruncated: true });
  });
  it('空列、空行的文本计划仍能保存', () => {
    const original = outcome('text', []); original.results[0].rows = [];
    expect(explainSnapshotOutcome(captureExplainSnapshot(original)).results[0]).toMatchObject({ columns: [], rows: [] });
  });
  it('允许无法解析的内层原文，外层严格有效，诊断从原文重建', () => {
    const original = outcome(); original.explain!.raw = '{无效内层JSON}'; original.results[0].rows[0].c0 = original.explain!.raw;
    const result = explainSnapshotOutcome(captureExplainSnapshot(original));
    expect(result.explain!.raw).toBe('{无效内层JSON}'); expect(result.explain!.nodes).toEqual([]); expect(result.explain!.warnings[0]).toBe('原始警告'); expect(result.explain!.warnings.length).toBeGreaterThan(1);
  });
  it('空保存警告不能隐藏坏原文的重解析诊断，重复往返不增长', () => {
    const original = outcome(); original.explain!.raw = '{错误}'; original.results[0].rows[0].c0 = '{错误}'; original.explain!.warnings = [];
    const first = explainSnapshotOutcome(captureExplainSnapshot(original)); expect(first.explain!.warnings.length).toBeGreaterThan(0);
    const second = explainSnapshotOutcome(decodeExplainSnapshot(encodeExplainSnapshot(captureExplainSnapshot(first))));
    expect(second.explain!.warnings).toEqual(first.explain!.warnings);
  });
  it('旧警告与相同解析器诊断去重且总数不超过64', () => {
    const original = outcome(); original.explain!.raw = '{错误}'; original.results[0].rows[0].c0 = '{错误}';
    const generated = parseExplainPlan('{错误}', 'mysql', '8.4.0').warnings;
    original.explain!.warnings = [...generated, ...Array.from({ length: 63 }, (_, index) => `原警告${index}`)];
    const restored = explainSnapshotOutcome(captureExplainSnapshot(original)); expect(restored.explain!.warnings).toHaveLength(64); expect(new Set(restored.explain!.warnings).size).toBe(64);
  });
  it('原型同名键安全且自有列完全对应', () => {
    const original = outcome('text');
    original.results[0].columns = ['__proto__', 'constructor', 'toString'].map(key => ({ key, name: key, type: 'TEXT' }));
    original.results[0].rows = [JSON.parse('{"__proto__":"原始值","constructor":null,"toString":""}')];
    const restored = explainSnapshotOutcome(decodeExplainSnapshot(encodeExplainSnapshot(captureExplainSnapshot(original))));
    const row = restored.results[0].rows[0];
    expect(Object.getPrototypeOf(row)).toBe(null); expect(row.__proto__).toBe('原始值'); expect(row.constructor).toBe(null); expect(row.toString).toBe('');
  });
  it('深复制文件对象及结果，不共享原始数组和单元格', () => {
    const original = outcome('text', [{ type: 'binary', base64: 'AA==' }]);
    const captured = captureExplainSnapshot(original), parsed = parseExplainSnapshot(captured);
    original.results[0].columns[0].name = '已改'; (original.results[0].rows[0].c0 as { base64: string }).base64 = '/w==';
    captured.warnings.push('新警告'); (captured.result.rows[0].c0 as { base64: string }).base64 = 'AQ==';
    expect(parsed.result.columns[0].name).toBe('列0'); expect(parsed.result.rows[0].c0).toEqual({ type: 'binary', base64: 'AA==' }); expect(parsed.warnings).toEqual(['原始警告']);
  });
  it.each(['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result'])('缺字段 %s 明确拒绝', field => {
    const value = snapshot(); Reflect.deleteProperty(value, field); expect(() => parseExplainSnapshot(value)).toThrow();
  });
  it.each([{ version: 2 }, { dialect: 'postgres' }, { format: 'tree' }, { kind: 'future.snapshot' }, { rawTruncated: 1 }, { nodes: [] }, { connectionId: '密码' }, { statement: 'SELECT 1' }])('拒绝未知格式和额外字段 %j', patch => {
    expect(() => parseExplainSnapshot(Object.assign(snapshot(), patch))).toThrow();
  });
  it('JSON 单列单行必须与树的原文一致，文本原文必须为空', () => {
    const changed = snapshot(); changed.result.rows[0].c0 = '不同原文'; expect(() => parseExplainSnapshot(changed)).toThrow();
    const text = captureExplainSnapshot(outcome('text')); text.raw = raw; expect(() => parseExplainSnapshot(text)).toThrow();
  });
  it.each([undefined, 1n, NaN, Infinity, -Infinity, new Date(), {}, [], { type: 'number', text: '1' }])('捕获拒绝不支持的源单元格 %#', value => {
    const original = outcome('text'); original.results[0].rows[0].c0 = value as CellValue;
    expect(() => captureExplainSnapshot(original)).toThrow(); expect(original.results[0].rows[0].c0).toBe(value);
  });
  it.each(['01', '+1', '1.0', '1e0', ' 1', '', 'NaN', 'Infinity', '-Infinity', '1e400', '-0.0', '0.0000010'])('数字标签必须是有限标准往返串 %s', value => {
    const changed = captureExplainSnapshot(outcome('text')); changed.result.rows[0].c0 = { type: 'number', text: value }; expect(() => parseExplainSnapshot(changed)).toThrow();
  });
  it.each(['A', 'AA', 'AA=', 'AA===', 'A===', 'AB==', 'AAB=', 'AA-=', 'AA_=', 'AA==\n', 'éA=='])('字节标签拒绝非标准 Base64 %s', value => {
    const changed = captureExplainSnapshot(outcome('text')); changed.result.rows[0].c0 = { type: 'binary', base64: value }; expect(() => parseExplainSnapshot(changed)).toThrow();
  });
  it.each(['', 'AA==', '/w==', 'AAA=', '////'])('字节标签接受标准 Base64 %s', value => {
    const changed = captureExplainSnapshot(outcome('text', [{ type: 'binary', base64: value }])); expect(parseExplainSnapshot(changed).result.rows[0].c0).toEqual({ type: 'binary', base64: value });
  });
  it('拒绝重复列、缺列、多列、隐藏字段、符号和自定义原型', () => {
    const cases: ExplainSnapshotDocument[] = [];
    let changed = snapshot(); changed.result.columns.push({ ...changed.result.columns[0] }); cases.push(changed);
    changed = snapshot(); Reflect.deleteProperty(changed.result.rows[0], 'c0'); cases.push(changed);
    changed = snapshot(); changed.result.rows[0].extra = ''; cases.push(changed);
    changed = snapshot(); Object.defineProperty(changed, 'extra', { value: true }); cases.push(changed);
    changed = snapshot(); Object.defineProperty(changed, Symbol('额外字段'), { value: true }); cases.push(changed);
    changed = snapshot(); Object.setPrototypeOf(changed.result.rows[0], { inherited: true }); cases.push(changed);
    for (const value of cases) expect(() => parseExplainSnapshot(value)).toThrow();
  });
  it('所有层的访问器均零执行；非法输入不修改源', () => {
    let gets = 0;
    for (const level of ['root', 'column', 'row', 'binary', 'array'] as const) {
      const changed = captureExplainSnapshot(outcome('text', [{ type: 'binary', base64: 'AA==' }]));
      const target = level === 'root' ? changed : level === 'column' ? changed.result.columns[0] : level === 'row' ? changed.result.rows[0] : level === 'binary' ? changed.result.rows[0].c0 as object : changed.warnings;
      const key = level === 'root' ? 'raw' : level === 'column' ? 'key' : level === 'row' ? 'c0' : level === 'binary' ? 'base64' : '0';
      const getter = () => { gets++; throw Error('不可执行'); }; Object.defineProperty(target, key, { get: getter, enumerable: true, configurable: true });
      expect(() => parseExplainSnapshot(changed)).toThrow(); expect(Object.getOwnPropertyDescriptor(target, key)?.get).toBe(getter);
    }
    expect(gets).toBe(0);
  });
  it('稀疏、额外数组键和循环结构明确拒绝，不无限递归', () => {
    for (const field of ['warnings', 'columns', 'rows'] as const) {
      const changed = snapshot(), target = field === 'warnings' ? changed.warnings : changed.result[field];
      Reflect.deleteProperty(target, '0'); expect(() => parseExplainSnapshot(changed)).toThrow();
    }
    const changed = snapshot(); Object.defineProperty(changed.warnings, 'extra', { value: true }); expect(() => parseExplainSnapshot(changed)).toThrow();
    const cyclic = snapshot(); cyclic.result.rows[0].c0 = cyclic as never; expect(() => parseExplainSnapshot(cyclic)).toThrow();
  });
  it.each(['\ud800', '\udc00', 'a\ud800b'])('拒绝孤立 UTF-16 代理项 %j，不损坏真实 emoji', value => {
    const changed = snapshot(); changed.serverVersion = value; expect(() => parseExplainSnapshot(changed)).toThrow();
    changed.serverVersion = '8.4.0🚀'; expect(parseExplainSnapshot(changed).serverVersion).toBe('8.4.0🚀');
    expect(() => decodeExplainSnapshot('{"x":"' + value + '"}')).toThrow();
  });
  it('原文和单格 192 KiB 上界按 UTF-8 计量，拒绝超长版本及过多行列警告', () => {
    const changed = captureExplainSnapshot(outcome('text', ['a'.repeat(explainSnapshotLimits.cell)])); expect(parseExplainSnapshot(changed).result.rows[0].c0).toHaveLength(explainSnapshotLimits.cell);
    changed.result.rows[0].c0 = 'a'.repeat(explainSnapshotLimits.cell + 1); expect(() => parseExplainSnapshot(changed)).toThrow();
    changed.result.rows[0].c0 = '中'.repeat(explainSnapshotLimits.cell / 3); expect(() => parseExplainSnapshot(changed)).not.toThrow();
    changed.result.rows[0].c0 += '中'; expect(() => parseExplainSnapshot(changed)).toThrow();
    for (const field of ['version', 'rows', 'columns', 'warnings'] as const) {
      const value = snapshot();
      if (field === 'version') value.serverVersion = 'x'.repeat(explainSnapshotLimits.version + 1);
      else if (field === 'warnings') value.warnings = Array(explainSnapshotLimits.warnings + 1).fill('');
      else value.result[field] = Array(explainSnapshotLimits[field] + 1).fill({}) as never;
      expect(() => parseExplainSnapshot(value)).toThrow();
    }
  });
  it('累计字节及 JSON 转义扩张计入 1 MiB 文件预算，解码在解析前拒绝超额', () => {
    expect(() => captureExplainSnapshot(outcome('text', Array(6).fill('a'.repeat(180000))))).toThrow();
    expect(() => captureExplainSnapshot(outcome('text', ['\u0000'.repeat(180000)]))).toThrow();
    expect(() => decodeExplainSnapshot(' '.repeat(explainSnapshotLimits.bytes + 1))).toThrow();
    const encoded = encodeExplainSnapshot(snapshot());
    const remaining = explainSnapshotLimits.bytes - new TextEncoder().encode(encoded).byteLength;
    expect(decodeExplainSnapshot(encoded + ' '.repeat(remaining)).raw).toBe(raw);
  });
  it('每行重复列键也计入累计预算，避免短单元格造成巨大序列化输出', () => {
    const changed = captureExplainSnapshot(outcome('text', ['']));
    const key = '键'.repeat(680);
    changed.result.columns = [{ key, name: '', type: '' }];
    changed.result.rows = Array.from({ length: 1000 }, () => ({ [key]: '' }));
    expect(() => parseExplainSnapshot(changed)).toThrow();
  });
  it('捕获来源访问器零执行，错误不改写结果或派生树', () => {
    const original = outcome(); let gets = 0;
    Object.defineProperty(original.results[0].rows[0], 'c0', { get: () => { gets++; return raw; }, enumerable: true });
    const nodes = original.explain!.nodes;
    expect(() => captureExplainSnapshot(original)).toThrow(); expect(gets).toBe(0); expect(original.explain!.nodes).toBe(nodes);
  });
  it('捕获要求正好一个结果，不静默丢弃额外结果', () => {
    const original = outcome(); original.results.push(original.results[0]); expect(() => captureExplainSnapshot(original)).toThrow();
    original.results = []; expect(() => captureExplainSnapshot(original)).toThrow();
  });
});
