import { expect, it } from 'vitest';
import { build } from 'esbuild';
import vm from 'node:vm';

it('真实SQLite引用线程bundle只含本地方言，严格请求握手及无数据库端口', async () => {
  const bundle = await build({ entryPoints: ['src/renderer/sqliteLocalReferences.worker.ts'], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const inputs = Object.keys(bundle.metafile!.inputs);
  expect(inputs.some(path => /dt-sql-parser|completionAnalysis\.ts|completionLexical\.ts/.test(path))).toBe(false);
  const messages: unknown[] = [], self = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage: (value: unknown) => messages.push(value) };
  // 仅提供消息端口和标准内建对象；真实线程代码不应尝试访问IPC、网络、文件或用户会话。
  vm.runInNewContext(bundle.outputFiles[0].text, { self, TextEncoder, TextDecoder, URL, console });
  expect(messages).toEqual([{ type: 'dbark-sqlite-local-references-ready', version: 1 }]);
  const source = 'SELECT [s].id FROM subject AS "S" WHERE s.id=1';
  const last = source.lastIndexOf('s.id');
  self.onmessage!({ data: { id: 1, source, offset: 7 } }); expect(messages.at(-1)).toMatchObject({ id: 1, result: { status: 'ready', references: [{ start: 7, end: 10 }, { start: last, end: last + 1 }] } });
  for (const input of [{ id: 2, source, offset: 7, mode: {} }, { id: 3, source, offset: -1 }, { id: 4, source, offset: 7, sql: 'SELECT 1' }]) {
    self.onmessage!({ data: input }); expect(messages.at(-1)).toMatchObject({ id: input.id, result: { status: 'blocked', reason: 'input' } });
  }
});
