import { describe, expect, it, vi } from 'vitest';
import { MySQL } from 'dt-sql-parser/dist/parser/mysql/index';
import { analyzeCompletion } from '../../src/shared/completionAnalysis';
import { completionSuggestions } from '../../src/renderer/completionSuggestions';

/** 运行真实分析及建议管道；目录端口若收到请求即失败，不连接数据库。 */
async function suggest(marked: string, capabilities = { windowFunctions: true }, mode = {}) {
  const source = marked.replace('|', ''), result = analyzeCompletion(source, marked.indexOf('|'), mode, capabilities);
  expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('真实帧关键字分析未就绪');
  const load = vi.fn(async () => { throw Error('帧关键字不得读取字段或函数目录'); });
  const items = await completionSuggestions(result, 'current', { load });
  expect(load).not.toHaveBeenCalled(); expect(result).toMatchObject({ syntax: [], relations: [], localRelations: [], incomplete: false });
  expect(items.items.every(item => item.kind === 'keyword' && item.insertText === item.label)).toBe(true);
  return { source, result, items };
}

describe('窗口帧关键字本地补全', () => {
  it.each([
    ['ROWS BETWEEN UNB|OUNDED PRECEDING AND CURRENT ROW', 'UNBOUNDED'],
    ['ROWS BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW', 'CURRENT'],
    ['ROWS BETWEEN 1 PRE|CEDING AND CURRENT ROW', 'PRECEDING'],
    ['ROWS BETWEEN 1 PRECEDING AN|D CURRENT ROW', 'AND'],
    ['ROWS BETWEEN 1 PRECEDING AND CURRENT RO|W', 'ROW'],
    ['ROW|S BETWEEN 1 PRECEDING AND CURRENT ROW', 'ROWS'],
    ['RAN|GE BETWEEN 1 PRECEDING AND CURRENT ROW', 'RANGE'],
    ['ROWS BETWEEN 1 PRECEDING AND 2 FOL|LOWING', 'FOLLOWING'],
  ])('%s替换完整词后仍为真实解析器接受的原语句', async (frame, expected) => {
    const marked = `SELECT SUM(u.value_col) OVER(ORDER BY u.id ${frame}) FROM users u`, h = await suggest(marked);
    expect(h.items.items.map(item => item.insertText)).toEqual([expected]);
    const sql = h.source.slice(0, h.result.target.start) + expected + h.source.slice(h.result.target.end);
    expect(sql).toBe(marked.replace('|', '')); expect(new MySQL().validate(sql)).toEqual([]);
  });
  it.each([
    ['ROWS |', ['CURRENT ROW', 'UNBOUNDED PRECEDING', 'BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW']],
    ['ROWS BETWEEN | AND CURRENT ROW', ['CURRENT ROW', 'UNBOUNDED PRECEDING']],
    ['ROWS UNBOUNDED |', ['PRECEDING']],
    ['ROWS BETWEEN CURRENT ROW AND UNBOUNDED |', ['FOLLOWING']],
    ['ROWS BETWEEN 1 PRECEDING AND 2 |', ['FOLLOWING']],
  ] as [string, string[]][])('完整边界%s仅提供适用于当前位置的固定候选', async (frame, expected) => {
    const h = await suggest(`SELECT SUM(value_col) OVER(ORDER BY id ${frame}) FROM users`);
    expect(h.items.items.map(item => item.insertText)).toEqual(expected);
  });
  it('空窗口可从完整ROWS／RANGE帧开始，不插入任意片段或读取目录', async () => {
    const h = await suggest('SELECT SUM(value_col) OVER(|) FROM users');
    expect(h.items.items.map(item => item.insertText)).toEqual(['ROWS CURRENT ROW', 'RANGE CURRENT ROW', 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW', 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW']);
  });
  it.each([
    ['9007199254740993', '9007199254740992', ['PRECEDING', 'FOLLOWING']],
    ['9007199254740992', '9007199254740993', ['FOLLOWING']],
  ] as [string, string, string[]][])('相邻大整数偏移%s／%s不转浮点比较', async (start, end, expected) => {
    const h = await suggest(`SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN ${start} PRECEDING AND ${end} |) FROM users`);
    expect(h.items.items.map(item => item.insertText)).toEqual(expected);
  });
  it('命名窗口定义保留原字段及名字，只补本帧关键字', async () => {
    const h = await suggest('SELECT SUM(v) OVER w FROM users WINDOW w AS(ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW)');
    expect(h.items.items.map(item => item.insertText)).toEqual(['CURRENT']); expect(h.result.windowNames).toBeUndefined();
  });
  it.each([{ ansiQuotes: false, noBackslashEscapes: false }, { ansiQuotes: false, noBackslashEscapes: true }, { ansiQuotes: true, noBackslashEscapes: false }, { ansiQuotes: true, noBackslashEscapes: true }])('词法模式%j不改变原文或目标范围', async mode => {
    const h = await suggest('SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN 1 PRECEDING AND CUR|RENT ROW) FROM `lib.x`.`table.y`', { windowFunctions: true }, mode);
    expect(h.items.items.map(item => item.insertText)).toEqual(['CURRENT']);
    expect(h.source.slice(h.result.target.start, h.result.target.end)).toBe('CURRENT');
  });
  it.each([
    'SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN CEI|L(2) PRECEDING AND CURRENT ROW) FROM users',
    'SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN 1 PRECEDING AND u.fo|suffix FOLLOWING) FROM users u',
    'SELECT SUM(v) OVER(base ORDER BY id ROWS CUR|RENT ROW) FROM users WINDOW base AS()',
    'SELECT SUM(v) OVER(ORDER BY id GROUPS CUR|RENT ROW) FROM users',
    'SELECT SUM(v) OVER(ORDER BY id RANGE BETWEEN INTERVAL 1 DAY PRECEDING AND CUR|RENT ROW) FROM users',
    'SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN 1.5 PRE|CEDING AND CURRENT ROW) FROM users',
    'SELECT SUM(v) OVER(ORDER BY id ROWS BETWEEN 1 PRECEDING AND CUR|RENT ROW) FROM users WHERE',
    'SELECT id FROM users UNION SELECT id FROM orders ORDER BY SUM(id) OVER(ROWS CUR|RENT ROW)',
  ])('不完整或尚不支持的边界不借目录恢复：%s', marked => {
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), {}, { windowFunctions: true }).status).toBe('blocked');
  });
  it.each([undefined, {}, { windowFunctions: false }])('缺省或关闭能力%j不启用新帧关键字', capabilities => {
    const marked = 'SELECT SUM(v) OVER(ORDER BY id ROWS CUR|RENT ROW) FROM users';
    expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|'), {}, capabilities).status).toBe('blocked');
  });
  it('取消后的帧建议不请求目录，也不交付迟到关键字', async () => {
    const h = await suggest('SELECT SUM(v) OVER(ROWS CUR|RENT ROW) FROM users'), load = vi.fn(), controller = new AbortController(); controller.abort();
    expect(await completionSuggestions(h.result, 'current', { load }, controller.signal)).toEqual({ items: [], incomplete: false, unavailable: false }); expect(load).not.toHaveBeenCalled();
  });
  it('帧前的限定字段继续走原来源分析，关键字不能抢占字段位置', () => {
    const marked='SELECT SUM(v) OVER(ORDER BY u.row|suffix ROWS UNBOUNDED PRECEDING) FROM users u',a=analyzeCompletion(marked.replace('|',''),marked.indexOf('|'),{},{windowFunctions:true});
    expect(a).toMatchObject({status:'ready',relations:[{name:'u',table:'users'}]});
  });
});
