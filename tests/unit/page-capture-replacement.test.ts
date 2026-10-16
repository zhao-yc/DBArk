import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { applyPageReplacement, findPageCellsInWorker, pageFindLimits, pageOccurrences, previewPageReplacement, previewPageReplacementInWorker, type PageFindOptions } from '../../src/renderer/pageFindReplace';
import { pageFindPanelHarness } from '../helpers/pageFindPanelHarness';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { formatText } from '../../src/renderer/locales/zh-CN';

const info: TableInfo = { database: '捕获', name: '当前页', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: ['id', 'note', 'amount', 'payload', 'generated'].map(name => ({ name, type: name === 'note' || name === 'generated' ? 'TEXT' : name === 'payload' ? 'BLOB' : 'DECIMAL(30,6)', nullable: true, generated: name === 'generated', defaultValue: null, extra: '', comment: '' })) };
const base: PageFindOptions = { kind: 'text', query: '(old)', regex: true, captureReplacement: true, caseSensitive: false, wholeCell: false };
/** 大整数、DECIMAL、NULL和二进制原值不参与捕获展开，保留独立original供最终守卫核对。 */
function row(note: string, id = 'uuid-1'): DraftRow { const data = { id: '18446744073709551615', note, amount: '12345678901234567890.123456', payload: { type: 'binary' as const, base64: 'AAH/' }, nil: null, generated: 'old' }; return { id, data, original: structuredClone(data), inserted: false, deleted: false }; }

describe('Worker内显式捕获替换契约', () => {
  it.each([
    ['数字组', 'old old', '(old)', '<$1>'],
    ['命名及未参与组', '老😀 老', '(?<词>老)(?<表情>😀)?', '$<表情>:$<词>:$2:$<缺失>'],
    ['可选分支', 'b ab b', '(?<a>a)?(?<b>b)', '[$1/$2/$<a>/$<b>/$<缺失>]'],
    ['完整命中及原文前后缀', '甲old乙old丙', '(old)', "[$$][$&][$`][$']"],
    ['不存在数字组及前导零', 'a a', '(a)', '$0/$00/$01/$09/$10/$99/$100/$001'],
    ['两位组', 'abcdefghijkl', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)', '$12/$10/$09/$99/$100/$01'],
    ['99号组', 'a'.repeat(99), '(a)'.repeat(99), '$99/$98/$100'],
    ['无命名组保留并继续解析', 'old', '(old)', '$<未知$&>/$$1/$$$1/$/$x/$<未闭合'],
    ['原型同名组', 'ab', '(?<__proto__>a)(?<constructor>b)', '$<__proto__>/$<constructor>/$<toString>'],
    ['Unicode零宽', '😀A', '(?=(😀|A|$))', '[$1]'],
    ['空格零宽', '', '(?<空>)', '<$<空>>'],
    ['前后查找的捕获', '中文', '(?<=(中))(?=(文))', '$1:$2'],
    ['不递归解释捕获内容', '$1', '(\\$1)', '$1$$$&'],
    ['大小写及Unicode', 'İ老😀 A a', '(a|老😀)', '[$1]'],
    ['整格分支', 'ab', '(a|ab)', '[$1]'],
  ])('%s与原生JavaScript静态替换字符串结果一致', (_label, source, query, replacement) => {
    const options = { ...base, query, wholeCell: _label === '整格分支' }, rows = [row(source)];
    // 仅测试中运行已知安全常量作为独立语义对照；生产不在渲染/主线程重跑用户正则。
    const expected = source.replace(new RegExp(options.wholeCell ? `^(?:${query})$` : query, 'giu'), replacement);
    const plan = previewPageReplacementInWorker(rows, ['note'], options, replacement, info, 1);
    expect(plan.patches).toEqual([{ rowId: rows[0].id, key: 'note', before: source, after: expected }]);
    expect(JSON.stringify(plan)).not.toContain('"groups"'); expect(findPageCellsInWorker(rows, ['note'], options)[0]).not.toHaveProperty('replacement');
    const next = applyPageReplacement(rows, plan, info, 1); expect(next[0].original).toBe(rows[0].original); expect(next[0].data.amount).toBe(rows[0].data.amount); expect(next[0].data.payload).toBe(rows[0].data.payload);
  });
  it('默认正则和普通文字仍保持美元字面，同步入口拒绝显式捕获，非法组合不静默降级', () => {
    const rows = [row('old')], literal = '$1/$&/$$/$<x>';
    expect(previewPageReplacementInWorker(rows, ['note'], { ...base, captureReplacement: undefined }, literal, info, 1).patches[0].after).toBe(literal);
    expect(previewPageReplacement(rows, ['note'], { ...base, captureReplacement: false, regex: false, query: 'old' }, literal, info, 1).patches[0].after).toBe(literal);
    expect(() => previewPageReplacement(rows, ['note'], base, literal, info, 1)).toThrow(text.workerRequired);
    expect(() => previewPageReplacementInWorker(rows, ['note'], { ...base, regex: false }, literal, info, 1)).toThrow(text.captureRequiresRegex);
    expect(() => previewPageReplacementInWorker(rows, ['note'], { ...base, kind: 'null' }, literal, info, 1)).toThrow(text.captureRequiresRegex);
  });
  it('仅展开选中第二处，原值快照及不可写旁列不变，陈旧草稿整批拒绝', () => {
    const rows = [row('😀old前old后old'), row('old', 'uuid-2')], occurrences = pageOccurrences(findPageCellsInWorker(rows, ['note'], base));
    const plan = previewPageReplacementInWorker(rows, ['note', 'amount', 'payload', 'generated'], base, '<$1$1>', info, 2, occurrences[1]);
    expect(plan.patches).toEqual([{ rowId: 'uuid-1', key: 'note', before: '😀old前old后old', after: '😀old前<oldold>后old' }]);
    const next = applyPageReplacement(rows, plan, info, 2); expect(next[1]).toBe(rows[1]); expect(next[0].original).toBe(rows[0].original); expect(next[0].data.generated).toBe('old');
    expect(() => applyPageReplacement([{ ...rows[0], data: { ...rows[0].data, amount: '新草稿' } }, rows[1]], plan, info, 2)).toThrow(text.changed);
  });
  it('捕获展开先累计预算再join或clone，超限不留下部分补丁', () => {
    const rows = [row('a'.repeat(32768))], clone = vi.spyOn(globalThis, 'structuredClone');
    try { expect(() => previewPageReplacementInWorker(rows, ['note'], { ...base, query: '(a+)' }, '$1'.repeat(2048), info, 1)).toThrow(text.budget); expect(clone).not.toHaveBeenCalled(); expect(rows[0].data.note).toBe('a'.repeat(32768)); } finally { clone.mockRestore(); }
    expect(() => previewPageReplacementInWorker([row('中'.repeat(10000))], ['note'], { ...base, query: '(中+)' }, '$1'.repeat(600), info, 1)).toThrow(text.budget);
    expect(() => previewPageReplacementInWorker([row('a'.repeat(50001))], ['note'], { ...base, query: 'a' }, '$&', info, 1)).toThrow(text.budget);
    expect(() => previewPageReplacementInWorker(rows, ['note'], base, 'x'.repeat(pageFindLimits.replacement + 1), info, 1)).toThrow(text.replacementLimit);
  });
  it('不为只读或非选中命中展开模板，单处不借其它格的放大结果超出预算', () => {
    const first = row('old'), other = row('a'.repeat(32768), 'uuid-2'); first.data.generated = 'a'.repeat(32768); first.data.amount = 'a'.repeat(32768);
    const options = { ...base, query: '(old|a+)' }, selected = pageOccurrences(findPageCellsInWorker([first, other], ['note'], options))[0];
    const plan = previewPageReplacementInWorker([first, other], ['note', 'generated', 'amount'], options, '$1'.repeat(600), info, 1, selected);
    expect(plan.patches).toEqual([{ rowId: first.id, key: 'note', before: 'old', after: 'old'.repeat(600) }]); expect(first.data.generated).toBe('a'.repeat(32768)); expect(other.data.note).toBe('a'.repeat(32768));
  });
});

/** 在完整生产面板的既有入口配置捕获模式；不另建查找/替换入口或伪造业务结果。 */
async function configure(h: Awaited<ReturnType<typeof pageFindPanelHarness>>, query: string, replacement: string) {
  h.view.nodes('input')[3].props.onChange({ target: { checked: true } }); h.view.render();
  h.view.nodes('input')[5].props.onChange({ target: { checked: true } }); h.view.render();
  h.change(0, query); h.change(4, replacement); h.click(text.search); await h.flush(); h.workers.at(-1)!.release(); await h.flush(); h.enter(0); await h.flush();
}
describe('既有面板捕获模式事件接线', () => {
  it.each([
    ['abcdef abcdef', '(abcdef)', '$1$1', 'abcdefabcdef abcdef', 3, 14],
    ['aa a', '(a)(b)?', '$2', 'a a', 1, 1],
  ] as const)('单处写入%s后按实际展开长度前进', async (source, query, replacement, expected, occurrence, offset) => {
    const h = await pageFindPanelHarness(); try {
      h.props.rows[0].data.note = source; await configure(h, query, replacement); h.enter(4); await h.flush(); h.workers.at(-1)!.release(); await h.flush();
      expect(h.applied).toHaveLength(1); expect(h.props.rows[0].data.note).toBe(expected);
      await h.searchTimer(); h.workers.at(-1)!.release(); await h.flush();
      expect(h.view.nodes('span').some(node => node.props.children === formatText(text.location, 1, 'note', occurrence, offset))).toBe(true);
    } finally { await h.dispose(); } expect(h.workers.every(worker => worker.terminated)).toBe(true);
  });
  it('整批命名捕获只在确认后形成草稿，关闭正则会同步关闭捕获模式', async () => {
    const h = await pageFindPanelHarness(); try { await configure(h, '(?<词>old)', '[$<词>]'); h.click(text.preview); await h.flush(); h.workers.at(-1)!.release(); await h.flush(); expect(h.applied).toHaveLength(0); h.click(text.apply); await h.flush(); expect(h.props.rows[0].data.note).toBe('[old] [old]'); expect(h.applied).toHaveLength(1);
      h.view.nodes('input')[3].props.onChange({ target: { checked: false } }); h.view.render(); expect(h.view.nodes('input')[5].props.checked).toBe(false); expect(h.view.nodes('input')[5].props.disabled).toBe(true);
    } finally { await h.dispose(); }
  });
  it('捕获开关ABA撤销已经完成计算但等待终止确认的旧命令', async () => {
    const h = await pageFindPanelHarness(); try { await configure(h, '(old)', '<$1>'); h.enter(4); await h.flush(); const worker = h.workers.at(-1)!; worker.holdTermination(); worker.release(); await h.flush();
      h.view.nodes('input')[5].props.onChange({ target: { checked: false } }); h.view.render(); h.view.nodes('input')[5].props.onChange({ target: { checked: true } }); h.view.render(); worker.acknowledge(); await h.flush(); expect(h.applied).toHaveLength(0); expect(h.props.rows[0].data.note).toBe('old old');
    } finally { await h.dispose(); }
  });
});
