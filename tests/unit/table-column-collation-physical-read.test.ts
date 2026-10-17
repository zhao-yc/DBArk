import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { readColumnCollationPhysicalFacts } from '../../src/engine/tableColumnCollationPhysicalRead';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { collationFacts } from '../fixtures/column-collation-facts';

type Step = { rows?: unknown; error?: Error; before?: () => void };
/** 仅伪造驱动事件和目录行，共用structureTaskQuery及产品读取器均真实运行；不建连。 */
function fixture() {
  const original = collationFacts(), facts = { ...original, target: { ...original.target } }, controller = new AbortController();
  const steps: Step[] = [
    { rows: [{ version: '8.4.11', os: 'Linux', lowerNames: 0 }] },
    { rows: [{ databaseName: 'ram_db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB' }] },
    { rows: [{ name: null }] },
    { rows: [{ id: '19611', name: 'ram_db/subject' }] },
  ];
  const connection = Object.assign(new EventEmitter(), { query: vi.fn() });
  const done = vi.fn(), cancelled = vi.fn(() => { if (controller.signal.aborted) throw controller.signal.reason; });
  const context = { managed: { connection, broken: false, signal: controller.signal, status: { dialect: 'mysql', version: '8.4.11' } }, checkCancelled: cancelled, report: vi.fn(), commandStarted: vi.fn(() => done) } as unknown as StructureTaskContext;
  connection.query.mockImplementation((_sql: string, callback: Function) => {
    const step = steps[connection.query.mock.calls.length - 1];
    if (!step) throw new Error('超出四条查询');
    step.before?.(); callback(step.error ?? null, step.rows, []);
  });
  return { facts, steps, connection, controller, context, done, cancelled, read: () => readColumnCollationPhysicalFacts(context, facts.target, facts.base) };
}

it('全部真实传输回调结束后才提供准确目标和原生ID，四条只读查询均有LIMIT及预算', async () => {
  const f = fixture(), result = await f.read();
  expect(result).toMatchObject({ status: 'observed', tableId: '19611', target: f.facts.target, serverIdentity: f.facts.base.identity, mapping: { version: '8.4.11', compileOs: 'linux', compileOsReported: 'Linux', lowerCaseTableNames: 0, engine: 'InnoDB', partitionName: null, nativeName: 'ram_db/subject' } });
  expect(result.bytes).toBeGreaterThan(0); expect(result.bytes).toBeLessThan(4 * 65536 + 4096);
  expect(f.connection.query).toHaveBeenCalledTimes(4); expect(f.done).toHaveBeenCalledTimes(4);
  for (const [sql] of f.connection.query.mock.calls) { expect(sql).toMatch(/^SELECT /); expect(sql).toMatch(/ LIMIT 2$/); expect(sql).not.toMatch(/SHOW GRANTS|ROUTINES|TRIGGERS|ALTER|SET SESSION/); }
  expect(f.connection.query.mock.calls[3][0]).toContain("X'72616d5f64622f7375626a656374'");
  expect(f.connection.listenerCount('error')).toBe(0); expect(f.connection.listenerCount('end')).toBe(0);
  if (result.status === 'observed') expect(Object.isFrozen(result.target) && Object.isFrozen(result.mapping)).toBe(true);
});

it.each(['8.4.12', '8.0.46', '8.4.11-commercial', '8.4.11-1', '11.4.13'])('握手准确版本%s不支持，不发送查询', async version => {
  const f = fixture(); f.context.managed.status.version = version;
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'unsupported-version' }); expect(f.connection.query).not.toHaveBeenCalled();
});
it('原快照版本或厂商不一致立即关闭', async () => {
  const f = fixture(); f.facts.base.serverVersion = '8.4.12';
  expect(await f.read()).toMatchObject({ reason: 'unsupported-version' }); expect(f.connection.query).not.toHaveBeenCalled();
  const other = fixture(); other.context.managed.status.dialect = 'mariadb';
  expect(await other.read()).toMatchObject({ reason: 'unsupported-version' }); expect(other.connection.query).not.toHaveBeenCalled();
});
it.each(['8.4.12', '8.4.11-vendor', null, 80411])('同会话VERSION回读%s不得冒充支持', async version => {
  const f = fixture(); f.steps[0].rows = [{ version, os: 'Linux', lowerNames: 0 }];
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'unsupported-version', stage: 'server' }); expect(f.connection.query).toHaveBeenCalledOnce();
});
it.each(['../subject', 'subject/name', 'subject#P#p0', 'subject`', 'subject\0', '中文', '', 'a'.repeat(65)])('不接受路径/转义/非ASCII/超长目标%j', async name => {
  const f = fixture(); f.facts.target.table = name;
  expect(await f.read()).toMatchObject({ reason: 'unsupported-target' }); expect(f.connection.query).not.toHaveBeenCalled();
});
it('原定义已指向另一表或库时抛输入错误，不运行目录SQL', async () => {
  const f = fixture(); f.facts.base.source = f.facts.base.source.replace('`subject`', '`other`');
  await expect(f.read()).rejects.toThrow('不一致'); expect(f.connection.query).not.toHaveBeenCalled();
  const other = fixture(); other.facts.base.source = other.facts.base.source.replace('`subject`', '`wrong_db`.`subject`');
  await expect(other.read()).rejects.toThrow('不一致'); expect(other.connection.query).not.toHaveBeenCalled();
});
it.each([{ os: 'Win64', lowerNames: 0 }, { os: 'Linux', lowerNames: 1 }, { os: 'Linux', lowerNames: '00' }, { os: null, lowerNames: 0 }])('未知名称映射%j关闭', async mapping => {
  const f = fixture(); f.steps[0].rows = [{ version: '8.4.11', ...mapping }];
  expect(await f.read()).toMatchObject({ reason: 'unsupported-mapping' }); expect(f.connection.query).toHaveBeenCalledOnce();
});
it('Debian Linux与目录字符串0映射保留实际观测', async () => {
  const f = fixture(); f.steps[0].rows = [{ version: '8.4.11', os: 'debian-linux-gnu', lowerNames: '0' }];
  expect(await f.read()).toMatchObject({ status: 'observed', mapping: { compileOs: 'debian-linux-gnu', compileOsReported: 'debian-linux-gnu' } });
});

it.each([
  [1, [], 'missing-table'], [1, [{ databaseName: 'ram_db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB' }, { databaseName: 'ram_db', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB' }], 'ambiguous-table'],
  [1, [{ databaseName: 'wrong', tableName: 'subject', kind: 'BASE TABLE', engine: 'InnoDB' }], 'invalid-catalog'],
  [1, [{ databaseName: 'ram_db', tableName: 'Subject', kind: 'BASE TABLE', engine: 'InnoDB' }], 'invalid-catalog'],
  [1, [{ databaseName: 'ram_db', tableName: 'subject', kind: 'VIEW', engine: null }], 'unsupported-engine'],
  [1, [{ databaseName: 'ram_db', tableName: 'subject', kind: 'BASE TABLE', engine: 'MyISAM' }], 'unsupported-engine'],
  [2, [], 'invalid-catalog'], [2, [{ name: 'p0' }], 'partitioned-table'], [2, [{ name: null }, { name: null }], 'partitioned-table'],
  [3, [], 'missing-table-id'], [3, [{ id: '1', name: 'ram_db/subject' }, { id: '2', name: 'ram_db/subject' }], 'ambiguous-table-id'],
  [3, [{ id: '1', name: 'ram_db/other' }], 'invalid-catalog'],
] as const)('目录第%s轮不完整或有歧义只能关闭：%s', async (index, rows, reason) => {
  const f = fixture(); f.steps[index].rows = rows;
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason }); expect(f.connection.query).toHaveBeenCalledTimes(index + 1);
});
it.each(['0', '01', '-1', '1.0', '1e4', '18446744073709551616', 19611, null, true])('TABLE_ID必须是准确正整数十进制uint64字符串：%j', async id => {
  const f = fixture(); f.steps[3].rows = [{ id, name: 'ram_db/subject' }];
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'invalid-catalog' });
});
it('保留最大uint64原字符串，不经JS Number损失精度', async () => {
  const f = fixture(); f.steps[3].rows = [{ id: '18446744073709551615', name: 'ram_db/subject' }];
  expect(await f.read()).toMatchObject({ status: 'observed', tableId: '18446744073709551615' });
});

it.each([0, 1, 2, 3])('仅明确权限1142/1143/1227可在第%s轮降级，不产生部分observed', async index => {
  for (const errno of [1142, 1143, 1227]) {
    const f = fixture(); f.steps[index].error = Object.assign(new Error('合成权限拒绝'), { errno });
    expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'catalog-permission' }); expect(f.connection.query).toHaveBeenCalledTimes(index + 1); expect(f.done).toHaveBeenCalledTimes(index + 1);
  }
});
it.each([1045, 1054, 1146, 1205, 1213, 2006, 2013, 2055, undefined])('认证/断线/未知驱动错误%s原样抛出', async errno => {
  const f = fixture(), error = Object.assign(new Error('合成原始错误'), { errno }); f.steps[2].error = error;
  await expect(f.read()).rejects.toBe(error); expect(f.connection.query).toHaveBeenCalledTimes(3); expect(f.done).toHaveBeenCalledTimes(3);
});
it.each(['fatal', 'broken'] as const)('%s即使带权限errno也不得降级，并保留原驱动错误', async kind => {
  const f = fixture(), error = Object.assign(new Error('原始终态'), { errno: 1142, fatal: kind === 'fatal' });
  f.steps[1] = { error, before: () => { if (kind === 'broken') f.context.managed.broken = true; } };
  await expect(f.read()).rejects.toBe(error); expect(f.connection.query).toHaveBeenCalledTimes(2);
});
it('abort先于权限回调时保留共用查询中止错误，不由晚到权限错误降级', async () => {
  const f = fixture(), error = Object.assign(new Error('晚到权限错误'), { errno: 1142 });
  f.steps[1] = { error, before: () => f.controller.abort(error) };
  await expect(f.read()).rejects.toThrow('本地结构连接已中止'); expect(f.done).toHaveBeenCalledTimes(2); expect(f.connection.query).toHaveBeenCalledTimes(2);
});
it('权限回调先结束、随后abort时仍保留原驱动错误', async () => {
  const f = fixture(), error = Object.assign(new Error('先到权限错误'), { errno: 1142 });
  f.connection.query.mockImplementation((_sql: string, callback: Function) => { callback(error); f.controller.abort(new Error('稍后取消')); });
  await expect(f.read()).rejects.toBe(error); expect(f.done).toHaveBeenCalledOnce();
});
it('开始前取消和末回调后取消均不得观察成功', async () => {
  const f = fixture(), error = new Error('取消原件'); f.controller.abort(error);
  await expect(f.read()).rejects.toBe(error); expect(f.connection.query).not.toHaveBeenCalled();
  const last = fixture(); last.steps[3].before = () => { queueMicrotask(() => last.controller.abort(error)); };
  await expect(last.read()).rejects.toBe(error); expect(last.done).toHaveBeenCalledTimes(4);
});
it('驱动end和error事件走共用命令终态，晚回调不得恢复observed', async () => {
  for (const event of ['end', 'error']) {
    const f = fixture(), error = new Error('合成断流'); let late: Function = () => undefined;
    f.connection.query.mockImplementation((_sql: string, callback: Function) => { late = callback; if (event === 'error') f.connection.emit(event, error); else f.connection.emit(event); });
    const pending = f.read(); await expect(pending).rejects.toThrow(event === 'error' ? '合成断流' : '断开');
    late(null, f.steps[0].rows, []); expect(f.done).toHaveBeenCalledOnce(); expect(f.connection.query).toHaveBeenCalledOnce(); expect(f.connection.listenerCount('end')).toBe(0);
  }
});
it('末次成功回调中的broken或握手漂移不能返回observed', async () => {
  const f = fixture(); f.steps[3].before = () => { f.context.managed.broken = true; };
  await expect(f.read()).rejects.toThrow('断开');
  const other = fixture(); other.steps[3].before = () => { other.context.managed.status.version = '8.4.12'; };
  expect(await other.read()).toMatchObject({ reason: 'unsupported-version' });
});

it.each(['getter', 'proxy', 'toJSON', 'extra-id'] as const)('拒绝输入%s且不执行钩子/查询', async kind => {
  const f = fixture(), hook = vi.fn(() => 'subject');
  if (kind === 'getter') Object.defineProperty(f.facts.target, 'table', { enumerable: true, get: hook });
  if (kind === 'proxy') f.facts.target = new Proxy(f.facts.target, { get: hook, ownKeys: () => { hook(); return []; } });
  if (kind === 'toJSON') Object.assign(f.facts.target, { toJSON: hook });
  if (kind === 'extra-id') Object.assign(f.facts.target, { tableId: '19611' });
  await expect(f.read()).rejects.toThrow(); expect(hook).not.toHaveBeenCalled(); expect(f.connection.query).not.toHaveBeenCalled();
});
it('待回调期间调用方改目标不改变已固定SQL和输出', async () => {
  const f = fixture(); f.steps[0].before = () => { f.facts.target.database = 'changed'; f.facts.target.table = 'other'; };
  const result = await f.read(); expect(result).toMatchObject({ status: 'observed', target: { database: 'ram_db', table: 'subject' } });
  expect(f.connection.query.mock.calls[1][0]).toContain("X'72616d5f6462'");
});
it.each(['getter', 'proxy', 'toJSON', 'array-extra', 'sparse', 'three', 'wrong-shape'] as const)('目录%s不执行钩子、不产生部分事实', async kind => {
  const f = fixture(), hook = vi.fn(() => '19611');
  const row = { id: '19611', name: 'ram_db/subject' };
  if (kind === 'getter') Object.defineProperty(row, 'id', { enumerable: true, get: hook });
  f.steps[3].rows = kind === 'proxy' ? new Proxy([row], { get: hook }) : kind === 'array-extra' ? Object.assign([row], { extra: true }) : kind === 'sparse' ? new Array(1) : kind === 'three' ? [row, row, row] : kind === 'wrong-shape' ? { rows: [row] } : [kind === 'toJSON' ? Object.assign(row, { toJSON: hook }) : row];
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'invalid-catalog' }); expect(hook).not.toHaveBeenCalled();
});
it.each(['raw', 'escaped'] as const)('第一个结果超过64KiB的%s数据必须提前关闭', async kind => {
  const f = fixture(); f.steps[0].rows = [{ version: '8.4.11', os: kind === 'raw' ? '中'.repeat(22000) : '\u0001'.repeat(12000), lowerNames: 0 }];
  expect(await f.read()).toMatchObject({ status: 'unavailable', reason: 'catalog-budget' }); expect(f.connection.query).toHaveBeenCalledOnce();
});
