import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult, ResultColumn } from '../../src/shared/contracts';
import { captureQueryResultComparison, currentQueryResultComparison, queryResultComparisonKeyReason, queryResultComparisonLimits, queryResultComparisonValues, QueryResultComparisonScan, type QueryResultComparisonCapture, type QueryResultComparisonRow } from '../../src/renderer/queryResultComparison';
import { queryResultComparisonZh as text } from '../../src/renderer/locales/queryResultComparison.zh-CN';

const columns: ResultColumn[] = [{ key: 'id', name: '同名', type: 'BIGINT' }, { key: 'value', name: '同名', type: 'DECIMAL(65,20)' }, { key: 'bytes', name: '字节', type: 'BLOB' }];
/** 原行只由明确CellValue组装，不经JSON往返、Number或日期转换。 */
function source(values: readonly (readonly CellValue[])[], metadata: readonly ResultColumn[] = columns): QueryResult {
  return { columns: metadata.map(column => ({ ...column })), rows: values.map(row => Object.fromEntries(metadata.map((column, index) => [column.key, row[index]]))), truncated: false, elapsedMs: 1, statement: '只读来源，不应读取此SQL' };
}
/** 每个断言通过真实capture与step，最终完成前永不接收部分比较结果。 */
function finish(scan: QueryResultComparisonScan, initialProcessed = 0) {
  let previous = initialProcessed;
  for (;;) {
    const next = scan.step();
    expect(next.processed).toBeGreaterThanOrEqual(previous); expect(next.processed - previous).toBeLessThanOrEqual(512); previous = next.processed;
    if (next.done) return scan.result()!;
    expect(scan.result()).toBeUndefined();
  }
}
function fixture(left: QueryResult, right: QueryResult, keys: readonly string[] = ['id']) {
  const capture = captureQueryResultComparison(left, right, keys), scan = new QueryResultComparisonScan(capture);
  return { left, right, capture, scan };
}

describe('固定结果的明确键与稳定完整差异', () => {
  it('左原序保留删除/变化/相同，再追加右侧新增原序，精确键不经Number', () => {
    const bytes = { type: 'binary' as const, base64: 'AAH/' };
    const left = source([['18446744073709551615', '9', bytes], ['0009007199254740993', '1.0', null], ['2', '2.00', bytes]]);
    const right = source([['2', '2.00', { ...bytes }], ['4', '', null], ['9007199254740993', '1.00', null], ['5', null, null]]);
    const f = fixture(left, right), result = finish(f.scan);
    expect(result).toEqual({ added: 2, removed: 1, changed: 1, equal: 1, rows: [
      { kind: 'removed', leftIndex: 0, changedColumns: [] },
      { kind: 'changed', leftIndex: 1, rightIndex: 2, changedColumns: ['value'] },
      { kind: 'equal', leftIndex: 2, rightIndex: 0, changedColumns: [] },
      { kind: 'added', rightIndex: 1, changedColumns: [] },
      { kind: 'added', rightIndex: 3, changedColumns: [] },
    ] });
    expect(f.capture).toEqual({ columns, keys: ['id'], leftCount: 3, rightCount: 4, leftTruncated: false, rightTruncated: false });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.rows)).toBe(true); expect(result.rows.every(row => Object.isFrozen(row) && Object.isFrozen(row.changedColumns))).toBe(true);
    expect(left.rows[0].bytes).toBe(bytes); expect(Object.isFrozen(bytes)).toBe(false); expect(Object.isFrozen(left.rows)).toBe(false);
  });
  it('复合键用可靠元组编码，文本分隔符与空串不能造成碰撞', () => {
    const metadata = [{ key: 'a', name: '同名', type: 'TEXT' }, { key: 'b', name: '同名', type: 'TEXT' }, { key: 'v', name: '值', type: 'TEXT' }];
    const left = source([['a\u0000b', 'c', '一'], ['a', 'b\u0000c', '二'], ['', 'x', '三']], metadata), right = source([['a', 'b\u0000c', '二'], ['', 'x', '三'], ['a\u0000b', 'c', '一']], metadata);
    expect(finish(fixture(left, right, ['a', 'b']).scan)).toMatchObject({ added: 0, removed: 0, changed: 0, equal: 3, rows: [{ rightIndex: 2 }, { rightIndex: 0 }, { rightIndex: 1 }] });
  });
  it.each([
    ['DECIMAL(65,20)', '+000.10000000000000000000', '0.1'],
    ['BIGINT', '-0', '+000'],
    ['TIME', '-00:00:00', '00:00:00.000000'],
    ['DATETIME', '2026-10-22 12:00:00.1', '2026-10-22T12:00:00.100000'],
    ['DATE', '0000-00-00', '0000-00-00'],
  ])('%s匹配键复用原精确归一，等价键原文不算非键变化', (type, leftKey, rightKey) => {
    const metadata = [{ key: 'id', name: '键', type }, { key: 'v', name: '原值', type: 'TEXT' }], f = fixture(source([[leftKey, '原文']], metadata), source([[rightKey, '原文']], metadata));
    const result = finish(f.scan); expect(result).toMatchObject({ equal: 1, changed: 0 });
    expect(queryResultComparisonValues(f.capture, result.rows[0])[0]).toEqual({ column: 'id', name: '键', left: leftKey, right: rightKey, changed: false });
  });
  it('非键列严格比较原表示，NULL/空串/布尔/字节base64均保持区别，数字0和-0可相等', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }, { key: 'v', name: '值', type: 'TEXT' }, { key: 'b', name: '字节', type: 'BLOB' }];
    const left = source([[1, null, { type: 'binary', base64: 'AA==' }], [2, '', null], [3, false, null], [4, -0, null]], metadata);
    const right = source([[1, '', { type: 'binary', base64: 'AA' }], [2, null, null], [3, 'false', null], [4, 0, null]], metadata);
    expect(finish(fixture(left, right).scan)).toMatchObject({ changed: 3, equal: 1, rows: [{ changedColumns: ['v', 'b'] }, { changedColumns: ['v'] }, { changedColumns: ['v'] }, { kind: 'equal' }] });
  });
  it('左右空结果均有完整结果，单边空只产生明确新增或删除，截断状态独立保留', () => {
    const empty = source([]), right = source([['1', '值', null]]); right.truncated = true;
    expect(finish(fixture(empty, source([])).scan)).toEqual({ added: 0, removed: 0, changed: 0, equal: 0, rows: [] });
    const added = fixture(empty, right); expect(added.capture.rightTruncated).toBe(true); expect(finish(added.scan)).toMatchObject({ added: 1, rows: [{ kind: 'added', rightIndex: 0 }] });
    expect(finish(fixture(right, empty).scan)).toMatchObject({ removed: 1, rows: [{ kind: 'removed', leftIndex: 0 }] });
  });
  it('只用内部key定位，原型同名key和重复显示名不串列', () => {
    const metadata = [{ key: '__proto__', name: '同名', type: 'INT' }, { key: 'constructor', name: '同名', type: 'TEXT' }];
    const f = fixture(source([['1', '左']], metadata), source([['1', '右']], metadata), ['__proto__']), result = finish(f.scan);
    expect(result.rows[0].changedColumns).toEqual(['constructor']); expect(queryResultComparisonValues(f.capture, result.rows[0])[1]).toMatchObject({ column: 'constructor', name: '同名', left: '左', right: '右' });
  });
});

describe('匹配键整份准入与左右侧错误', () => {
  it.each(['INT', 'BIGINT UNSIGNED', 'DECIMAL(65,30)', 'NEWDECIMAL', 'TEXT', 'VARCHAR', 'JSON', 'DATE', 'TIME', 'TIMESTAMP'])('%s明确类型可作为匹配键', type => {
    expect(queryResultComparisonKeyReason({ key: 'id', name: '键', type })).toBeUndefined();
  });
  it.each(['FLOAT', 'DOUBLE', 'BLOB', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'TINYBLOB', 'BIT', 'GEOMETRY', '未知'])('%s不接受为键，不因值碰巧像整数放行', type => {
    const metadata = [{ key: 'id', name: '键', type }], left = source([[1]], metadata), right = source([[1]], metadata);
    expect(queryResultComparisonKeyReason(metadata[0])).toBe(text.keyUnsupported); expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.keyUnsupported);
  });
  it.each(['left', 'right'] as const)('%s NULL键整次拒绝且明确侧别，不能发布其它合法行', side => {
    const good = source([['1', '值', null]]), bad = source([['2', '值', null], [null, 'NULL键', null]]), f = fixture(side === 'left' ? bad : good, side === 'right' ? bad : good);
    expect(() => f.scan.step()).toThrow(text.keyNull(side)); expect(f.scan.result()).toBeUndefined(); expect(currentQueryResultComparison(f.capture, f.left, f.right)).toBe(true);
  });
  it.each(['left', 'right'] as const)('%s重复精确键整次拒绝，前导零/负零不绕过唯一性', side => {
    for (const values of [['1', '+0001'], ['0', '-0']]) {
      const good = source([['9', '值', null]]), bad = source(values.map(value => [value, '值', null])), f = fixture(side === 'left' ? bad : good, side === 'right' ? bad : good);
      expect(() => f.scan.step()).toThrow(text.keyDuplicate(side)); expect(f.scan.result()).toBeUndefined(); expect(currentQueryResultComparison(f.capture, f.left, f.right)).toBe(true);
    }
  });
  it.each(['left', 'right'] as const)('%s非法类型原值不猜测转换且侧别明确', side => {
    for (const value of ['1.0', '坏整数', 9007199254740992]) {
      const good = source([['1', '值', null]]), bad = source([[value, '值', null]]), f = fixture(side === 'left' ? bad : good, side === 'right' ? bad : good);
      expect(() => f.scan.step()).toThrow(text.keyInvalid(side)); expect(f.scan.result()).toBeUndefined();
    }
    const good = source([['1', '值', null]]), malformed = source([[Infinity, '值', null]]);
    expect(() => captureQueryResultComparison(side === 'left' ? malformed : good, side === 'right' ? malformed : good, ['id'])).toThrow(text.keyInvalid(side));
  });
  it('键必须显式1至8项、唯一且对应完整列，8项复合键可用', () => {
    const metadata = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, name: '键', type: 'INT' })), left = source([metadata.map((_, index) => String(index))], metadata), right = source([metadata.map((_, index) => String(index))], metadata);
    expect(finish(fixture(left, right, metadata.slice(0, 8).map(column => column.key)).scan)).toMatchObject({ equal: 1 });
    for (const keys of [[], ['不存在'], ['k0', 'k0'], metadata.map(column => column.key)]) expect(() => captureQueryResultComparison(left, right, keys)).toThrow();
  });
  it.each(['key', 'name', 'type', 'order', 'missing', 'duplicate'])('%s任一完整元数据不同均拒绝，不按同名猜测对齐', kind => {
    const left = source([['1', '值', null]]), right = source([['1', '值', null]]);
    if (kind === 'key') right.columns[1].key = 'other'; else if (kind === 'name') right.columns[1].name = '别名'; else if (kind === 'type') right.columns[1].type = 'TEXT'; else if (kind === 'order') right.columns.reverse(); else if (kind === 'missing') right.columns.pop(); else { left.columns[1].key = 'id'; right.columns[1].key = 'id'; }
    expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.identity);
  });
});

describe('来源访问器、不可变明细和永久失效', () => {
  it('明细保留原NULL和字节快照，缺行字段不补NULL，源对象从未冻结', () => {
    const bytes = { type: 'binary' as const, base64: 'AAH/' }, f = fixture(source([['1', null, bytes]]), source([['2', '', null]])), result = finish(f.scan);
    const removed = queryResultComparisonValues(f.capture, result.rows[0]), added = queryResultComparisonValues(f.capture, result.rows[1]);
    expect(removed[1]).toEqual({ column: 'value', name: '同名', left: null, changed: false }); expect(Object.hasOwn(removed[1], 'right')).toBe(false);
    expect(added[1]).toEqual({ column: 'value', name: '同名', right: '', changed: false }); expect(Object.hasOwn(added[1], 'left')).toBe(false);
    expect(removed[2].left).toEqual(bytes); expect(removed[2].left).not.toBe(bytes); expect(Object.isFrozen(removed)).toBe(true); expect(Object.isFrozen(removed[2].left)).toBe(true);
    bytes.base64 = 'AQ=='; expect((removed[2].left as { base64: string }).base64).toBe('AAH/');
    expect(() => queryResultComparisonValues(f.capture, result.rows[0])).toThrow(text.stale); bytes.base64 = 'AAH/'; expect(currentQueryResultComparison(f.capture, f.left, f.right)).toBe(false);
  });
  it('伪造capture/clone/其它scan的行不能读取私有原值，cancel也撤销已发明细', () => {
    const f = fixture(source([['1', '值', null]]), source([['1', '值', null]])), result = finish(f.scan), other = fixture(f.left, f.right), otherResult = finish(other.scan);
    for (const capture of [{ ...f.capture }, Object.create(f.capture)] as QueryResultComparisonCapture[]) {
      expect(currentQueryResultComparison(capture, f.left, f.right)).toBe(false); expect(() => new QueryResultComparisonScan(capture)).toThrow(text.stale);
    }
    for (const row of [{ ...result.rows[0] }, Object.create(result.rows[0]), otherResult.rows[0]] as QueryResultComparisonRow[]) expect(() => queryResultComparisonValues(f.capture, row)).toThrow(text.stale);
    f.scan.cancel(); expect(() => queryResultComparisonValues(f.capture, result.rows[0])).toThrow(text.stale); expect(currentQueryResultComparison(f.capture, f.left, f.right)).toBe(true);
  });
  it.each(['rows', 'row-index', 'column-index', 'metadata', 'cell', 'bytes', 'key-array'])('%s访问器在捕获中零调用，不能通过协议读取执行getter', kind => {
    const left = source([['1', '值', { type: 'binary', base64: '' }]]), right = source([['1', '值', null]]), getter = vi.fn(() => '不应读取'), keys = ['id'];
    if (kind === 'rows') Object.defineProperty(left, 'rows', { get: getter }); else if (kind === 'row-index') Object.defineProperty(left.rows, '0', { get: getter }); else if (kind === 'column-index') Object.defineProperty(left.columns, '0', { get: getter }); else if (kind === 'metadata') Object.defineProperty(left.columns[0], 'type', { get: getter }); else if (kind === 'cell') Object.defineProperty(left.rows[0], 'value', { get: getter }); else if (kind === 'bytes') Object.defineProperty(left.rows[0].bytes, 'base64', { get: getter }); else Object.defineProperty(keys, '0', { get: getter });
    expect(() => captureQueryResultComparison(left, right, keys)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('SQL与其它元数据不参与对比且不读取，坏对象也不能用toString补协议', () => {
    const left = source([['1', '值', null]]), right = source([['1', '值', null]]), getter = vi.fn(() => { throw Error('不应读取SQL'); });
    Object.defineProperty(left, 'statement', { get: getter }); Object.defineProperty(right, 'elapsedMs', { get: getter });
    expect(finish(fixture(left, right).scan)).toMatchObject({ equal: 1 }); expect(getter).not.toHaveBeenCalled();
    const convert = vi.fn(() => '值'); left.rows[0].value = { toString: convert } as unknown as CellValue;
    expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.value); expect(convert).not.toHaveBeenCalled();
  });
  it('键资格查询遇到坏元数据只返回原因且不执行getter', () => {
    const column = { key: 'id', name: '键', type: 'INT' }, getter = vi.fn(() => 'INT'); Object.defineProperty(column, 'type', { get: getter });
    expect(queryResultComparisonKeyReason(column)).toBe(text.identity); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['source', 'rows-array', 'columns-array', 'row', 'order', 'column', 'name', 'type', 'truncated', 'value', 'bytes-field', 'bytes-reference', 'bytes-prototype'])('%s观测漂移即永久撤销，恢复原引用不能复活', kind => {
    const bytes = { type: 'binary' as const, base64: 'AA==' }, left = source([['1', '一', bytes], ['2', '二', null]]), right = source([['1', '一', { ...bytes }]]), f = fixture(left, right);
    const rows = left.rows, cols = left.columns, row = rows[0], column = cols[0], prototype = Object.getPrototypeOf(bytes); let observed = left;
    if (kind === 'source') observed = { ...left }; else if (kind === 'rows-array') left.rows = [...rows]; else if (kind === 'columns-array') left.columns = [...cols]; else if (kind === 'row') rows[0] = { ...row }; else if (kind === 'order') rows.reverse(); else if (kind === 'column') cols[0] = { ...column }; else if (kind === 'name') column.name = '新名'; else if (kind === 'type') column.type = 'TEXT'; else if (kind === 'truncated') left.truncated = true; else if (kind === 'value') row.value = '变化'; else if (kind === 'bytes-field') bytes.base64 = 'AQ=='; else if (kind === 'bytes-reference') row.bytes = { ...bytes }; else Object.setPrototypeOf(bytes, null);
    expect(currentQueryResultComparison(f.capture, observed, right)).toBe(false);
    if (kind === 'order') rows.reverse(); left.rows = rows; left.columns = cols; rows[0] = row; cols[0] = column; column.name = '同名'; column.type = 'BIGINT'; left.truncated = false; row.value = '一'; row.bytes = bytes; bytes.base64 = 'AA=='; Object.setPrototypeOf(bytes, prototype);
    expect(currentQueryResultComparison(f.capture, left, right)).toBe(false); expect(() => f.scan.step()).toThrow(text.stale); expect(f.scan.result()).toBeUndefined();
  });
  it('scan自身观察漂移也sticky，右侧所有列同样核源，原格替换getter零调用', () => {
    const f = fixture(source([['1', '值', null]]), source([['1', '值', null]])), old = f.right.rows[0].value, getter = vi.fn(() => old);
    Object.defineProperty(f.right.rows[0], 'value', { get: getter, configurable: true }); expect(() => f.scan.step()).toThrow(text.stale); expect(getter).not.toHaveBeenCalled();
    Object.defineProperty(f.right.rows[0], 'value', { value: old, writable: true }); expect(currentQueryResultComparison(f.capture, f.left, f.right)).toBe(false);
  });
  it('完成后但result前变化不能发布；已经取得的行明细也不能越过最终来源核验', () => {
    const f = fixture(source([['1', '值', null]]), source([['1', '值', null]])); expect(f.scan.step().done).toBe(true);
    f.right.rows[0].value = '变化'; expect(f.scan.result()).toBeUndefined(); f.right.rows[0].value = '值'; expect(f.scan.result()).toBeUndefined();
  });
});

describe('完整有界分批、取消与预算', () => {
  it('先左映射再右匹配，每步最多512行且最终核源后才发布', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }], left = source(Array.from({ length: 513 }, (_, index) => [index]), metadata), right = source(Array.from({ length: 513 }, (_, index) => [index]), metadata), f = fixture(left, right);
    expect(f.scan.result()).toBeUndefined(); expect(f.scan.step()).toEqual({ processed: 512, total: 1026, done: false }); expect(f.scan.result()).toBeUndefined();
    expect(f.scan.step()).toEqual({ processed: 1024, total: 1026, done: false }); expect(f.scan.result()).toBeUndefined();
    expect(f.scan.step()).toEqual({ processed: 1026, total: 1026, done: true }); expect(f.scan.result()).toMatchObject({ equal: 513 });
  });
  it('长值按32Ki让出，单行超过32Ki时仍原子完整处理不拆格或截断', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }, { key: 'v', name: '值', type: 'TEXT' }], left = source(Array.from({ length: 17 }, (_, index) => [index, 'x'.repeat(4096)]), metadata), empty = source([], metadata), f = fixture(left, empty);
    expect(f.scan.step()).toEqual({ processed: 8, total: 17, done: false }); expect(f.scan.step()).toEqual({ processed: 16, total: 17, done: false }); expect(f.scan.step().done).toBe(true); expect(f.scan.result()?.removed).toBe(17);
    const wide = [{ key: 'id', name: '键', type: 'INT' }, ...Array.from({ length: 16 }, (_, index) => ({ key: `v${index}`, name: '值', type: 'TEXT' }))], one = source([[1, ...Array.from({ length: 16 }, () => 'x'.repeat(4096))]], wide), atomic = fixture(one, source([], wide));
    expect(atomic.scan.step()).toEqual({ processed: 1, total: 1, done: true }); expect(atomic.scan.result()?.removed).toBe(1);
  });
  it('取消清空部分映射，旧扫描不可重启；未漂移capture可显式创建新的扫描', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }], f = fixture(source(Array.from({ length: 513 }, (_, index) => [index]), metadata), source([], metadata));
    f.scan.step(); f.scan.cancel(); expect(f.scan.step()).toEqual({ processed: 512, total: 513, done: true }); expect(f.scan.result()).toBeUndefined();
    expect(finish(new QueryResultComparisonScan(f.capture))).toMatchObject({ removed: 513 });
  });
  it('后半批重复键仍整份拒绝；最终完整核源发现已经处理过的旧行变化', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }], left = source(Array.from({ length: 513 }, (_, index) => [index === 512 ? 0 : index]), metadata), f = fixture(left, source([], metadata));
    expect(f.scan.step().done).toBe(false); expect(() => f.scan.step()).toThrow(text.keyDuplicate('left')); expect(f.scan.result()).toBeUndefined();
    const g = fixture(source(Array.from({ length: 513 }, (_, index) => [index]), metadata), source([], metadata)); g.scan.step(); g.left.rows[0].id = 999;
    expect(() => g.scan.step()).toThrow(text.stale); g.left.rows[0].id = 0; expect(currentQueryResultComparison(g.capture, g.left, g.right)).toBe(false);
  });
  it('分批扫描的源格检查保持线性，不在每步重扫全部行', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }], left = source(Array.from({ length: 10000 }, (_, index) => [index]), metadata), right = source(Array.from({ length: 10000 }, (_, index) => [index]), metadata); let reads = 0;
    for (const result of [left, right]) result.rows = result.rows.map(row => new Proxy(row, { getOwnPropertyDescriptor(target, key) { reads++; return Reflect.getOwnPropertyDescriptor(target, key); } }));
    expect(finish(fixture(left, right).scan)).toMatchObject({ equal: 10000 }); expect(reads).toBeLessThanOrEqual(8 * (left.rows.length + right.rows.length));
  });
  it('100000行完整接纳；超出每侧行数或合计2m格在读缺失格之前拒绝', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }], left = source(Array.from({ length: 100000 }, (_, index) => [index]), metadata), empty = source([], metadata);
    expect(finish(fixture(left, empty).scan)).toMatchObject({ removed: 100000 });
    left.rows.push({ id: 100000 }); expect(() => captureQueryResultComparison(left, empty, ['id'])).toThrow(text.budget); left.rows.pop();
    const wide = Array.from({ length: 21 }, (_, index) => ({ key: index ? `v${index}` : 'id', name: '值', type: 'INT' })); left.columns = wide;
    expect(() => captureQueryResultComparison(left, source([], wide), ['id'])).toThrow(text.budget);
  });
  it('1024列允许，1025列拒绝，不靠丢弃隐藏列缩小对比范围', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }, ...Array.from({ length: 1023 }, (_, index) => ({ key: `v${index}`, name: '值', type: 'TEXT' }))], row: CellValue[] = [1, ...Array.from({ length: 1023 }, () => null)];
    expect(finish(fixture(source([row], metadata), source([row], metadata)).scan)).toMatchObject({ equal: 1 });
    const tooMany = [...metadata, { key: 'extra', name: '值', type: 'TEXT' }]; expect(() => captureQueryResultComparison(source([], tooMany), source([], tooMany), ['id'])).toThrow(text.budget);
  });
  it('合计16Mi原文与单值4096边界完整接纳，重复原值也计预算且不截断', () => {
    const metadata = [{ key: 'id', name: '键', type: 'INT' }, { key: 'v', name: '值', type: 'TEXT' }], value = 'x'.repeat(4096), left = source(Array.from({ length: 2048 }, (_, index) => [index, value]), metadata), right = source(Array.from({ length: 2048 }, (_, index) => [index, value]), metadata);
    expect(finish(fixture(left, right).scan)).toMatchObject({ equal: 2048 });
    right.rows.push({ id: 2048, v: 'x' }); expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.budget);
    expect(() => captureQueryResultComparison(source([[1, value + 'x']], metadata), source([], metadata), ['id'])).toThrow(text.budget);
    expect(() => captureQueryResultComparison(source([['1', null, { type: 'binary', base64: value + 'x' }]]), source([]), ['id'])).toThrow(text.budget);
    expect(queryResultComparisonLimits.cells).toBe(2000000);
  });
  it('稀疏行列、继承原格、重复原行与坏字节包装不被默默过滤', () => {
    const left = source([['1', '值', null]]), right = source([]); left.rows = new Array(1); expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow();
    left.rows = [Object.create({ id: '1', value: '值', bytes: null })]; expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.keyInvalid('left'));
    const row = { id: '1', value: '值', bytes: null }; left.rows = [row, row]; expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.identity);
    left.rows = [{ ...row, bytes: { type: 'binary', base64: '', extra: '额外字段' } as CellValue }]; expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow(text.value);
    left.columns = new Array(3); expect(() => captureQueryResultComparison(left, right, ['id'])).toThrow();
  });
});
