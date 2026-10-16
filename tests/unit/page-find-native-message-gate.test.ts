import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { installNativeFindMessageGate, type NativeFindMessageGate } from '../helpers/pageFindNativeMessageGate';

/** 仅校验传输门，端口哨兵不冒充真实匹配；E2E另由原生Worker生成实际结果。 */
function fixture() {
  const ports: Native[] = [], termination = { native: true };
  class Native extends EventTarget {
    sent: unknown[][] = []; stops = 0;
    constructor() { super(); ports.push(this); }
    postMessage(...args: unknown[]) { this.sent.push(args); }
    terminate() { this.stops++; return termination; }
    emit(data: unknown) { const event = new MessageEvent('message', { data }); this.dispatchEvent(event); return event; }
  }
  const host: Record<string, any> = { Worker: Native };
  runInNewContext('(' + installNativeFindMessageGate.toString() + ')()', { window: host, location: { href: 'http://127.0.0.1/' }, URL, performance });
  const gate = host.__d06NativeMessages as NativeFindMessageGate, worker = new host.Worker('/src/renderer/pageFind.worker.ts'), received: MessageEvent[] = []; worker.onmessage = (event: MessageEvent) => received.push(event);
  return { host, gate, worker, received, ports, Native, termination };
}
describe('仅延迟原消息的原生Worker观察门', () => {
  it('就绪不延迟，请求及transfer原样转交，取消后交付仍是同一事件/对象', () => {
    const f = fixture(); try { f.gate.arm(); const ready = f.ports[0].emit({ type: 'dbark-page-find-ready', version: 1 }); expect(f.received[0]).toBe(ready);
      const input = { id: 8, request: { operation: 'preview', generation: 2, options: { regex: true, caseSensitive: true } } }, transfer: unknown[] = []; f.worker.postMessage(input, transfer); expect(f.ports[0].sent[0][0]).toBe(input); expect(f.ports[0].sent[0][1]).toBe(transfer);
      const value = { id: 8, result: { status: 'ready', preview: { patches: [{ after: '端口哨兵' }] } } }, event = f.ports[0].emit(value); expect(f.received).toHaveLength(1); f.worker.onmessage = null;
      expect(f.worker.terminate()).toBe(f.termination); f.gate.release(0); expect(f.received[1]).toBe(event); expect(f.received[1].data).toBe(value); expect(() => f.gate.release(0)).toThrow(); expect(f.gate.snapshot()[0]).toMatchObject({ nativeTerminated: true, terminateCalls: 1, generation: 2, regex: true, caseSensitive: true, captureReplacement: false });
    } finally { f.gate.restore(); } expect(f.ports[0].stops).toBe(1); expect(f.host.Worker).toBe(f.Native);
  });
  it('真实错误哨兵不改写，指定find只暂存find，时间戳和快照不能改变原行为', () => {
    const f = fixture(); try { f.gate.arm('find'); f.worker.postMessage({ request: { operation: 'preview' } }); const first = f.ports[0].emit({ result: { status: 'ready' } }); expect(f.received[0]).toBe(first);
      const next = new f.host.Worker('/src/renderer/pageFind.worker.ts'), events: MessageEvent[] = []; next.onmessage = (event: MessageEvent) => events.push(event); next.postMessage({ request: { operation: 'find' } }); const error = { result: { status: 'blocked', reason: 'invalid', message: '原始错误哨兵' } }, event = f.ports[1].emit(error);
      expect(events).toHaveLength(0); f.gate.snapshot()[1].nativeTerminated = true; expect(f.gate.snapshot()[1].nativeTerminated).toBe(false); f.gate.release(1); expect(events[0]).toBe(event); expect(events[0].data).toBe(error); const state = f.gate.snapshot()[1]; expect(state.deliveredAt).toBeGreaterThanOrEqual(state.receivedAt!); expect(state.receivedAt).toBeGreaterThanOrEqual(state.sentAt!);
    } finally { f.gate.restore(); } expect(f.ports.map(port => port.stops)).toEqual([1, 1]);
  });
  it('收尾仅终止自有线程，不交付未释放原消息，不制造终止确认', () => {
    const f = fixture(); f.gate.arm(); f.worker.postMessage({ request: { operation: 'preview' } }); f.ports[0].emit({ result: { status: 'ready' } }); f.gate.restore(); expect(f.received).toHaveLength(0); expect(f.ports[0].stops).toBe(1); expect(f.host.Worker).toBe(f.Native); expect(f.worker.terminate()).toBe(f.termination); expect(f.ports[0].stops).toBe(2);
  });
  it('未指定延迟时未知请求和原错误事件仍直接转交，不被意外暂存', () => {
    const f = fixture(); try { const request = { id: 3, request: {} }; f.worker.postMessage(request); const error = { id: 3, result: { status: 'blocked', reason: 'invalid' } }, event = f.ports[0].emit(error); expect(f.received[0]).toBe(event); expect(f.received[0].data).toBe(error); expect(f.gate.snapshot()[0]).toMatchObject({ held: false, delivered: true }); } finally { f.gate.restore(); }
  });
});
