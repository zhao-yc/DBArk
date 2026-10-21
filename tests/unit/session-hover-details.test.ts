import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readSessionObject } from '../../src/engine/sessionObjectRead';
import { SessionObjects } from '../../src/engine/sessionObjects';
import type { ManagedConnection } from '../../src/engine/connection';

const details = { type: 'decimal(30,20)', nullable: false, defaultValue: '0.12345678901234567890', extra: '', comment: '会话字段' };

describe('显式临时结构读取的详情与补全预算', () => {
  it.each([false, true])('原生字段协议读取后只在显式请求提供完整属性，超限%s保留摘要', async overflow => {
    const catalog = new SessionObjects(0), connection = new EventEmitter() as EventEmitter & { query: Function };
    connection.query = vi.fn(({ sql }) => {
      const query = new EventEmitter(); queueMicrotask(() => {
        if (sql.startsWith('SHOW CREATE')) { query.emit('fields', [{ name: 'Create Table' }]); query.emit('result', ['CREATE TEMPORARY TABLE users(amount DECIMAL(30,20))']); }
        else { query.emit('fields', ['Field','Type','Null','Default','Extra','Comment'].map(name => ({ name }))); query.emit('result', ['amount', details.type, 'NO', overflow ? 'x'.repeat(4097) : details.defaultValue, '', details.comment]); }
        query.emit('end');
      }); return query;
    });
    const managed = { connection, sessionObjects: catalog, status: { dialect: 'mysql', version: '5.7.44' } } as unknown as ManagedConnection, control = { start: vi.fn(), check: vi.fn(), finish: vi.fn(async () => {}) };
    const result = await readSessionObject(managed, { database: 'db', table: 'users' }, control); expect(result).toMatchObject({ temporary: true, columns: 1, complete: true });
    const query = { kind: 'columns' as const, database: 'db', table: 'users', prefix: 'amount' };
    expect(catalog.completion(query).entries[0].details).toBeUndefined(); expect(catalog.completion({ ...query, details: true }).entries[0].details).toEqual(overflow ? undefined : details); expect(catalog.completion(query).entries[0].dataType).toBe('decimal'); expect(control.start).toHaveBeenCalledTimes(2); expect(control.finish).toHaveBeenCalledTimes(2);
  });
  it('可选详情预算满后丢详情但保留两表全部已确认字段', () => {
    const catalog = new SessionObjects(0), columns = Array.from({ length: 200 }, (_, index) => ({ name: 'c' + index, dataType: 'decimal', visible: true, details: { ...details, defaultValue: 'x'.repeat(4096), comment: 'y'.repeat(2048) } }));
    catalog.confirm('db', 'a', columns); catalog.confirm('db', 'b', columns);
    for (const table of ['a','b']) { const output = catalog.completion({ kind: 'columns', database: 'db', table, prefix: '' }); expect(output.entries).toHaveLength(200); expect(output.incomplete).toBe(false); expect(catalog.completion({ kind: 'columns', database: 'db', table, prefix: 'c0', details: true }).entries[0].details).toBeUndefined(); }
  });
});
