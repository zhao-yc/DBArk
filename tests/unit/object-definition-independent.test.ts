import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
const ports = vi.hoisted(() => ({ create: vi.fn() }));
// 只替换驱动传输端口，实际connect、资源账本、严格关闭和任务准入均运行产品实现。
vi.mock('mysql2', async () => { const original = await vi.importActual<any>('mysql2'); return { ...original, default: { ...original.default, createConnection: ports.create } }; });
import { Engine } from '../../src/engine';

const profile: NetworkConnectionProfile = { id: 'definition-read', name: '内存定义短读', group: '', color: '', dialect: 'mariadb', host: 'never-connect.invalid', port: 1, user: '内存' };
const request = { connectionId: profile.id, database: '明确库', table: '目标表', taskId: 'object-definition:短读' };
beforeEach(() => ports.create.mockReset());
afterEach(() => vi.useRealTimers());

/** 原命令end、QUIT回调、写入排空和流close独立控制，不能用其中之一替代其余物理证据。 */
function driver(threadId: number, closeOnDestroy = true) {
  let ended!: () => void, queried!: () => void, flush: (() => void) | undefined;
  const endSeen = new Promise<void>(resolve => { ended = resolve; }), querySeen = new Promise<void>(resolve => { queried = resolve; });
  const stream = Object.assign(new EventEmitter(), { closed: false, end: vi.fn(), destroy: vi.fn() });
  const close = () => { if (!stream.closed) { stream.closed = true; stream.emit('close'); } };
  stream.end.mockImplementation((done: () => void) => { flush = done; ended(); });
  stream.destroy.mockImplementation(() => { if (closeOnDestroy) close(); });
  const ddlQuery = new EventEmitter();
  const native = Object.assign(new EventEmitter(), { stream, threadId, connect: vi.fn((done: () => void) => done()), query: vi.fn(), execute: vi.fn(), end: vi.fn((done: () => void) => done()), destroy: vi.fn(() => stream.destroy()) });
  native.query.mockImplementation((sql: string | { sql: string }, done?: (error: null, rows: unknown, fields: unknown[]) => void) => {
    if (typeof sql !== 'string') { queried(); return ddlQuery; }
    const rows = sql.startsWith('SELECT VERSION') ? [{ version: '11.4.1-MariaDB', sqlMode: '', currentDatabase: null, identifierCase: 0 }] : sql.includes('lower_case_table_names') ? [{ mode: 0 }] : { affectedRows: 0 };
    done!(null, rows, []);
  });
  ports.create.mockReturnValueOnce(native);
  return { native, stream, ddlQuery, endSeen, querySeen, close, flushOnly: () => { const done = flush; flush = undefined; done?.(); }, finish: () => { const done = flush; flush = undefined; done?.(); close(); }, reply: () => { ddlQuery.emit('fields', [{ name: 'Table' }, { name: 'Create Table' }]); ddlQuery.emit('result', ['目标表', 'CREATE TABLE `目标表` (`列` INT)']); ddlQuery.emit('end'); } };
}

it('无会话要求明确库且不猜保存profile默认库，不新建用户查询session', async () => {
  const engine = new Engine();
  await expect(engine.handle('query.objectDefinition', { connectionId: profile.id, table: request.table, taskId: request.taskId, profile: { ...profile, database: '不能猜' } })).rejects.toThrow('必须明确数据库');
  expect(ports.create).not.toHaveBeenCalled(); expect(Reflect.get(engine, 'sessions').size).toBe(0);
});

it('保存配置注入的短读等原流关闭才交付，响应不夹带profile且不创建查询会话', async () => {
  const f = driver(51), engine = new Engine(); let settled = false;
  const pending = engine.handle('query.objectDefinition', { ...request, profile }).then(value => { settled = true; return value; });
  await f.querySeen; f.reply(); await f.endSeen;
  expect(settled).toBe(false); expect(f.native.end).toHaveBeenCalledOnce(); expect(Reflect.get(engine, 'independentResources').owns(request.taskId)).toBe(true);
  expect(Reflect.get(engine, 'sessions').size).toBe(0); f.finish();
  expect(await pending).toMatchObject({ request, database: request.database, ddl: 'CREATE TABLE `目标表` (`列` INT)' });
  expect(Reflect.get(engine, 'objectDefinitions').size).toBe(0);
});

it('两个关闭间隙的短读仍占满用途槽位，拒绝第三个网络分配', async () => {
  const a = driver(52), b = driver(53), engine = new Engine();
  const first = engine.handle('query.objectDefinition', { ...request, profile });
  const second = engine.handle('query.objectDefinition', { ...request, profile, taskId: 'object-definition:第二' });
  await Promise.all([a.querySeen, b.querySeen]); a.reply(); b.reply(); await Promise.all([a.endSeen, b.endSeen]);
  await expect(engine.handle('query.objectDefinition', { ...request, profile, taskId: 'object-definition:第三' })).rejects.toThrow('并发上限');
  expect(ports.create).toHaveBeenCalledTimes(2); a.finish(); b.finish(); await Promise.all([first, second]);
});

it('关闭超时不释放旧用途槽位，不返回DDL或自动重放', async () => {
  vi.useFakeTimers(); const a = driver(54, false), b = driver(55, false), engine = new Engine();
  const first = engine.handle('query.objectDefinition', { ...request, profile }), firstFailure = expect(first).rejects.toThrow('物理终态尚未确认');
  const second = engine.handle('query.objectDefinition', { ...request, profile, taskId: 'object-definition:第二' }), secondFailure = expect(second).rejects.toThrow('物理终态尚未确认');
  await Promise.all([a.querySeen, b.querySeen]); a.reply(); b.reply(); await Promise.all([a.endSeen, b.endSeen]); a.flushOnly(); b.flushOnly();
  await vi.advanceTimersByTimeAsync(1001); await Promise.all([firstFailure, secondFailure]);
  expect(Reflect.get(engine, 'objectDefinitions').size).toBe(2);
  await expect(engine.handle('query.objectDefinition', { ...request, profile, taskId: 'object-definition:第三' })).rejects.toThrow('并发上限');
  expect(ports.create).toHaveBeenCalledTimes(2); expect(a.native.query.mock.calls.filter(([value]) => typeof value !== 'string')).toHaveLength(1);
});
