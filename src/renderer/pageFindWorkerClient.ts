import type { TableInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { assertPageFindTransfer, pageFindLimits, type PageCellMatch, type PageFindOptions, type PageOccurrence, type PageReplacement } from './pageFindReplace';
import { tableGridZh as text } from './locales/tableGrid.zh-CN';

export interface PageFindRequest { operation: 'find' | 'preview'; rows: DraftRow[]; keys: string[]; options: PageFindOptions; replacement?: string; info?: TableInfo; generation: number; only?: PageOccurrence; }
export type PageFindResult = { status: 'ready'; operation: 'find'; matches: PageCellMatch[] } | { status: 'ready'; operation: 'preview'; preview: PageReplacement } | { status: 'blocked'; reason: string; message: string };
export interface PageFindWorkerPort { postMessage(value: unknown): void; terminate(): void | Promise<unknown>; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null; }
interface Pending { id: number; worker: PageFindWorkerPort; request?: PageFindRequest; running: boolean; timer: ReturnType<typeof setTimeout>; resolve(value: PageFindResult): void; }

/** 每次请求使用独立真实线程；终止完成才交付结果或允许下一次创建，防止恶意回溯积累。 */
export class PageFindWorkerClient {
  private pending?: Pending;
  private serial = 0;
  private disposed = false;
  private retiring: Promise<void> = Promise.resolve();
  /** 生产注入本地 Web Worker；测试可注入带异步终止确认的端口以验证回收顺序。 */
  constructor(private readonly createWorker: () => PageFindWorkerPort, private readonly timeoutMs: number = pageFindLimits.timeoutMs, private readonly startupMs: number = pageFindLimits.startupMs) {}

  /** 只复制有界页面快照；握手之前不发送原文，重复请求先回收旧线程。 */
  async run(request: PageFindRequest): Promise<PageFindResult> {
    const id = ++this.serial;
    await this.stop({ status: 'blocked', reason: 'cancelled', message: text.cancelled });
    if (this.disposed || id !== this.serial) return { status: 'blocked', reason: 'cancelled', message: text.cancelled };
    try { assertPageFindTransfer(request); } catch { return { status: 'blocked', reason: 'budget', message: text.budget }; }
    return new Promise(resolve => {
      try {
        const worker = this.createWorker();
        const deadline = (running: boolean) => setTimeout(() => {
          if (this.pending?.id === id && this.pending.running === running) void this.stop({ status: 'blocked', reason: 'timeout', message: text.timeout });
        }, running ? this.timeoutMs : this.startupMs);
        this.pending = { id, worker, request, running: false, timer: deadline(false), resolve };
        worker.onmessage = event => {
          const pending = this.pending;
          if (!pending || pending.id !== id || pending.worker !== worker) return;
          if (event.data?.type === 'dbark-page-find-ready' && !pending.running) {
            if (event.data.version !== 1) { void this.stop({ status: 'blocked', reason: 'worker', message: text.workerFailed }); return; }
            pending.running = true; clearTimeout(pending.timer); pending.timer = deadline(true);
            const payload = pending.request; pending.request = undefined;
            try { worker.postMessage({ id, request: payload }); } catch { void this.stop({ status: 'blocked', reason: 'worker', message: text.workerFailed }); }
            return;
          }
          if (!pending.running || event.data?.id !== id) return;
          const result = event.data.result as PageFindResult | undefined;
          if (result?.status === 'ready' || result?.status === 'blocked') void this.stop(result);
          else void this.stop({ status: 'blocked', reason: 'worker', message: text.workerFailed });
        };
        worker.onerror = event => { event.preventDefault(); if (this.pending?.worker === worker) void this.stop({ status: 'blocked', reason: 'worker', message: text.workerFailed }); };
        worker.onmessageerror = () => { if (this.pending?.worker === worker) void this.stop({ status: 'blocked', reason: 'worker', message: text.workerFailed }); };
      } catch { resolve({ status: 'blocked', reason: 'worker', message: text.workerFailed }); }
    });
  }

  /** 先隔离迟到回调，再等待终止；Web Worker terminate 按平台语义立即停止线程。 */
  private stop(result: PageFindResult): Promise<void> {
    const pending = this.pending; this.pending = undefined;
    if (!pending) return this.retiring;
    clearTimeout(pending.timer); pending.worker.onmessage = null; pending.worker.onerror = null; pending.worker.onmessageerror = null;
    const previous = this.retiring;
    this.retiring = (async () => {
      await previous;
      let completed = result;
      try { await pending.worker.terminate(); }
      catch { this.disposed = true; completed = { status: 'blocked', reason: 'worker', message: text.workerFailed }; }
      finally { pending.request = undefined; pending.resolve(completed); }
    })();
    return this.retiring;
  }
  /** 用户取消、页面变化和卸载共用真实终止路径，不仅隐藏进度提示。 */
  cancel(): Promise<void> { this.serial++; return this.stop({ status: 'blocked', reason: 'cancelled', message: text.cancelled }); }
  /** 已销毁的面板不能创建新的线程。 */
  dispose(): Promise<void> { this.disposed = true; return this.cancel(); }
}
