import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, DataRow } from '../../src/shared/contracts';
import { buildRecordProjection, buildRecordSummary, canonicalBinaryBytes, recordProjectionLimits, RecordJsonTreeCache, resolveProjectionPath, sameProjectionIdentity, type ProjectionIdentity } from '../../src/renderer/recordProjections';
import { lexicalToken, parseJsonLexicalTree } from '../../src/renderer/jsonLexicalTree';

/** 元数据只提供真实类型提示；行值类型不根据 SQL 类型强制转换。 */
function column(name: string, type = 'varchar(100)', generated = false): ColumnInfo { return { name, type, generated, nullable: true, defaultValue: null, extra: '', comment: '' }; }
/** 身份保存引用，无数据库连接、原值复制或写回入口。 */
function identity(data: DataRow = { a: '1' }): ProjectionIdentity { return { target: '["c","d","t"]', connectionVersion: 1, generation: 2, metadata: 'm', rowId: 'local-a', data, original: { ...data }, inserted: false, deleted: false }; }

describe('类型化记录投影的完整性与词法保真', () => {
  it('完整元数据顺序保留原型/数字键及隐藏列，不按对象枚举顺序重新排列', () => {
    const names = ['10', '__proto__', '2', 'constructor', 'toString', 'a.b/~汉']; const data = Object.freeze(Object.fromEntries(names.map(name => [name, name])));
    const result = buildRecordProjection({ data, inserted: false }, names.map(name => column(name)), new Set(['__proto__'])); expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error(result.reason); expect(result.document.fields.map(field => field.name)).toEqual(names); expect(result.document.fields[1].hidden).toBe(true); expect(result.document.fields[1].value).toEqual({ kind: 'string', text: '__proto__' });
    expect(JSON.parse(result.text).fields).toEqual(result.document.fields); expect(result.outputBytes).toBe(Buffer.byteLength(result.text)); expect(Object.keys(data).sort()).toEqual([...names].sort());
    expect(Object.hasOwn(result.document, 'original')).toBe(false); expect(Object.hasOwn(result.document, 'target')).toBe(false);
  });
  it('精确字符串、真实 number 负零/指数、布尔、SQL NULL、文字 NULL和空串保持独立标签', () => {
    const data = { big: '18446744073709551615', decimal: '12345678901234567890.120000', time: '2026-10-14 01:02:03.123456', number: -0, exponent: 1e30, flag: true, null: null, word: 'NULL', empty: '' };
    const result = buildRecordProjection({ data, inserted: false }, Object.keys(data).map(name => column(name, 'decimal(65,30)'))); if (result.status !== 'ready') throw new Error(result.reason);
    expect(result.document.fields.map(field => field.value)).toEqual([{ kind: 'string', text: data.big }, { kind: 'string', text: data.decimal }, { kind: 'string', text: data.time }, { kind: 'number', text: '-0', representation: 'javascript-number' }, { kind: 'number', text: '1e+30', representation: 'javascript-number' }, { kind: 'boolean', value: true }, { kind: 'null' }, { kind: 'string', text: 'NULL' }, { kind: 'string', text: '' }]); expect(Object.is(data.number, -0)).toBe(true);
  });
  it('精确 JSON 类型保原文与重复键；普通字符串及 Maria LONGTEXT 不根据内容猜 JSON', () => {
    const raw = ' {"n":9007199254740993,"n":1.2300,"__proto__":"值"}\n'; const data = { json: raw, text: raw, alias: raw };
    const result = buildRecordProjection({ data, inserted: false }, [column('json', 'JSON'), column('text', "enum('json')"), column('alias', 'longtext')]); if (result.status !== 'ready') throw new Error(result.reason);
    expect(result.document.fields.map(field => field.value.kind)).toEqual(['json-text', 'string', 'string']); expect(JSON.parse(result.text).fields.map((field: { value: { text: string } }) => field.value.text)).toEqual([raw, raw, raw]);
    // 未暂存非法 JSON 也可能经其他工具进入本地草稿；整行只读展示原文，结构解析单独失败。
    expect(buildRecordProjection({ data: { json: '{' }, inserted: false }, [column('json', 'json')]).status).toBe('ready'); expect(parseJsonLexicalTree('{').status).toBe('invalid');
  });
  it('新增缺省与生成待定有明确标签，已有缺字段和自有undefined不冒充DEFAULT', () => {
    const columns = [column('a'), column('generated', 'int', true)]; const fresh = buildRecordProjection({ data: {}, inserted: true }, columns);
    if (fresh.status !== 'ready') throw new Error(fresh.reason); expect(fresh.document.fields.map(field => field.value.kind)).toEqual(['default', 'generated-pending']);
    expect(buildRecordProjection({ data: {}, inserted: false }, columns)).toMatchObject({ status: 'unavailable', columnName: 'a' });
    expect(buildRecordProjection({ data: { a: undefined } as unknown as DataRow, inserted: true }, [column('a')])).toMatchObject({ status: 'unavailable' });
    const summary = buildRecordSummary({ data: {}, inserted: false }, columns); expect(summary).toMatchObject({ status: 'ready', complete: false }); if (summary.status === 'ready') expect(summary.fields.map(field => field.kind)).toEqual(['unavailable', 'unavailable']);
  });
  it.each([NaN, Infinity, -Infinity])('非有限数 %s 失败且无完整或部分文档', value => {
    const result = buildRecordProjection({ data: { a: value }, inserted: false }, [column('a')]); expect(result.status).toBe('unavailable'); expect(result).not.toHaveProperty('document'); expect(result).not.toHaveProperty('text');
  });
  it('二进制首尾零高位/空串准确，摘要只返回短base64并不执行atob', () => {
    const data: DataRow = { a: { type: 'binary', base64: 'AP+AAA==' }, empty: { type: 'binary', base64: '' }, large: { type: 'binary', base64: Buffer.alloc(100_000, 255).toString('base64') } };
    const spy = vi.spyOn(globalThis, 'atob').mockImplementation(() => { throw new Error('不应完整解码'); });
    try {
      const summary = buildRecordSummary({ data, inserted: false }, Object.keys(data).map(name => column(name, 'blob'))); if (summary.status !== 'ready') throw new Error(summary.reason);
      expect(summary.fields.map(field => field.bytes)).toEqual([4, 0, 100_000]); expect(summary.fields[2].encoding).toBe('base64'); expect(summary.fields[2].preview).toHaveLength(64); expect(summary.fields[2].truncated).toBe(true); expect(spy).not.toHaveBeenCalled();
      const full = buildRecordProjection({ data, inserted: false }, Object.keys(data).map(name => column(name, 'blob'))); if (full.status !== 'ready') throw new Error(full.reason); expect(full.document.fields[0].value).toEqual({ kind: 'binary', encoding: 'base64', bytes: 4, text: 'AP+AAA==' });
    } finally { spy.mockRestore(); }
  });
  it.each(['A', 'AAA', '=AAA', 'AA=A', 'AA==\n', 'AB==', 'AAB=', '!!!!', '===='])('拒绝非规范 Base64 %j', base64 => { expect(() => canonicalBinaryBytes(base64)).toThrow(); });
  it('未知对象、访问器、额外二进制属性、toJSON、继承字段均不可伪装完整值', () => {
    let invoked = 0;
    const getter = Object.defineProperty({}, 'a', { enumerable: true, get() { invoked++; return '值'; } });
    const inputs = [getter, { a: { type: 'binary', base64: '', extra: true } }, { a: { toJSON() { invoked++; return '假'; } } }, { a: new Date() }, Object.assign(Object.create({ a: '继承' }), {})];
    for (const data of inputs) expect(buildRecordProjection({ data: data as DataRow, inserted: false }, [column('a')]).status).toBe('unavailable'); expect(invoked).toBe(0);
    const nullPrototype = Object.assign(Object.create(null), { a: '正确' }); expect(buildRecordProjection({ data: nullPrototype, inserted: false }, [column('a')]).status).toBe('ready');
  });
  it('元数据重复/残缺与未涵盖自有字段不能冒称整行', () => {
    expect(buildRecordProjection({ data: { a: '1' }, inserted: false }, [column('a'), column('a')]).status).toBe('unavailable'); expect(buildRecordProjection({ data: { a: '1', b: '2' }, inserted: false }, [column('a')]).status).toBe('unavailable');
    expect(buildRecordProjection({ data: { a: '1' }, inserted: false }, [{ name: 'a', type: 'int' } as ColumnInfo]).status).toBe('unavailable');
  });
});

describe('输出预算、身份和活动行结构缓存', () => {
  it('最终UTF8字节包含转义、元数据、标签和分隔符，孤立surrogate仍逐代码单元相同', () => {
    const raw = '汉😀\ud800\udfff\u0000\b\t\n\f\r\\"'; const columns = [column('名\u0000', 'varchar(100)')]; const data = { ['名\u0000']: raw };
    const result = buildRecordProjection({ data, inserted: false }, columns); if (result.status !== 'ready') throw new Error(result.reason);
    expect(result.outputBytes).toBe(Buffer.byteLength(result.text)); expect(JSON.parse(result.text).fields[0].value.text).toBe(raw);
    expect(buildRecordProjection({ data, inserted: false }, columns, new Set(), result.outputBytes).status).toBe('ready'); expect(buildRecordProjection({ data, inserted: false }, columns, new Set(), result.outputBytes - 1).status).toBe('limited');
  });
  it('准确2MiB边界通过，超1字节预检拒绝且不先stringify全文', () => {
    const columns = [column('a')]; const base = buildRecordProjection({ data: { a: '' }, inserted: false }, columns); if (base.status !== 'ready') throw new Error(base.reason);
    const data = { a: 'x'.repeat(recordProjectionLimits.outputBytes - base.outputBytes) }; const exact = buildRecordProjection({ data, inserted: false }, columns); expect(exact.status).toBe('ready');
    if (exact.status === 'ready') expect(exact.outputBytes).toBe(2 * 1024 * 1024);
    const spy = vi.spyOn(JSON, 'stringify'); try { const limited = buildRecordProjection({ data: { a: data.a + 'x' }, inserted: false }, columns); expect(limited.status).toBe('limited'); expect(limited).not.toHaveProperty('document'); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });
  it('字段数/活动行源上限与摘要长度独立，有界摘要不冒充完整值', () => {
    expect(buildRecordSummary({ data: {}, inserted: true }, Array.from({ length: 4097 }, (_, i) => column(String(i)))).status).toBe('limited');
    const summary = buildRecordSummary({ data: { a: 'x'.repeat(1000) }, inserted: false }, [column('a')]); if (summary.status !== 'ready') throw new Error(summary.reason); expect(summary.fields[0]).toMatchObject({ preview: 'x'.repeat(240), truncated: true });
    expect(buildRecordSummary({ data: { a: 'x'.repeat(recordProjectionLimits.inputUnits + 1) }, inserted: false }, [column('a')]).status).toBe('limited');
    expect(buildRecordSummary({ data: {}, inserted: true }, Array.from({ length: 17 }, (_, i) => column(String(i), 'x'.repeat(65_536)))).status).toBe('limited');
  });
  it.each(['target', 'connectionVersion', 'generation', 'metadata', 'rowId', 'data', 'original', 'inserted', 'deleted'] as const)('身份 %s 变化使树定位失效，不按值或主键相等重用', key => {
    const current = identity(); const next = { ...current, [key]: key === 'data' || key === 'original' ? { a: '1' } : typeof current[key] === 'number' ? Number(current[key]) + 1 : typeof current[key] === 'boolean' ? !current[key] : `${current[key]}x` } as ProjectionIdentity;
    expect(sameProjectionIdentity(current, next)).toBe(false);
    const doc = parseJsonLexicalTree('1'); if (doc.status !== 'ready') throw new Error(doc.reason); expect(resolveProjectionPath(next, 'a', doc, { identity: current, columnName: 'a', document: doc, segments: [] })).toBeUndefined();
  });
  it('JSON仅按需解析，LONGTEXT需显式查看，字段路径绑定精确列名', () => {
    const cache = new RecordJsonTreeCache(); const current = identity({ a: '{"k":1,"k":2}' }); expect(cache.usage).toEqual({ fields: 0, sourceBytes: 0, nodes: 0 });
    expect(cache.read(current, column('a', 'longtext')).status).toBe('unavailable'); expect(cache.usage.fields).toBe(0);
    const doc = cache.read(current, column('a', 'longtext'), true); if (doc.status !== 'ready') throw new Error(doc.reason);
    const node = resolveProjectionPath(current, 'a', doc, { identity: current, columnName: 'a', document: doc, segments: [{ kind: 'member', memberIndex: 1, key: 'k' }] })!; expect(lexicalToken(doc, node)).toBe('2');
    expect(resolveProjectionPath(current, 'another', doc, { identity: current, columnName: 'a', document: doc, segments: [] })).toBeUndefined(); expect(cache.read(current, column('a', 'json'))).toBe(doc);
    const changed = { ...current, data: { a: '[0]' } }; cache.read(changed, column('a', 'json')); expect(cache.usage).toEqual({ fields: 1, sourceBytes: 3, nodes: 2 }); cache.clear(); expect(cache.usage).toEqual({ fields: 0, sourceBytes: 0, nodes: 0 });
  });
  it('缓存累计源1MiB先拒新字段，失败不污染已发布树或增加计数', () => {
    const raw = '[' + Array.from({ length: 4 }, () => '"' + 'x'.repeat(60_000) + '"').join(',') + ']'; const data = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), raw])); const current = identity(data); const cache = new RecordJsonTreeCache();
    for (let i = 0; i < 4; i++) expect(cache.read(current, column(String(i), 'json')).status).toBe('ready'); const before = cache.usage;
    expect(cache.read(current, column('4', 'json')).status).toBe('limited'); expect(cache.usage).toEqual(before); expect(before.sourceBytes).toBe(raw.length * 4);
  });
  it('累计节点16384真实计数，非法新字段不写缓存，等值新data也重建', () => {
    const raw = '[' + Array.from({ length: 2048 }, () => '0').join(',') + ']'; const current = identity(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), i === 8 ? '{' : raw]))); const cache = new RecordJsonTreeCache();
    for (let i = 0; i < 7; i++) expect(cache.read(current, column(String(i), 'json')).status).toBe('ready'); expect(cache.usage.nodes).toBe(2049 * 7);
    expect(cache.read(current, column('7', 'json')).status).toBe('limited'); expect(cache.read(current, column('8', 'json')).status).toBe('invalid'); expect(cache.usage.fields).toBe(7);
    const previous = cache.read(current, column('0', 'json')); const next = cache.read({ ...current, data: { ...current.data } }, column('0', 'json')); expect(next).not.toBe(previous); expect(cache.usage.fields).toBe(1);
  });
});
