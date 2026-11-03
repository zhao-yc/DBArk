import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { objectDefinitionSql, readObjectDefinition } from '../../src/engine/objectDefinition';
import type { ManagedConnection } from '../../src/engine/connection';
import { SessionObjects } from '../../src/engine/sessionObjects';
import { objectDefinitionLimits } from '../../src/shared/objectDefinition';

const input = { connectionId: '连接', sessionId: '原会话', table: '表', taskId: 'object-definition:测试' };

/** 仅替换mysql2传输事件；引擎的会话互斥、任务登记及预算检查均保留真实实现。 */
function fixture() {
  const queries: EventEmitter[] = [];
  const native = Object.assign(new EventEmitter(), { query: vi.fn(() => { const query = new EventEmitter(); queries.push(query); return query; }) });
  const managed = { connection: native, profile: { id: input.connectionId }, status: { dialect: 'mysql', version: '8.4.1' }, broken: false, serverStatus: 1, transactionStateKnown: true, completionDatabase: { known: true, database: '可靠库' }, sessionObjects: new SessionObjects(0), close: vi.fn() } as unknown as ManagedConnection;
  const control = { start: vi.fn(), check: vi.fn(), finish: vi.fn(async () => {}) };
  /** 显式交付完整驱动行和end，测试不会把Promise结算当物理终态。 */
  function row(index: number, ddl = 'CREATE TABLE `表` (`列` INT)', kind = 'Table') {
    queries[index].emit('fields', [{ name: kind }, { name: 'Create ' + kind }]); queries[index].emit('result', ['表', ddl]);
  }
  return { managed, native, queries, control, row };
}

describe('MySQL对象定义原会话只读', () => {
  it('单段编码引用名称，不允许输入改变固定SHOW语句', () => {
    expect(objectDefinitionSql('库.名', '表`; DROP TABLE x; --')).toBe('SHOW CREATE TABLE `库.名`.`表``; DROP TABLE x; --`');
  });
  it.each([
    ['CREATE TABLE `表` (`列` INT)', 'Table', 'table', false],
    ['CREATE TEMPORARY TABLE `表` (`列` INT)', 'Table', 'table', true],
    ['CREATE ALGORITHM=UNDEFINED VIEW `表` AS select 1', 'View', 'view', false],
  ])('按真实SHOW识别表、视图及临时遮蔽：%s', async (ddl, field, kind, temporary) => {
    const f = fixture(); const pending = readObjectDefinition(f.managed, input, '可靠库', f.control);
    let settled = false; void pending.then(() => { settled = true; }); f.row(0, ddl as string, field as string); await Promise.resolve();
    expect(settled).toBe(false); expect(f.control.finish).not.toHaveBeenCalled(); f.queries[0].emit('end');
    expect(await pending).toMatchObject({ request: input, database: '可靠库', name: '表', kind, temporary, ddl });
    expect(f.native.query).toHaveBeenCalledExactlyOnceWith({ sql: 'SHOW CREATE TABLE `可靠库`.`表`', rowsAsArray: true });
    expect(f.managed.serverStatus).toBe(1); expect(f.managed.close).not.toHaveBeenCalled();
  });
  it('第二行及超限内容失败也等真实end，不交付部分定义', async () => {
    for (const oversized of [false, true]) {
      const f = fixture(), pending = readObjectDefinition(f.managed, input, '库', f.control), failure = expect(pending).rejects.toThrow();
      f.row(0, oversized ? 'CREATE TABLE t ' + 'a'.repeat(objectDefinitionLimits.rowBytes) : undefined);
      if (!oversized) f.queries[0].emit('result', ['表', 'CREATE TABLE second(a INT)']);
      expect(f.control.finish).not.toHaveBeenCalled(); f.queries[0].emit('end'); await failure;
    }
  });
  it('原会话精确归属、忙碌、断线及未知默认库拒绝，绝不退到其它连接', async () => {
    const f = fixture(), engine = new Engine(), session = { id: input.sessionId, connectionId: input.connectionId, managed: f.managed, busy: false };
    Reflect.get(engine, 'sessions').set(input.sessionId, session);
    await expect(engine.handle('query.objectDefinition', { ...input, connectionId: '其它连接' })).rejects.toThrow('原会话');
    session.busy = true; await expect(engine.handle('query.objectDefinition', input)).rejects.toThrow('正在执行'); session.busy = false;
    f.managed.broken = true; await expect(engine.handle('query.objectDefinition', input)).rejects.toThrow('已断开'); f.managed.broken = false;
    f.managed.completionDatabase!.known = false; await expect(engine.handle('query.objectDefinition', input)).rejects.toThrow('未确认');
    expect(f.native.query).not.toHaveBeenCalled();
  });
  it('只在原查询默认库读取，保持事务，两个在途读取占槽到原end', async () => {
    const engine = new Engine(), a = fixture(), b = fixture();
    Reflect.get(engine, 'sessions').set('原会话', { id: '原会话', connectionId: input.connectionId, managed: a.managed, busy: false });
    Reflect.get(engine, 'sessions').set('第二会话', { id: '第二会话', connectionId: input.connectionId, managed: b.managed, busy: false });
    const first = engine.handle('query.objectDefinition', input), second = engine.handle('query.objectDefinition', { ...input, sessionId: '第二会话', taskId: 'object-definition:第二' });
    await expect(engine.handle('query.objectDefinition', { ...input, sessionId: '不存在', taskId: 'object-definition:第三' })).rejects.toThrow('并发上限');
    a.row(0, 'CREATE TEMPORARY TABLE `表` (`列` INT)'); b.row(0); a.queries[0].emit('end'); b.queries[0].emit('end');
    expect((await first).temporary).toBe(true); await second;
    expect(a.managed.serverStatus).toBe(1); expect(b.managed.serverStatus).toBe(1);
    expect(Reflect.get(engine, 'objectDefinitions').size).toBe(0);
  });
});
