import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { TablePage } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { resultInsertZh as text } from '../../src/renderer/locales/resultInsert.zh-CN';
import { createTableRowTransfer } from '../../src/renderer/tableRowTransfer';

it.each([{ argv: [] as string[] }, { argv: ['--list'] }])('实库原生入口默认和列表不加载驱动或桌面：%j', ({ argv }) => {
  const source = readFileSync(new URL('../e2e/table-row-transfer.spec.ts', import.meta.url), 'utf8'), skip = vi.fn();
  const require = vi.fn((name: string) => { if (name === '@playwright/test') return { test: { skip } }; throw Error('不得加载桌面、驱动或认证'); });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require, process: { argv, env: argv.length ? { DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_ROW_TRANSFER_NATIVE: '1' } : {} } });
  expect(skip).toHaveBeenCalledOnce(); expect(require.mock.calls).toEqual([['@playwright/test']]);
});

/** 原页和草稿分别克隆，复现表浏览页的原值校验边界。 */
function fixture() {
  const page: TablePage = {
    columns: ['id', 'amount', 'note', 'bin', 'json', 'time', 'hidden'].map(key => ({ key, name: key, type: '' })),
    rows: [
      { id: '18446744073709551615', amount: '0.12345678901234567890', note: null, bin: { type: 'binary', base64: 'AP8=' }, json: '{"n":900719925474099312345,"x":-0,"x":2}', time: '2026-10-31 12:34:56.123456', hidden: '不复制的原文' },
      { id: '9007199254740993', amount: '1.00000000000000000001', note: '', bin: { type: 'binary', base64: '' }, json: '{ "a": 1 }', time: '-838:59:58.123456', hidden: '不复制的原文' },
    ],
    hasMore: true, page: 2, pageSize: 2,
  };
  const rows: DraftRow[] = page.rows.map((data, index) => ({ id: 'r' + index, data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }));
  return { page, rows, visible: ['bin', 'id', 'amount', 'note', 'json', 'time'], selected: new Set(['r1', 'r0']) };
}

describe('表浏览页勾选转入目标表的冻结来源', () => {
  it('按原页行序和可见列序保留精确值、NULL、BLOB、JSON原文与时间微秒，不改勾选', () => {
    const { page, rows, visible, selected } = fixture();
    const intent = createTableRowTransfer(page, rows, visible, selected, '原窗口', () => true);
    expect(intent.selected).toBe(true); expect(intent.owner).toBe('原窗口'); expect(intent.current()).toBe(true);
    expect(intent.data.columns.map(column => column.key)).toEqual(visible);
    expect(intent.data.rows.map(row => row.id)).toEqual(['18446744073709551615', '9007199254740993']);
    expect(intent.data.rows[0]).toEqual({ bin: { type: 'binary', base64: 'AP8=' }, id: '18446744073709551615', amount: '0.12345678901234567890', note: null, json: '{"n":900719925474099312345,"x":-0,"x":2}', time: '2026-10-31 12:34:56.123456' });
    expect(intent.data.rows[1]).toMatchObject({ bin: { type: 'binary', base64: '' }, note: '', json: '{ "a": 1 }', time: '-838:59:58.123456' });
    expect(intent.data.truncated).toBe(false); expect(JSON.stringify(intent.data)).not.toContain('不复制的原文');
    expect([...selected]).toEqual(['r1', 'r0']);
  });

  it('只取勾选子集，不因表页还有后续数据扩展来源', () => {
    const { page, rows } = fixture();
    const intent = createTableRowTransfer(page, rows, ['id'], new Set(['r1']), '窗口', () => true);
    expect(intent.data).toEqual({ columns: [{ key: 'id', name: 'id' }], rows: [{ id: '9007199254740993' }], truncated: false });
  });

  it('未选中行的修改、新增、删除或原始身份漂移也拒绝，绝不忽略原页草稿', () => {
    for (const mutate of [
      (rows: DraftRow[]) => { rows[1].data.note = '未提交'; },
      (rows: DraftRow[]) => { rows[1].inserted = true; },
      (rows: DraftRow[]) => { rows[1].deleted = true; },
      (rows: DraftRow[]) => { rows[1].original = undefined; },
      (rows: DraftRow[]) => { rows.reverse(); },
    ]) {
      const { page, rows, visible } = fixture(); mutate(rows);
      expect(() => createTableRowTransfer(page, rows, visible, new Set(['r0']), '窗口', () => true)).toThrow(text.stale);
    }
  });

  it('空勾选、旧页ID及混合旧ID统一拒绝，不回退全页', () => {
    const { page, rows, visible } = fixture();
    for (const selected of [new Set<string>(), new Set(['旧页']), new Set(['r0', '旧页'])]) {
      expect(() => createTableRowTransfer(page, rows, visible, selected, '窗口', () => true)).toThrow(text.stale);
    }
  });

  it('开门前与创建后都核实时守卫，失效或异常统一为安全中文错误', () => {
    const { page, rows, visible, selected } = fixture();
    const before = vi.fn(() => false);
    expect(() => createTableRowTransfer(page, rows, visible, selected, '窗口', before)).toThrow(text.stale);
    expect(before).toHaveBeenCalledOnce();
    const during = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    expect(() => createTableRowTransfer(page, rows, visible, selected, '窗口', during)).toThrow(text.stale);
    expect(during).toHaveBeenCalledTimes(2);
    for (const guard of [() => { throw Error('不应泄露的底层内容'); }, () => 1 as unknown as boolean]) {
      expect(() => createTableRowTransfer(page, rows, visible, selected, '窗口', guard)).toThrow(text.stale);
    }
  });

  it('守卫是后续写入的权威，来源失效后恢复原值不能复活冻结快照', () => {
    const { page, rows, visible, selected } = fixture(); let allowed = true;
    const intent = createTableRowTransfer(page, rows, visible, selected, '窗口', () => allowed), listener = vi.fn(); intent.subscribe(listener);
    allowed = false; expect(intent.current()).toBe(false);
    allowed = true; expect(intent.current()).toBe(false); intent.invalidate(); expect(listener).toHaveBeenCalledOnce();
  });

  it('原页、草稿、列序及勾选后续变更不污染深度冻结值，也不代替实时授权', () => {
    const { page, rows, visible, selected } = fixture(); let allowed = true;
    const intent = createTableRowTransfer(page, rows, visible, selected, '窗口', () => allowed), saved = structuredClone(intent.data);
    page.rows[0].id = '后来修改'; rows[0].data.amount = '0'; (page.rows[0].bin as { type: 'binary'; base64: string }).base64 = 'AA==';
    page.columns.reverse(); visible.reverse(); selected.clear();
    expect(intent.data).toEqual(saved); expect(Object.isFrozen(intent.data)).toBe(true); expect(Object.isFrozen(intent.data.columns)).toBe(true);
    expect(Object.isFrozen(intent.data.rows[0])).toBe(true); expect(Object.isFrozen(intent.data.rows[0].bin)).toBe(true);
    allowed = false; expect(intent.current()).toBe(false);
  });
});
