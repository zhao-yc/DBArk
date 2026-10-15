import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, page, pageErrors } from './desktop-fixture';

test('生产构建中的页内查找Worker在实际应用CSP和沙箱下可加载并执行零宽预览', async () => {
  const assets = await readdir(join(process.cwd(), 'dist/renderer/assets'));
  const asset = assets.find(name => /^pageFind\.worker-.*\.js$/.test(name));
  if (!asset) throw new Error('构建未生成页内查找线程');
  const result = await page.evaluate(async name => {
    return new Promise<{ after: string; node: boolean }>((resolve, reject) => {
      const worker = new Worker(new URL('assets/' + name, location.href), { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('生产线程启动或响应超时')); }, 8000);
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('生产线程加载失败')); };
      worker.onmessage = event => {
        if (event.data?.type === 'dbark-page-find-ready') {
          worker.postMessage({ id: 1, request: { operation: 'preview', rows: [{ id: '1', data: { note: '😀A' }, original: { note: '😀A' }, inserted: false, deleted: false }], keys: ['note'], options: { kind: 'text', regex: true, query: '(?:)', caseSensitive: false, wholeCell: false }, replacement: '$1', generation: 1, info: { database: '离线', name: '离线', engine: 'InnoDB', editableKey: ['id'], columns: [{ name: 'note', type: 'TEXT', generated: false }], indexes: [], foreignKeys: [] } } });
        } else {
          clearTimeout(timer); worker.terminate();
          if (event.data?.result?.status !== 'ready') { reject(new Error('生产线程未返回可用预览')); return; }
          resolve({ after: event.data.result.preview.patches[0].after, node: typeof (globalThis as unknown as { require?: unknown }).require !== 'undefined' });
        }
      };
    });
  }, asset);
  expect(result).toEqual({ after: '$1😀$1A$1', node: false }); expect(pageErrors).toEqual([]);
});
