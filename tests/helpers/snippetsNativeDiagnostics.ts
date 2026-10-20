import type { PlaywrightWorkerOptions } from '@playwright/test';

export const snippetsDiagnosticTitle = '离线片段分组搜索编辑复制删除、重启持久化、纯文本插入撤销与模态快捷键';
export const explainDiagnosticTitle = '执行计划离线组件：键盘、缺失指标、未知节点、长文本和最小窗口';
export const snippetsDiagnosticLimits = { samples: 128, markers: 32, errors: 16, intervalMs: 500, drainMs: 300, traceMs: 5000 } as const;
type TraceSetting = PlaywrightWorkerOptions['trace'];
type TraceMode = Exclude<TraceSetting, object>;
export interface SnippetsDiagnosticPolicy {
  enabled: boolean;
  mode: TraceMode;
  retry: number;
  screenshots: boolean;
  snapshots: boolean | { dom?: boolean; aria?: boolean; screen?: boolean };
}

/** 只接受本离线用例和实际解析后的 trace；不读取凭据文件，也不输出环境变量值。 */
export function snippetsDiagnosticPolicy(input: { env: NodeJS.ProcessEnv; trace: TraceSetting; retry: number; file: string; title: string }): SnippetsDiagnosticPolicy {
  return nativeDiagnosticPolicy(input, 'DBARK_SNIPPETS_NATIVE_DIAGNOSTICS', '/tests/e2e/snippets.spec.ts', snippetsDiagnosticTitle, '片段');
}
/** 执行计划只开放自身离线用例，不能借用片段标题或扩大到实库页面。 */
export function explainDiagnosticPolicy(input: { env: NodeJS.ProcessEnv; trace: TraceSetting; retry: number; file: string; title: string }): SnippetsDiagnosticPolicy {
  return nativeDiagnosticPolicy(input, 'DBARK_EXPLAIN_NATIVE_DIAGNOSTICS', '/tests/e2e/explain-view.spec.ts', explainDiagnosticTitle, '执行计划');
}
/** 两个入口共用原trace保留及隐私规则，真实file/title和开关分别校验。 */
function nativeDiagnosticPolicy(input: { env: NodeJS.ProcessEnv; trace: TraceSetting; retry: number; file: string; title: string }, gate: string, file: string, title: string, label: string): SnippetsDiagnosticPolicy {
  const mode = typeof input.trace === 'object' ? input.trace.mode : input.trace;
  const policy: SnippetsDiagnosticPolicy = { enabled: false, mode, retry: input.retry, screenshots: typeof input.trace === 'object' ? input.trace.screenshots !== false : true, snapshots: typeof input.trace === 'object' ? input.trace.snapshots ?? true : true };
  if (input.env[gate] !== '1' || !input.file.replaceAll('\\', '/').endsWith(file) || input.title !== title) return policy;
  // 显式诊断与实库配置不能并用；仅检查键是否配置，不读取其值或 .cache/dbark-test.env。
  if (input.env.DBARK_INTEGRATION_ENABLED === '1' || Object.keys(input.env).some(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key))) throw new Error(label + '原生诊断拒绝实库或私网测试环境，请使用独立离线进程');
  policy.enabled = mode === 'on' || mode === 'retain-on-failure' || mode === 'retain-on-failure-and-retries' || mode === 'retain-on-first-failure' && input.retry === 0 || (mode === 'on-first-retry' || mode === 'retry-with-trace') && input.retry === 1 || mode === 'on-all-retries' && input.retry > 0;
  return policy;
}

/** 与原生 runner 一致决定保留时机；重启前先封存，最终失败时保留所有已完成的段。 */
export function retainSnippetsDiagnostics(policy: SnippetsDiagnosticPolicy, failed: boolean) {
  return failed || policy.mode === 'on' || policy.mode === 'on-first-retry' || policy.mode === 'retry-with-trace' || policy.mode === 'on-all-retries' || policy.mode === 'retain-on-failure-and-retries' && policy.retry > 0;
}

export interface DiagnosticRect { x: number; y: number; width: number; height: number; }
export interface NativeWindowSample { id: number; visible: boolean; focused: boolean; minimized: boolean; maximized: boolean; fullScreen: boolean; bounds: DiagnosticRect; contentBounds: DiagnosticRect; webContentsId?: number; backgroundThrottling?: boolean; }
export interface RendererSample {
  visibility: string; focused: boolean; width: number; height: number;
  raf: { requested: number; delivered: number; pending: boolean; lastTimestamp: number | null };
  dialog: DiagnosticRect | null;
  edit: { count: number; disabled: boolean | null; rect: DiagnosticRect | null };
  target?: { count: number; disabled: boolean | null; rect: DiagnosticRect | null; display: string | null; visibility: string | null; pointerEvents: string | null; opacity: string | null; hitTag: string | null; };
}
export interface SnippetsDiagnosticPort {
  startTrace(options: { screenshots: boolean; snapshots: SnippetsDiagnosticPolicy['snapshots']; sources: false }): Promise<void>;
  stopTrace(path: string): Promise<void>;
  native(): Promise<NativeWindowSample[]>;
  renderer(): Promise<RendererSample>;
  dispose(): Promise<void>;
}
interface Reading<T> { state: 'pending' | 'ready' | 'unavailable' | 'busy'; value?: T; }
interface Sample { atMs: number; phase: string; segment: number; native: Reading<NativeWindowSample[]>; renderer: Reading<RendererSample>; }
interface Segment { id: number; name: 'initial' | 'restart'; path: string; port: SnippetsDiagnosticPort; started: boolean; sealed: boolean; trace: 'starting' | 'recording' | 'saved' | 'unavailable'; inFlight: Set<Promise<void>>; busy: Set<'native' | 'renderer'>; finalized?: Promise<void>; }
export interface SnippetsDiagnosticOutput {
  path(segment: number): string;
  trace(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  summary(value: unknown): Promise<void>;
}

/** 只给诊断操作设置收尾预算，不修改原测试或点击的超时。 */
async function bounded(operation: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation.then(() => true, () => false), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** 单用例的分段记录器；每个采样通道最多一条在途请求，不在停帧时堆积 evaluate。 */
export class SnippetsNativeDiagnostics {
  private readonly startedAt = performance.now();
  private readonly samples: Sample[] = [];
  private readonly markers: { atMs: number; phase: string }[] = [];
  private readonly errors: string[] = [];
  private readonly segments: Segment[] = [];
  private current?: Segment;
  private timer?: ReturnType<typeof setInterval>;
  private phase = 'offline-ready';
  private finished = false;
  private retain = false;
  private finishTask?: Promise<void>;
  constructor(private readonly policy: SnippetsDiagnosticPolicy, private readonly output: SnippetsDiagnosticOutput) {}

  /** 不保存异常原文，避免调试连接错误带入路径、命令或敏感运行参数。 */
  private error(code: string) { if (this.errors.length < snippetsDiagnosticLimits.errors) this.errors.push(code); }
  private elapsed() { return Math.round((performance.now() - this.startedAt) * 10) / 10; }

  /** 第一段须在固定离线连接表单关闭后启动；每次 Electron 启动拥有独立的 context。 */
  async start(port: SnippetsDiagnosticPort, name: Segment['name']) {
    if (!this.policy.enabled || this.finished) return;
    if (this.current || this.segments.length >= 2) { this.error('segment-order'); return; }
    const segment: Segment = { id: this.segments.length + 1, name, path: this.output.path(this.segments.length + 1), port, started: false, sealed: false, trace: 'starting', inFlight: new Set(), busy: new Set() };
    this.segments.push(segment); this.current = segment;
    // 只有成功 start 的 context 才允许 stop；不会接管或重置 runner 的其它 trace。
    const starting = Promise.resolve().then(() => port.startTrace({ screenshots: this.policy.screenshots, snapshots: this.policy.snapshots, sources: false })).then(async () => {
      segment.started = true; segment.trace = 'recording';
      // 若启动超过预算，后来才成功，也只收尾自己启动的 trace，绝不触碰其它 context。
      if (segment.sealed) await this.saveTrace(segment);
    });
    if (!await bounded(starting, snippetsDiagnosticLimits.traceMs)) this.error('trace-start-unavailable');
    // 诊断启动失败仍旁观原动作，摘要明确缺失；不把诊断错误替换成产品错误。
    if (!segment.started && segment.trace === 'starting') segment.trace = 'unavailable';
    if (segment.sealed || this.finished) return;
    this.mark(name === 'initial' ? 'initial-ready' : 'restart-ready');
    this.timer = setInterval(() => this.sample(), snippetsDiagnosticLimits.intervalMs); this.timer.unref();
  }

  /** 阶段标记是同步旁观，不插入点击前等待、重试或窗口前台操作。 */
  mark(phase: 'initial-ready' | 'restart-ready' | 'before-copy' | 'before-copy-save' | 'before-copy-edit' | 'after-copy-edit' | 'before-plan-table' | 'after-plan-table' | 'before-quit' | 'test-failed' | 'test-finished') {
    if (!this.policy.enabled || this.finished) return;
    this.phase = phase;
    if (this.markers.length < snippetsDiagnosticLimits.markers) this.markers.push({ atMs: this.elapsed(), phase });
    this.sample();
  }

  /** 原生和页面通道独立，页面 evaluate 停滞时仍可取得窗口状态；总行数有上限。 */
  private sample() {
    const segment = this.current;
    if (!segment || segment.sealed || this.samples.length >= snippetsDiagnosticLimits.samples) { if (this.timer) clearInterval(this.timer); return; }
    const sample: Sample = { atMs: this.elapsed(), phase: this.phase, segment: segment.id, native: { state: 'busy' }, renderer: { state: 'busy' } };
    this.samples.push(sample);
    const read = <K extends 'native' | 'renderer'>(channel: K, operation: () => Promise<K extends 'native' ? NativeWindowSample[] : RendererSample>) => {
      if (segment.busy.has(channel)) return;
      segment.busy.add(channel); sample[channel] = { state: 'pending' };
      const request = Promise.resolve().then(operation).then(value => {
        if (!this.finished) Object.assign(sample[channel], { state: 'ready', value });
      }, () => { if (!this.finished) sample[channel].state = 'unavailable'; }).finally(() => { segment.busy.delete(channel); segment.inFlight.delete(request); });
      segment.inFlight.add(request);
    };
    read('native', () => segment.port.native()); read('renderer', () => segment.port.renderer());
  }

  /** 分段 trace 在退出前落盘；写入失败只留固定错误码。 */
  private async saveTrace(segment: Segment) {
    segment.started = false;
    const saving = Promise.resolve().then(() => segment.port.stopTrace(segment.path)).then(async () => {
      segment.trace = 'saved';
      // stop 超过预算后才落盘时，仍按最终结果删除或保留，避免成功测试留下迟到的临时包。
      if (this.finished) await this.finalizeSegment(segment);
    });
    if (!await bounded(saving, snippetsDiagnosticLimits.traceMs)) { segment.trace = 'unavailable'; this.error('trace-stop-unavailable'); }
  }

  /** 先保留退出或失败瞬间，再有界排空，在原夹具关闭窗口之前尝试封存 trace。 */
  async stop() {
    const segment = this.current; if (!segment || segment.sealed) return;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.sample(); segment.sealed = true; this.current = undefined;
    if (!await bounded(Promise.all([...segment.inFlight]), snippetsDiagnosticLimits.drainMs)) this.error('sample-drain-budget');
    // dispose 在页面恢复前可能同样挂起，不能因此推迟原夹具退出。
    if (!await bounded(Promise.resolve().then(() => segment.port.dispose()), snippetsDiagnosticLimits.drainMs)) this.error('observer-dispose-unavailable');
    if (segment.started) await this.saveTrace(segment);
  }

  /** 幂等终结；最终失败保留重启前后各段，成功按实际 trace 模式删除临时段。 */
  finish(failed: boolean) {
    return this.finishTask ??= this.finishOnce(failed);
  }
  private async finishOnce(failed: boolean) {
    if (!this.policy.enabled) return;
    this.retain = retainSnippetsDiagnostics(this.policy, failed);
    this.mark(failed ? 'test-failed' : 'test-finished'); await this.stop(); this.finished = true;
    for (const segment of this.segments) {
      if (segment.trace === 'saved') await this.finalizeSegment(segment);
      else if (!this.retain) {
        if (!await bounded(Promise.resolve().then(() => this.output.remove(segment.path)), snippetsDiagnosticLimits.traceMs)) this.error('trace-remove-unavailable');
      }
    }
    if (this.retain) await bounded(Promise.resolve().then(() => this.output.summary({ version: 1, failed, limits: snippetsDiagnosticLimits, platform: process.platform, arch: process.arch, segments: this.segments.map(({ id, name, trace }) => ({ id, name, trace })), markers: this.markers, samples: this.samples, errors: this.errors })), snippetsDiagnosticLimits.traceMs);
  }

  /** 同一段只输出一次；迟到的 trace 完成也复用同一最终保留策略。 */
  private finalizeSegment(segment: Segment) {
    return segment.finalized ??= (async () => {
      const operation = Promise.resolve().then(() => this.retain ? this.output.trace(segment.path) : this.output.remove(segment.path));
      if (!await bounded(operation, snippetsDiagnosticLimits.traceMs)) this.error(this.retain ? 'trace-attach-unavailable' : 'trace-remove-unavailable');
    })();
  }
}
