import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { assertFixedPrefixBudgetPreview, assertFixedPrefixBudgetSubParts, assertFixedPrefixModes, assertPrefixReleased, bindFixedPrefixTarget, finishFixedPrefix, fixedPrefixOwner, isPrefixDuplicate, watchPrefixConnection } from '../helpers/indexFixedPrefixCore';

/** 合成配置全部在RAM；不读取环境、证书、驱动或正式入口。 */
function configuration(port = '13384') {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_INDEX_FIXED_PREFIX_CORE: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: port, DBARK_TEST_TLS: port === '13484' ? '1' : '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-2222-4333-8444-555555555555', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-host', DBARK_TEST_EXPECTED_SERVER_ID: '123', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_CA: 'X:/synthetic/ca.pem' };
}
/** 同一真实旁观函数的RAM端口，Query对象和回调上下文可独立检查。 */
function harness() {
  const time = { now: 0 }, owner = fixedPrefixOwner('owner', () => time.now, 30000), stream = Object.assign(new EventEmitter(), { closed: false }), returned = {}, callbacks: Function[] = [], argsSeen: unknown[][] = [];
  const native = { threadId: 17, stream, query(...args: unknown[]) { argsSeen.push(args); callbacks.push(args.at(-1) as Function); return returned; } };
  const close = vi.fn(async (_options?: { strict?: boolean }) => { stream.closed = true; stream.emit('close'); });
  const managed = { connection: native, profile: { id: 'profile' }, close }, fact = watchPrefixConnection(managed, owner, 'task', 'profile', '`db`.`t`');
  return { time, owner, stream, native, returned, callbacks, argsSeen, close, managed, fact };
}
const duplicate = { errno: 1062, code: 'ER_DUP_ENTRY', sqlState: '23000' };

describe('三个前缀核心case的准确目标及真透传资源证据', () => {
  it.each(['13357', '13380', '13384', '13310', '13311', '13484'])('准确端口%s只选一个版本并要求显式认证', port => {
    const raw = configuration(port); expect(bindFixedPrefixTarget(() => raw).target.port).toBe(Number(port));
    const missing = { ...raw } as Record<string, string | undefined>; delete missing.DBARK_TEST_PASSWORD; expect(() => bindFixedPrefixTarget(() => missing)).toThrow('显式配置');
  });
  it('未知端口、TLS降级和继承认证均拒绝，身份恢复后不能重绑', () => {
    expect(() => bindFixedPrefixTarget(() => configuration('13385'))).toThrow('端口');
    const tls = configuration('13484'); tls.DBARK_TEST_TLS = '0'; expect(() => bindFixedPrefixTarget(() => tls)).toThrow('TLS');
    expect(() => bindFixedPrefixTarget(() => Object.create(configuration()))).toThrow('显式配置');
    const raw = configuration(), binding = bindFixedPrefixTarget(() => raw); raw.DBARK_TEST_USER = 'changed'; expect(() => binding.assertCurrent()).toThrow(); raw.DBARK_TEST_USER = 'synthetic'; expect(() => binding.assertCurrent()).toThrow('已变化');
  });
  it('保留原Query对象、sql参数和回调this/全部参数，只旁观不造回包', async () => {
    const f = harness(), callback = vi.fn(), receiver = {}, rows = [{ actual: true }], fields = [{}];
    expect(f.native.query('ALTER TABLE `db`.`t` ADD KEY `i` (`c`(2))', callback)).toBe(f.returned); expect(f.fact.pending).toBe(1); expect(f.argsSeen[0][0]).toBe('ALTER TABLE `db`.`t` ADD KEY `i` (`c`(2))');
    f.callbacks[0].call(receiver, null, rows, fields); expect(callback.mock.instances[0]).toBe(receiver); expect(callback).toHaveBeenCalledWith(null, rows, fields); expect(f.fact.pending).toBe(0); expect(f.fact.alters).toBe(1);
    await f.managed.close({ strict: true }); expect(f.close).toHaveBeenCalledWith({ strict: true }); expect(() => assertPrefixReleased([f.fact], f.owner, 'task', true)).not.toThrow();
  });
  it('真实回调1062原样到达调用者；没有同流close证据仍不可清理', () => {
    const f = harness(), callback = vi.fn(); f.native.query('ALTER TABLE `db`.`t` ADD UNIQUE KEY `u` (`c`(1))', callback); f.callbacks[0](duplicate);
    expect(callback).toHaveBeenCalledWith(duplicate); expect(f.fact.alterErrors).toEqual([duplicate]); expect(isPrefixDuplicate(duplicate)).toBe(true);
    expect(() => assertPrefixReleased([f.fact], f.owner, 'task', true)).toThrow('关闭未确认'); expect(f.owner.state.retained).toBe(true);
    for (const value of [{ errno: 1062 }, { ...duplicate, code: 'UNKNOWN' }, { ...duplicate, sqlState: 'HY000' }, Error('1062')]) expect(isPrefixDuplicate(value)).toBe(false);
  });
  it('其它目标ALTER在原查询发送前停链，不把错误目标计为本例成功', () => {
    const f = harness(); expect(() => f.native.query('ALTER TABLE `other`.`t` ADD KEY `i` (`c`)', vi.fn())).toThrow('其它目标'); expect(f.argsSeen).toEqual([]); expect(f.fact.alters).toBe(0); expect(f.owner.state.retained).toBe(true);
  });
  it('profile-open原非strict end先返回时，旁观仍等待同一close事件而不升级产品调用', async () => {
    const f = harness(); f.close.mockResolvedValueOnce(undefined); await f.managed.close();
    let observed = false; const waiting = f.fact.closeEvent.then(() => { observed = true; }); await Promise.resolve(); expect(observed).toBe(false); expect(f.close).toHaveBeenCalledWith(undefined);
    f.stream.closed = true; f.stream.emit('close'); await waiting; expect(observed).toBe(true); expect(() => assertPrefixReleased([f.fact], f.owner, 'task', false)).not.toThrow();
  });
  it('迟到connect的native仍可被捕获，但sticky后不准发任何新查询', () => {
    const f = harness(); f.owner.stop(); const close = vi.fn(async () => {}), native = { threadId: 18, stream: Object.assign(new EventEmitter(), { closed: false }), query: vi.fn() };
    const arrived = watchPrefixConnection({ connection: native, profile: { id: 'profile' }, close }, f.owner, 'late', 'profile', '`db`.`t`');
    expect(arrived.native).toBe(native); expect(arrived.ownerId).toBe(f.owner.id); expect(() => native.query('SELECT 1', vi.fn())).toThrow('停链'); expect(close).not.toHaveBeenCalled(); expect(arrived.pending).toBe(0);
  });
  it('Engine保留原1062也不能遮住close拒绝，即使底层流已close仍停链', async () => {
    const f = harness(), closeFailure = Error('合成strict close失败'); f.close.mockImplementationOnce(async () => { f.stream.closed = true; f.stream.emit('close'); throw closeFailure; });
    await expect(f.managed.close({ strict: true })).rejects.toBe(closeFailure);
    expect(isPrefixDuplicate(duplicate)).toBe(true); expect(() => assertPrefixReleased([f.fact], f.owner, 'task', true)).toThrow(); expect(f.fact.closeFailed).toBe(true);
  });
  it.each(['另一owner', '另一task', '替换native', '替换stream', '仅end', '非strict', 'pending'])('%s不能冒充准确任务的严格释放', async change => {
    const f = harness(); await f.managed.close({ strict: true });
    if (change === '另一owner') f.fact.ownerId = 'other'; if (change === '另一task') f.fact.taskId = 'other'; if (change === '替换native') f.managed.connection = { ...f.native }; if (change === '替换stream') f.native.stream = Object.assign(new EventEmitter(), { closed: true }); if (change === '仅end') f.fact.sawClose = false; if (change === '非strict') f.fact.strict = false; if (change === 'pending') f.fact.pending = 1;
    expect(() => assertPrefixReleased([f.fact], f.owner, 'task', true)).toThrow();
  });
});

describe('前缀核心case原30秒活动门与精确清理顺序', () => {
  /** DROP只给RAM计数端口，不触碰文件或数据库。 */
  function cleanup() { const f = harness(), steps = { resources: vi.fn(async () => {}), closeEngine: vi.fn(async () => {}), verifyOwned: vi.fn(async () => {}), drop: vi.fn(async () => {}), absent: vi.fn(async () => {}), closeObserver: vi.fn(async () => {}), restore: vi.fn() }; return { ...f, steps }; }
  it('完整资源门通过后正常清理且各步只一次，活动门关闭', async () => {
    const f = cleanup(); await finishFixedPrefix(f.owner, f.steps); f.owner.afterEach();
    for (const step of Object.values(f.steps)) expect(step).toHaveBeenCalledTimes(1); expect(f.owner.state).toEqual({ retained: false, active: false, pending: 0 });
  });
  it('资源门发现关闭未知时，不closeAll取消、不核库、不DROP', async () => {
    const f = cleanup(); f.steps.resources.mockImplementationOnce(async () => assertPrefixReleased([f.fact], f.owner, 'task', true));
    await expect(finishFixedPrefix(f.owner, f.steps)).rejects.toThrow('关闭未确认'); expect(f.steps.closeEngine).not.toHaveBeenCalled(); expect(f.steps.verifyOwned).not.toHaveBeenCalled(); expect(f.steps.drop).not.toHaveBeenCalled();
  });
  it('afterEach先置sticky，迟到结果不会恢复许可或清理', async () => {
    const f = cleanup(); let finish!: () => void; const waiting = f.owner.run(() => new Promise<void>(resolve => { finish = resolve; })).catch(reason => reason);
    expect(() => f.owner.afterEach()).toThrow('保留现场'); expect(f.owner.state.retained).toBe(true); finish(); expect(await waiting).toBeInstanceOf(Error);
    await expect(finishFixedPrefix(f.owner, f.steps)).rejects.toThrow(); expect(f.steps.resources).not.toHaveBeenCalled();
  });
  it('原30秒之后的返回被拒绝，资源校验失败后也绝不DROP', async () => {
    const f = cleanup(); await expect(f.owner.run(async () => { f.time.now = 30000; })).rejects.toThrow('原30秒'); expect(f.owner.state.retained).toBe(true);
    const other = cleanup(); other.steps.verifyOwned.mockRejectedValueOnce(Error('合成同名资源变化')); await expect(finishFixedPrefix(other.owner, other.steps)).rejects.toThrow('同名资源'); expect(other.steps.drop).not.toHaveBeenCalled();
  });
  it('扣除Vitest开始后已用时间，缺失开始事实或改预算均不能导入实际模块', () => {
    let now = 0; const owner = fixedPrefixOwner('elapsed', () => now, 30000, 29999); now = 1; expect(() => owner.check()).toThrow('原30秒');
    for (const elapsed of [NaN, Infinity, -1, 30000]) expect(() => fixedPrefixOwner('unknown', () => 0, 30000, elapsed).check()).toThrow();
    expect(() => fixedPrefixOwner('changed', () => 0, 60000).check()).toThrow();
  });
});

describe('前缀核心入口的Maria模式及满列规范期待', () => {
  /** 明确合成SHOW INDEX目录；不导入驱动或用产品生成器反填期待。 */
  const rows = () => ['c', 'd', 'e', 'b'].map((Column_name, index) => ({ Key_name: 'budget_key', Column_name, Seq_in_index: index + 1, Sub_part: index < 3 ? null : 12 }));
  it.each(['13310', '13311'])('Maria%s已知IGNORE_SPACE可并存普通模式', port => {
    const raw = configuration(port), target = bindFixedPrefixTarget(() => raw).target;
    expect(() => assertFixedPrefixModes('IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', target.dialect)).not.toThrow();
  });
  it('未知、省略定义、组合ANSI及空项仍拒绝，不扩大MySQL模式合同', () => {
    expect(() => assertFixedPrefixModes('STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', 'mysql')).not.toThrow();
    for (const mode of ['IGNORE_SPACE,UNKNOWN', 'IGNORE_SPACE,NO_FIELD_OPTIONS', 'IGNORE_SPACE,NO_KEY_OPTIONS', 'IGNORE_SPACE,NO_TABLE_OPTIONS', 'IGNORE_SPACE,ANSI', 'IGNORE_SPACE,,STRICT_TRANS_TABLES', undefined, null]) expect(() => assertFixedPrefixModes(mode, 'mariadb')).toThrow();
    expect(() => assertFixedPrefixModes('IGNORE_SPACE', 'mysql')).toThrow();
  });
  it('满列预览只接受无长度c/d/e和BINARY(12)，不退到254或放行13', () => {
    const sql = "ALTER TABLE `db`.`t` ADD INDEX `budget_key` USING BTREE (`c` ASC, `d` ASC, `e` ASC, `b`(12) ASC) COMMENT '';";
    expect(() => assertFixedPrefixBudgetPreview(sql, '`db`.`t`')).not.toThrow();
    for (const changed of [sql.replace('`c` ASC', '`c`(255) ASC'), sql.replace('`d` ASC', '`d`(254) ASC'), sql.replace('`b`(12)', '`b`(13)'), sql.replace('`db`.`t`', '`other`.`t`'), undefined]) expect(() => assertFixedPrefixBudgetPreview(changed, '`db`.`t`')).toThrow();
  });
  it('目录接受实际SQL NULL/NULL/NULL与字节12，不把文字null或未设值当SQL NULL', () => {
    expect(() => assertFixedPrefixBudgetSubParts(rows())).not.toThrow();
    for (const index of [0, 1, 2]) for (const bad of ['null', 'NULL', undefined, 0, 255, 254]) { const changed: Record<string, unknown>[] = rows(); changed[index].Sub_part = bad; expect(() => assertFixedPrefixBudgetSubParts(changed)).toThrow('SQL NULL'); }
    const numbersAsText: Record<string, unknown>[] = rows(); numbersAsText[3].Sub_part = '12'; expect(() => assertFixedPrefixBudgetSubParts(numbersAsText)).not.toThrow();
  });
  it('缺失、继承或getter的Sub_part不可冒充NULL，且不执行getter', () => {
    for (const index of [0, 1, 2, 3]) { const changed: Record<string, unknown>[] = rows(); delete changed[index].Sub_part; expect(() => assertFixedPrefixBudgetSubParts(changed)).toThrow('SQL NULL'); }
    const inherited: Record<string, unknown>[] = rows(); const first = { ...inherited[0] }; delete first.Sub_part; inherited[0] = Object.assign(Object.create({ Sub_part: null }), first); expect(() => assertFixedPrefixBudgetSubParts(inherited)).toThrow('SQL NULL');
    let reads = 0; const accessor = rows(); Object.defineProperty(accessor[0], 'Sub_part', { get() { reads++; return null; } }); expect(() => assertFixedPrefixBudgetSubParts(accessor)).toThrow('SQL NULL'); expect(reads).toBe(0);
  });
  it('目录的b必须12，字段顺序/数量/身份也不能被归一化吞掉', () => {
    for (const bad of [null, undefined, 'null', '12.0', 13, 0]) { const changed: Record<string, unknown>[] = rows(); changed[3].Sub_part = bad; expect(() => assertFixedPrefixBudgetSubParts(changed)).toThrow('SQL NULL'); }
    const changed = rows(); changed[0].Column_name = 'other'; expect(() => assertFixedPrefixBudgetSubParts(changed)).toThrow('身份');
    expect(() => assertFixedPrefixBudgetSubParts(rows().slice(0, 3))).toThrow('数量'); expect(() => assertFixedPrefixBudgetSubParts(rows().reverse())).toThrow('顺序');
  });
});
