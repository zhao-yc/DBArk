import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

type Environment = Record<string, string | undefined>;
export const batchDuplicateTargetKeys = [
  'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID',
  'DBARK_BATCH_DUPLICATE_DATABASE', 'DBARK_BATCH_DUPLICATE_TABLE', 'DBARK_BATCH_DUPLICATE_DDL_SHA256', 'DBARK_BATCH_DUPLICATE_ROWS_SHA256',
  'DBARK_TEST_DATABASE', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'DBARK_DEV_URL', 'DBARK_EXECUTABLE_PATH',
  'DBARK_BATCH_DUPLICATE_EXE_SHA256', 'DBARK_BATCH_DUPLICATE_ASAR_SHA256',
] as const;
const required = batchDuplicateTargetKeys.slice(0, 10);
const hash = /^[a-f0-9]{64}$/;

/** 仅接收本轮自有RAM参数；缺值、访问器、原型回填及旧.env均不构成授权。 */
function valueOf(environment: Environment, key: string): string | undefined {
  const property = Object.getOwnPropertyDescriptor(environment, key);
  if (!property) return undefined;
  if (!Object.hasOwn(property, 'value') || typeof property.value !== 'string') throw Error('批量复制参数必须为自有字符串');
  return property.value;
}
/** 精确绑定既有测试库表；执行中观察过的漂移永久失效，不改变原共享目标绑定器。 */
export function bindBatchDuplicateTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  const fixed = batchDuplicateTargetKeys.map(key => {
    const present = Object.hasOwn(raw, key), value = valueOf(raw, key);
    if (present !== Object.hasOwn(helper, key) || value !== valueOf(helper, key) || required.includes(key) && !present) throw Error('批量复制缺少本轮显式一致参数');
    return { key, present, value };
  });
  const take = (key: typeof batchDuplicateTargetKeys[number]) => fixed.find(item => item.key === key)!.value;
  if (take('DBARK_TEST_HOST') !== '192.168.31.200' || take('DBARK_TEST_PORT') !== '13384' || take('DBARK_TEST_TLS') !== '0'
    || !take('DBARK_TEST_USER') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(take('DBARK_TEST_EXPECTED_SERVER_UUID')!)
    || !/^dbark_[a-z0-9_]{1,58}$/.test(take('DBARK_BATCH_DUPLICATE_DATABASE')!) || !/^[a-z][a-z0-9_]{0,63}$/.test(take('DBARK_BATCH_DUPLICATE_TABLE')!)
    || !hash.test(take('DBARK_BATCH_DUPLICATE_DDL_SHA256')!) || !hash.test(take('DBARK_BATCH_DUPLICATE_ROWS_SHA256')!)
    || take('DBARK_TEST_DATABASE') || ![undefined, '', '0'].includes(take('DBARK_TEST_SSH')) || take('DBARK_TEST_CA') || Object.hasOwn(raw, 'DBARK_DEV_URL')) throw Error('批量复制仅允许准确200明文目标及明确既有隔离表');
  const executable = take('DBARK_EXECUTABLE_PATH');
  if (executable !== undefined ? !isAbsolute(executable) || !hash.test(take('DBARK_BATCH_DUPLICATE_EXE_SHA256') ?? '') || !hash.test(take('DBARK_BATCH_DUPLICATE_ASAR_SHA256') ?? '')
    : take('DBARK_BATCH_DUPLICATE_EXE_SHA256') !== undefined || take('DBARK_BATCH_DUPLICATE_ASAR_SHA256') !== undefined) throw Error('批量复制安装字节身份缺失或源模式混入安装摘要');
  const target = Object.freeze({ host: '192.168.31.200', port: 13384, user: take('DBARK_TEST_USER')!, password: take('DBARK_TEST_PASSWORD')!, uuid: take('DBARK_TEST_EXPECTED_SERVER_UUID')!, database: take('DBARK_BATCH_DUPLICATE_DATABASE')!, table: take('DBARK_BATCH_DUPLICATE_TABLE')!, ddlHash: take('DBARK_BATCH_DUPLICATE_DDL_SHA256')!, rowsHash: take('DBARK_BATCH_DUPLICATE_ROWS_SHA256')!, executable, exeHash: take('DBARK_BATCH_DUPLICATE_EXE_SHA256'), asarHash: take('DBARK_BATCH_DUPLICATE_ASAR_SHA256') });
  let changed = false;
  return { target, assertCurrent() {
    if (changed) throw Error('批量复制参数已变化，永久保留现场');
    try {
      const current = readRaw();
      for (const entry of fixed) if (Object.hasOwn(current, entry.key) !== entry.present || Object.hasOwn(helper, entry.key) !== entry.present || valueOf(current, entry.key) !== entry.value || valueOf(helper, entry.key) !== entry.value) throw Error('漂移');
    } catch { changed = true; throw Error('批量复制参数已变化，永久保留现场'); }
  } };
}
export type BatchDuplicateTarget = ReturnType<typeof bindBatchDuplicateTarget>;
/** 资源定义用原文字节；行快照按固定SELECT列序的JSON编码，不改写数值/JSON字段。 */
export function batchDuplicateDigest(value: string | unknown[]): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

interface Owner { assertCurrent(allowClosed?: boolean): void; closed(): boolean; retain(): void; confirmExit(): Promise<void>; }
interface Info { readonly _startWallTime?: number; readonly timeout: number; readonly status?: string; }
/** 每例启动准备从同一TestInfo原起点计时，目录晚回包和通知失败不能复活。 */
export class BatchDuplicatePreparation {
  private readonly start: number; private last: number; private retained = false;
  constructor(private readonly info: Info, private readonly now = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.last = this.start; }
  preserve(): void { this.retained = true; }
  assertCurrent(): void {
    try {
      const current = this.now();
      if (this.retained || !Number.isFinite(this.start) || this.start < 0 || this.info._startWallTime !== this.start || !Number.isFinite(current) || current < this.last || current >= this.start + 120000 || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('批量复制启动准备的原TestInfo或期限失效');
      this.last = current;
    } catch (reason) { this.retained = true; throw reason; }
  }
}
/** 独立生命周期沿TestInfo原起点；不借用要求2查询/1导出的旧finish合同。 */
export class BatchDuplicateLifecycle {
  private active = true; private retained = false; private pending = 0; private factsVerified = false; private exited = false; private ended = false;
  private readonly start: number; private last: number; private finishing = false;
  constructor(private readonly owner: Owner, private readonly info: Info, private readonly now = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.last = this.start; }
  /** 本地先锁定，即使共享保留通知抛错，迟到操作也不能继续。 */
  preserve(): void { if (this.retained) return; this.retained = true; try { this.owner.retain(); } catch { /* 保留原失败，通知失败不解锁。 */ } }
  /** 主体结束后仍核同一原起点和单调时钟；不能借afterEach重新建立期限。 */
  private assertDeadline(): void {
    const current = this.now();
    if (!Number.isFinite(this.start) || this.start < 0 || this.info._startWallTime !== this.start || !Number.isFinite(current) || current < this.last || current >= this.start + 120000 || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('批量复制原期限或框架状态失效');
    this.last = current;
  }
  assertCurrent(allowClosed = false): void {
    try {
      if (this.retained || !this.active) throw Error('批量复制主体已失效或保留');
      this.assertDeadline(); this.owner.assertCurrent(allowClosed);
      if (!allowClosed && this.owner.closed()) throw Error('批量复制所属桌面已关闭');
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** 包围每次真实UI/只读观察await；失败或afterEach超时后的回包都不得再被接纳。 */
  async observe<T>(operation: () => Promise<T>): Promise<T> {
    this.assertCurrent(); this.pending++;
    try { const result = await operation(); this.assertCurrent(); return result; }
    catch (reason) { this.preserve(); throw reason; } finally { this.pending--; }
  }
  /** 必须先完成服务器定义/行保持和原流严格关闭，再允许正常退出。 */
  markReadOnlyVerified(): void { this.assertCurrent(); if (this.pending) { this.preserve(); throw Error('批量复制观察仍在途'); } this.factsVerified = true; }
  async finish(readTasks: () => Promise<unknown>): Promise<void> {
    this.assertCurrent();
    if (this.finishing || this.pending || !this.factsVerified) { this.preserve(); throw Error('批量复制缺少只读后核或存在在途操作'); }
    this.finishing = true;
    try {
      const tasks = await this.observe(readTasks);
      // 独立新配置没有用户SQL/写入/文件任务。空列表不用于声称隐藏读取为零。
      if (!Array.isArray(tasks) || tasks.length !== 0) throw Error('批量复制出现意外持久任务；不退出或清理');
      this.assertCurrent(); this.pending++;
      try { await this.owner.confirmExit(); this.assertCurrent(true); if (!this.owner.closed()) throw Error('批量复制真实退出未确认'); this.exited = true; }
      finally { this.pending--; }
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** 主体只记录此前收尾完成；afterEach不再发退出、清理或延长期限。 */
  endBody(): void { if (!this.retained && this.factsVerified && this.exited && !this.pending) { try { this.assertCurrent(true); this.ended = true; } catch { /* 原保留原因不变。 */ } } this.active = false; }
  afterEach(): void {
    try { if (this.retained || this.active || this.pending || !this.ended || !this.exited) throw Error('批量复制主体或收尾未确认'); this.assertDeadline(); this.owner.assertCurrent(true); if (!this.owner.closed()) throw Error('批量复制退出证明缺失'); this.assertDeadline(); }
    catch (reason) { this.preserve(); throw reason; }
  }
}
