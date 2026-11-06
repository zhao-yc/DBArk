import { describe, expect, it } from 'vitest';
import { postgresCountedWindow, postgresTablePageOffset, postgresTablePageSchema } from '../../src/shared/postgresTable';

describe('PostgreSQL 表页位置与计数', () => {
  it('末页、空表和因删除而越过末页的计数请求返回准确边界', () => {
    expect(postgresCountedWindow('401', 200, 0, 'last')).toEqual({ matchingRows: '401', offset: 400, expected: 1 });
    expect(postgresCountedWindow('400', 200, 0, 'last')).toEqual({ matchingRows: '400', offset: 200, expected: 200 });
    expect(postgresCountedWindow('0', 200, 400, 'count')).toEqual({ matchingRows: '0', offset: 0, expected: 0 });
    expect(postgresCountedWindow('3', 2, 8, 'count')).toEqual({ matchingRows: '3', offset: 2, expected: 1 });
  });

  it('保留超过浮点安全范围的总数，明确拒绝超出浏览范围的末页', () => {
    expect(postgresCountedWindow('9007199254740993', 200, 0, 'count')).toEqual({ matchingRows: '9007199254740993', offset: 0, expected: 201 });
    expect(() => postgresCountedWindow('9007199254740993', 200, 0, 'last')).toThrow('最大浏览偏移');
    expect(() => postgresCountedWindow(9007199254740992, 200, 0, 'count')).toThrow('计数');
  });

  it('跳页使用已应用的大小和数据库偏移边界，IPC 严格限制模式', () => {
    expect(postgresTablePageOffset('3', 200)).toBe(400);
    expect(postgresTablePageOffset('1000001', 1)).toBe(1_000_000);
    for (const raw of ['0', '3.2', '3e2', '1000002']) expect(() => postgresTablePageOffset(raw, 1)).toThrow();
    const input = { connectionId: '连接', database: '库', table: '表', tabId: '标签', offset: 0, limit: 2 };
    expect(postgresTablePageSchema.safeParse({ ...input, navigation: 'last' }).success).toBe(true);
    expect(postgresTablePageSchema.safeParse({ ...input, navigation: '自定义 SQL' }).success).toBe(false);
  });
});
