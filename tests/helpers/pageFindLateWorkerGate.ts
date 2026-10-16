export type PageFindGateMode = 'response' | 'termination';
export interface PageFindGateSummary { id: number; operation?: string; mode?: PageFindGateMode; received: boolean; delivered: boolean; nativeTerminated: boolean; acknowledged: boolean; status?: string; reason?: string; after?: string; }
export interface PageFindLateWorkerGate {
  arm(mode: PageFindGateMode, operation?: 'find' | 'preview'): void;
  snapshot(): PageFindGateSummary[];
  releaseResponse(id: number): void;
  acknowledge(id: number): void;
  restore(): void;
}

/** 在真实浏览器中安装纯传输门：只延迟原生事件或终止确认，不生成/重算匹配和替换计划。 */
export function installPageFindLateWorkerGate(): void {
  const host = window as Window & { __d06LateWorker?: PageFindLateWorkerGate };
  if (host.__d06LateWorker) throw Error('D06迟到传输门重复安装');
  const Native = window.Worker;
  type Entry = { summary: PageFindGateSummary; stop(): void; deliver?: () => void; finish?: () => void; responseReleased: boolean; };
  const entries: Entry[] = [], owners = new WeakMap<Worker, Entry>(); let next: { mode: PageFindGateMode; operation: 'find' | 'preview' } | undefined;
  class ObservedWorker extends Native {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      if (!new URL(String(args[0]), location.href).pathname.match(/\/pageFind\.worker(?:\.ts|-[^/]+\.js)$/)) return;
      if (entries.length >= 64) { super.terminate(); throw Error('D06旁观线程数量超出本例预算'); }
      let receiver: Worker['onmessage'] = null;
      // 保留生产客户端原处理器；取消后也可交付已捕获的同一原生事件，检验迟到隔离。
      Object.defineProperty(this, 'onmessage', { configurable: true, get: () => receiver, set: (value: Worker['onmessage']) => { receiver = value; } });
      const entry: Entry = { summary: { id: entries.length, received: false, delivered: false, nativeTerminated: false, acknowledged: false }, responseReleased: false, stop: () => { if (!entry.summary.nativeTerminated) { Native.prototype.terminate.call(this); entry.summary.nativeTerminated = true; } } };
      owners.set(this, entry); entries.push(entry);
      super.addEventListener('message', event => {
        if (event.data?.type === 'dbark-page-find-ready') { receiver?.call(this, event); return; }
        entry.summary.received = true; entry.summary.status = event.data?.result?.status; entry.summary.reason = event.data?.result?.reason;
        const after = event.data?.result?.preview?.patches?.[0]?.after;
        if (typeof after === 'string' && after.length <= 256) entry.summary.after = after;
        const originalReceiver = receiver;
        entry.deliver = () => { if (entry.summary.delivered) throw Error('同一真实响应不能交付两次'); entry.summary.delivered = true; originalReceiver?.call(this, event); };
        if (entry.summary.mode !== 'response') entry.deliver();
      });
    }
    /** 请求按原对象、原id和原选项发往原生Worker，旁观门只按操作选择下一次延迟。 */
    postMessage(message: any, transfer: Transferable[]): void;
    postMessage(message: any, options?: StructuredSerializeOptions): void;
    postMessage(message: any, options?: StructuredSerializeOptions | Transferable[]): void {
      const entry = owners.get(this); if (entry) { entry.summary.operation = message?.request?.operation; if (next && entry.summary.operation === next.operation) { entry.summary.mode = next.mode; next = undefined; } }
      if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options);
    }
    /** 始终立即终止实际线程，只延迟客户端等待的确认Promise；不让Worker继续后台运行。 */
    terminate(): void | Promise<void> {
      const entry = owners.get(this); if (!entry) return super.terminate(); entry.stop();
      if (entry.summary.mode === 'termination' && !entry.summary.acknowledged) return new Promise<void>(resolve => { if (entry.finish) throw Error('终止确认被重复请求'); entry.finish = resolve; });
      entry.summary.acknowledged = true;
    }
  }
  window.Worker = ObservedWorker;
  host.__d06LateWorker = {
    arm(mode, operation = 'preview') { if (next || entries.some(entry => entry.finish && !entry.summary.acknowledged)) throw Error('上一传输门尚未结束'); next = { mode, operation }; },
    snapshot: () => entries.map(entry => ({ ...entry.summary })),
    releaseResponse(id) { const entry = entries[id]; if (!entry || entry.summary.mode !== 'response' || !entry.deliver || entry.responseReleased) throw Error('没有可释放的真实响应'); entry.responseReleased = true; entry.deliver(); },
    acknowledge(id) { const entry = entries[id]; if (!entry?.finish || entry.summary.acknowledged) throw Error('没有可完成的终止确认'); entry.summary.acknowledged = true; entry.finish(); },
    restore() { next = undefined; entries.forEach(entry => { entry.stop(); entry.summary.acknowledged = true; entry.finish?.(); }); window.Worker = Native; delete host.__d06LateWorker; }
  };
}
