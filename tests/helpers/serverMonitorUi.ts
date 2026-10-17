type Environment = Record<string, string | undefined>;
export const serverMonitorUiKeys = ['DBARK_INTEGRATION_ENABLED','DBARK_S02_SERVER_MONITOR_UI_TEST','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_TLS','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_TEST_SSH','DBARK_TEST_DATABASE','DBARK_TEST_CA'] as const;

/** 默认/列表不调用本门；只接受同一轮raw/helper显式RAM配置，不读取文件或补造认证。 */
export function bindServerMonitorUiTarget(readRaw: () => Environment, helper: Environment) {
  const raw = readRaw();
  for (const [index, key] of serverMonitorUiKeys.entries()) if (Object.hasOwn(raw,key) !== Object.hasOwn(helper,key) || raw[key] !== helper[key] || index < 8 && (!Object.hasOwn(raw,key) || typeof raw[key] !== 'string')) throw Error('S02验收缺少本轮显式一致配置');
  if (raw.DBARK_INTEGRATION_ENABLED !== '1' || raw.DBARK_S02_SERVER_MONITOR_UI_TEST !== '1' || raw.DBARK_TEST_HOST !== '192.168.31.200' || raw.DBARK_TEST_PORT !== '13384' || raw.DBARK_TEST_TLS !== '0' || !raw.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(raw.DBARK_TEST_EXPECTED_SERVER_UUID!) || ![undefined,'','0'].includes(raw.DBARK_TEST_SSH) || raw.DBARK_TEST_DATABASE || raw.DBARK_TEST_CA) throw Error('S02验收仅允许200/13384明文准确目标，不指定数据库或SSH/TLS');
  const fixed = serverMonitorUiKeys.map(key => ({ key, present: Object.hasOwn(raw,key), value: raw[key] })); let invalid = false;
  return { target: Object.freeze({ host: raw.DBARK_TEST_HOST, port: 13384, user: raw.DBARK_TEST_USER, password: raw.DBARK_TEST_PASSWORD!, uuid: raw.DBARK_TEST_EXPECTED_SERVER_UUID! }),
    assertCurrent() { const current = readRaw(); if (invalid || fixed.some(({key,present,value}) => Object.hasOwn(current,key) !== present || Object.hasOwn(helper,key) !== present || current[key] !== value || helper[key] !== value)) { invalid = true; throw Error('S02验收配置已变化，永久停链'); } } };
}
export type ServerMonitorUiTarget = ReturnType<typeof bindServerMonitorUiTarget>;
export interface ServerMonitorUiInfo { readonly _startWallTime?: number; readonly timeout: number; readonly status?: string; }
export interface ServerMonitorUiOwner { check(allowClosed: boolean): void; closed(): boolean; retain(): void; exit(): Promise<void>; }

/** 真实任务列表必须只有本例两条成功只读监控；不同任务号不是取消ACK或空会话的替代证据。 */
export function serverMonitorUiTaskIds(tasks: unknown, expected: 1 | 2): string[] {
  if (!Array.isArray(tasks) || tasks.length !== expected || tasks.some(task => !task || typeof task.id !== 'string' || !task.id || task.kind !== 'serverMonitor.read' || task.status !== 'completed') || new Set(tasks.map(task => task.id)).size !== expected) throw Error('S02本例监控任务未确认准确完成');
  return tasks.map(task => task.id);
}
/** 只读身份结果不能代替连接/资源终态；仅为正式UI前的准确服务器准备门。 */
export function assertServerMonitorUiIdentity(result: unknown, uuid: string): void {
  const row = Array.isArray(result) && Array.isArray(result[0]) && result[0].length === 1 ? result[0][0] : undefined;
  if (!row || typeof row.version !== 'string' || !/^8\.4\.11(?:$|[- ])/.test(row.version) || row.os !== 'Linux' || String(row.names) !== '0' || row.uuid !== uuid) throw Error('S02只读预检服务器身份不符');
}

/** 只管理原TestInfo/原窗口；保留本地锁先落定，通知throw/noop也不能恢复退出权限。 */
export class ServerMonitorUiLifetime {
  readonly state = { active: true, pending: 0, retained: false, tasksChecked: false, windowClosed: false, observerClosed: false };
  private readonly start: number;
  private readonly deadline: number;
  private last: number;
  private ended?: number;
  constructor(private readonly owner: ServerMonitorUiOwner, private readonly info: ServerMonitorUiInfo, private readonly now: () => number = () => Date.now()) { this.start = info._startWallTime ?? NaN; this.deadline = this.start + 120000; this.last = this.start; }
  preserve(): void { if (this.state.retained) return; this.state.retained = true; try { this.owner.retain(); } catch { /* 本地永久锁优先于共享通知，不覆盖原失败。 */ } }
  /** 不从helper启动重计时；预算变化、原框架终态和时钟倒退均停止。 */
  check(allowClosed = false): void {
    try { const now = this.now(); if (this.state.retained || !this.state.active || !Number.isFinite(this.start) || this.start < 0 || !Number.isFinite(now) || now < this.last || now >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed') throw Error('S02本例已停链或原120秒期限失效'); this.last = now; this.owner.check(allowClosed); if (!allowClosed && this.owner.closed()) throw Error('S02本例窗口已关闭'); }
    catch (reason) { this.preserve(); throw reason; }
  }
  /** 动作前后核同一owner；未知保留原错误与句柄，不自动重试或退出。 */
  async observe<T>(action: () => Promise<T>, allowClosed = false): Promise<T> { this.check(allowClosed); this.state.pending++; try { const result = await action(); this.check(allowClosed); return result; } catch (reason) { this.preserve(); throw reason; } finally { this.state.pending--; } }
  /** 原生严格关闭也不得借独立超时越过原期限。 */
  remaining(maximum: number): number { this.check(true); return Math.max(1,Math.min(maximum,this.deadline-this.last)); }
  /** 仅在任务、窗口和原观察流都确定时完成；失败不进入finally补清理。 */
  async finish(readTasks: () => Promise<unknown>, closeObserver: () => Promise<void>): Promise<void> {
    try {
      this.check(); if (this.state.pending) throw Error('S02仍有未结束动作'); serverMonitorUiTaskIds(await this.observe(readTasks),2); this.state.tasksChecked = true;
      await this.observe(() => this.owner.exit(),true); if (!this.owner.closed()) throw Error('S02原窗口退出未确认'); this.state.windowClosed = true;
      await this.observe(closeObserver,true); this.state.observerClosed = true;
    } catch (reason) { this.preserve(); throw reason; }
  }
  /** finally只关闭活动门，不执行退出、原生关闭或目录清理。 */
  endBody(): void { if (!this.state.retained && this.state.pending === 0 && this.state.tasksChecked && this.state.windowClosed && this.state.observerClosed) { try { this.check(true); this.ended = this.last; } catch { /* 原失败由动作门保留。 */ } } this.state.active = false; }
  /** 超时/仍活动先保留；正常afterEach只核原期限内已完成事实，不重新开放动作。 */
  afterEach(): void {
    try { if (this.state.retained || this.state.active || this.state.pending || this.ended === undefined || this.ended >= this.deadline || this.info.timeout !== 120000 || this.info.status !== 'passed' || !this.state.tasksChecked || !this.state.windowClosed || !this.state.observerClosed) throw Error('S02本例收尾未确认，保留所属资源'); this.owner.check(true); if (!this.owner.closed()) throw Error('S02原窗口close事实失效'); }
    catch (reason) { this.preserve(); throw reason; }
  }
}

export interface ServerMonitorObserver { connection?: unknown; }
/** Promise end不是关闭证明；严格函数必须处理捕获原native并确认同一stream的close终态。 */
export async function closeServerMonitorObserver(raw: ServerMonitorObserver, native: any, stream: any, check: () => void, closeStrict: (native: any) => Promise<void>): Promise<void> {
  check(); if (!native || raw.connection !== native || !stream || native.stream !== stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || ['once','removeListener','end','destroy'].some(key => typeof stream[key] !== 'function')) throw Error('S02观察连接原生归属未知');
  await closeStrict(native); check(); if (raw.connection !== native || native.stream !== stream || stream.closed !== true) throw Error('S02观察连接同流严格关闭未确认');
}

/** 仅序列化到本例Electron主进程：共享退出助手的自动答案只能返回工作台，不能强制退出未知资源。 */
export function guardServerMonitorExitAnswers(_electron?: unknown): void {
  const root = globalThis as unknown as Record<string,unknown>, key = '__dbarkE2EDialogs', descriptor = Object.getOwnPropertyDescriptor(root,key);
  if (descriptor && (!descriptor.configurable || descriptor.get || descriptor.set)) throw Error('S02退出答案归属未知');
  const safe = (value: unknown) => { const record = value as { answers?: unknown; calls?: unknown }; if (!record || !Array.isArray(record.answers) || !Array.isArray(record.calls)) throw Error('S02退出答案形状未知'); return { ...record, answers: record.answers.map(() => 0) }; };
  let current = safe(descriptor?.value ?? { answers:[], calls:[] });
  Object.defineProperty(root,key,{configurable:true,enumerable:true,get:()=>current,set:(value:unknown)=>{current=safe(value);}});
}
