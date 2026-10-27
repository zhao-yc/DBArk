import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { createQueryResultSnapshot, decodeQueryResultSnapshot, encodeQueryResultSnapshot, parseQueryResultSnapshot, queryResultSnapshotLimits as limits } from '../../src/shared/queryResultSnapshot';
import { queryResultSnapshotZh as text } from '../../src/shared/queryResultSnapshot.zh-CN';

/** 源结果包含真实合同全部字段；SQL只作为来源文字，不持有任何连接能力。 */
function result(values: CellValue[] = ['18446744073709551615', '1234567890.123456789000', '2026-10-28 12:34:56.123456', null, '', true, false, { type: 'binary', base64: 'AP8=' }, { type: 'binary', base64: '' }, -0, 0, Number.MIN_VALUE, Number.MAX_VALUE, 1 / 3]): QueryResult {
  return { columns: values.map((_, index) => ({ key: 'k' + index, name: index < 2 ? '重复别名' : '列' + index, type: index === 1 ? 'DECIMAL(65,12)' : '原始类型' })), rows: [Object.fromEntries(values.map((value, index) => ['k' + index, value]))],
    truncated: true, elapsedMs: -0, affectedRows: 0, insertId: '18446744073709551615', warningCount: 3, statement: 'SELECT \'源 SQL 🚢\', :name, @original;\r\n-- 仅文字，不执行' };
}
const document = () => createQueryResultSnapshot(result(), '本次结果');
/** 只为攻击反例生成待解析磁盘对象；产品从不对该对象进行宽松字符串化。 */
function wire(): any { return JSON.parse(encodeQueryResultSnapshot(document())); }
function decoded(value: unknown) { return decodeQueryResultSnapshot(JSON.stringify(value)); }

describe('已返回结果快照的版本化无损合同', () => {
  it('源SQL、重复显示名、内部列key/type及完整结果元信息均保留，Number负零不丢失', () => {
    const source = result(), before = structuredClone(source), captured = createQueryResultSnapshot(source, '本次结果'), encoded = encodeQueryResultSnapshot(captured), reopened = decodeQueryResultSnapshot(encoded);
    expect(encoded.endsWith('\n')).toBe(true); expect(reopened).toEqual(captured); expect(source).toEqual(before);
    expect(reopened.result.statement).toBe(source.statement); expect(reopened.result.columns).toEqual(source.columns);
    expect(reopened.result).toMatchObject({ truncated: true, affectedRows: 0, insertId: '18446744073709551615', warningCount: 3 });
    expect(Object.is(reopened.result.elapsedMs, -0)).toBe(true);
    expect(Object.is(reopened.result.rows[0].k9, -0)).toBe(true);
    for (let index = 0; index < source.columns.length; index++) expect(Object.is(reopened.result.rows[0]['k' + index], source.rows[0]['k' + index]) || typeof source.rows[0]['k' + index] === 'object' && source.rows[0]['k' + index] !== null).toBe(true);
    expect(reopened.result.rows).toEqual(source.rows); expect(reopened.result.rows).not.toBe(source.rows); expect(reopened.result.rows[0]).not.toBe(source.rows[0]);
    expect(wire().result.rows[0].k9).toEqual({ type: 'number', text: '-0' });
    expect(wire().result.elapsedMs).toEqual({ type: 'number', text: '-0' });
    expect(encodeQueryResultSnapshot(reopened)).toBe(encoded);
  });

  it('JSON字段只保留原词法，包括重复内层字段、大数、空白和转义，不当作外层JSON解析', () => {
    const raw = '{ "a":900719925474099312345, "a":-0.0000, "quote":"\\u4e2d" }';
    expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(result([raw])))).result.rows[0].k0).toBe(raw);
  });

  it('无结果行和影响行结果仍保留真实元信息，未出现的可选字段不自动补零', () => {
    const empty: QueryResult = { columns: [], rows: [], truncated: false, elapsedMs: 12.5, statement: 'UPDATE 原始语句文字', affectedRows: 7, insertId: '0' };
    const reopened = decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(empty)));
    expect(reopened.result).toEqual(empty); expect(reopened).not.toHaveProperty('name'); expect(reopened.result).not.toHaveProperty('warningCount');
    const query = result([]); query.rows = []; delete query.affectedRows; delete query.insertId; delete query.warningCount;
    expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(query))).result).toEqual(query);
  });

  it('原型同名列与空列名使用自有键保留，安全恢复为空原型行', () => {
    const source = result([]), keys = ['__proto__', 'constructor', 'prototype', 'toJSON', ''];
    source.columns = keys.map(key => ({ key, name: '', type: '' })); source.rows = [Object.fromEntries(keys.map((key, index) => [key, '值' + index]))];
    const reopened = decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(source)));
    expect(Object.getPrototypeOf(reopened.result.rows[0])).toBeNull();
    for (let index = 0; index < keys.length; index++) { expect(Object.hasOwn(reopened.result.rows[0], keys[index])).toBe(true); expect(reopened.result.rows[0][keys[index]]).toBe('值' + index); }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('固定结果没有任何文件容器之外的活动状态，额外连接/凭据/会话字段整份拒绝', () => {
    for (const field of ['connectionId', 'password', 'privateKeyPath', 'sessionId', 'transactionOpen', 'taskId']) {
      const value = wire(); value[field] = '秘密'; expect(() => decoded(value)).toThrow(text.invalid);
      const nested = wire(); nested.result[field] = '秘密'; expect(() => decoded(nested)).toThrow(text.invalid);
    }
    // 同名真实数据列仍是合法原始数据，不做内容扫描或删除。
    const source = result(['原始值']); source.columns[0].key = 'password'; source.rows = [{ password: '原始值' }];
    expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(source))).result.rows[0].password).toBe('原始值');
  });

  it('parse返回独立副本，修改已创建文档不会改写原查询结果', () => {
    const source = result(), captured = createQueryResultSnapshot(source), checked = parseQueryResultSnapshot(captured);
    checked.result.rows[0].k0 = '后来修改'; checked.result.columns[0].name = '后来改名';
    expect(captured.result.rows[0].k0).toBe(source.rows[0].k0); expect(source.columns[0].name).toBe('重复别名');
  });

  it.each(['9007199254740993', '18446744073709551615', '9'.repeat(200)])('insertId保持原始精确字符串%s，不作Number转换', insertId => {
    const source = result(); source.insertId = insertId;
    const encoded = encodeQueryResultSnapshot(createQueryResultSnapshot(source));
    expect(JSON.parse(encoded).result.insertId).toBe(insertId); expect(decodeQueryResultSnapshot(encoded).result.insertId).toBe(insertId);
  });

  it('insertId数值及超限文本拒绝，不能把已舍入值当成精确ID', () => {
    for (const insertId of [0, 1, 9007199254740992]) { const source = result(); Object.defineProperty(source, 'insertId', { enumerable: true, value: insertId }); expect(() => createQueryResultSnapshot(source)).toThrow(text.invalid); }
    const onDisk = wire(); onDisk.result.insertId = { type: 'number', text: '9007199254740992' }; expect(() => decoded(onDisk)).toThrow(text.invalid);
    const source = result(); source.insertId = '9'.repeat(limits.insertIdBytes + 1); expect(() => createQueryResultSnapshot(source)).toThrow(text.tooLarge);
  });
});

describe('不可信JSON、UTF8及数值标签', () => {
  it('对象任意层的重复字段与转义后的同名字段均拒绝，不按最后一个覆盖', () => {
    const original = encodeQueryResultSnapshot(document());
    for (const bad of [original.replace('"version":1', '"version":1,"version":1'), original.replace('"version":1', '"version":1,"\\u0076ersion":1'), original.replace('"k0":', '"k0":null,"\\u006b0":'), original.replace('"truncated":true', '"truncated":false,"truncated":true')]) expect(() => decodeQueryResultSnapshot(bad)).toThrow(text.duplicate);
  });

  it('严格UTF8字节入口拒绝非法/截断序列；合法Unicode字节可往返，JSON截断也拒绝', () => {
    const encoded = encodeQueryResultSnapshot(document()), bytes = new TextEncoder().encode(encoded);
    expect(decodeQueryResultSnapshot(bytes)).toEqual(decodeQueryResultSnapshot(encoded));
    for (const bad of [Uint8Array.from([0xc3, 0x28]), Uint8Array.from([0xf0, 0x9f, 0x9a]), Uint8Array.from([0xc0, 0xaf]), Uint8Array.from([0xed, 0xa0, 0x80])]) expect(() => decodeQueryResultSnapshot(bad)).toThrow(text.encoding);
    expect(() => decodeQueryResultSnapshot(bytes.subarray(0, bytes.length - 2))).toThrow(text.invalid);
    expect(() => decodeQueryResultSnapshot('\ufeff' + encoded)).toThrow(text.invalid);
  });

  it.each(['\ud800', '\udc00', '中\ud800文'])('不把孤立代理项%j替换成别的文字', malformed => {
    expect(() => createQueryResultSnapshot(result([malformed]))).toThrow(text.invalid);
    expect(() => decodeQueryResultSnapshot(encodeQueryResultSnapshot(document()).replace('本次结果', '\\ud800'))).toThrow(text.invalid);
  });

  it('裸数字与非规范标签拒绝，避免JSON解析先舍入再伪装成原值', () => {
    for (const supplied of [1, 0, -0, 9007199254740992]) { const value = wire(); value.result.rows[0].k0 = supplied; expect(() => decoded(value)).toThrow(); }
    for (const representation of ['01', '1.0', '1e0', '+0', '-00', '-0.0', 'NaN', 'Infinity', '1e309', '9007199254740993', '5E-324']) {
      const value = wire(); value.result.rows[0].k0 = { type: 'number', text: representation }; expect(() => decoded(value)).toThrow(text.invalid);
    }
    const value = wire(); value.result.elapsedMs = 1; expect(() => decoded(value)).toThrow(text.invalid);
    for (const supplied of [NaN, Infinity, -Infinity]) expect(() => createQueryResultSnapshot(result([supplied]))).toThrow(text.invalid);
  });

  it('类型、版本、必填和可选字段均严格验证，不忽略未知字段或undefined', () => {
    const value = document(); expect(() => parseQueryResultSnapshot({ ...value, version: 2 })).toThrow(text.version);
    const unsupported = wire(); unsupported.version = 2; expect(() => decoded(unsupported)).toThrow();
    expect(() => parseQueryResultSnapshot({ ...value, kind: '别的文件' })).toThrow(text.version);
    expect(() => parseQueryResultSnapshot({ ...value, name: undefined })).toThrow(text.invalid);
    for (const key of ['columns', 'rows', 'truncated', 'elapsedMs', 'statement']) { const changed = wire(); delete changed.result[key]; expect(() => decoded(changed)).toThrow(text.invalid); }
    for (const key of ['affectedRows', 'insertId', 'warningCount']) { const changed = document(); Object.defineProperty(changed.result, key, { enumerable: true, value: undefined }); expect(() => parseQueryResultSnapshot(changed)).toThrow(text.invalid); }
    const nested = wire(); nested.result.rows[0].k0 = { value: '不是CellValue' }; expect(() => decoded(nested)).toThrow(text.invalid);
  });

  it('列内部key重复、行缺键/多键、非布尔truncated及伪装对象均拒绝', () => {
    const duplicated = wire(); duplicated.result.columns[1].key = duplicated.result.columns[0].key; expect(() => decoded(duplicated)).toThrow(text.invalid);
    for (const change of [(value: any) => { delete value.result.rows[0].k0; }, (value: any) => { value.result.rows[0].extra = '不可混入'; }, (value: any) => { value.result.columns[0].extra = true; }, (value: any) => { value.result.truncated = 'false'; }]) { const value = wire(); change(value); expect(() => decoded(value)).toThrow(text.invalid); }
    const inherited = Object.assign(Object.create({ private: '不能继承' }), document()); expect(() => parseQueryResultSnapshot(inherited)).toThrow(text.invalid);
  });

  it('访问器、自定义迭代器、toJSON及非枚举额外字段均不执行', () => {
    let reads = 0;
    const source = result(); Object.defineProperty(source, 'statement', { enumerable: true, get() { reads++; throw Error('不应调用'); } });
    expect(() => createQueryResultSnapshot(source)).toThrow(text.invalid);
    const rows = result(); Object.defineProperty(rows.rows[0], 'k0', { enumerable: true, get() { reads++; return '不可读取'; } }); expect(() => createQueryResultSnapshot(rows)).toThrow(text.invalid);
    const iterable = result(); Object.defineProperty(iterable.rows, Symbol.iterator, { value() { reads++; throw Error('不应迭代'); } }); expect(() => createQueryResultSnapshot(iterable)).toThrow(text.invalid);
    const indexed = result(); Object.defineProperty(indexed.columns, '0', { enumerable: true, get() { reads++; throw Error('不应读取索引getter'); } }); expect(() => createQueryResultSnapshot(indexed)).toThrow(text.invalid);
    const custom = result(); Object.defineProperty(custom, 'toJSON', { enumerable: true, value() { reads++; return {}; } }); expect(() => createQueryResultSnapshot(custom)).toThrow(text.invalid);
    const hidden = document(); Object.defineProperty(hidden, 'hidden', { value: true }); expect(() => parseQueryResultSnapshot(hidden)).toThrow(text.invalid);
    expect(reads).toBe(0);
  });

  it('稀疏数组、循环结构与深层JSON在克隆/递归扩张之前拒绝', () => {
    const sparse = result(); delete sparse.rows[0]; expect(() => createQueryResultSnapshot(sparse)).toThrow(text.invalid);
    const cycle = result(); cycle.rows[0].k0 = cycle as unknown as CellValue; expect(() => createQueryResultSnapshot(cycle)).toThrow(text.invalid);
    expect(() => decodeQueryResultSnapshot('['.repeat(limits.jsonDepth + 2) + '1' + ']'.repeat(limits.jsonDepth + 2))).toThrow(text.tooLarge);
  });
});

describe('Base64与逐层真实编码预算', () => {
  it.each(['A', 'AAA', 'AA=', 'A===', 'AA A', 'AA-_', 'AA==\n', 'AB==', 'AAF='])('非标准或非canonical Base64 %j不被静默修正', base64 => {
    expect(() => createQueryResultSnapshot(result([{ type: 'binary', base64 }]))).toThrow(text.invalid);
  });
  it('空字节与NULL不同，超过旧1MiB的BLOB仍可保真，必然超总文件预算的输入先拒绝', () => {
    const zero = createQueryResultSnapshot(result([null, { type: 'binary', base64: '' }])); expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(zero)).result.rows[0]).toEqual({ k0: null, k1: { type: 'binary', base64: '' } });
    const base64 = Buffer.alloc(1024 * 1024 + 1).toString('base64');
    expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(result([{ type: 'binary', base64 }])))).result.rows[0].k0).toEqual({ type: 'binary', base64 });
    const oversized = 'A'.repeat(4 * Math.ceil(limits.binaryBytes / 3) + 4); expect(() => createQueryResultSnapshot(result([{ type: 'binary', base64: oversized }]))).toThrow(text.tooLarge);
  });
  it('1MiB+1文本在总预算内可往返，中文/转义字符串不按UTF16长度假冒预算', () => {
    const larger = 'x'.repeat(1024 * 1024 + 1); expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(result([larger])))).result.rows[0].k0).toBe(larger);
    expect(() => createQueryResultSnapshot(result(['x'.repeat(limits.cellBytes + 1)]))).toThrow(text.tooLarge);
    const chinese = '中'.repeat(400000); expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(result([chinese])))).result.rows[0].k0).toBe(chinese);
    expect(() => createQueryResultSnapshot(result(['中'.repeat(Math.floor(limits.cellBytes / 3) + 1)]))).toThrow(text.tooLarge);
    expect(() => createQueryResultSnapshot(result(), '中'.repeat(86))).toThrow(text.tooLarge);
  });
  it('列/行/格预算先于复制下一元素，超限不裁剪为部分快照', () => {
    const columns = result(); columns.columns = Array(limits.columns + 1); expect(() => createQueryResultSnapshot(columns)).toThrow(text.tooLarge);
    const rows = result(); rows.rows = Array(limits.rows + 1); expect(() => createQueryResultSnapshot(rows)).toThrow(text.tooLarge);
    const cells = result(); cells.columns = Array.from({ length: 1001 }, (_, index) => ({ key: 'k' + index, name: 'n', type: 't' })); cells.rows = Array.from({ length: 1000 }, () => ({})); expect(() => createQueryResultSnapshot(cells)).toThrow(text.tooLarge);
  });
  it('16MiB边界按完整wire字节（包含number标签、键、转义、SQL和换行）计量', () => {
    const empty: QueryResult = { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: '' };
    const overhead = new TextEncoder().encode(encodeQueryResultSnapshot(createQueryResultSnapshot(empty))).byteLength;
    empty.statement = 'x'.repeat(limits.bytes - overhead);
    const encoded = encodeQueryResultSnapshot({ kind: 'dbark.query-result-snapshot', version: 1, result: empty }); expect(new TextEncoder().encode(encoded)).toHaveLength(limits.bytes);
    empty.statement += 'x'; expect(() => createQueryResultSnapshot(empty)).toThrow(text.tooLarge);
    expect(() => decodeQueryResultSnapshot(' '.repeat(limits.bytes + 1))).toThrow(text.tooLarge);
    const escaping = result(Array.from({ length: 6 }, () => '\0'.repeat(512 * 1024))); expect(() => createQueryResultSnapshot(escaping)).toThrow(text.tooLarge);
  });
});
