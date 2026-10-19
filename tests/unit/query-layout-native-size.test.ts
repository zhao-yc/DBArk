import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { EditorIndentNativeRun, type IndentNativeOwner, type IndentNativePort } from '../e2e/editor-indentation-native-owner';

const spec = readFileSync(new URL('../e2e/query-layout-native.spec.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('layout.ts', spec, ts.ScriptTarget.Latest, true);
/** 只提取原测试函数执行RAM边界，不导入专项门、不启动Playwright或Electron。 */
const functions = ['attachGeometry', 'resize', 'geometry', 'readyMaximum'].map(name => {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw Error('缺少原分栏尺寸函数：' + name);
  return node.getText(tree);
}).join('\n');
const helper = readFileSync(new URL('../helpers/queryLayoutNativeGeometry.ts', import.meta.url), 'utf8');
const pageGeometry = (maximum = 614) => ({ viewport: { width: 1400, height: 1000, devicePixelRatio: 2 }, tab: { x: 0, y: 132, width: 1100, height: 844 }, editor: { x: 0, y: 213, width: 1100, height: Math.min(300, maximum) }, separator: { minimum: 130, maximum, value: Math.min(300, maximum) }, children: [{ classes: 'toolbar', rect: { x: 0, y: 169, width: 1100, height: 44 } }] });

/** 原controller.step核每个await两侧；只有系统窗口/页面/附件端口是RAM。 */
function fixture(sizes: number[][] = [[1400, 1000]], maxima = [614], attachmentFails = false) {
  const attachments: Array<{ name: string; value: any }> = [], annotations: unknown[] = [], polls: Array<{ timeout: number; expected: unknown; attempts: number }> = [];
  let alive = true, afterNative: (() => void) | undefined;
  const getContentSize = vi.fn(() => { const result = sizes[Math.min(getContentSize.mock.calls.length - 1, sizes.length - 1)]; afterNative?.(); return result; });
  const native = { setMinimumSize: vi.fn(), setContentSize: vi.fn(), getContentSize };
  const handle = { evaluate: vi.fn(async (action: (window: typeof native, value: any) => unknown, value: unknown) => action(native, value)) };
  const evaluate = vi.fn(async () => pageGeometry(maxima[Math.min(evaluate.mock.calls.length - 1, maxima.length - 1)]));
  const owner = { application: { browserWindow: vi.fn(async () => handle) }, page: { evaluate }, closed: false, confirmed: false } as unknown as IndentNativeOwner;
  const assertCurrent = vi.fn(() => { if (!alive) throw Error('原scope已失效'); });
  const run = new EditorIndentNativeRun({ assertCurrent } as unknown as IndentNativePort); run.acquiredOwner(owner);
  const info = { annotations, attach: vi.fn(async (name: string, input: { body: Buffer }) => {
    attachments.push({ name, value: JSON.parse(input.body.toString()) }); if (attachmentFails) throw Error('合成附件写入失败');
  }) };
  // 两次立即采样只用于RAM验证分支；不模拟经过真实5秒，不替代原生验收。
  const poll = (sample: () => Promise<unknown>, options: { timeout: number }) => {
    const record = { timeout: options.timeout, expected: undefined as unknown, attempts: 0 }; polls.push(record);
    const check = async (expected: unknown, compare: (actual: unknown) => void) => {
      record.expected = expected; let failure: unknown;
      for (let attempt = 0; attempt < 2; attempt++) { record.attempts++; const actual = await sample(); try { compare(actual); return; } catch (reason) { failure = reason; } }
      throw failure;
    };
    return { toEqual: (expected: unknown) => check(expected, actual => expect(actual).toEqual(expected)), toBeGreaterThan: (expected: number) => check(expected, actual => expect(actual).toBeGreaterThan(expected)) };
  };
  const code = ts.transpileModule(functions + '\nglobalThis.actions={resize,readyMaximum};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actions = runInNewContext(code + '\nactions', { expect: { poll }, Buffer, readQueryLayoutNativeGeometry() {} }) as { resize(run: EditorIndentNativeRun, owner: IndentNativeOwner, width: number, height: number, info: unknown): Promise<void>; readyMaximum(run: EditorIndentNativeRun, owner: IndentNativeOwner, info: unknown): Promise<void> };
  return { resize: () => actions.resize(run, owner, 1400, 1000, info), ready: () => actions.readyMaximum(run, owner, info), run, owner, native, evaluate, attachments, annotations, polls, assertCurrent, expireAfterNative: () => { afterNative = () => { alive = false; }; } };
}

it('请求成功返回仍须真实内容尺寸完成，首个不足样本和完成样本均保留', async () => {
  const f = fixture([[1400, 612], [1400, 1000]]); await f.resize();
  expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(1400, 1000);
  expect(f.native.getContentSize).toHaveBeenCalledTimes(2); expect(f.polls).toEqual([{ timeout: 5000, expected: [1400, 1000], attempts: 2 }]);
  expect(f.attachments.map(value => value.value.actual.height)).toEqual([612, 1000]);
  expect(f.assertCurrent).toHaveBeenCalledTimes(16); expect(f.run.retained).toBe(false);
});
it('OS一直未达到请求尺寸仍失败，不能用请求值冒充实际或变skip', async () => {
  const f = fixture([[1400, 612]], [226]); await expect(f.resize()).rejects.toThrow();
  expect(f.attachments).toHaveLength(2); expect(f.attachments.every(value => value.value.actual.height === 612 && value.value.page.separator.maximum === 226)).toBe(true);
  expect(f.native.setContentSize).toHaveBeenCalledOnce(); expect(f.polls[0].timeout).toBe(5000);
});
it('真实尺寸已到而布局尚未完成可在原5秒观察，410门槛保持', async () => {
  const f = fixture(undefined, [226, 614]); await f.ready();
  expect(f.polls).toEqual([{ timeout: 5000, expected: 410, attempts: 2 }]);
  expect(f.attachments.map(value => value.value.separator.maximum)).toEqual([226, 614]);
  expect(f.native.setContentSize).not.toHaveBeenCalled();
});
it.each([226, 410])('实际上限%s始终不满足原严格准入，不能放宽为当前值', async maximum => {
  const f = fixture(undefined, [maximum]); await expect(f.ready()).rejects.toThrow(); expect(f.polls[0].expected).toBe(410);
});
it('native读回后原scope失效，不能追加页面或附件观察', async () => {
  const f = fixture(); f.expireAfterNative(); await expect(f.resize()).rejects.toThrow('原scope已失效');
  expect(f.evaluate).not.toHaveBeenCalled(); expect(f.attachments).toEqual([]); expect(f.run.retained).toBe(true);
});
it('诊断附件失败不遮盖原尺寸失败，也不能伪造尺寸完成', async () => {
  const f = fixture([[1400, 612]], [226], true); await expect(f.resize()).rejects.toThrow();
  expect(f.annotations).toHaveLength(2); expect(f.polls[0].attempts).toBe(2);
  expect(JSON.stringify(f.annotations)).not.toContain('合成附件写入失败');
});
it('附件失败不改变已满足的原尺寸/布局断言', async () => {
  const f = fixture(undefined, undefined, true); await f.resize(); await f.ready(); expect(f.annotations).toHaveLength(2); expect(f.run.retained).toBe(false);
});
it('原几何收集器只返回数字/类名，缺失属性不变0，不读取正文或表单值', () => {
  const forbidden = () => { throw Error('不得读取正文或表单'); };
  const node = { classList: ['toolbar'], getBoundingClientRect: () => ({ x: 1, y: 2, width: 1400, height: 44 }), get textContent(): never { return forbidden(); }, get value(): never { return forbidden(); } };
  const separator = { getAttribute: (name: string) => name === 'aria-valuemax' ? '226' : name === 'aria-valuenow' ? '' : null };
  const tab = { classList: node.classList, getBoundingClientRect: node.getBoundingClientRect, children: [node], querySelector: (name: string) => name === '.sql-editor-wrap' ? node : separator };
  const context = { exports: {}, document: { querySelector: () => tab }, window: { innerWidth: 1400, innerHeight: 612, devicePixelRatio: 2 } };
  const code = ts.transpileModule(helper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const observed = runInNewContext(code + '\nexports.readQueryLayoutNativeGeometry()', context);
  expect(observed.separator).toEqual({ minimum: null, maximum: 226, value: null }); expect(observed.children[0].classes).toBe('toolbar'); expect(observed.viewport.height).toBe(612);
});
