import { EventEmitter } from 'node:events';
import type { Client, Query } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresConnection } from '../../src/engine/postgres/connection';
import { PostgresNoticeCollector } from '../../src/engine/postgres/notices';
import { postgresNoticeHiddenMessage, postgresNoticeLimits, postgresNoticeReportSchema } from '../../src/shared/postgresNotices';

const identity = (value: string) => value;
const raw = {severity: 'WARNING', code: '01000', message: '执行提示😀', detail: '多行\n详情', hint: '检查原值', where: 'PL/pgSQL 上下文'};
const range = {start: 7, end: 38};
describe('PostgreSQL 查询消息有界副本', () => {
  it('保留真实顺序、可选字段、SQLSTATE 和定位范围，回包副本不共享对象', () => {
    const collector = new PostgresNoticeCollector(false); expect(collector.report()).toBeUndefined();
    collector.record(2, range, raw, identity); collector.record(4, undefined, {...raw, message: ''}, identity);
    const report = postgresNoticeReportSchema.parse(collector.report());
    expect(report).toMatchObject({received: 2, omitted: 0, redacted: false, truncated: false});
    expect(report.entries[0]).toMatchObject({sequence: 1, statementOrdinal: 2, severity: 'WARNING', sqlState: '01000', message: raw.message,
      detail: raw.detail, hint: raw.hint, context: raw.where, sourceRange: range});
    expect(report.entries[1]).toMatchObject({sequence: 2, statementOrdinal: 4, message: ''});
    const copy = collector.report()!; copy.entries[0].sourceRange!.start = 9; copy.entries[0].message = '修改副本';
    expect(collector.report()!.entries[0]).toMatchObject({message: raw.message, sourceRange: range});
  });
  it('参数执行不读正文或附加字段，只保留受限等级、SQLSTATE 与原范围', () => {
    const read = vi.fn(() => '私有参数值😀'), redact = vi.fn(identity), collector = new PostgresNoticeCollector(true);
    const notice = {severity: '异常私有参数值😀', code: '00000'};
    for (const name of ['message', 'detail', 'hint', 'where']) Object.defineProperty(notice, name, {get: read});
    collector.record(1, range, notice, redact);
    const report = postgresNoticeReportSchema.parse(collector.report());
    expect(report.entries[0]).toMatchObject({severity: '未知级别', sqlState: '00000', sourceRange: range, message: postgresNoticeHiddenMessage});
    expect(JSON.stringify(report)).not.toContain('私有参数值'); expect(read).not.toHaveBeenCalled(); expect(redact).not.toHaveBeenCalled();
  });
  it('先脱敏再截断，不拆开 emoji；JSON 转义与 UTF8 都计入预算', () => {
    const collector = new PostgresNoticeCollector(false), secret = '口令'.repeat(3000);
    collector.record(1, range, {...raw, message: secret + 'a'.repeat(4089) + '😀', detail: '\n'.repeat(900)}, value => value.replaceAll(secret, '已隐藏'));
    const report = postgresNoticeReportSchema.parse(collector.report()), entry = report.entries[0];
    expect(entry.message).not.toContain('口令'); expect(entry.message.startsWith('已隐藏')).toBe(true);
    expect(entry.message).not.toMatch(/[\uD800-\uDBFF]$/u); expect(entry.detail).toHaveLength(512);
    expect(entry.truncated).toBe(true); expect(report.truncated).toBe(true);
  });
  it('条数和总字节预算独立生效，达到预算后继续计数且保留首批', () => {
    const many = new PostgresNoticeCollector(false), large = new PostgresNoticeCollector(false), count = postgresNoticeLimits.entries + 15;
    for (let i = 0; i < count; i++) { many.record(1, undefined, raw, identity); large.record(1, undefined, {...raw, message: '😀'.repeat(2000), detail: 'x'.repeat(1024), hint: 'y'.repeat(1024)}, identity); }
    const first = postgresNoticeReportSchema.parse(many.report()), second = postgresNoticeReportSchema.parse(large.report());
    expect(first).toMatchObject({received: count, omitted: 15, truncated: true}); expect(first.entries).toHaveLength(200);
    expect(second.received).toBe(count); expect(second.entries.length).toBeLessThan(200); expect(second.entries.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThanOrEqual(postgresNoticeLimits.bytes);
    expect(second.omitted).toBe(count - second.entries.length);
  });
  it('无效消息和访问器被省略，严格报告拒绝重复顺序、越界范围及参数原文', () => {
    const collector = new PostgresNoticeCollector(false), getter = vi.fn(() => '恶意访问器');
    collector.record(1, range, Object.defineProperty({}, 'message', {get: getter}), identity);
    collector.record(1, range, raw, identity);
    const report = postgresNoticeReportSchema.parse(collector.report()); expect(report).toMatchObject({received: 2, omitted: 1, truncated: true});
    expect(report.entries[0].sequence).toBe(2); expect(getter).not.toHaveBeenCalled();
    for (const input of [{...report, redacted: true}, {...report, omitted: 0}, {...report, entries: [{...report.entries[0], sourceRange: {start: 9, end: 1}}]},
      {...report, received: 3, entries: [report.entries[0], report.entries[0]]}]) expect(postgresNoticeReportSchema.safeParse(input).success).toBe(false);
  });
});

/** 替换物理传输端口，使用实际 PostgresConnection.query 的监听与收尾。 */
function wireFixture(action: (query: Query, client: EventEmitter, wire: EventEmitter) => void) {
  const wire = new EventEmitter(), client = Object.assign(new EventEmitter(), {connection: wire,
    query(query: Query) { action(query, client, wire); }, getTransactionStatus: () => 'I'});
  const connection = new PostgresConnection({id: 'c', name: '隔离消息', group: '', color: '', dialect: 'postgresql', host: 'invalid', port: 1, user: 'unit', password: '合成口令'});
  connection.client = client as unknown as Client;
  return {connection, client, wire};
}
it('原查询期间才接收 Notice；ReadyForQuery 后不泄漏监听或误收通知', async () => {
  const f = wireFixture((query, client, wire) => {
    client.emit('notice', {...raw, message: '服务端合成口令'});
    client.emit('notification', {channel: '异步事件', payload: '不属于 Notice'});
    query.emit('end', {fields: [], command: 'SELECT', rowCount: 1}); wire.emit('readyForQuery');
    client.emit('notice', {...raw, message: '迟到'});
  });
  const collector = new PostgresNoticeCollector(false);
  const result = await f.connection.query('SELECT 1', undefined, {rows: 10, bytes: 1024}, undefined, undefined,
    (notice, redact) => collector.record(1, range, notice, redact));
  expect(result.postgresCommand).toBe('SELECT'); expect(collector.report()!.received).toBe(1);
  expect(collector.report()!.entries[0].message).toBe('服务端[已隐藏]'); expect(f.client.listenerCount('notice')).toBe(0);
});
it.each(['server', 'end', 'submit'] as const)('%s失败后清理监听；此前已收到的消息保持', async kind => {
  const f = wireFixture((query, client, wire) => {
    client.emit('notice', raw);
    if (kind === 'submit') throw Error('提交失败');
    if (kind === 'end') { client.emit('end'); return; }
    query.emit('error', Error('服务端失败')); wire.emit('readyForQuery');
  });
  const receive = vi.fn(); await expect(f.connection.query('SELECT 1', undefined, {rows: 1, bytes: 1024}, undefined, undefined, receive)).rejects.toThrow();
  expect(receive).toHaveBeenCalledOnce(); expect(f.client.listenerCount('notice')).toBe(0); expect(f.wire.listenerCount('readyForQuery')).toBe(0);
});
it('消息旁路失败不能中断查询；内部 SQL 默认没有监听', async () => {
  const f = wireFixture((query, client, wire) => { client.emit('notice', raw); query.emit('end', {fields: [], command: 'SHOW', rowCount: 1}); wire.emit('readyForQuery'); });
  await expect(f.connection.query('SHOW standard_conforming_strings', undefined, {rows: 1, bytes: 1024}, undefined, undefined, () => { throw Error('消息旁路失败'); })).resolves.toMatchObject({postgresCommand: 'SHOW'});
  expect(f.client.listenerCount('notice')).toBe(0);
  await expect(f.connection.query('SHOW standard_conforming_strings', undefined, {rows: 1, bytes: 1024})).resolves.toMatchObject({postgresCommand: 'SHOW'});
  expect(f.client.listenerCount('notice')).toBe(0);
});
