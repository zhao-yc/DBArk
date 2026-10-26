import { describe, expect, it } from 'vitest';
import type { CellValue, QueryOutcome } from '../../src/shared/contracts';
import { parseExplainPlan } from '../../src/shared/explain';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { captureExplainSnapshot, capturePlanSnapshot, decodeExplainSnapshot, decodePlanSnapshot, encodeExplainSnapshot, encodePlanSnapshot, explainSnapshotLimits, explainSnapshotOutcome, parseExplainSnapshot, parsePlanSnapshot, planSnapshotOutcome, type AnalyzeSnapshotDocument } from '../../src/shared/explainSnapshot';

const mysqlRaw = "-> Filter: (notes = '业务字面值_仍在原文')  (cost=1.234567890123456789 rows=18446744073709551615) (actual time=0.0000000000000000001..1.234567890123456789 rows=2.5 loops=3)";
const mariaRaw = '{"query_block":{"r_total_time_ms":0.123456789012345678901,"table":{"table_name":"业务表","rows":18446744073709551615,"r_rows":2.5,"r_loops":3,"r_filtered":0}}}';

/** 只使用合成原文；派生指标、SQL和活动事务用于证明文件白名单不会主动保存这些字段。 */
function actualOutcome(dialect: 'mysql' | 'mariadb' = 'mysql', raw = dialect === 'mysql' ? mysqlRaw : mariaRaw): QueryOutcome {
  const analysis = parseQueryAnalyzePlan(raw, dialect, dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB', dialect === 'mysql' ? 'tree' : 'json');
  analysis.warnings = ['原始实测提示'];
  return { analysis, elapsedMs: 73, transactionOpen: true,
    results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'LONGTEXT' }], rows: [{ c0: raw }], truncated: false, elapsedMs: 57, statement: 'SELECT 主动SQL字段不会写入文件' }] };
}

/** 每例取得独立文件对象；不使用断言类型强行把估算文档当实测文档。 */
function actualSnapshot(outcome = actualOutcome()): AnalyzeSnapshotDocument {
  const snapshot = capturePlanSnapshot(outcome);
  if (snapshot.kind !== 'dbark.analyze-snapshot') throw Error('合成实际计划未捕获为实测文档');
  return snapshot;
}

/** 非标准结果必须先明确标记不完整，才能沿用原表格的NULL/数字/字节容器查看。 */
function partialOutcome(values: CellValue[]): QueryOutcome {
  const raw = values.length === 1 && typeof values[0] === 'string' ? values[0] : '';
  const outcome = actualOutcome('mysql', raw);
  outcome.analysis!.rawTruncated = true;
  outcome.results[0] = { columns: values.map((_, index) => ({ key: 'c' + index, name: '原始列' + index, type: '原始类型' })), rows: [Object.fromEntries(values.map((value, index) => ['c' + index, value]))], truncated: true, elapsedMs: 7, statement: 'SELECT 不应持久化' };
  return outcome;
}

describe('估算与实测快照严格分流，旧v1接口保持', () => {
  it('通用估算编码与旧六个函数生成相同v1文档及展示结果', () => {
    const raw = '{"query_block":{"table":{"table_name":"t","rows_examined_per_scan":900719925474099312345}}}';
    const old: QueryOutcome = { explain: parseExplainPlan(raw, 'mysql', '8.4.11'), elapsedMs: 1, results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'JSON' }], rows: [{ c0: raw }], truncated: false, elapsedMs: 1, statement: 'SELECT 旧接口' }] };
    const legacy = captureExplainSnapshot(old), generic = capturePlanSnapshot(old);
    expect(generic).toEqual(legacy); expect(encodePlanSnapshot(generic)).toBe(encodeExplainSnapshot(legacy));
    expect(parsePlanSnapshot(legacy)).toEqual(parseExplainSnapshot(legacy));
    expect(decodePlanSnapshot(encodeExplainSnapshot(legacy))).toEqual(decodeExplainSnapshot(encodeExplainSnapshot(legacy)));
    expect(planSnapshotOutcome(generic)).toEqual(explainSnapshotOutcome(legacy));
    expect(planSnapshotOutcome(generic).analysis).toBeUndefined();
  });
  it('拒绝同时包含两种来源或无计划来源，旧读取器不能误收新实测kind', () => {
    const source = actualOutcome(); source.explain = parseExplainPlan('{}', 'mysql', '8.4.11');
    expect(() => capturePlanSnapshot(source)).toThrow();
    expect(() => capturePlanSnapshot({ results: [], elapsedMs: 0 })).toThrow();
    const captured = actualSnapshot();
    expect(() => parseExplainSnapshot(captured)).toThrow(); expect(() => decodeExplainSnapshot(encodePlanSnapshot(captured))).toThrow();
    expect(() => parsePlanSnapshot({ ...captured, kind: 'dbark.explain-snapshot' })).toThrow();
  });
  it.each([{ dialect: 'mysql', format: 'json' }, { dialect: 'mysql', format: 'text' }, { dialect: 'mariadb', format: 'tree' }, { dialect: 'future', format: 'json' }])('实际格式与厂商不匹配时拒绝 %j', patch => {
    expect(() => parsePlanSnapshot(Object.assign(actualSnapshot(), patch))).toThrow();
  });
});

describe('实际计划只保存原始有限事实，离线恢复不能执行SQL', () => {
  it.each(['mysql', 'mariadb'] as const)('%s原文和服务器信息保真，重开只产生analysis且清空活动状态', dialect => {
    const source = actualOutcome(dialect), originalRaw = source.analysis!.raw;
    source.analysis!.nodes[0].label = '禁止持久化的伪造派生节点';
    source.analysis!.nodes[0].metrics.push({ source: '禁止持久化的伪造指标', value: '999', kind: 'actual', unit: 'ms' });
    const captured = actualSnapshot(source), encoded = encodePlanSnapshot(captured);
    expect(encoded.endsWith('\n')).toBe(true); expect(captured.raw).toBe(originalRaw);
    expect(captured.serverVersion).toBe(source.analysis!.version); expect(captured.dialect).toBe(dialect);
    expect(encoded).not.toContain('主动SQL字段不会写入文件'); expect(encoded).not.toContain('禁止持久化');
    for (const field of ['statement', 'elapsedMs', 'transactionOpen', 'connectionId', 'sessionId', 'nodes', 'metrics']) expect(encoded).not.toContain('"' + field + '"');
    const restored = planSnapshotOutcome(decodePlanSnapshot(encoded));
    expect(restored.explain).toBeUndefined(); expect(restored.analysis!.raw).toBe(originalRaw); expect(restored.analysis!.nodes.length).toBeGreaterThan(0);
    expect(restored.analysis!.warnings).toContain('原始实测提示'); expect(restored.analysis!.rawTruncated).toBe(false);
    expect(restored.results[0].statement).toBe(''); expect(restored.results[0].elapsedMs).toBe(0); expect(restored.elapsedMs).toBe(0); expect(restored).not.toHaveProperty('transactionOpen');
    const metrics = restored.analysis!.nodes.flatMap(node => node.metrics);
    expect(metrics.some(metric => metric.kind === 'actual' && metric.value.includes('123456789'))).toBe(true);
    expect(metrics.some(metric => metric.kind === 'estimate' && metric.value === '18446744073709551615')).toBe(true);
  });
  it('原文中的业务字面值仍可能出现在文件，不把剥离statement误称为完全不含SQL内容', () => {
    const encoded = encodePlanSnapshot(actualSnapshot());
    expect(encoded).toContain('业务字面值_仍在原文'); expect(encoded).not.toContain('主动SQL字段不会写入文件');
  });
  it('正常单行单列必须与raw一致；截断标记也不能掩盖两份矛盾字符串', () => {
    for (const truncated of [false, true]) {
      const changed = actualSnapshot(); changed.rawTruncated = truncated; changed.result.rows[0].c0 = '不同原文';
      expect(() => parsePlanSnapshot(changed)).toThrow();
    }
    const missing = actualSnapshot(); missing.result.rows = []; expect(() => parsePlanSnapshot(missing)).toThrow();
    const extra = actualSnapshot(); extra.result.columns.push({ key: 'c1', name: '另一列', type: 'TEXT' }); extra.result.rows[0].c1 = null; expect(() => parsePlanSnapshot(extra)).toThrow();
    const nonText = actualSnapshot(); nonText.result.rows[0].c0 = null; expect(() => parsePlanSnapshot(nonText)).toThrow();
  });
  it.each(['raw', 'result', 'both'] as const)('%s截断事实禁止从合法前缀生成树，反复往返诊断不增长', flag => {
    const original = actualSnapshot(actualOutcome('mariadb'));
    original.warnings = [];
    original.rawTruncated = flag !== 'result'; original.result.truncated = flag !== 'raw';
    const first = planSnapshotOutcome(original);
    expect(first.analysis!.nodes).toEqual([]); expect(first.analysis!.rawTruncated).toBe(true); expect(first.analysis!.warnings.join()).toContain('截断前缀');
    const second = planSnapshotOutcome(decodePlanSnapshot(encodePlanSnapshot(capturePlanSnapshot(first))));
    expect(second.analysis!.nodes).toEqual([]); expect(second.analysis!.warnings).toEqual(first.analysis!.warnings);
  });
  it('文件另存保留原文档，不把展示新诊断或节点修改反向写入源文档', () => {
    const original = actualSnapshot(actualOutcome('mariadb', '{损坏JSON}')), encoded = encodePlanSnapshot(original);
    original.warnings = []; const before = encodePlanSnapshot(original), view = planSnapshotOutcome(original);
    expect(view.analysis!.warnings.length).toBeGreaterThan(0); view.analysis!.warnings.push('展示后来增加的诊断');
    view.analysis!.raw = '后来的展示原文'; view.results[0].columns[0].name = '后来改动';
    expect(encodePlanSnapshot(original)).toBe(before); expect(decodePlanSnapshot(encoded).kind).toBe('dbark.analyze-snapshot');
  });
  it('保存警告保留顺序，新增解析诊断不能被空数组压掉，最多64项且重复往返不增长', () => {
    const original = actualSnapshot(actualOutcome('mariadb', '{损坏JSON}'));
    original.warnings = Array.from({ length: 64 }, (_, index) => '原警告' + index);
    const first = planSnapshotOutcome(original), diagnostics = parseQueryAnalyzePlan(original.raw, 'mariadb', original.serverVersion, 'json').warnings;
    expect(first.analysis!.warnings).toHaveLength(64); expect(first.analysis!.warnings[0]).toBe('原警告0');
    for (const diagnostic of diagnostics) expect(first.analysis!.warnings).toContain(diagnostic);
    expect(planSnapshotOutcome(capturePlanSnapshot(first)).analysis!.warnings).toEqual(first.analysis!.warnings);
  });
  it('部分原始表格保留精度字符串、微秒、NULL、空串、布尔、字节、有限数字和负零', () => {
    const values: CellValue[] = ['18446744073709551615', '1234567890.123456789000', '2026-10-28 12:34:56.123456', null, '', true, false, { type: 'binary', base64: 'AAF/' }, 1.25, -0];
    const saved = actualSnapshot(partialOutcome(values)), restored = planSnapshotOutcome(decodePlanSnapshot(encodePlanSnapshot(saved)));
    expect(Object.values(restored.results[0].rows[0])).toEqual(values); expect(Object.is(restored.results[0].rows[0].c9, -0)).toBe(true);
    expect(saved.result.rows[0].c8).toEqual({ type: 'number', text: '1.25' }); expect(saved.result.rows[0].c9).toEqual({ type: 'number', text: '-0' });
    expect(restored.analysis!.nodes).toEqual([]); expect(restored.analysis!.rawTruncated).toBe(true);
  });
  it('深复制文档/行/字节，原型同名列安全且派生展示不与文件共享可变对象', () => {
    const source = partialOutcome([{ type: 'binary', base64: 'AA==' }, null, '']);
    source.results[0].columns = ['__proto__', 'constructor', 'toString'].map(key => ({ key, name: key, type: 'TEXT' }));
    source.results[0].rows = [JSON.parse('{"__proto__":{"type":"binary","base64":"AA=="},"constructor":null,"toString":""}')];
    const captured = actualSnapshot(source), parsed = parsePlanSnapshot(captured), restored = planSnapshotOutcome(parsed);
    (source.results[0].rows[0].__proto__ as { base64: string }).base64 = '/w=='; captured.warnings.push('后来警告');
    (captured.result.rows[0].__proto__ as { base64: string }).base64 = 'AQ==';
    expect(parsed.result.rows[0].__proto__).toEqual({ type: 'binary', base64: 'AA==' }); expect(parsed.warnings).toEqual(['原始实测提示']);
    expect(Object.getPrototypeOf(restored.results[0].rows[0])).toBe(null); expect(restored.results[0].rows[0].constructor).toBe(null); expect(restored.results[0].rows[0].toString).toBe('');
  });
});

describe('实际快照严格结构与预算，不接受未知字段或静默截断', () => {
  it.each(['kind', 'version', 'dialect', 'serverVersion', 'format', 'raw', 'rawTruncated', 'warnings', 'result'])('缺少字段%s明确拒绝', field => {
    const changed = actualSnapshot(); Reflect.deleteProperty(changed, field); expect(() => parsePlanSnapshot(changed)).toThrow();
  });
  it.each([{ kind: 'future.snapshot' }, { version: 2 }, { rawTruncated: 1 }, { statement: 'SELECT 1' }, { elapsedMs: 1 }, { transactionOpen: true }, { connectionId: '不保存' }, { sessionId: '不保存' }, { nodes: [] }, { metrics: [] }])('拒绝未知版本及额外字段%j', patch => {
    expect(() => parsePlanSnapshot(Object.assign(actualSnapshot(), patch))).toThrow();
  });
  it('对象和数组访问器零执行；非法源捕获也不调用analysis getter', () => {
    let gets = 0;
    for (const level of ['root', 'column', 'row', 'binary', 'array'] as const) {
      const changed = actualSnapshot(partialOutcome([{ type: 'binary', base64: 'AA==' }]));
      const target = level === 'root' ? changed : level === 'column' ? changed.result.columns[0] : level === 'row' ? changed.result.rows[0] : level === 'binary' ? changed.result.rows[0].c0 as object : changed.warnings;
      const key = level === 'root' ? 'raw' : level === 'column' ? 'key' : level === 'row' ? 'c0' : level === 'binary' ? 'base64' : '0';
      const getter = () => { gets++; throw Error('不可执行'); };
      Object.defineProperty(target, key, { get: getter, enumerable: true, configurable: true });
      expect(() => parsePlanSnapshot(changed)).toThrow(); expect(Object.getOwnPropertyDescriptor(target, key)?.get).toBe(getter);
    }
    const original = actualOutcome(); Object.defineProperty(original, 'analysis', { get: () => { gets++; throw Error('不可执行'); }, enumerable: true });
    expect(() => capturePlanSnapshot(original)).toThrow(); expect(gets).toBe(0);
  });
  it('拒绝稀疏数组、额外键、异常原型、循环和隐藏字段，不改写输入', () => {
    for (const field of ['warnings', 'columns', 'rows'] as const) {
      const changed = actualSnapshot(), target = field === 'warnings' ? changed.warnings : changed.result[field];
      Reflect.deleteProperty(target, '0'); expect(() => parsePlanSnapshot(changed)).toThrow();
    }
    const cases = [actualSnapshot(), actualSnapshot(), actualSnapshot(), actualSnapshot(), actualSnapshot()];
    Object.defineProperty(cases[0].warnings, 'extra', { value: true }); Object.setPrototypeOf(cases[1].result.rows[0], { inherited: true });
    Object.defineProperty(cases[2], 'raw', { value: mysqlRaw, enumerable: false }); Object.defineProperty(cases[3], Symbol('额外字段'), { value: true });
    cases[4].result.rows[0].c0 = cases[4] as never;
    for (const changed of cases) expect(() => parsePlanSnapshot(changed)).toThrow();
  });
  it.each([undefined, 1n, NaN, Infinity, -Infinity, new Date(), {}, [], { type: 'number', text: '1' }])('捕获拒绝不支持源单元格%#', value => {
    const original = partialOutcome([value as CellValue]);
    expect(() => capturePlanSnapshot(original)).toThrow(); expect(original.results[0].rows[0].c0).toBe(value);
  });
  it('沿用规范数字/Base64和列键匹配规则，不能借新kind绕过旧容器校验', () => {
    const numeric = actualSnapshot(partialOutcome([1])); numeric.result.rows[0].c0 = { type: 'number', text: '1.0' }; expect(() => parsePlanSnapshot(numeric)).toThrow();
    const binary = actualSnapshot(partialOutcome([{ type: 'binary', base64: 'AA==' }])); binary.result.rows[0].c0 = { type: 'binary', base64: 'AB==' }; expect(() => parsePlanSnapshot(binary)).toThrow();
    const duplicate = actualSnapshot(); duplicate.result.columns.push({ ...duplicate.result.columns[0] }); expect(() => parsePlanSnapshot(duplicate)).toThrow();
    const extra = actualSnapshot(); extra.result.rows[0].notDeclared = null; expect(() => parsePlanSnapshot(extra)).toThrow();
  });
  it('超额raw、单元格、累计JSON转义、行列警告预算明确拒绝，不悄悄截成前缀', () => {
    const exact = actualSnapshot(actualOutcome('mysql', 'a'.repeat(explainSnapshotLimits.raw))); expect(parsePlanSnapshot(exact).raw.length).toBe(explainSnapshotLimits.raw);
    const raw = actualSnapshot(); raw.raw = '中'.repeat(explainSnapshotLimits.raw / 3) + '中'; expect(() => parsePlanSnapshot(raw)).toThrow();
    expect(() => capturePlanSnapshot(partialOutcome(['a'.repeat(explainSnapshotLimits.cell + 1)]))).toThrow();
    const tooManyCells = Array(6).fill('a'.repeat(180000));
    expect(() => capturePlanSnapshot(partialOutcome(tooManyCells))).toThrow();
    expect(() => capturePlanSnapshot(actualOutcome('mysql', '\u0000'.repeat(180000)))).toThrow();
    for (const field of ['serverVersion', 'rows', 'columns', 'warnings'] as const) {
      const changed = actualSnapshot();
      if (field === 'serverVersion') changed.serverVersion = 'x'.repeat(explainSnapshotLimits.version + 1);
      else if (field === 'warnings') changed.warnings = Array(explainSnapshotLimits.warnings + 1).fill('');
      else changed.result[field] = Array(explainSnapshotLimits[field] + 1).fill({}) as never;
      expect(() => parsePlanSnapshot(changed)).toThrow();
    }
  });
  it('解码先核1MiB文件预算；孤立代理项拒绝，真实Unicode与末尾空白保持', () => {
    expect(() => decodePlanSnapshot(' '.repeat(explainSnapshotLimits.bytes + 1))).toThrow();
    for (const invalid of ['\ud800', '\udc00', 'a\ud800b']) { const changed = actualSnapshot(); changed.serverVersion = invalid; expect(() => parsePlanSnapshot(changed)).toThrow(); }
    const encoded = encodePlanSnapshot(actualSnapshot()), remaining = explainSnapshotLimits.bytes - new TextEncoder().encode(encoded).byteLength;
    expect(decodePlanSnapshot(encoded + ' '.repeat(remaining)).raw).toBe(mysqlRaw);
    expect(() => decodePlanSnapshot('{损坏JSON}')).toThrow();
  });
  it('捕获必须正好一个有限结果，额外结果和空结果不静默丢弃', () => {
    const extra = actualOutcome(); extra.results.push(extra.results[0]); expect(() => capturePlanSnapshot(extra)).toThrow();
    const empty = actualOutcome(); empty.results = []; expect(() => capturePlanSnapshot(empty)).toThrow();
  });
});
