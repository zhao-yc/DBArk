export interface NativeFindMessageSummary {
  id: number; held: boolean; requestId?: number; operation?: string; generation?: number; regex?: boolean; caseSensitive?: boolean; captureReplacement?: boolean;
  sentAt?: number; receivedAt?: number; deliveredAt?: number; terminatedAt?: number; received: boolean; delivered: boolean; nativeTerminated: boolean; terminateCalls: number; status?: string; reason?: string; after?: string;
}
export interface NativeFindMessageGate { arm(operation?: 'find' | 'preview'): void; snapshot(): NativeFindMessageSummary[]; release(id: number): void; restore(): void; }

/** 只延迟实际Worker原消息；就绪、请求和原生terminate的调用/返回值均保持原行为。 */
export function installNativeFindMessageGate(): void {
  const host = window as Window & { __d06NativeMessages?: NativeFindMessageGate };
  if (host.__d06NativeMessages) throw Error('D06原消息门重复安装');
  const Native = window.Worker;
  type Entry = { summary: NativeFindMessageSummary; deliver?: () => void; stop(): void; };
  const entries: Entry[] = [], owners = new WeakMap<Worker, Entry>(); let next: 'find' | 'preview' | undefined;
  class ObservedWorker extends Native {
    /** 原构造参数不变，仅对页内查找线程安装消息旁观。 */
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      if (!new URL(String(args[0]), location.href).pathname.match(/\/pageFind\.worker(?:\.ts|-[^/]+\.js)$/)) return;
      if (entries.length >= 64) { super.terminate(); throw Error('D06本例线程摘要超过预算'); }
      let receiver: Worker['onmessage'] = null;
      Object.defineProperty(this, 'onmessage', { configurable: true, get: () => receiver, set: (value: Worker['onmessage']) => { receiver = value; } });
      const entry: Entry = { summary: { id: entries.length, held: false, received: false, delivered: false, nativeTerminated: false, terminateCalls: 0 }, stop: () => { if (!entry.summary.nativeTerminated) this.terminate(); } }; owners.set(this, entry); entries.push(entry);
      super.addEventListener('message', event => {
        if (event.data?.type === 'dbark-page-find-ready') { receiver?.call(this, event); return; }
        entry.summary.received = true; entry.summary.receivedAt = performance.now(); entry.summary.status = event.data?.result?.status; entry.summary.reason = event.data?.result?.reason;
        const after = event.data?.result?.preview?.patches?.[0]?.after; if (typeof after === 'string' && after.length <= 256) entry.summary.after = after;
        // 缓存原事件及当时的原处理器；取消后交付也必须由生产客户端自行拒绝旧身份。
        const original = receiver;
        entry.deliver = () => { if (entry.summary.delivered) throw Error('原消息不允许重复交付'); entry.summary.delivered = true; entry.summary.deliveredAt = performance.now(); original?.call(this, event); };
        if (!entry.summary.held) entry.deliver();
      });
    }
    /** 不改输入对象或传输参数，只摘取固定夹具所需的有界身份和选项摘要。 */
    postMessage(message: any, transfer: Transferable[]): void;
    postMessage(message: any, options?: StructuredSerializeOptions): void;
    postMessage(message: any, options?: StructuredSerializeOptions | Transferable[]): void {
      const entry = owners.get(this); if (entry) {
        Object.assign(entry.summary, { requestId: message?.id, operation: message?.request?.operation, generation: message?.request?.generation, regex: !!message?.request?.options?.regex, caseSensitive: !!message?.request?.options?.caseSensitive, captureReplacement: !!message?.request?.options?.captureReplacement, sentAt: performance.now() });
        if (next && next === entry.summary.operation) { entry.summary.held = true; next = undefined; }
      }
      if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options);
    }
    /** 实际调用原生终止并原样返回，绝不合成Promise、错误或终止确认。 */
    terminate(): void {
      const result = super.terminate(), entry = owners.get(this);
      if (entry) { entry.summary.nativeTerminated = true; entry.summary.terminatedAt ??= performance.now(); entry.summary.terminateCalls++; }
      return result;
    }
  }
  window.Worker = ObservedWorker;
  host.__d06NativeMessages = {
    /** 一次只选择下一条指定操作，未交付的旧消息不允许被新门覆盖。 */
    arm(operation = 'preview') { if (next || entries.some(entry => entry.summary.held && !entry.summary.delivered)) throw Error('上一原消息尚未结束'); next = operation; },
    /** 返回独立摘要副本，测试读取不能篡改交付和终止状态。 */
    snapshot: () => entries.map(entry => ({ ...entry.summary })),
    /** 仅调用保存的原生事件交付器，没有响应创建入口。 */
    release(id) { const entry = entries[id]; if (!entry?.summary.held || !entry.deliver) throw Error('没有可交付的真实原消息'); entry.deliver(); },
    /** 不在收尾交付旧结果，只停止自有线程并恢复原构造器。 */
    restore() { next = undefined; entries.forEach(entry => entry.stop()); window.Worker = Native; delete host.__d06NativeMessages; }
  };
}
