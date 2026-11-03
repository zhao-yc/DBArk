import { expect, it, vi } from 'vitest';
import type { SqlSnippet } from '../../src/shared/contracts';
import { createSnippetCatalog, matchSnippetPrefix, snippetAtStatementStart, snippetPrefix } from '../../src/renderer/snippetCompletion';

const item = (name: string, group = ''): SqlSnippet => ({ id: name + group, name, group, sql: "SELECT '${name}'\n  ;", description: '', updatedAt: '' });

it('片段前缀支持 Unicode，仅在独立语句中替换完整名称前缀', () => {
  expect(snippetPrefix('SELECT 1;  临时')).toBe('临时');
  expect(snippetPrefix('临')).toBeUndefined();
  expect(snippetPrefix('alias.临时')).toBeUndefined();
  expect(snippetPrefix('SELECT 临时')).toBeUndefined();
  for (const dialect of ['mysql', 'mariadb', 'sqlite'] as const) {
    const source = 'SELECT 1;\r\n  临时';
    expect(snippetAtStatementStart(source, source.length, '临时', dialect)).toBe(true);
    for (const text of ["SELECT '值\n临时", '-- 注释\n/* 临时', 'SELECT 临时', '临时名称']) {
      expect(snippetAtStatementStart(text, text.indexOf('临时') + 2, '临时', dialect)).toBe(false);
    }
  }
  expect(snippetAtStatementStart('--临时', 4, '临时', 'sqlite')).toBe(false);
  expect(snippetAtStatementStart('DELIMITER //\n临时', 15, '临时', 'mysql')).toBe(true);
});

it('名称按前缀匹配，精确名优先，同名分组和原始正文保持', () => {
  const rows = [item('ReportLong'), item('Report', '甲'), item('Report', '乙'), item('OtherReport')];
  expect(matchSnippetPrefix(rows, 'rePORT', 'mysql')).toEqual([rows[1], rows[2], rows[0]]);
  expect(matchSnippetPrefix(rows, '按条件', 'mysql')).toHaveLength(1);
  expect(matchSnippetPrefix(rows, '按条件', 'sqlite')).toEqual([]);
  expect(matchSnippetPrefix(Array.from({ length: 25 }, (_, i) => item('Report' + i)), 're', 'mysql')).toHaveLength(20);
});

it('共享在途读取，失效后的迟到结果不能覆盖新片段，失败可重试', async () => {
  let finish!: (rows: SqlSnippet[]) => void;
  const read = vi.fn<() => Promise<SqlSnippet[]>>()
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce([item('new')])
    .mockRejectedValueOnce(Error('本地读取失败'))
    .mockResolvedValueOnce([item('retry')]);
  const cache = createSnippetCatalog(read);
  const previous = cache.list();
  expect(cache.list()).toBe(previous);
  cache.invalidate();
  await expect(cache.list()).resolves.toEqual([item('new')]);
  finish([item('old')]);
  await expect(previous).resolves.toBeUndefined();
  await expect(cache.list()).resolves.toEqual([item('new')]);
  cache.invalidate();
  await expect(cache.list()).resolves.toBeUndefined();
  await expect(cache.list()).resolves.toEqual([item('retry')]);
});
