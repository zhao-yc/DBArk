import { describe, expect, it } from 'vitest';
import type { DataRow } from '../../src/shared/contracts';
import { decodeTableDraft, encodeTableDraft, parseTableDraftDocument, parseTableDraftPayload, parseTableDraftTarget, tableDraftLimits, type TableDraftDocument } from '../../src/shared/tableDraft';

/** 文件与 IPC 使用同一合成目标，不含任何真实连接配置。 */
function fixture(values: DataRow = { id: '9007199254740993', amount: '12345678901234567890.120000', stamp: '2026-10-27 01:02:03.123456', json: '{ "a": 9007199254740993 }', empty: '', nullable: null, bytes: { type: 'binary', base64: '' }, zero: -0 }): TableDraftDocument {
  return { kind: 'dbark.table-draft', version: 1, endpointKey: 'a'.repeat(64), target: { connectionId: 'fixture', database: 'db', table: 'subject' }, metadataKey: '结构原文摘要', changes: [{ kind: 'insert', values }] };
}

describe('表格草稿编解码与无损边界', () => {
  it('精度文本、JSON词法、NULL、空串、空字节和负零完整往返，DEFAULT保持省略', () => {
    const source = fixture(), encoded = encodeTableDraft(source), result = decodeTableDraft(encoded);
    expect(encoded).toContain('"zero":{"type":"number","text":"-0"}');
    expect(result).toEqual(source); expect(Object.is((result.changes[0] as { values: DataRow }).values.zero, -0)).toBe(true);
    expect(Object.hasOwn((result.changes[0] as { values: DataRow }).values, 'defaulted')).toBe(false);
  });
  it('有限数值通过标签保持最短往返值，包括极小数与最大有限数', () => {
    for (const value of [0, -0, 1, -1, 0.1, 1e-7, Number.MIN_VALUE, Number.MAX_VALUE]) {
      const result = decodeTableDraft(encodeTableDraft(fixture({ value })));
      expect(Object.is((result.changes[0] as { values: DataRow }).values.value, value)).toBe(true);
    }
  });
  it('更新和删除保留完整before且克隆原行，不复用输入对象或字节包装', () => {
    const source = fixture(); source.changes = [{ kind: 'update', before: { id: '1', blob: { type: 'binary', base64: 'AA==' } }, values: { id: '2', blob: null } }, { kind: 'delete', before: { id: '3' } }];
    const copy = parseTableDraftDocument(source);
    expect(copy).toEqual(source); expect(copy.changes).not.toBe(source.changes);
    const change = copy.changes[0]; if (change.kind !== 'update') throw Error('夹具类型错误');
    expect(change.before).not.toBe(source.changes[0].kind === 'update' ? source.changes[0].before : null);
    (change.before.blob as { base64: string }).base64 = 'AQ==';
    expect(source.changes[0].kind === 'update' && source.changes[0].before.blob).toEqual({ type: 'binary', base64: 'AA==' });
  });
  it('空新增记录保留全DEFAULT；proto同名列不会污染输出原型', () => {
    const values = Object.fromEntries([['__proto__', '字段值'], ['constructor', null], ['prototype', { type: 'binary', base64: 'AAE=' }]]);
    const source = fixture(values), result = decodeTableDraft(encodeTableDraft(source));
    expect(result).toEqual(source); expect(Object.getPrototypeOf((result.changes[0] as { values: DataRow }).values)).toBe(Object.prototype);
    expect(decodeTableDraft(encodeTableDraft(fixture({})))).toEqual(fixture({}));
  });
  it.each(['AA==', 'AAA=', 'AAE=', '////', ''])('接受标准canonical Base64：%s', base64 => expect(parseTableDraftDocument(fixture({ bytes: { type: 'binary', base64 } }))).toEqual(fixture({ bytes: { type: 'binary', base64 } })));
  it.each(['A', 'AA', 'AB==', 'AAB=', 'AA===', 'AA-_', 'AA==\n', ' AA=='])('拒绝不规范Base64：%s', base64 => expect(() => parseTableDraftDocument(fixture({ bytes: { type: 'binary', base64 } }))).toThrow());
  it('IPC payload拒绝文件专属字段，文档拒绝未知版本/端点/未知字段', () => {
    const full = fixture(), { kind: _kind, version: _version, endpointKey: _endpoint, ...payload } = full;
    expect(parseTableDraftPayload(payload)).toEqual(payload);
    for (const value of [full, { ...payload, password: '不应保存' }, { ...payload, changes: [] }]) expect(() => parseTableDraftPayload(value)).toThrow();
    for (const value of [{ ...full, version: 2 }, { ...full, endpointKey: 'A'.repeat(64) }, { ...full, endpointKey: '' }, { ...full, extra: 1 }]) expect(() => parseTableDraftDocument(value)).toThrow();
  });
  it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol('cell'), { type: 'number', text: '1' }, { type: 'binary', base64: '', extra: true }])('拒绝运行时非法单元格 %s', value => expect(() => parseTableDraftDocument(fixture({ value } as DataRow))).toThrow());
  it('磁盘拒绝裸数字、非canonical数字标签和错误JSON', () => {
    const base = fixture();
    for (const value of [1, { type: 'number', text: '01' }, { type: 'number', text: '+1' }, { type: 'number', text: '1.0' }, { type: 'number', text: 'NaN' }, { type: 'number', text: 'Infinity' }, { type: 'number', text: '1e+0' }, { type: 'number', text: '0', extra: 1 }]) {
      expect(() => decodeTableDraft(JSON.stringify({ ...base, changes: [{ kind: 'insert', values: { value } }] }))).toThrow();
    }
    expect(() => decodeTableDraft('{')).toThrow();
  });
  it('不读取getter、继承成员、符号或不可枚举字段', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return '不能执行'; } });
    const hidden = Object.defineProperty({}, 'value', { enumerable: false, value: '不能接受' });
    for (const values of [getter, hidden, Object.create({ value: '继承值' }), { [Symbol('key')]: '值' }]) expect(() => parseTableDraftDocument(fixture(values as DataRow))).toThrow();
    const source = fixture(); Object.defineProperty(source, 'changes', { enumerable: true, get() { calls++; return []; } });
    expect(() => parseTableDraftDocument(source)).toThrow(); expect(calls).toBe(0);
  });
  it('拒绝稀疏数组、继承索引、额外属性和未声明变更字段', () => {
    const full = fixture(), sparse = new Array(1), extra = Object.assign([full.changes[0]], { extra: '值' });
    const inherited = [full.changes[0]]; Object.setPrototypeOf(inherited, Object.create(Array.prototype));
    for (const changes of [sparse, extra, inherited, [{ kind: 'update', before: {}, values: {} }], [{ kind: 'delete', before: {}, values: {} }], [{ kind: 'insert', values: {}, before: undefined }]]) expect(() => parseTableDraftDocument({ ...full, changes })).toThrow();
  });
  it('限制真实UTF8单元格大小，不能按字符数漏过多字节值', () => {
    expect(parseTableDraftDocument(fixture({ value: 'a'.repeat(tableDraftLimits.cellBytes) }))).toBeTruthy();
    expect(() => parseTableDraftDocument(fixture({ value: 'a'.repeat(tableDraftLimits.cellBytes + 1) }))).toThrow();
    expect(() => parseTableDraftDocument(fixture({ value: '汉'.repeat(Math.floor(tableDraftLimits.cellBytes / 3) + 1) }))).toThrow();
  });
  it('metadata和原文件总UTF8预算在JSON解析前后均受限', () => {
    expect(() => parseTableDraftDocument({ ...fixture(), metadataKey: 'm'.repeat(tableDraftLimits.metadataBytes + 1) })).toThrow();
    expect(() => decodeTableDraft(' '.repeat(tableDraftLimits.bytes + 1))).toThrow();
    const values = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`c${index}`, 'a'.repeat(tableDraftLimits.cellBytes)]));
    expect(() => encodeTableDraft(fixture(values))).toThrow();
  });
  it('精确8MiB的合法编码可往返，增加一个ASCII字节即拒绝', () => {
    const values: DataRow = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`c${index}`, 'a'.repeat(tableDraftLimits.cellBytes)]));
    values.pad = '';
    const document = fixture(values), room = tableDraftLimits.bytes - Buffer.byteLength(encodeTableDraft(document), 'utf8');
    expect(room).toBeGreaterThan(0); expect(room).toBeLessThan(tableDraftLimits.cellBytes);
    values.pad = 'a'.repeat(room);
    const encoded = encodeTableDraft(document);
    expect(Buffer.byteLength(encoded, 'utf8')).toBe(tableDraftLimits.bytes);
    expect(decodeTableDraft(encoded)).toEqual(document);
    values.pad += 'a'; expect(() => encodeTableDraft(document)).toThrow();
  });
  it('记录数、每行列数与总单元格数分别有界，超预算不截断', () => {
    const full = fixture();
    expect(() => parseTableDraftDocument({ ...full, changes: Array.from({ length: tableDraftLimits.changes + 1 }, () => ({ kind: 'insert', values: {} })) })).toThrow();
    expect(() => parseTableDraftDocument(fixture(Object.fromEntries(Array.from({ length: tableDraftLimits.columns + 1 }, (_, index) => [`c${index}`, null]))))).toThrow();
    const values = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`c${index}`, null]));
    expect(() => parseTableDraftDocument({ ...full, changes: Array.from({ length: 1000 }, () => ({ kind: 'insert', values })) })).toThrow();
  });
  it('名称必须非空且不含NUL；空metadata不具备结构身份', () => {
    for (const target of [{ ...fixture().target, database: '' }, { ...fixture().target, table: 'a\0b' }, { ...fixture().target, connectionId: '' }]) expect(() => parseTableDraftDocument({ ...fixture(), target })).toThrow();
    expect(() => parseTableDraftDocument({ ...fixture(), metadataKey: '' })).toThrow();
  });
  it('目标解析独立可用，拒绝凭据字段和继承目标', () => {
    const target = fixture().target;
    expect(parseTableDraftTarget(target)).toEqual(target); expect(parseTableDraftTarget(target)).not.toBe(target);
    expect(() => parseTableDraftTarget({ ...target, password: '不应进入契约' })).toThrow();
    expect(() => parseTableDraftTarget(Object.create(target))).toThrow();
  });
});
