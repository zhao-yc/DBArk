import type { ElectronApplication, Page, TestInfo, PlaywrightWorkerOptions } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { SnippetsNativeDiagnostics, snippetsDiagnosticPolicy, type RendererSample, type SnippetsDiagnosticPort } from '../helpers/snippetsNativeDiagnostics';

interface RafObserver { requested: number; delivered: number; pending: boolean; lastTimestamp: number | null; handle?: number; }
type DiagnosticWindow = Window & { __dbarkSnippetDiagnosticRaf?: RafObserver };

/** 只提取白名单状态；不读取输入值、SQL、文件或生产 store，不保存页面文本。 */
export function sampleSnippetsRenderer(): RendererSample {
  const root = window as DiagnosticWindow;
  const raf = root.__dbarkSnippetDiagnosticRaf ??= { requested: 0, delivered: 0, pending: false, lastTimestamp: null };
  const frame = { requested: raf.requested, delivered: raf.delivered, pending: raf.pending, lastTimestamp: raf.lastTimestamp };
  // 每次采样最多一个待交付 rAF，不 await 帧，不使用页面计时器或持续帧循环。
  if (!raf.pending && raf.requested < 128) {
    raf.requested++; raf.pending = true;
    raf.handle = requestAnimationFrame(timestamp => { raf.delivered++; raf.pending = false; raf.lastTimestamp = timestamp; });
  }
  const modal = document.querySelector<HTMLElement>('[role="dialog"][aria-label="SQL 片段库"]');
  const buttons = [...(modal?.querySelectorAll<HTMLButtonElement>('.modal-footer button') ?? [])].filter(button => button.textContent?.trim() === '编辑片段');
  const rect = (element: Element | undefined | null) => { if (!element) return null; const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
  return { visibility: document.visibilityState, focused: document.hasFocus(), width: innerWidth, height: innerHeight, raf: frame, dialog: rect(modal), edit: { count: buttons.length, disabled: buttons[0]?.disabled ?? null, rect: rect(buttons[0]) } };
}

/** 移除本诊断创建的待交付帧；不修改应用的 rAF 或窗口状态。 */
export function disposeSnippetsRenderer() {
  const root = window as DiagnosticWindow, raf = root.__dbarkSnippetDiagnosticRaf;
  if (raf?.handle !== undefined) cancelAnimationFrame(raf.handle);
  delete root.__dbarkSnippetDiagnosticRaf;
}

/** 每一段直接持有该次 Electron 的真实 BrowserContext，避免 runner-only trace。 */
export function snippetsDiagnosticPort(desktop: ElectronApplication, page: Page): SnippetsDiagnosticPort {
  const tracing = desktop.context().tracing;
  return {
    startTrace: async options => {
      // 锁定的 Playwright 1.64 会在 start 被拒绝前改客户端配置；先只读检查，保护已有记录器。
      // 没有公开的 isTracing；字段缺失时保守拒绝，不能通过 stop/start 接管其它 trace。
      if ((tracing as unknown as { _isTracing?: boolean })._isTracing !== false) throw new Error('片段诊断无法独占当前 context 的 trace');
      await tracing.start(options);
    },
    stopTrace: path => tracing.stop({ path }),
    native: () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).slice(0, 4).map(window => ({ id: window.id, visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), maximized: window.isMaximized(), fullScreen: window.isFullScreen(), bounds: window.getBounds(), contentBounds: window.getContentBounds() }))),
    renderer: () => page.evaluate(sampleSnippetsRenderer),
    dispose: () => page.evaluate(disposeSnippetsRenderer)
  };
}

/** 只由自动夹具传入 resolved trace；关门时不创建路径、采样器或 trace。 */
export function createSnippetsNativeDiagnostics(trace: PlaywrightWorkerOptions['trace'], info: TestInfo) {
  const policy = snippetsDiagnosticPolicy({ env: process.env, trace, retry: info.retry, file: info.file, title: info.title });
  if (!policy.enabled) return undefined;
  return new SnippetsNativeDiagnostics(policy, {
    path: segment => info.outputPath(`snippets-native-${segment}.zip`),
    trace: path => info.attach('snippets-native-trace', { path, contentType: 'application/zip' }),
    remove: path => rm(path, { force: true }),
    summary: value => info.attach('snippets-native-state', { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
  });
}
