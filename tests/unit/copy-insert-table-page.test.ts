import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers/copyInsertPage';

describe('仅复制明确表页中已加载的未修改行', () => {
  it('无键表和只读引擎也能本地复制，按页顺序复制当前/选中行，不扩展整表', () => {
    const f = fixture(); expect(f.prepare().rows).toEqual([f.page.rows[0]]);
    expect(f.prepare(new Set(['行1', '行0'])).rows).toEqual(f.page.rows);
    expect(f.prepare().rows).not.toBe(f.page.rows); expect(f.page.hasMore).toBe(true);
  });
  it.each(['view', 'unknown', 'database', 'table', 'version', 'generation', 'metadata', 'page-object', 'busy', 'stale', 'unloaded', 'missing-source', 'missing-columns', 'original'])('%s 归属不成立时拒绝', condition => {
    const f = fixture();
    if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'unknown') delete f.info.objectKind;
    else if (condition === 'database') f.context.target.database = '另库'; else if (condition === 'table') f.context.target.table = '另表';
    else if (condition === 'version') f.context.connectionVersion++; else if (condition === 'generation') f.context.generation++;
    else if (condition === 'metadata') f.info.columns[1].comment = '目录已改变'; else if (condition === 'page-object') f.binding.page = { ...f.page };
    else if (condition === 'busy') f.context.busy = true; else if (condition === 'stale') f.context.stale = true; else if (condition === 'unloaded') f.context.loaded = false;
    else if (condition === 'missing-source') delete f.page.copySource; else if (condition === 'missing-columns') f.page.copySource!.missingColumns = ['值']; else f.rows[0].original!.值 = '旧快照被替换';
    expect(() => f.prepare()).toThrow();
  });
  it.each(['inserted', 'deleted', 'modified', 'missing', 'unknown'])('所选行 %s 草稿整次拒绝，不静默省略', condition => {
    const f = fixture();
    if (condition === 'inserted') f.rows[0].inserted = true; else if (condition === 'deleted') f.rows[0].deleted = true; else if (condition === 'modified') f.rows[0].data.值 = '草稿'; else if (condition === 'missing') delete f.rows[0].data.值; else f.rows[0].data.其他 = '额外值';
    expect(() => f.prepare(new Set(['行0', '行1']))).toThrow(); expect(f.rows).toHaveLength(2);
  });
  it('未勾选的草稿不混入原值复制，返回快照不随之后的本地修改改变', () => {
    const f = fixture(); f.rows[1].data.值 = '未勾选草稿'; const input = f.prepare();
    f.rows[0].original!.值 = '后来变化'; f.rows[0].data.值 = '后来草稿'; expect(input.rows[0].值).toBe('甲');
  });
  it('空选择、失效 UUID、缺失目录字段和未知结果列不能推断为完整 INSERT', () => {
    const f = fixture(); expect(() => f.prepare(new Set())).toThrow(); expect(() => f.prepare(new Set(['其他UUID']))).toThrow();
    delete f.page.rows[0].值; delete f.rows[0].original!.值; delete f.rows[0].data.值; expect(() => f.prepare()).toThrow('缺少字段');
  });
});
