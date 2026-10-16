import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { definitionNavigationResult } from '../../src/engine/definitionNavigation';
import { definitionNavigationLimits } from '../../src/shared/definitionNavigation';
import type { DatabaseSearchPattern } from '../../src/shared/databaseSearchPattern';
const query = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/completionQuery', () => ({ completionQuery: query }));
import { definitionMatchQuery, readDefinitionSearchPage } from '../../src/engine/definitionSearch';
import { structureSearchLimits, type StructureSearchInput } from '../../src/shared/databaseSearch';

const pattern = (text: string, mode: DatabaseSearchPattern['mode'] = 'contains', caseSensitive = true): DatabaseSearchPattern => ({ mode, text, caseSensitive });
describe('定义正文有界位置与服务器语义边界', () => {
  it('Unicode、CRLF、百分号、下划线、反斜线按原UTF16位置保留，不转义正文或计为代码点', () => {
    const sql = "CREATE TABLE `t`(s TEXT COMMENT '😀标记%_!\\\r\n标记%_!\\')", result = definitionNavigationResult(sql, pattern('标记%_!\\'));
    expect(result).toMatchObject({ status: 'ready', digest: createHash('sha256').update(sql).digest('hex'), ranges: [{ offset: sql.indexOf('标记'), length: 6 }, { offset: sql.lastIndexOf('标记'), length: 6 }], limitReached: false });
  });
  it.each([199, 200, 201, 10000])('%s处最多保留200并额外探测一处，恰好200处不伪称截断', count => {
    const result = definitionNavigationResult('标记 '.repeat(count), pattern('标记')); expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('应有位置'); expect(result.ranges).toHaveLength(Math.min(count, 200)); expect(result.limitReached).toBe(count > 200); expect(result.ranges.at(-1)).toEqual({ offset: (Math.min(count, 200) - 1) * 3, length: 2 });
  });
  it.each(['prefix', 'whole'] as const)('%s只提供一次完整匹配，不能把同一正文中的其它位置混入', mode => {
    expect(definitionNavigationResult('x x', pattern(mode === 'whole' ? 'x x' : 'x', mode))).toMatchObject({ status: 'ready', ranges: [{ offset: 0, length: mode === 'whole' ? 3 : 1 }], limitReached: false });
    expect(definitionNavigationResult('x x', pattern('bad', mode))).toMatchObject({ status: 'unavailable', reason: 'positions-unavailable' });
  });
  it('非重叠普通文字延续保存查询策略，前后空格不修剪、不解析美元符号或反斜线', () => {
    expect(definitionNavigationResult('aaaaa', pattern('aa'))).toMatchObject({ ranges: [{ offset: 0, length: 2 }, { offset: 2, length: 2 }] });
    expect(definitionNavigationResult(' $1\\ $1\\ ', pattern(' $1\\ '))).toMatchObject({ ranges: [{ offset: 0, length: 5 }] });
  });
  it('默认大小写匹配使用同次服务器返回的LOWER，ASCII与不变中文可以无损映射', () => {
    expect(definitionNavigationResult('CREATE 表 ABC abc', pattern('AbC', 'contains', false), { navigationText: 'create 表 abc abc', navigationNeedle: 'abc' })).toMatchObject({ status: 'ready', ranges: [{ offset: 9, length: 3 }, { offset: 13, length: 3 }] });
    const q = definitionMatchQuery('CREATE 表 ABC', pattern('AbC', 'contains', false)); expect(q.sql).toContain('LOWER(definition_text) AS navigationText'); expect(q.sql).toContain('LOWER(navigation_pattern) AS navigationNeedle'); expect(q.params).toEqual(['CREATE 表 ABC', 'AbC', '%AbC%']);
    const sensitive = definitionMatchQuery('ABC', pattern('ABC')); expect(sensitive.sql).not.toContain('navigationText'); expect(sensitive.params).toEqual(['ABC', '%ABC%']);
  });
  it.each([{ navigationText: undefined, navigationNeedle: 'x' }, { navigationText: 'xy', navigationNeedle: 'x' }, { navigationText: 'y', navigationNeedle: 'x' }, { navigationText: 'x', navigationNeedle: 'XX' }])('服务器LOWER缺失/无法往返%j时无位置和计数', facts => {
    const result = definitionNavigationResult('X', pattern('x', 'contains', false), facts); expect(result).toMatchObject({ status: 'unavailable', reason: 'case-mapping' }); expect(Object.hasOwn(result, 'ranges')).toBe(false);
  });
  it('Unicode大小写变化或扩展一律明确降级，不借JavaScript猜服务器规则', () => {
    for (const [sql, folded] of [['É', 'é'], ['İ', 'i\u0307'], ['𐐀', '𐐨']]) expect(definitionNavigationResult(sql, pattern('x', 'contains', false), { navigationText: folded, navigationNeedle: 'x' })).toMatchObject({ status: 'unavailable', reason: 'case-mapping' });
  });
  it.each(['[', '(a+)+$', '(?=😀)|$', '(?<=x)y'])('服务器正则%s不在本地重跑、不伪称零处或完整计数', text => {
    const result = definitionNavigationResult('a'.repeat(20000) + '!', pattern(text, 'regexp')); expect(result).toMatchObject({ status: 'unavailable', reason: 'server-regexp' }); expect(Object.hasOwn(result, 'ranges')).toBe(false); expect(Object.hasOwn(result, 'limitReached')).toBe(false);
  });
  it('服务器判命中但普通文字未映射、空needle或超预算时不制造首处位置', () => {
    for (const result of [definitionNavigationResult('x', pattern('y')), definitionNavigationResult('x', pattern('', 'whole')), definitionNavigationResult('中'.repeat(700000), pattern('中'))]) { expect(result.status).toBe('unavailable'); expect(Object.hasOwn(result, 'ranges')).toBe(false); }
  });
});

describe('实际定义批次附加摘要与位置的纯契约', () => {
  it('十个满额对象仍小于128KiB回包；不携带定义/折叠全文，不增匹配SQL请求', async () => {
    let shown = '', next = 0; const statements: string[] = [];
    query.mockReset().mockImplementation(async (_managed, _control, sql: string, params: string[] = []) => {
      statements.push(sql);
      if (sql === 'SELECT @@SESSION.sql_mode AS mode') return { rows: [{ mode: '' }] };
      if (sql.startsWith('SET SESSION')) return { rows: [] };
      if (sql.startsWith('SELECT TABLE_NAME AS object_name')) { next++; return { rows: [{ object_name: 't' + next }, { object_name: 't' + (next + 1) }] }; }
      if (sql.startsWith('SHOW CREATE TABLE')) { shown = `CREATE TABLE \`t${next}\`(s TEXT) COMMENT='${'marker '.repeat(201)}'`; return { rows: [{ 'Create Table': shown }] }; }
      if (sql.startsWith('SELECT CHAR_LENGTH')) { expect(params[0]).toBe(shown); expect(sql).toContain('LOWER(definition_text) AS navigationText'); return { rows: [{ characters: shown.length, navigationText: shown.toLowerCase(), navigationNeedle: 'marker' }] }; }
      throw Error('未定义的测试读取');
    });
    const input: StructureSearchInput = { connectionId: 'c', taskId: '00000000-0000-4000-8000-000000000001', databases: ['db'], kinds: ['table'], pattern: pattern('marker', 'contains', false), maxResults: 1000, onError: 'stop', searchIn: 'definition' };
    const page = await readDefinitionSearchPage({ input, scope: 0, total: 0 }, { broken: false } as never, { checkCancelled() {}, commandStarted: () => () => {} });
    expect(page.hits).toHaveLength(10); expect(page.failures).toEqual([]); expect(page.hits.every(hit => hit.definitionNavigation?.status === 'ready' && hit.definitionNavigation.ranges.length === definitionNavigationLimits.matches && hit.definitionNavigation.limitReached)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(structureSearchLimits.pageBytes); expect(JSON.stringify(page)).not.toContain('CREATE TABLE'); expect(JSON.stringify(page)).not.toContain('navigationText'); expect(statements.filter(sql => sql.startsWith('SELECT CHAR_LENGTH'))).toHaveLength(10); expect(statements.some(sql => /^(ALTER|INSERT|UPDATE|DELETE|CALL|SET GLOBAL)/.test(sql))).toBe(false);
  });
});
