import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

/** 执行实际封存函数，仅以原生临时文件和附件端口代替桌面；不复制实现。 */
function attachFunction(observations: WeakMap<object, { seal(): string }>, output: (value: string) => void) {
  const source = readFileSync(new URL('../e2e/query-close-others-native.spec.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'attachInputObservation');
  if (!declaration) throw Error('缺少实际原输入附件封存入口');
  const js = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const scope = { inputObservations: observations, Buffer, writeFile, process: { stdout: { write: output } }, attachInputObservation: undefined as unknown as (info: object) => Promise<void> };
  runInNewContext(js, scope); return scope.attachInputObservation;
}

describe('原输入诊断在list reporter下仍独占保留原件', () => {
  it('成功用例也先写真实outputPath再附路径，原件不会只停留在内存报告', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbark-input-artifact-'));
    try {
      const records = new WeakMap<object, { seal(): string }>(), text = '{"receivedRecordsOnly":true,"records":[{"kind":"原写入阶段"}]}';
      const info = { outputPath: (name: string) => join(root, name), attach: vi.fn(async (_name: string, value: { path: string }) => { expect(await readFile(value.path, 'utf8')).toBe(text); }) };
      records.set(info, { seal: () => text }); const output = vi.fn();
      await attachFunction(records, output)(info);
      expect(info.attach).toHaveBeenCalledOnce(); expect(info.attach.mock.calls[0][1]).toEqual({ path: join(root, 'query-close-others-input-observation.json'), contentType: 'application/json' });
      expect(records.has(info)).toBe(false); expect(output).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('同名原件已存在时不覆盖、不重试，仍只保留原错误之外的诊断日志', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbark-input-artifact-'));
    try {
      const file = join(root, 'query-close-others-input-observation.json'); await writeFile(file, '原件', { flag: 'wx' });
      const records = new WeakMap<object, { seal(): string }>(), info = { outputPath: () => file, attach: vi.fn() }, output = vi.fn();
      records.set(info, { seal: () => '{"records":[]}' });
      await expect(attachFunction(records, output)(info)).resolves.toBeUndefined();
      expect(await readFile(file, 'utf8')).toBe('原件'); expect(info.attach).not.toHaveBeenCalled(); expect(output).toHaveBeenCalledOnce();
      expect(output.mock.calls[0][0]).toContain('不替换原用例错误'); expect(records.has(info)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
