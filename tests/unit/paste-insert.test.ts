import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { collectChanges, newDraftRow, type DraftRow } from '../../src/renderer/dataChanges';
import { cellClipboardType, encodeClipboard, maxClipboardCharacters } from '../../src/renderer/gridClipboard';
import { decodePasteInsert, defaultPasteInsertMapping, PasteInsertIntent, pasteInsertSummary, preparePasteInsert, readPasteInsert } from '../../src/renderer/pasteInsert';
import { assertCopiedRecordKeys } from '../../src/renderer/recordDuplicate';
import type { RecordContext } from '../../src/renderer/recordViews';

/** 所有目录与记录均为合成值；不连接数据库或读取真实剪贴板。 */
export function pasteFixture() {
  const column = (name: string, extra = '', generated = false) => ({ name, type: 'text', nullable: true, defaultValue: null, extra, generated, comment: '' });
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], columns: [column('id', 'auto_increment'), column('note'), column('__proto__'), column('bytes'), column('hidden', 'INVISIBLE'), column('generated', '', true)] };
  const context: RecordContext = { target: { connectionId: 'connection', database: 'db', table: 'items' }, connectionVersion: 1, generation: 1, info, loaded: true, stale: false, busy: false };
  const original = { id: 7, note: '原行' }, rows: DraftRow[] = [{ id: 'old', data: { ...original, note: '旧草稿' }, original, inserted: false, deleted: false }];
  return { info, context, rows };
}

describe('粘贴新增的整批计划与本地草稿', () => {
  it('默认只映射可见可写字段，生成、自增、隐藏列均省略', () => {
    const f = pasteFixture(); expect(defaultPasteInsertMapping(f.info, ['id', 'note', 'generated', '__proto__'], 4)).toEqual(['note', '__proto__', null, null]);
    const plan = preparePasteInsert(f.info, decodePasteInsert('', 'NULL\t900719925474099312345'), ['note', '__proto__']);
    expect(plan.data[0].note).toBe('NULL'); expect(Object.hasOwn(plan.data[0], 'id')).toBe(false); expect(Object.hasOwn(plan.data[0], 'hidden')).toBe(false);
    expect(pasteInsertSummary(plan.data[0], 'note')).toBe('文本：NULL'); expect(pasteInsertSummary(plan.data[0], 'hidden')).toContain('DEFAULT');
  });
  it('typed NULL、空二进制、字节与DEFAULT保持，原字符串的精度/JSON词法不重解', () => {
    const f = pasteFixture();
    const binary = { type: 'binary' as const, base64: 'AAH/' }, originals = ['900719925474099312345', '1.23000000000000000001', '2026-10-16 12:34:56.123456', '{"x":1,"x":-0,"n":9007199254740993}'];
    for (const value of originals) {
      const encoded = encodeClipboard([[value, undefined, binary, null]]), matrix = decodePasteInsert(encoded.typed, encoded.text);
      const plan = preparePasteInsert(f.info, matrix, ['note', '__proto__', 'bytes', 'hidden']);
      expect(plan.data[0].note).toBe(value); expect(plan.data[0].bytes).toEqual(binary); expect(plan.data[0].bytes).not.toBe(binary); expect(plan.data[0].hidden).toBeNull(); expect(Object.hasOwn(plan.data[0], '__proto__')).toBe(false);
    }
    const empty = preparePasteInsert(f.info, [[{ type: 'binary', base64: '' }]], ['bytes']); expect(empty.data[0].bytes).toEqual({ type: 'binary', base64: '' });
  });
  it('原型同名字段为自有值，省略DEFAULT不触发原型setter', () => {
    const f = pasteFixture(), plan = preparePasteInsert(f.info, [['安全值']], ['__proto__']);
    expect(Object.hasOwn(plan.data[0], '__proto__')).toBe(true); expect(Object.getPrototypeOf(plan.data[0])).toBe(Object.prototype); expect(plan.data[0].__proto__).toBe('安全值');
  });
  it.each([{ mapping: ['note', 'note'] }, { mapping: ['generated', null] }, { mapping: ['missing', null] }, { mapping: [null, null] }])('无效/重复/生成/全空映射$mapping整批拒绝', ({ mapping }) => {
    const f = pasteFixture(); expect(() => preparePasteInsert(f.info, [['a', 'b']], mapping)).toThrow();
  });
  it('未知typed版本、空typed或未知DBArk MIME均失败，不退回text', () => {
    for (const typed of ['{bad', '{"version":2,"rows":[["secret"]]}', '{"version":1,"rows":[[{"type":"unknown"}]]}']) expect(() => decodePasteInsert(typed, '可见文字')).toThrow();
    expect(() => readPasteInsert({ types: [cellClipboardType], getData: () => '' })).toThrow();
    expect(() => readPasteInsert({ types: [cellClipboardType + '-v2'], getData: () => '文字' })).toThrow();
    const data = { types: ['text/plain'], getData: vi.fn(() => 'NULL') }; expect(readPasteInsert(data).values).toEqual([['NULL']]); expect(data.getData).toHaveBeenCalledTimes(1);
  });
  it('空输入、非矩形、1001行、50k单元与10M字符上限在分配草稿前拒绝', () => {
    expect(() => decodePasteInsert('', '')).toThrow(); expect(() => decodePasteInsert('', 'a\tb\nc')).toThrow();
    expect(() => decodePasteInsert('', Array(1001).fill('x').join('\n'))).toThrow(/1000/);
    expect(() => decodePasteInsert('', Array(1000).fill(Array(51).fill('x').join('\t')).join('\n'))).toThrow();
    expect(() => decodePasteInsert('', 'x'.repeat(maxClipboardCharacters + 1))).toThrow();
    const exact = decodePasteInsert('', Array(1000).fill(Array(50).fill('x').join('\t')).join('\n')); expect(exact).toHaveLength(1000); expect(exact[0]).toHaveLength(50);
  });
  it('1000行只一次原子追加，旧草稿/original/选择身份不被替换，后续集中changes保留', () => {
    const f = pasteFixture(), intent = new PasteInsertIntent(f.rows, f.context, ['note']); let sequence = 0; const id = vi.fn(() => 'new-' + ++sequence);
    const plan = preparePasteInsert(f.info, decodePasteInsert('', Array(1000).fill('新值').join('\n')), ['note']);
    expect(id).not.toHaveBeenCalled(); const result = intent.consume(plan, f.rows, f.context, id);
    expect(result.rows).toHaveLength(1001); expect(result.rows[0]).toBe(f.rows[0]); expect(result.rows[0].original).toBe(f.rows[0].original); expect(f.rows).toHaveLength(1);
    expect(collectChanges(result.rows)).toHaveLength(1001); expect(result.rows[1].inserted).toBe(true); expect(Object.hasOwn(result.rows[1].data, 'id')).toBe(false);
    expect(() => intent.consume(plan, f.rows, f.context, id)).toThrow(); expect(id).toHaveBeenCalledTimes(1000);
  });
  it('显式映射自增沿原冲突保护，不能通过类型变化绕开已存在键', () => {
    const f = pasteFixture(), intent = new PasteInsertIntent(f.rows, f.context, ['note']);
    const result = intent.consume(preparePasteInsert(f.info, [['7']], ['id']), f.rows, f.context, () => 'new');
    expect(() => assertCopiedRecordKeys(result.rows, f.info, new Set(result.ids))).toThrow(/冲突/);
  });
  it.each(['busy', 'stale', 'not-loaded', 'view', 'no-key', 'engine'] as const)('原只读边界%s不分配草稿', condition => {
    const f = pasteFixture(); if (condition === 'busy') f.context.busy = true; if (condition === 'stale') f.context.stale = true; if (condition === 'not-loaded') f.context.loaded = false; if (condition === 'view') f.info.objectKind = 'view'; if (condition === 'no-key') f.info.editableKey = []; if (condition === 'engine') f.info.engine = 'MyISAM';
    expect(() => new PasteInsertIntent(f.rows, f.context, ['note'])).toThrow();
  });
  it.each(['rows', 'target', 'generation', 'connection', 'metadata', 'closed'] as const)('预览后%s变化拒绝，UUID分配0，原草稿不变', change => {
    const f = pasteFixture(), intent = new PasteInsertIntent(f.rows, f.context, ['note']), plan = preparePasteInsert(f.info, [['新值']], ['note']), id = vi.fn(() => 'new');
    let rows = f.rows; if (change === 'rows') rows = [...rows]; if (change === 'target') f.context.target.table = 'other'; if (change === 'generation') f.context.generation++; if (change === 'connection') f.context.connectionVersion++; if (change === 'metadata') f.info.columns[1].type = 'varchar(2)'; if (change === 'closed') intent.invalidate();
    expect(() => intent.consume(plan, rows, f.context, id)).toThrow(); expect(id).not.toHaveBeenCalled(); expect(f.rows[0].data.note).toBe('旧草稿');
  });
  it('身份碰撞/克隆伪计划不发布部分行，合法值与原二进制不共享可变包装', () => {
    const f = pasteFixture(), plan = preparePasteInsert(f.info, [[{ type: 'binary', base64: 'AA==' }], [{ type: 'binary', base64: '' }]], ['bytes']);
    expect(() => new PasteInsertIntent(f.rows, f.context, ['bytes']).consume(structuredClone(plan), f.rows, f.context, () => 'new')).toThrow();
    expect(() => new PasteInsertIntent(f.rows, f.context, ['bytes']).consume(plan, f.rows, f.context, () => 'same')).toThrow(); expect(f.rows).toHaveLength(1);
    const row = newDraftRow('single'); expect(row).toEqual({ id: 'single', data: {}, inserted: true, deleted: false });
  });
});
