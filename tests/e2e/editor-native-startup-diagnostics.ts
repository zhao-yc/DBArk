import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import type { EditorIndentNativeRun } from './editor-indentation-native-owner';
import { attachNativeStartupWires, stopNativeStartupWires } from './editor-native-startup-wire';

type UrlKind = 'blank' | 'file' | 'devtools' | 'other';
type EventKind = 'pageerror' | 'console-error' | 'crash' | 'preload-error';
/** 仅存固定枚举和有界数字；不接收错误正文、SQL、完整URL、路径或环境。 */
export interface NativeStartupDiagnostic {
  version: 1; coverage: 'launch-returned-to-prepare-done'; preloadCoverage: 'hook-forward-only';
  launchReturnedElapsedMs?: number; firstObservedElapsedMs?: number; firstWindowElapsedMs?: number; statusbarStartElapsedMs?: number;
  pages: number; firstObservedUrl?: UrlKind; firstWindowUrl?: UrlKind;
  events: { kind: EventKind; page: number; elapsedMs?: number }[]; dropped: number; prepared: boolean;
}

/** 阶段0/1扫描进入/返回，2/3来源进入/返回，4/5evaluate进入/返回，6/7实际路径核验进入/返回。 */
export type NativeStartupWaitStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface NativeStartupWaitData { version: 1; points: [NativeStartupWaitStage, number, number][]; dropped: number; }
export interface NativeStartupWaitRecorder { readonly data: NativeStartupWaitData; record(stage: NativeStartupWaitStage, call: number): void; seal(): void; }
/** 仅由原guard之后同步调用；只取已验证时钟缓存和本地墓碑，不调用权限门、SDK或新时钟。 */
export function createNativeStartupWaits(elapsedMs: (() => number | undefined) | undefined, alive: () => boolean): NativeStartupWaitRecorder {
  const data: NativeStartupWaitData = { version: 1, points: [], dropped: 0 }; let sealed = false;
  return { data, seal() { sealed = true; }, record(stage, call) {
    if (sealed) return;
    if (!alive()) { sealed = true; return; }
    const elapsed = elapsedMs?.();
    if (!Number.isSafeInteger(stage) || stage < 0 || stage > 7 || !Number.isSafeInteger(call) || call < 1 || call > 8 || elapsed === undefined || !Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed >= 120000) return;
    if (data.points.length < 64) data.points.push([stage, call, elapsed]); else data.dropped = Math.min(1024, data.dropped + 1);
  } };
}

/** 本地缓存URL只分类，不解析/输出其中的路径、查询参数或正文。 */
function urlKind(value: string): UrlKind {
  return value === 'about:blank' || !value ? 'blank' : value.startsWith('file:') ? 'file' : value.startsWith('devtools:') ? 'devtools' : 'other';
}

/** 所有getter和事件均为同步正式API；失效门只停观察，不领取新的资源权限。 */
export function observeNativeStartup(application: ElectronApplication, current: () => void, marker: string, elapsedMs?: () => number | undefined) {
  const data: NativeStartupDiagnostic = { version: 1, coverage: 'launch-returned-to-prepare-done', preloadCoverage: 'hook-forward-only', pages: 0, events: [], dropped: 0, prepared: false };
  const pages = new Map<Page, number>(); let sealed = false;
  /** 只消费原门缓存的相对时刻；未提供时不补造起点，不额外读取Date.now。 */
  const stamp = () => { const value = elapsedMs?.(); return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value < 120000 ? value : undefined; };
  const allowed = () => { if (sealed) return false; try { current(); return true; } catch { sealed = true; return false; } };
  /** 只捕获权限门的拒绝；事件API自身的真实异常不在catch内。 */
  const record = (kind: EventKind, page = 0) => {
    if (!allowed()) return;
    const elapsed = stamp();
    if (data.events.length < 32) data.events.push({ kind, page, ...(elapsed === undefined ? {} : { elapsedMs: elapsed }) }); else data.dropped = Math.min(1024, data.dropped + 1);
  };
  const watch = (page: Page) => {
    if (!allowed() || pages.has(page)) return;
    if (pages.size >= 4) { data.dropped = Math.min(1024, data.dropped + 1); return; }
    const id = pages.size + 1; pages.set(page, id); data.pages = pages.size;
    if (data.firstObservedUrl === undefined) { data.firstObservedUrl = urlKind(page.url()); data.firstObservedElapsedMs = stamp(); }
    page.on('pageerror', () => record('pageerror', id));
    page.on('crash', () => record('crash', id));
    page.on('console', message => { if (allowed() && message.type() === 'error') record('console-error', id); });
  };
  current(); data.launchReturnedElapsedMs = stamp();
  // context/pages/url均读取客户端已缓存对象；不等待window加载，不增加RPC。
  const context = application.context(); context.on('page', watch); context.pages().forEach(watch);
  application.on('console', message => {
    if (!allowed()) return;
    if (message.type() === 'error') record('console-error');
    else if (message.type() === 'log' && message.text() === marker + ':PRELOAD') record('preload-error');
  });
  return {
    data,
    firstWindow(page: Page) { if (allowed()) { watch(page); if (data.firstWindowUrl === undefined) { data.firstWindowUrl = urlKind(page.url()); data.firstWindowElapsedMs = stamp(); } } },
    // 调用点紧跟原phase guard且没有await，只读它已验证的时刻。
    statusbar() { if (!sealed) data.statusbarStartElapsedMs = stamp(); },
    finish() { if (allowed()) { data.prepared = true; sealed = true; } },
  };
}

/** afterEach只序列化已捕获的内存；不调用owner、Page、Electron或文件系统端口。 */
async function attachOriginalNativeStartupDiagnostics(info: Pick<TestInfo, 'attach' | 'errors'>, run: Pick<EditorIndentNativeRun, 'owners' | 'startupWaits'>) {
  try {
    // afterEach原scope已retain；先封存纯内存轨迹，迟到回包不能再补写该case。
    run.startupWaits?.seal();
    const owners = run.owners.slice(0, 2).flatMap((owner, index) => owner.startupDiagnostics ? [{ owner: index + 1, startup: owner.startupDiagnostics, sourceDiagnostics: (owner.sourceDiagnostics ?? []).slice(-1) }] : []);
    const waits = run.startupWaits?.data;
    if (!owners.length && !waits?.points.length) return;
    const body = Buffer.from(JSON.stringify({ version: 1, owners, ...(waits?.points.length ? { waits } : {}) }));
    if (body.byteLength > 8192) throw Error('启动观察附件超过固定字节上限');
    await info.attach('原生启动有界观察', { body, contentType: 'application/json' });
  }
  catch (attachment) {
    if (info.errors.length) throw new AggregateError([...info.errors, attachment], '原测试失败且启动观察附件失败', { cause: info.errors[0] });
    throw attachment;
  }
}

/** 两份附件独立尝试，原8KiB正文逐字保留；任一收集/写入失败都保留原异常链。 */
export async function attachNativeStartupDiagnostics(info: Pick<TestInfo, 'attach' | 'errors'>, run: Pick<EditorIndentNativeRun, 'owners' | 'startupWaits'>) {
  stopNativeStartupWires(run);
  let original: { error: unknown } | undefined;
  try { await attachOriginalNativeStartupDiagnostics(info, run); } catch (error) { original = { error }; }
  try { await attachNativeStartupWires(info, run); }
  catch (failure) {
    if (original) throw new AggregateError([original.error, failure], '原启动观察与固定标记附件均失败', { cause: original.error });
    if (info.errors.length) throw new AggregateError([...info.errors, failure], '原测试失败且固定标记观察失败', { cause: info.errors[0] });
    throw failure;
  }
  if (original) throw original.error;
}
