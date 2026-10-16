import { describe, expect, it, vi } from 'vitest';
import { analyzeCompletion } from '../../src/shared/completionAnalysis';
import { completionSuggestions } from '../../src/renderer/completionSuggestions';

const prefix = 'SELECT SUM(u.id) OVER(base ORDER BY u.va|suffix) FROM db.users u WINDOW ';
/** 用真实分析及建议管道核对完整语法，目录端口只提供可观察的固定字段。 */
function directory() { return { load: vi.fn(async () => ({ entries: [{ name: 'value_col', kind: 'column' as const }], incomplete: false })) }; }

describe('Q01继承窗口的完整列表和PARTITION表达式', () => {
  it.each([
    'base AS(),',
    'base AS() other AS()',
    'base AS(PARTITION BY u.id,)',
    'base AS(), /* 等待下一定义 */',
    'base AS(),other AS(),',
    'base AS() unrelated',
    'base AS() ORDER BY u.id +',
    'base AS(PARTITION BY ,u.id)',
    'base AS(PARTITION BY u.id,,u.other)',
    'base AS(PARTITION BY u.id +)',
    'base AS(PARTITION BY -)',
    'base AS(PARTITION BY ())',
    'base AS(PARTITION BY COALESCE(u.id,))',
    'base AS(PARTITION BY CASE WHEN u.id > 0 THEN END)',
    'base AS(PARTITION BY u.id u.other)',
    'base AS(),other AS(base ORDER BY u.id,)',
    'base AS(),other AS(base ORDER BY u.id) third AS()',
  ])('不完整列表、后继或表达式必须停止且零目录：%s', async tail => {
    const marked = prefix + tail, analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')), port = directory();
    if (analysis.status === 'ready') await completionSuggestions(analysis, 'db', port);
    expect(analysis.status).toBe('blocked'); expect(port.load).not.toHaveBeenCalled();
  });
  it.each(['u.id', 'u.id,u.other', '(u.id + 1)', 'COALESCE(u.id,0)', 'CASE WHEN u.id IS NULL THEN 0 ELSE u.id END', 'CAST(u.id AS SIGNED)', 'u.rows'])('完整PARTITION表达式仍沿用当前来源：%s', async expression => {
    const marked = prefix + `base AS(PARTITION BY ${expression})`, analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')), port = directory();
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    const result = await completionSuggestions(analysis, 'db', port);
    expect(result.items.some(item => item.insertText === '`value_col`')).toBe(true); expect(port.load).toHaveBeenCalledOnce();
  });
  it.each(['', ' ORDER BY u.id', ' LIMIT 5', ' ORDER BY u.id LIMIT 5'])('合法列表后继保留补全：%s', async tail => {
    const marked = prefix + 'base AS(),other AS(base)' + tail, analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')), port = directory();
    expect(analysis.status).toBe('ready'); if (analysis.status !== 'ready') return;
    expect((await completionSuggestions(analysis, 'db', port)).items.some(item => item.label === 'value_col')).toBe(true);
  });
  it('完整校验仅看当前查询分支，合法内层和UNION分支不携带外部语法片段', async () => {
    for (const marked of [
      'SELECT * FROM (' + prefix + 'base AS())d',
      prefix + 'base AS() UNION ALL SELECT 1',
      'SELECT 1 UNION ALL ' + prefix + 'base AS()',
      'WITH q AS(SELECT 1) ' + prefix + 'base AS()',
    ]) {
      const analysis = analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')); expect(analysis.status).toBe('ready');
      if (analysis.status === 'ready') expect((await completionSuggestions(analysis, 'db', directory())).items.some(item => item.label === 'value_col')).toBe(true);
    }
  });
  it('校验失败沿用静默解析，不把未知正文或错误内容输出console', () => {
    const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    try { const marked = prefix + 'base AS(PARTITION BY COALESCE(u.id,))'; expect(analyzeCompletion(marked.replace('|', ''), marked.indexOf('|')).status).toBe('blocked'); for (const spy of spies) expect(spy).not.toHaveBeenCalled(); }
    finally { for (const spy of spies) spy.mockRestore(); }
  });
});
