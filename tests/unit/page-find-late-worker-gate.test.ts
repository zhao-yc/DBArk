import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { installPageFindLateWorkerGate, type PageFindLateWorkerGate } from '../helpers/pageFindLateWorkerGate';

/** 只检验传输门不改消息、不延迟实际终止；这里的端口哨兵不冒充真实Worker匹配证据。 */
function fixture() {
  const workers: Native[] = [];
  class Native extends EventTarget {
    sent: unknown[] = []; stops = 0;
    constructor() { super(); workers.push(this); }
    postMessage(value: unknown) { this.sent.push(value); }
    terminate() { this.stops++; }
    emit(data: unknown) { const event = new MessageEvent('message', { data }); this.dispatchEvent(event); return event; }
  }
  const host: Record<string, any> = { Worker: Native };
  runInNewContext('(' + installPageFindLateWorkerGate.toString() + ')()', { window: host, location: { href: 'http://127.0.0.1/' }, URL, Error });
  const gate = host.__d06LateWorker as PageFindLateWorkerGate, received: MessageEvent[] = [], worker = new host.Worker('/src/renderer/pageFind.worker.ts'); worker.onmessage = (event: MessageEvent) => received.push(event);
  return { host, gate, worker, workers, received, Native };
}
describe('D06真实Worker迟到传输门自身约束', () => {
  it('就绪事件不延迟，请求原样发出，释放的是同一个原生响应事件和对象', () => {
    const f = fixture(); try { f.gate.arm('response'); const ready = f.workers[0].emit({ type: 'dbark-page-find-ready', version: 1 }); expect(f.received[0]).toBe(ready);
      const input = { id: 7, request: { operation: 'preview', marker: {} } }; f.worker.postMessage(input); expect(f.workers[0].sent[0]).toBe(input);
      const value = { id: 7, result: { status: 'ready', preview: { patches: [{ after: '端口哨兵' }] } } }, event = f.workers[0].emit(value); expect(f.received).toHaveLength(1);
      f.worker.onmessage = null; f.worker.terminate(); expect(f.workers[0].stops).toBe(1); f.gate.releaseResponse(0); expect(f.received[1]).toBe(event); expect(f.received[1].data).toBe(value); expect(() => f.gate.releaseResponse(0)).toThrow();
    } finally { f.gate.restore(); } expect(f.host.Worker).toBe(f.Native); expect(f.workers[0].stops).toBe(1);
  });
  it('终止确认可以延迟，但实际线程先停止；原错误响应不被改成成功或取消', async () => {
    const f = fixture(); try { f.gate.arm('termination', 'find'); const input = { id: 9, request: { operation: 'find' } }; f.worker.postMessage(input); const error = { id: 9, result: { status: 'blocked', reason: 'invalid', message: '原始错误哨兵' } }, event = f.workers[0].emit(error); expect(f.received[0]).toBe(event); expect(f.received[0].data).toBe(error);
      let finished = false; const pending = Promise.resolve(f.worker.terminate()).then(() => { finished = true; }); await Promise.resolve(); expect(f.workers[0].stops).toBe(1); expect(finished).toBe(false); expect(f.gate.snapshot()[0]).toMatchObject({ received: true, delivered: true, nativeTerminated: true, acknowledged: false, status: 'blocked', reason: 'invalid' });
      f.gate.acknowledge(0); await pending; expect(finished).toBe(true); expect(() => f.gate.acknowledge(0)).toThrow();
    } finally { f.gate.restore(); }
  });
  it('仅选择指定操作，快照不能篡改门状态，恢复会释放未完成确认并终止自己创建的线程', async () => {
    const f = fixture(); f.gate.arm('termination'); f.worker.postMessage({ request: { operation: 'find' } }); f.workers[0].emit({ result: { status: 'ready' } }); expect(f.gate.snapshot()[0].mode).toBeUndefined();
    const next = new f.host.Worker('/src/renderer/pageFind.worker.ts'); next.onmessage = () => {}; next.postMessage({ request: { operation: 'preview' } }); const pending = Promise.resolve(next.terminate()); f.gate.snapshot()[1].acknowledged = true; expect(f.gate.snapshot()[1].acknowledged).toBe(false); f.gate.restore(); await pending; expect(next.terminate()).toBeUndefined(); expect(f.workers.map(worker => worker.stops)).toEqual([1, 1]); expect(f.host.Worker).toBe(f.Native);
  });
});
