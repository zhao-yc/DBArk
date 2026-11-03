import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { cellClipboardType } from '../../src/renderer/gridClipboard';
import { sqliteCellClipboardType, sqliteClipboardLimits, encodeSqliteClipboard, writeSqliteClipboardData, readSqliteClipboard, decodeSqliteClipboard, defaultSqlitePasteMapping, prepareSqlitePaste, sqlitePastePlanValues, type SqliteClipboardCell, type SqlitePasteMapping } from '../../src/renderer/sqliteTableClipboard';
import { sqliteTableClipboardZh as text } from '../../src/renderer/locales/sqliteTableClipboard.zh-CN';

const cell = (value: string): SqliteClipboardCell => ({ kind: 'text', value });
/** 仅RAM页协议夹具，不伪造数据库定位、剪贴板系统交互或提交成功。 */
function page(names = ['id', 'note', 'computed']): SqliteTablePage {
  return { schemaKey: 'original-schema', target: { connectionId: 'owned', database: 'main', table: 'subject', kind: 'table' }, columns: names.map(name => ({ name, declaredType: name === 'id' ? 'INTEGER' : 'TEXT', generated: name === 'computed' })), result: { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: '' }, offset: 0, limit: 100, hasMore: false,
    edit: { kind: 'editable', snapshotId: 'original-snapshot', expiresAt: '2030-01-01T00:00:00Z', columns: names.map(name => ({ name, declaredType: name === 'id' ? 'INTEGER' : 'TEXT', generated: name === 'computed', nullable: true, hasDefault: name !== 'id' })), rows: [], locator: { kind: 'rowid', columns: [] } } };
}
function typed(rows: unknown[][], version = 1) { return JSON.stringify({ version, rows }); }
function generic(rows: unknown[][], version = 1) { return JSON.stringify({ version, rows }); }


describe('SQLite三MIME复制及严格来源解码', () => {
  it('含列名的文本仍保留原生类型化行和列映射', () => {
    const values: SqliteClipboardCell[][] = [[{ kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }, undefined]];
    const columns = ['id', '空值', '默认'];
    const content = encodeSqliteClipboard(values, columns, true);
    expect(content.text).toBe('id\t空值\t默认\n9223372036854775807\tNULL\t');
    expect(decodeSqliteClipboard(content.sqlite, content.typed, content.text)).toMatchObject({ values, columns, plain: false });
    expect(JSON.parse(content.typed).rows).toHaveLength(1);
  });
  it('原生格式逐格保留int64/REAL文本/BLOB/NULL/DEFAULT，不经过Number或JSON null替换', () => {
    const values: SqliteClipboardCell[][] = [[{ kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'real', value: '-0' }, { kind: 'real', value: '1.2345678901234567' }, { kind: 'blob', value: '00ff80' }, { kind: 'null' }, undefined, cell('引号"\t换行\n\0🚢')]];
    const encoded = encodeSqliteClipboard(values), decoded = decodeSqliteClipboard(encoded.sqlite, encoded.typed, encoded.text); expect(decoded.values).toEqual(values); expect(decoded.plain).toBe(false); expect(decoded.text).toBe(encoded.text);
    const packet = JSON.parse(encoded.typed); expect(packet.rows[0][0]).toBe('9223372036854775807'); expect(packet.rows[0][2]).toBe('-0'); expect(packet.rows[0][4]).toEqual({ type: 'binary', base64: 'AP+A' }); expect(packet.rows[0][5]).toBeNull(); expect(packet.rows[0][6]).toEqual({ type: 'default' }); expect(encoded.text).toContain('0x00ff80'); expect(encoded.text).toContain('NULL');
  });
  it('三MIME同步写入原copy事件端口，不使用navigator或异步系统剪贴板', () => {
    const content = encodeSqliteClipboard([[cell('原文')]]), stored = new Map<string, string>(), setData = vi.fn((type: string, value: string) => { stored.set(type, value); });
    expect(writeSqliteClipboardData({ setData }, content)).toBeUndefined(); expect(setData.mock.calls.map(([type]) => type)).toEqual(['text/plain', cellClipboardType, sqliteCellClipboardType]); expect(readSqliteClipboard({ types: [...stored.keys()], getData: type => stored.get(type) ?? '' }).values).toEqual([[cell('原文')]]);
  });
  it('native坏包/空包/未知版本/额外字段均拒绝，不能降级到看似合法的generic或plain', () => {
    for (const source of ['{', typed([[{ kind: 'text', value: 'x' }]], 2), JSON.stringify({ version: 1, rows: [['x']] }), JSON.stringify({ version: 1, rows: [[{ kind: 'default', value: 'SQL' }]] }), JSON.stringify({ version: 1, rows: [[{ kind: 'text', value: 'x', sql: 'DROP TABLE' }]] }), JSON.stringify({ version: 1, rows: [[{ kind: 'null' }]], profile: 'bad' })]) expect(() => decodeSqliteClipboard(source, generic([['可读']]), '可读')).toThrow(text.nativeInvalid);
    expect(() => readSqliteClipboard({ types: [sqliteCellClipboardType, 'text/plain'], getData: type => type === 'text/plain' ? '可读' : '' })).toThrow(text.nativeInvalid); expect(() => readSqliteClipboard({ types: [], getData: () => '' })).toThrow();
  });
  it('plain默认全部TEXT，不猜数字/NULL/DEFAULT/二进制，TSV完整保引号及多行', () => {
    const source = '001\tNULL\tDEFAULT\t0x00ff\t"a\tb\n""c"""'; const decoded = decodeSqliteClipboard('', '', source); expect(decoded).toEqual({ values: [[cell('001'), cell('NULL'), cell('DEFAULT'), cell('0x00ff'), cell('a\tb\n"c"')]], plain: true, text: source }); expect(decodeSqliteClipboard('', '', '').values).toEqual([[cell('')]]);
  });
  it('generic仅沿声明动态值：boolean为INTEGER、安全int为INTEGER、其余有限number为REAL，BLOB原字节转Hex', () => {
    const result = decodeSqliteClipboard('', generic([[true, false, 7, 1.25, 9007199254740992, '001', null, { type: 'default' }, { type: 'binary', base64: 'AP+A' }]]), '显示文本');
    expect(result.values).toEqual([[{ kind: 'integer', value: '1' }, { kind: 'integer', value: '0' }, { kind: 'integer', value: '7' }, { kind: 'real', value: '1.25' }, { kind: 'real', value: '9007199254740992' }, cell('001'), { kind: 'null' }, undefined, { kind: 'blob', value: '00ff80' }]]); expect(result.plain).toBe(false); expect(result.text).toBe('显示文本');
  });
  it('generic外壳/包装值额外字段、非canonical Base64及非有限值不能隐藏在兼容解码器里', () => {
    for (const source of [JSON.stringify({ version: 1, rows: [[1]], extra: true }), generic([[{ type: 'binary', base64: 'AB==' }]]), generic([[{ type: 'binary', base64: 'AA==', sql: 'DROP' }]]), generic([[{ type: 'default', value: 'bad' }]]), '{"version":1,"rows":[[1e999]]}', generic([['x']], 2)]) expect(() => decodeSqliteClipboard('', source, 'fallback')).toThrow();
  });
  it('复制非有限原REAL可读但新增preserve必须拒绝，明确转TEXT仍保原文', () => {
    for (const value of ['Infinity', '-Infinity']) { const encoded = encodeSqliteClipboard([[{ kind: 'real', value }]]), source = decodeSqliteClipboard(encoded.sqlite, '', encoded.text), target = page(['value']); expect(source.values[0][0]).toEqual({ kind: 'real', value }); expect(() => prepareSqlitePaste(target, source.values, [{ column: 'value', kind: 'preserve' }])).toThrow(text.nonfinite); expect(sqlitePastePlanValues(prepareSqlitePaste(target, source.values, [{ column: 'value', kind: 'text' }]), target)).toEqual([[cell(value)]]); }
  });
  it('复制允许1000行，但粘贴保持500，不因自带native格式而扩大写入资格', () => {
    const encoded = encodeSqliteClipboard(Array.from({ length: 1000 }, () => [cell('x')])); expect(JSON.parse(encoded.sqlite).rows).toHaveLength(1000); expect(() => decodeSqliteClipboard(encoded.sqlite, '', encoded.text)).toThrow(text.rowLimit); expect(() => encodeSqliteClipboard(Array.from({ length: 1001 }, () => [cell('x')]))).toThrow(text.copyRowLimit);
    expect(() => prepareSqlitePaste(page(['value']), Array.from({ length: 501 }, () => [cell('x')]), [{ column: 'value', kind: 'preserve' }])).toThrow(text.rowLimit);
  });
});

describe('SQLite粘贴先完整预检再签发原页计划', () => {
  it('默认只按可写列顺序，保id不猜自增，生成列无映射；未映射槽为DEFAULT', () => {
    const target = page(); expect(defaultSqlitePasteMapping(target, 3)).toEqual([{ column: 'id', kind: 'preserve' }, { column: 'note', kind: 'preserve' }, { column: null, kind: 'preserve' }]);
    const plan = prepareSqlitePaste(target, [[cell('只写note')]], [{ column: 'note', kind: 'preserve' }]); expect(plan).toEqual({ rows: 1, width: 3 }); expect(Object.isFrozen(plan)).toBe(true); expect(sqlitePastePlanValues(plan, target)).toEqual([[undefined, cell('只写note'), undefined]]);
  });
  it('每列明确转换，文本NULL与实际NULL/DEFAULT及BLOB始终不同', () => {
    const target = page(['int', 'real', 'blob', 'null', 'default', 'text']), mapping: SqlitePasteMapping = [{ column: 'int', kind: 'integer' }, { column: 'real', kind: 'real' }, { column: 'blob', kind: 'blob' }, { column: 'null', kind: 'null' }, { column: 'default', kind: 'default' }, { column: 'text', kind: 'text' }];
    const values = [[cell('-9223372036854775808'), cell('1.25'), cell('0x00FF'), cell('NULL'), cell('DEFAULT'), { kind: 'null' } as SqliteClipboardCell]]; expect(sqlitePastePlanValues(prepareSqlitePaste(target, values, mapping), target)).toEqual([[{ kind: 'integer', value: '-9223372036854775808' }, { kind: 'real', value: '1.25' }, { kind: 'blob', value: '00FF' }, { kind: 'null' }, undefined, cell('NULL')]]);
  });
  it('整数不越界/截断/借REAL舍入，整数转REAL也须证明精确；转换失败整组无计划', () => {
    const target = page(['value']); for (const value of [cell('9223372036854775808'), cell('1.5'), { kind: 'real', value: '1.5' } as SqliteClipboardCell, { kind: 'real', value: '-0' } as SqliteClipboardCell]) expect(() => prepareSqlitePaste(target, [[value]], [{ column: 'value', kind: 'integer' }])).toThrow();
    expect(() => prepareSqlitePaste(target, [[{ kind: 'integer', value: '9007199254740993' }]], [{ column: 'value', kind: 'real' }])).toThrow(text.conversionInvalid); expect(sqlitePastePlanValues(prepareSqlitePaste(target, [[{ kind: 'integer', value: '9007199254740992' }]], [{ column: 'value', kind: 'real' }]), target)).toEqual([[{ kind: 'real', value: '9007199254740992' }]]);
    expect(() => prepareSqlitePaste(target, [[undefined]], [{ column: 'value', kind: 'text' }])).toThrow(text.defaultConversion);
  });
  it('目标重复、生成列、未知列/类型、映射宽度、全跳过及非矩形整组拒绝', () => {
    const target = page(); for (const mapping of [[{ column: 'id', kind: 'preserve' }, { column: 'id', kind: 'text' }], [{ column: 'id', kind: 'SQL' }, { column: 'note', kind: 'text' }], [{ column: 'computed', kind: 'default' }, { column: 'note', kind: 'text' }], [{ column: 'other', kind: 'text' }, { column: null, kind: 'preserve' }], [{ column: null, kind: 'preserve' }, { column: null, kind: 'preserve' }], [{ column: 'id', kind: 'preserve' }]]) expect(() => prepareSqlitePaste(target, [[cell('a'), cell('b')]], mapping as any)).toThrow();
    expect(() => prepareSqlitePaste(target, [[cell('a')], [cell('a'), cell('b')]], [{ column: 'note', kind: 'preserve' }])).toThrow(text.ragged);
  });
  it('只读页可复制，任何伪造clipboard editable字段不能变成暂存权限', () => {
    const target = page(); target.edit = { kind: 'readonly', reason: '没有可靠定位' }; expect(encodeSqliteClipboard([[cell('可复制')]]).text).toBe('可复制'); expect(() => defaultSqlitePasteMapping(target, 1)).toThrow(text.readonly); expect(() => prepareSqlitePaste(target, [[cell('x')]], [{ column: 'note', kind: 'text' }])).toThrow(text.readonly); expect(() => decodeSqliteClipboard(JSON.stringify({ version: 1, rows: [[{ kind: 'text', value: 'x' }]], editable: true }), '', '')).toThrow(text.nativeInvalid);
  });
  it('计划只认原page，外形相同或克隆计划均拒绝；取值不消费且每次独立复制', () => {
    const target = page(), values = [[cell('原文')]], mapping: SqlitePasteMapping = [{ column: 'note', kind: 'preserve' }], plan = prepareSqlitePaste(target, values, mapping); values[0][0] = cell('后改'); mapping[0].column = 'id'; const first = sqlitePastePlanValues(plan, target); first[0][1] = cell('试图回写'); expect(sqlitePastePlanValues(plan, target)[0][1]).toEqual(cell('原文')); expect(() => sqlitePastePlanValues({ ...plan }, target)).toThrow(text.stale); expect(() => sqlitePastePlanValues(plan, structuredClone(target))).toThrow(text.stale);
    target.schemaKey = 'changed'; expect(() => sqlitePastePlanValues(plan, target)).toThrow(text.stale);
  });
  it('原页同引用的snapshot、目标、列生成标记变化均使原计划失效', () => {
    for (const change of [(target: SqliteTablePage) => { if (target.edit?.kind === 'editable') target.edit.snapshotId = 'new'; }, (target: SqliteTablePage) => { target.target.table = 'new'; }, (target: SqliteTablePage) => { if (target.edit?.kind === 'editable') { target.edit.columns[1].generated = true; target.columns[1].generated = true; } }]) { const target = page(), plan = prepareSqlitePaste(target, [[cell('x')]], [{ column: 'note', kind: 'preserve' }]); change(target); expect(() => sqlitePastePlanValues(plan, target)).toThrow(text.stale); }
  });
});

describe('SQLite剪贴板预算与纯输入边界', () => {
  it('2MiB原文、65536单格、10000格、完整Unicode、矩形均在签发计划前限制', () => {
    expect(() => decodeSqliteClipboard('', '', 'x'.repeat(sqliteClipboardLimits.bytes + 1))).toThrow(text.tooLarge); expect(() => decodeSqliteClipboard('', '', 'x'.repeat(65537))).toThrow(text.valueLimit); expect(() => encodeSqliteClipboard([[cell('x'.repeat(65537))]])).toThrow(text.valueLimit); expect(() => decodeSqliteClipboard('', '', '\ud800')).toThrow(text.unicode); expect(() => encodeSqliteClipboard([[cell('\ud800')]])).toThrow(text.unicode);
    expect(() => decodeSqliteClipboard('', '', Array.from({ length: 500 }, () => Array(21).fill('x').join('\t')).join('\n'))).toThrow(text.cellLimit); expect(() => encodeSqliteClipboard(Array.from({ length: 500 }, () => Array(21).fill(cell('x'))))).toThrow(text.cellLimit); expect(() => decodeSqliteClipboard('', '', 'a\tb\nc')).toThrow(text.ragged); expect(() => decodeSqliteClipboard('', '', '"bad')).toThrow();
  });
  it('getter、原型、稀疏输入及extra SQL字段不进入内容或映射，且不执行访问器', () => {
    const getter = vi.fn(() => 'private'), value = { kind: 'text' }; Object.defineProperty(value, 'value', { enumerable: true, get: getter }); expect(() => encodeSqliteClipboard([[value as any]])).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => encodeSqliteClipboard([Array(1)])).toThrow(); expect(() => encodeSqliteClipboard([[{ kind: 'text', value: 'x', sql: 'DROP' } as any]])).toThrow(); expect(() => encodeSqliteClipboard([[Object.assign(Object.create({ inherited: true }), { kind: 'text', value: 'x' })]])).toThrow();
    const mapping = { kind: 'text' }; Object.defineProperty(mapping, 'column', { enumerable: true, get: getter }); expect(() => prepareSqlitePaste(page(), [[cell('x')]], [mapping as any])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('精确接受65536字符及10000源格；宽表未映射DEFAULT槽不冒充实际写入格', () => {
    const target = page(['value']); const plan = prepareSqlitePaste(target, [[cell('x'.repeat(65536))]], [{ column: 'value', kind: 'preserve' }]); expect((sqlitePastePlanValues(plan, target)[0][0] as any).value).toHaveLength(65536);
    const wide = page(Array.from({ length: 1024 }, (_, index) => 'c' + index)), rows = Array.from({ length: 500 }, () => [cell('x')]), sparsePlan = prepareSqlitePaste(wide, rows, [{ column: 'c1023', kind: 'preserve' }]); const result = sqlitePastePlanValues(sparsePlan, wide); expect(result).toHaveLength(500); expect(result[0]).toHaveLength(1024); expect(result[499][1023]).toEqual(cell('x')); expect(result[0][0]).toBeUndefined();
    expect(decodeSqliteClipboard('', '', Array.from({ length: 500 }, () => Array(20).fill('x').join('\t')).join('\n')).values.flat()).toHaveLength(10000);
  });
});

it('原生可选列名让含中间生成列的整行按准确目标匹配，生成值不滑入下一可写字段', () => {
  const target = page(['id', 'computed', 'note']), values: SqliteClipboardCell[][] = [[{ kind: 'integer', value: '7' }, cell('生成结果'), cell('实际note')]], content = encodeSqliteClipboard(values, target.columns.map(column => column.name)), source = decodeSqliteClipboard(content.sqlite, content.typed, content.text);
  expect(source.columns).toEqual(['id', 'computed', 'note']); const mapping = defaultSqlitePasteMapping(target, 3, source.columns); expect(mapping).toEqual([{ column: 'id', kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: 'note', kind: 'preserve' }]); expect(sqlitePastePlanValues(prepareSqlitePaste(target, source.values, mapping), target)).toEqual([[{ kind: 'integer', value: '7' }, undefined, cell('实际note')]]);
  expect(defaultSqlitePasteMapping(target, 3, ['note', 'unknown', 'ID'])).toEqual([{ column: 'note', kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: null, kind: 'preserve' }]);
});
it('原生来源列名只作建议且严格验证长度/唯一/Unicode，不接受坏metadata后降级猜测', () => {
  for (const columns of [['id', 'ID'], ['id'], ['id', '\ud800'], ['id', 'nul\0'], ['id', 'x'.repeat(513)], ['id', undefined]]) {
    expect(() => encodeSqliteClipboard([[cell('a'), cell('b')]], columns as any)).toThrow(); expect(() => decodeSqliteClipboard(JSON.stringify({ version: 1, rows: [[{ kind: 'text', value: 'a' }, { kind: 'text', value: 'b' }]], columns }), generic([['fallback']]), 'fallback')).toThrow(text.nativeInvalid);
  }
  const names = ['id', 'note'], content = encodeSqliteClipboard([[cell('a'), cell('b')]], names); names[0] = 'changed'; expect(decodeSqliteClipboard(content.sqlite, '', content.text).columns).toEqual(['id', 'note']);
});
it('整批映射预算按字段名实际UTF8及typed值计数，长Unicode目标名不能绕过2MiB门', () => {
  const names = Array.from({ length: 20 }, (_, index) => '列'.repeat(500) + index), target = page(names), values = Array.from({ length: 500 }, () => names.map(() => cell('x'))); expect(() => prepareSqlitePaste(target, values, defaultSqlitePasteMapping(target, names.length))).toThrow(text.tooLarge);
});

it('未知DBArk自有MIME变体即使有准确native/generic和纯文本也拒绝，不静默降级', () => {
  const content = encodeSqliteClipboard([[cell('准确原文')]]), getData = vi.fn((type: string) => type === sqliteCellClipboardType ? content.sqlite : type === cellClipboardType ? content.typed : content.text);
  for (const variant of [sqliteCellClipboardType + '-v999', sqliteCellClipboardType + '.v2', cellClipboardType + '-v999', cellClipboardType + '/v2', sqliteCellClipboardType.toUpperCase(), cellClipboardType.toUpperCase()]) {
    for (const exact of [[], [sqliteCellClipboardType], [cellClipboardType]]) expect(() => readSqliteClipboard({ types: [...exact, variant, 'text/plain'], getData })).toThrow();
  }
  expect(getData).not.toHaveBeenCalled(); expect(readSqliteClipboard({ types: [sqliteCellClipboardType, cellClipboardType, 'text/plain'], getData }).values).toEqual([[cell('准确原文')]]);
});
it('重复/超量/无效MIME列表先拒绝，不读取数据或用稀疏/非字符串格式绕过检查', () => {
  const getData = vi.fn(() => 'fallback');
  for (const types of [[sqliteCellClipboardType, sqliteCellClipboardType, 'text/plain'], ['text/plain', 'TEXT/PLAIN'], Array.from({ length: sqliteClipboardLimits.types + 1 }, (_, index) => 'application/x-format-' + index), ['text/plain', 1], ['text/plain', null], ['text/plain', ''], ['text/plain', 'bad format'], ['text/plain', 'x/\0'], Array(2), null, 'text/plain', {}]) expect(() => readSqliteClipboard({ types: types as any, getData })).toThrow();
  expect(getData).not.toHaveBeenCalled();
});
it('有界枚举DOMStringList式列表及迭代器；无限格式流在上限处关闭，不先Array.from整批分配', () => {
  const getData = vi.fn(() => '原文'); expect(readSqliteClipboard({ types: { 0: 'text/plain', length: 1 }, getData }).values).toEqual([[cell('原文')]]);
  let closed = false, visited = 0; const iterable = { *[Symbol.iterator]() { try { for (;;) { visited++; yield 'application/x-format-' + visited; } } finally { closed = true; } } }; expect(() => readSqliteClipboard({ types: iterable, getData })).toThrow(); expect(closed).toBe(true); expect(visited).toBe(sqliteClipboardLimits.types + 1); expect(getData).toHaveBeenCalledTimes(1);
});
it('来源列可宽于目标：无名文本多列明确跳过尾列，具名原生按准确名匹配并跳过未知与生成列', () => {
  const target = page(['id', 'computed', 'note']), values = [[cell('id1'), cell('note1'), cell('skip1'), cell('skip2'), cell('skip3')]], mapping = defaultSqlitePasteMapping(target, 5); expect(mapping).toEqual([{ column: 'id', kind: 'preserve' }, { column: 'note', kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: null, kind: 'preserve' }]); expect(sqlitePastePlanValues(prepareSqlitePaste(target, values, mapping), target)).toEqual([[cell('id1'), undefined, cell('note1')]]);
  const named = defaultSqlitePasteMapping(target, 5, ['unknown', 'note', 'computed', 'another', 'id']); expect(named).toEqual([{ column: null, kind: 'preserve' }, { column: 'note', kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: null, kind: 'preserve' }, { column: 'id', kind: 'preserve' }]); expect(sqlitePastePlanValues(prepareSqlitePaste(target, values, named), target)).toEqual([[cell('skip3'), undefined, cell('note1')]]);
});
