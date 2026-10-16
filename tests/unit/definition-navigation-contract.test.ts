import { describe, expect, it } from 'vitest';
import { definitionNavigationResultSchema, definitionSearchOpenSchema, definitionNavigationLimits as limits, definitionTextWithinBudget, validateDefinitionNavigationResult } from '../../src/shared/definitionNavigation';
import { structureSearchLimits, type StructureSearchInput } from '../../src/shared/databaseSearch';
import { StructureSearches } from '../../src/engine/structureSearch';

const ready = () => ({ digest: 'a'.repeat(64), status: 'ready', ranges: [{ offset: 2, length: 2 }, { offset: 5, length: 2 }], limitReached: false });
describe('定义位置共享严格契约', () => {
  it('完整原文预算按UTF8计算且不替换孤立代理项，Unicode码点与UTF16位置各自保真', () => {
    expect(definitionTextWithinBudget('x'.repeat(limits.sourceBytes))).toBe(true); expect(definitionTextWithinBudget('x'.repeat(limits.sourceBytes + 1))).toBe(false);
    expect(definitionTextWithinBudget('中'.repeat(700000))).toBe(false); expect(definitionTextWithinBudget('😀\r\n标记')).toBe(true);
    for (const sql of ['\ud800', '\udc00', 'x\ud800y']) expect(definitionTextWithinBudget(sql)).toBe(false);
  });
  it.each(['digest', 'extra', 'span-extra', 'negative', 'fraction', 'overflow', 'order', 'overlap', 'empty', 'too-many', 'zero', 'fake-cap', 'unknown-status', 'unknown-reason'])('%s输入被共享校验拒绝', kind => {
    const value: Record<string, any> = ready();
    if (kind === 'digest') value.digest = 'not-sha'; if (kind === 'extra') value.sql = '不允许夹带正文'; if (kind === 'span-extra') value.ranges[0].line = 1; if (kind === 'negative') value.ranges[0].offset = -1; if (kind === 'fraction') value.ranges[0].offset = 0.5;
    if (kind === 'overflow') value.ranges[1] = { offset: limits.sourceBytes, length: 1 }; if (kind === 'order') value.ranges.reverse(); if (kind === 'overlap') value.ranges[1].offset = 3; if (kind === 'empty') value.ranges = []; if (kind === 'zero') value.ranges[0].length = 0;
    if (kind === 'too-many') value.ranges = Array.from({ length: 201 }, (_, offset) => ({ offset, length: 1 })); if (kind === 'fake-cap') value.limitReached = true; if (kind === 'unknown-status') value.status = 'guessed'; if (kind === 'unknown-reason') { delete value.ranges; delete value.limitReached; value.status = 'unavailable'; value.reason = 'guess'; }
    expect(definitionNavigationResultSchema.safeParse(value).success).toBe(false);
  });
  it('与实际原文再次校验，范围不能越界或拆代理对；CRLF内部留给真实模型整组拒绝', () => {
    expect(() => validateDefinitionNavigationResult(ready(), '短')).toThrow();
    expect(() => validateDefinitionNavigationResult({ ...ready(), ranges: [{ offset: 1, length: 1 }] }, '😀标记')).toThrow('代理对');
    expect(validateDefinitionNavigationResult({ ...ready(), ranges: [{ offset: 0, length: 2 }] }, '😀标记')).toMatchObject({ ranges: [{ offset: 0, length: 2 }] });
  });
  it('对象来源严格绑定六类对象及规范修订，拒绝未知字段、SQL和越界版本', () => {
    const input = { connectionId: 'c', connectionVersion: 1, database: 'db', name: 'n', kind: 'table', invalidated: false, result: ready() };
    expect(definitionSearchOpenSchema.parse(input)).toEqual(input);
    for (const patch of [{ connectionVersion: -1 }, { connectionVersion: 1.5 }, { connectionVersion: Number.MAX_SAFE_INTEGER + 1 }, { kind: 'column' }, { sql: 'DROP TABLE n' }, { unknown: true }, { result: { ...ready(), extra: true } }]) expect(definitionSearchOpenSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('200处与全部摘要、长中文对象名及续页元数据一起核算，仍在128KiB内', () => {
    const ranges = Array.from({ length: 200 }, (_, index) => ({ offset: 1000000 + index * 4000, length: 3000 })), navigation = { digest: 'a'.repeat(64), status: 'ready', ranges, limitReached: true };
    expect(definitionNavigationResultSchema.safeParse(navigation).success).toBe(true); expect(Buffer.byteLength(JSON.stringify(navigation))).toBeLessThan(limits.payloadBytes);
    const page = { hits: Array.from({ length: 10 }, (_, index) => ({ database: '库'.repeat(64), kind: 'procedure', object: '名'.repeat(62) + String(index).padStart(2, '0'), name: '名'.repeat(62) + String(index).padStart(2, '0'), parentKind: 'procedure', matchedIn: 'definition', definitionCharacters: 2097152, definitionNavigation: navigation })), failures: [], totalHits: 1000, completedScopes: 192, scopeCount: 192, limitReached: false, stoppedOnError: false, scannedDefinitions: 1000, cursor: '00000000-0000-4000-8000-000000000001', expiresAt: '2026-10-16T00:00:00.000Z' };
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(structureSearchLimits.pageBytes);
  });
  it('外层加入游标后超预算也拒绝并清理句柄，不把元数据排除在正文预算外', async () => {
    const searches = new StructureSearches(), input: StructureSearchInput = { connectionId: 'c', taskId: '00000000-0000-4000-8000-000000000001', databases: ['db'], kinds: ['table'], pattern: { mode: 'contains', text: 'x', caseSensitive: true }, maxResults: 1000, onError: 'stop', searchIn: 'definition' };
    const page = { hits: [], failures: [{ database: 'db', kind: 'table' as const, message: '' }], totalHits: 0, completedScopes: 0, scopeCount: 1, limitReached: false, stoppedOnError: false };
    page.failures[0].message = 'x'.repeat(structureSearchLimits.pageBytes - Buffer.byteLength(JSON.stringify(page)) - 10);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(structureSearchLimits.pageBytes);
    await expect(searches.start(input, async () => page as never)).rejects.toThrow('元数据');
    expect((searches as unknown as { cursors: Map<string, unknown> }).cursors.size).toBe(0);
  });
});
