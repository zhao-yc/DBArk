type Environment = Record<string, string | undefined>;
export const selectedResultsTargetKeys = ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_SSH', 'DBARK_TEST_DATABASE', 'DBARK_TEST_CA'] as const;
const requiredKeys = selectedResultsTargetKeys.slice(0, 6);

/** 本专项只接收本轮显式RAM配置；列表和默认关闭分支不调用，不读凭据文件。 */
export function bindSelectedResultsTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const key of selectedResultsTargetKeys) {
    if (Object.hasOwn(raw, key) !== Object.hasOwn(helper, key) || raw[key] !== helper[key]
      || requiredKeys.includes(key) && (!Object.hasOwn(raw, key) || typeof raw[key] !== 'string')) throw Error('勾选行验收缺少本轮显式一致配置');
  }
  if (raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0'
    || !raw.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!)
    || ![undefined, '', '0'].includes(raw.DBARK_TEST_SSH) || raw.DBARK_TEST_DATABASE || raw.DBARK_TEST_CA) throw Error('勾选行验收仅接受200明文8.4.11专用目标且不指定数据库');
  const fixed = selectedResultsTargetKeys.map(key => ({ key, present: Object.hasOwn(raw, key), value: raw[key] }));
  const target = Object.freeze({ host: raw.DBARK_TEST_HOST, port: 13384, user: raw.DBARK_TEST_USER, password: raw.DBARK_TEST_PASSWORD!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID! });
  let changed = false;
  return { target, assertCurrent() {
    if (changed) throw Error('勾选行验收配置已变化，停链保留现场');
    const current = readRaw();
    for (const { key, present, value } of fixed) if (Object.hasOwn(current, key) !== present || Object.hasOwn(helper, key) !== present || current[key] !== value || helper[key] !== value) {
      changed = true; throw Error('勾选行验收配置已变化，停链保留现场');
    }
  } };
}
export type SelectedResultsTarget = ReturnType<typeof bindSelectedResultsTarget>;

export interface SelectedResultsOwner {
  assertCurrent(allowClosed?: boolean): void;
  closed(): boolean;
  retain(): void;
  confirmExit(): Promise<void>;
}
interface SelectedResultsTestInfo {
  readonly _startWallTime?: number;
  readonly timeout: number;
  readonly status?: string;
}

/** 专用生命周期只管理本例所有者；本地保留先落定，通知失败和迟到结果都不能重新解锁。 */
export class SelectedResultsUiLifecycle {
  readonly state = { active: true, pending: 0, retained: false, tasksVerified: false, exited: false };
  private readonly startedAt: number;
  private readonly deadline: number;
  private lastNow: number;
  private endedAt: number | undefined;
  constructor(private readonly owner: SelectedResultsOwner, private readonly info: SelectedResultsTestInfo, private readonly now: () => number = () => Date.now()) {
    // 固定框架原起点；缺少该版本TestInfo事实就拒绝运行，不能从body或helper取得新的120秒。
    this.startedAt = info._startWallTime ?? NaN;
    this.deadline = this.startedAt + 120000;
    this.lastNow = this.startedAt;
  }
  preserve(): void { if (this.state.retained) return; this.state.retained = true; try { this.owner.retain(); } catch { /* 通知失败仍保持本地停链。 */ } }
  /** 原框架失败、超时、跳过或预算变化都不可复活；时钟倒退也不能延长本例期限。 */
  private assertBudget(): void {
    const current = this.now();
    if (!Number.isFinite(this.startedAt) || this.startedAt < 0 || !Number.isFinite(this.deadline) || !Number.isFinite(current) || current < this.lastNow || current >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('勾选行验收原120秒期限或框架状态已失效');
    this.lastNow = current;
  }
  assertCurrent(allowClosed = false): void {
    try {
      if (this.state.retained) throw Error('勾选行验收已停链保留现场');
      if (!this.state.active) throw Error('勾选行验收主体活动已结束');
      this.assertBudget();
      this.owner.assertCurrent(allowClosed);
      if (!allowClosed && this.owner.closed()) throw Error('勾选行验收桌面已关闭');
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** 每次异步动作前后核对捕获句柄；afterEach超时先保留，原动作返回也不能继续。 */
  async observe<T>(action: () => Promise<T>): Promise<T> {
    this.assertCurrent(); this.state.pending++;
    try { const value = await action(); this.assertCurrent(); return value; }
    catch (reason) { this.preserve(); throw reason; }
    finally { this.state.pending--; }
  }
  /** 仅真实任务列表能证明终态；退出标志不能替代查询和文件任务的证明。 */
  async finish(readTasks: () => Promise<unknown>): Promise<void> {
    try {
      this.assertCurrent();
      if (this.state.pending) throw Error('勾选行验收仍有未结束观察');
      const tasks = await this.observe(readTasks);
      if (!Array.isArray(tasks) || tasks.some(task => !task || typeof task.id !== 'string' || typeof task.kind !== 'string' || !['completed', 'failed', 'cancelled'].includes(task.status))) throw Error('勾选行验收任务未确认终态');
      if (tasks.filter(task => task.kind === 'query.execute' && task.status === 'completed').length !== 2 || tasks.filter(task => task.kind === 'files.exportResult' && task.status === 'completed').length !== 1) throw Error('勾选行验收缺少两次查询和一次文件导出的真实终态');
      this.state.tasksVerified = true;
      this.assertCurrent(); this.state.pending++;
      try { await this.owner.confirmExit(); this.assertCurrent(true); if (!this.owner.closed()) throw Error('本例桌面退出未确认'); this.state.exited = true; }
      finally { this.state.pending--; }
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** 主体结束只记录已在原期限内完成的成功证明；失败finally不覆盖原始错误。 */
  endBody(): void {
    if (this.state.active && !this.state.retained && !this.state.pending && this.state.tasksVerified && this.state.exited) {
      try { this.assertCurrent(true); this.endedAt = this.lastNow; }
      catch { /* 原期限或归属未知已由动作门保留，不从finally覆盖首因。 */ }
    }
    this.state.active = false;
  }
  /** 超时、未结束动作或缺失退出证明均只保留现场，不退出也不删除任何资源。 */
  afterEach(): void {
    try {
      // 这里仅核此前成功结束事实，不重新开放主体动作，也不给afterEach另一次120秒预算。
      if (this.state.retained) throw Error('勾选行验收已停链保留现场');
      if (this.state.active || this.state.pending || !this.state.tasksVerified || !this.state.exited || this.endedAt === undefined || this.endedAt >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('勾选行验收主体或退出尚未确认终态');
      this.owner.assertCurrent(true);
      if (!this.owner.closed()) throw Error('勾选行验收主体或退出尚未确认终态');
    } catch (reason) { this.preserve(); throw reason; }
  }
}

export interface SelectedResultsProbe {
  connection?: unknown;
  query(sql: string): Promise<unknown>;
}
interface NativeProbe { stream?: { closed?: boolean }; end: (...args: never[]) => unknown; destroy: () => unknown; }

/** 只读身份预检，严格关闭始终绑定捕获的原生连接和原始流；从不建库、建表或DROP。 */
export async function probeSelectedResultsTarget(binding: SelectedResultsTarget, guard: () => void, connect: () => Promise<SelectedResultsProbe>, closeStrict: (native: unknown) => Promise<void>): Promise<void> {
  guard(); binding.assertCurrent();
  const observer = await connect();
  const native = observer.connection as NativeProbe | undefined, stream = native?.stream;
  if (!native || typeof native.end !== 'function' || typeof native.destroy !== 'function' || !stream
    || ['once', 'removeListener', 'destroy', 'end'].some(key => typeof (stream as Record<string, unknown>)[key] !== 'function')) throw Error('只读预检缺少可核对的原生连接和流');
  let failed = false, failure: unknown, closeFailed = false, closingFailure: unknown;
  try {
    guard(); binding.assertCurrent();
    const result = await observer.query('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid');
    guard(); binding.assertCurrent();
    const row = Array.isArray(result) && Array.isArray(result[0]) && result[0].length === 1 ? result[0][0] : undefined;
    if (!row || !/^8\.4\.11(?:$|[- ])/.test(row.version) || row.os !== 'Linux' || row.names !== 0 || row.uuid !== binding.target.uuid) throw Error('只读预检服务器身份不符');
  } catch (reason) { failed = true; failure = reason; }
  try {
    if (observer.connection !== native || native.stream !== stream) throw Error('只读预检原生连接或流已改变');
    await closeStrict(native);
    if (observer.connection !== native || native.stream !== stream || stream.closed !== true) throw Error('只读预检同流严格关闭未确认');
  } catch (reason) { closeFailed = true; closingFailure = reason; }
  if (failed && closeFailed) throw new AggregateError([failure, closingFailure], '只读预检失败且同流严格关闭未确认', { cause: failure });
  if (failed) throw failure;
  if (closeFailed) throw closingFailure;
  guard(); binding.assertCurrent();
}
