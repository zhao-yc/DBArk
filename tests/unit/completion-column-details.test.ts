import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { copyCompletionColumnDetails, completionDetailLimits } from '../../src/shared/completionColumnDetails';
import { validateCommand } from '../../src/shared/validation';
import type { ManagedConnection } from '../../src/engine/connection';
vi.mock('../../src/engine/connection', () => ({ execute: vi.fn() }));
import { execute } from '../../src/engine/connection';
import { completionMetadata } from '../../src/engine/completionMetadata';
import { CompletionDirectory } from '../../src/renderer/completionDirectory';

const details = { type: 'decimal(30,20)', nullable: false, defaultValue: '0.12345678901234567890', extra: '', comment: '<img src=x> [执行](command:danger)' };
const row = { name: 'amount', kind: 'column', dataType: 'decimal', columnType: details.type, isNullable: 'NO', defaultValue: details.defaultValue, extra: details.extra, comment: details.comment };
beforeEach(() => vi.resetAllMocks());

describe('按需字段完整属性与已有补全隔离', () => {
  it('只在columns接受details=true，普通补全和临时目录形状仍兼容', () => {
    const input = { kind: 'columns', connectionId: 'c', taskId: 't', database: 'db', table: 'users', prefix: 'amount', details: true };
    expect(validateCommand('metadata.completion', input)).toEqual(input);
    expect(validateCommand('query.temporaryCompletion', { sessionId: 's', kind: 'columns', database: 'db', table: 'users', prefix: 'amount', details: true })).toMatchObject({ details: true });
    for (const extra of [{ details: false }, { details: 'true' }, { details: null }, { details: true, sql: 'SELECT 1' }, { details: true, sessionId: 's' }]) expect(() => validateCommand('metadata.completion', { ...input, ...extra })).toThrow();
    expect(() => validateCommand('metadata.completion', { kind: 'databases', connectionId: 'c', taskId: 't', prefix: '', details: true })).toThrow();
  });
  it('固定参数精确读取字段、限制两行及每个文本，不发送用户SQL', async () => {
    vi.mocked(execute).mockResolvedValueOnce({ rows: [{ mode: 0 }], fields: [] }).mockResolvedValueOnce({ rows: [row], fields: [] });
    const control = { checkCancelled: vi.fn(), commandStarted: vi.fn(() => vi.fn()) }, prefix = "a' OR 1=1 --";
    const result = await completionMetadata({ connection: new EventEmitter() } as ManagedConnection, { kind: 'columns', connectionId: 'c', taskId: 't', database: 'db', table: 'users', prefix, details: true }, control);
    expect(result.entries[0].details).toEqual(details); expect(result.entries[0].visible).toBe(true); expect(result.incomplete).toBe(false);
    const call = vi.mocked(execute).mock.lastCall!; expect(call[1]).toContain('COLUMN_NAME = ?'); expect(call[1]).toContain('LIMIT 2'); expect(call[1]).toContain('LEFT(COLUMN_TYPE,4097)'); expect(call[1]).not.toContain(prefix); expect(call[1]).not.toContain('SHOW CREATE'); expect(call[2]).toEqual(['db', 'users', prefix]);
    expect(control.commandStarted).toHaveBeenCalledTimes(2); for (const result of control.commandStarted.mock.results) expect(result.value).toHaveBeenCalledTimes(1);
  });
  it('两条匹配明确标不完整，非法或被截断属性不能作为完整信息交付', async () => {
    const managed = { connection: new EventEmitter() } as ManagedConnection, input = { kind: 'columns' as const, connectionId: 'c', taskId: 't', database: 'db', table: 'users', prefix: 'amount', details: true as const }, control = { checkCancelled() {}, commandStarted: () => () => {} };
    vi.mocked(execute).mockResolvedValueOnce({ rows: [{ mode: 0 }], fields: [] }).mockResolvedValueOnce({ rows: [row, { ...row, name: 'Amount' }], fields: [] }); expect((await completionMetadata(managed, input, control)).incomplete).toBe(true);
    for (const bad of [{ ...row, comment: 'x'.repeat(completionDetailLimits.comment + 1) }, { ...row, columnType: 'x'.repeat(completionDetailLimits.type + 1) }, { ...row, isNullable: null }, { ...row, defaultValue: undefined }]) {
      vi.mocked(execute).mockResolvedValueOnce({ rows: [{ mode: 0 }], fields: [] }).mockResolvedValueOnce({ rows: [bad], fields: [] }); await expect(completionMetadata(managed, input, control)).rejects.toThrow();
    }
  });
  it('详情缓存与普通目录不混用，副本不能改缓存，未知编码和形状拒绝', async () => {
    let id = 0; const request = vi.fn(async (input: any) => ({ entries: [{ name: 'amount', kind: 'column' as const, ...(input.details ? { details, visible: true } : { dataType: 'decimal' }) }], incomplete: false }));
    const directory = new CompletionDirectory('c', 1, { request, cancel: async () => {}, id: () => String(++id) }), query = { kind: 'columns' as const, database: 'db', table: 'users', prefix: 'amount' };
    await directory.load(query); const first = await directory.load({ ...query, details: true }); first.entries[0].details!.comment = '改写'; expect((await directory.load({ ...query, details: true })).entries[0].details!.comment).toBe(details.comment); expect(request).toHaveBeenCalledTimes(2); expect((await directory.load(query)).entries[0].details).toBeUndefined(); directory.dispose();
    for (const value of [{ ...details, nullable: 'NO' }, { ...details, type: '' }, { ...details, defaultValue: '\ud800' }, { ...details, comment: '\0' }, { ...details, sql: 'SELECT 1' }]) expect(() => copyCompletionColumnDetails(value)).toThrow();
    const inherited = Object.assign(Object.create({ type: 'int' }), { nullable: false, defaultValue: null, extra: '', comment: '', other: true }); expect(() => copyCompletionColumnDetails(inherited)).toThrow();
  });
});
