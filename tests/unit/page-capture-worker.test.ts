import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PageFindWorkerClient, type PageFindRequest, type PageFindWorkerPort } from '../../src/renderer/pageFindWorkerClient';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

let code: string;
beforeAll(async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../../src/renderer/pageFind.worker.ts', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'iife' });
  // 仅把Web Worker消息端口桥接到Node真实线程，线程主体为完整当前生产Worker。
  code = "const {parentPort}=require('node:worker_threads');globalThis.self={onmessage:null,postMessage:data=>parentPort.postMessage(data)};parentPort.on('message',data=>self.onmessage({data}));" + result.outputFiles[0].text;
});

/** 真实独立线程实现生产WorkerClient端口，terminate等待退出完成；不创建GUI或数据库资源。 */
class Port implements PageFindWorkerPort {
  onmessage: PageFindWorkerPort['onmessage'] = null; onerror: PageFindWorkerPort['onerror'] = null; onmessageerror: PageFindWorkerPort['onmessageerror'] = null;
  worker = new Worker(code, { eval: true, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
  sent = false; ended = false;
  constructor() { this.worker.on('message', data => this.onmessage?.({ data } as MessageEvent)); this.worker.on('error', () => this.onerror?.({ preventDefault() {} } as ErrorEvent)); this.worker.on('exit', () => { this.ended = true; }); }
  postMessage(value: unknown) { this.sent = true; this.worker.postMessage(value); }
  async terminate() { await this.worker.terminate(); this.ended = true; }
}
/** 所有恶意模式只发送到上面的真实线程，本测试主线程从不编译或执行它们。 */
function fixture(timeoutMs = 1500) { const ports: Port[] = [], client = new PageFindWorkerClient(() => { const port = new Port(); ports.push(port); return port; }, timeoutMs); return { ports, client }; }
function request(query = '(?<词>old)', source = '😀old old', replacement = '[$<词>/$1]'): PageFindRequest {
  return { operation: 'preview', rows: [{ id: '1', inserted: false, deleted: false, data: { note: source }, original: { note: source } }], keys: ['note'], options: { kind: 'text', query, regex: true, captureReplacement: true, caseSensitive: false, wholeCell: false }, generation: 1, replacement, info: { database: '纯线程', name: '当前页', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], columns: [{ name: 'note', type: 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [], foreignKeys: [], ddl: '' } };
}
describe('捕获替换的真实Worker消息和释放', () => {
  it('完整生产Worker执行命名捕获，非法开关与输出放大明确拒绝，所有线程退出', async () => {
    const f = fixture(); try {
      const result = await f.client.run(request()); expect(result).toMatchObject({ status: 'ready', operation: 'preview', preview: { patches: [{ after: '😀[old/old] [old/old]' }] } });
      const invalid = request(); (invalid.options as unknown as { captureReplacement: unknown }).captureReplacement = 'yes'; expect(await f.client.run(invalid)).toMatchObject({ status: 'blocked', message: text.budget });
      expect(await f.client.run(request('(a+)', 'a'.repeat(32768), '$1'.repeat(2048)))).toMatchObject({ status: 'blocked', message: text.budget });
    } finally { await f.client.dispose(); } expect(f.ports.every(port => port.ended && port.worker.threadId === -1)).toBe(true);
  });
  it.each(['超时', '取消'] as const)('捕获模式恶意回溯%s真正终止线程，下一次正常命令可恢复', async kind => {
    const f = fixture(kind === '超时' ? 100 : 1500); try {
      const pending = f.client.run(request('(?<词>a+)+$', 'a'.repeat(100000) + '!', '$<词>'));
      if (kind === '取消') { await vi.waitFor(() => expect(f.ports[0]?.sent).toBe(true)); await f.client.cancel(); }
      await expect(pending).resolves.toMatchObject({ status: 'blocked', reason: kind === '超时' ? 'timeout' : 'cancelled' }); expect(f.ports[0].ended).toBe(true); expect(f.ports[0].worker.threadId).toBe(-1);
      expect(await f.client.run(request())).toMatchObject({ status: 'ready', operation: 'preview' }); expect(f.ports).toHaveLength(2);
    } finally { await f.client.dispose(); } expect(f.ports.every(port => port.ended && port.worker.threadId === -1)).toBe(true);
  });
});
