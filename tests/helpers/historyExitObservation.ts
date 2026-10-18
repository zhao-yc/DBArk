import type { PlaywrightWorkerOptions, TestInfo } from '@playwright/test';

export const historyExitObservationTitle = '历史真实IPC取消、切换、关闭和重启释放资源且筛选条件不写本地配置';
export const historyExitObservationLimits = { events: 96, applications: 8, attachmentMs: 1000 } as const;
type EventKind = 'observation-start' | 'application-bound' | 'quit-start' | 'close-wait-start' | 'request-app' | 'request-window' | 'request-returned' | 'request-error' | 'will-quit-marker' | 'quit-ready' | 'quit-race-returned' | 'desktop-close-enter' | 'desktop-close-returned' | 'close' | 'quit-complete' | 'quit-error' | 'dialog' | 'body-ended' | 'teardown-start' | 'teardown-complete' | 'teardown-error' | 'observation-end';
type DialogCategory = 'pending-work' | 'shutdown-error' | 'other';
interface ExitEvent { sequence: number; atMs: number; phase: 'body' | 'teardown'; kind: EventKind; application?: number; category?: DialogCategory; response?: number | null; }
let current: HistoryExitObservation | undefined;
const owners = new WeakMap<TestInfo, HistoryExitObservation>();

/** 在原资源分配前核对显式范围；默认关闭不访问用例内容，也不产生IO。 */
export function assertHistoryExitObservationScope(enabled: boolean, info: TestInfo, trace: PlaywrightWorkerOptions['trace']): void {
  if (!enabled) return;
  if (!info.file.replaceAll('\\', '/').endsWith('/tests/e2e/history-pages.spec.ts') || info.title !== historyExitObservationTitle || (typeof trace === 'object' ? trace.mode : trace) !== 'off') throw new Error('历史退出观察仅允许指定原用例且录制关闭');
}

/** 只在显式目标用例运行时建立内存记录；导入、默认及list都不创建文件或执行RPC。 */
export function beginHistoryExitObservation(enabled: boolean, info: TestInfo, trace: PlaywrightWorkerOptions['trace'], now = () => performance.now()): HistoryExitObservation | undefined {
  if (!enabled) { if (current && owners.get(info) !== current) current.retire(); return; }
  assertHistoryExitObservationScope(enabled, info, trace);
  current?.retire();
  const observation = new HistoryExitObservation(info, now); owners.set(info, observation); current = observation;
  observation.start(); return observation;
}

/** 只返回本例正在运行的记录器；调用者仍在await前捕获它，迟到回包不能改绑下一例。 */
export function currentHistoryExitObservation(): HistoryExitObservation | undefined { return current; }

/** 显式用例跨await仍按原TestInfo取记录器；找不到时不能借用当前其他用例。 */
export function historyExitObservationFor(info: TestInfo | undefined): HistoryExitObservation | undefined { return info === undefined ? current : owners.get(info); }

/** 记录既有事件及固定分类，不读取页面、进程、产品状态或任何待保存正文。 */
export class HistoryExitObservation {
  private active = true;
  private readonly applications = new WeakMap<object, number>();
  private applicationCount = 0;
  private readonly events: ExitEvent[] = [];
  private dropped = 0;
  private phase: ExitEvent['phase'] = 'body';
  private bodyEnded = false;
  private teardownCompleted: boolean | undefined;
  private readonly started: number;
  private lastMs = 0;
  /** TestInfo始终是原对象；时钟可由RAM测试注入，不启动计时器。 */
  constructor(private readonly info: TestInfo, private readonly now: () => number) { try { const value = now(); this.started = Number.isFinite(value) ? value : 0; } catch { this.started = 0; } }
  /** 归属必须同时匹配TestInfo与当前世代；旧事件只能被丢弃。 */
  private owns(): boolean { return this.active && current === this && owners.get(this.info) === this; }
  /** 所有记录字段均为枚举或有界数字，不接受原生错误、SQL、标题或路径。 */
  private record(kind: EventKind, application?: number, dialog?: { category: DialogCategory; response: number | null }): void {
    if (!this.owns()) return;
    if (this.events.length >= historyExitObservationLimits.events) { this.dropped = Math.min(1_000_000, this.dropped + 1); return; }
    let elapsed = this.lastMs;
    try { const value = this.now() - this.started; if (Number.isFinite(value)) elapsed = Math.min(1_000_000_000, Math.max(this.lastMs, Math.round(value * 10) / 10)); } catch { /* 观察时钟失败不能改变原退出链。 */ }
    this.lastMs = elapsed;
    this.events.push({ sequence: this.events.length + 1, atMs: elapsed, phase: this.phase, kind, ...(application === undefined ? {} : { application }), ...dialog });
  }
  /** 启用后才记录首事件，不在模块加载期读取时钟。 */
  start(): void { this.record('observation-start'); }
  /** 应用仅以本例递增编号表示，不记录PID、目录或调试端点。 */
  bind(application: object): void {
    if (!this.owns() || this.applications.has(application)) return;
    if (this.applicationCount >= historyExitObservationLimits.applications) { this.dropped = Math.min(1_000_000, this.dropped + 1); return; }
    const id = ++this.applicationCount; this.applications.set(application, id); this.record('application-bound', id);
  }
  /** 退出调用及console/close回调均使用捕获的记录器与应用，不向后续用例借句柄。 */
  mark(application: object, kind: EventKind): void {
    const id = this.applications.get(application); if (id !== undefined) this.record(kind, id);
  }
  /** 只观察原fixture已收到的回答；标题只用于固定类别匹配，绝不写入附件。 */
  dialog(application: object, call: { title?: string; response: number }): void {
    const id = this.applications.get(application); if (id === undefined) return;
    const category: DialogCategory = call.title === '仍有待完成的工作' ? 'pending-work' : call.title === '退出前保存或收尾失败' ? 'shutdown-error' : 'other';
    const response = Number.isSafeInteger(call.response) && call.response >= 0 && call.response <= 31 ? call.response : null;
    this.record('dialog', id, { category, response });
  }
  /** 主体结果先封边，再给原teardown独立阶段，不能把清理退出倒算成主体成功。 */
  beginTeardown(): void { if (!this.owns()) return; this.bodyEnded = true; this.record('body-ended'); this.phase = 'teardown'; this.record('teardown-start'); }
  /** 原收尾是否走完只用布尔事实，不保存原错误内容。 */
  endTeardown(completed: boolean): void { if (!this.owns()) return; this.teardownCompleted = completed; this.record(completed ? 'teardown-complete' : 'teardown-error'); }
  /** 失效仅关闭观察状态，不结束应用、不解绑产品事件、不产生清理或重试。 */
  retire(): void { this.active = false; if (current === this) current = undefined; }
  /** 只附加冻结的有界JSON；附件失败不能覆盖原用例或原收尾错误。 */
  async finish(): Promise<void> {
    if (!this.owns()) return;
    this.record('observation-end');
    const body = Buffer.from(JSON.stringify({ version: 1, scope: 'history-pages-exit', limits: historyExitObservationLimits, coverage: { willQuit: 'existing-console-marker', dialog: 'existing-fixture-console-answer', persistStateRequest: 'not-covered', settingsSaveAck: 'not-covered', recording: 'off' }, phases: { bodyEnded: this.bodyEnded, teardownStarted: this.phase === 'teardown', teardownCompleted: this.teardownCompleted ?? null }, applications: this.applicationCount, dropped: this.dropped, events: this.events }));
    this.retire();
    let timer: ReturnType<typeof setTimeout> | undefined, attached = false;
    try {
      attached = await Promise.race([this.info.attach('history-exit-observation', { body, contentType: 'application/json' }).then(() => true, () => false), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), historyExitObservationLimits.attachmentMs); })]);
    } catch { /* 同步附件失败也不能替换原错误。 */ }
    finally { if (timer) clearTimeout(timer); }
    if (!attached) try { this.info.annotations.push({ type: 'history-exit-observation', description: '退出观察附件写入未确认；原测试结果保持。' }); } catch { /* 附件和注记都不能替换原错误。 */ }
  }
}
