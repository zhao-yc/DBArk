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
const nativeHelper = readFileSync(new URL('../helpers/queryLayoutNativeWindow.ts', import.meta.url), 'utf8');
const pageGeometry = (maximum = 614) => ({ viewport: { width: 1400, height: 1000, devicePixelRatio: 2 }, tab: { x: 0, y: 132, width: 1100, height: 844 }, editor: { x: 0, y: 213, width: 1100, height: Math.min(300, maximum) }, separator: { minimum: 130, maximum, value: Math.min(300, maximum) }, children: [{ classes: 'toolbar', rect: { x: 0, y: 169, width: 1100, height: 44 } }] });

/** 原controller.step核每个await两侧；只有系统窗口/页面/附件端口是RAM。 */
function fixture(options: { platform?: 'darwin' | 'win32'; sizes?: number[][]; viewports?: number[][]; maxima?: number[]; attachmentFails?: boolean; expire?: 'identity' | 'set' | 'center' | 'get' | 'page' | 'attach'; wrongWindow?: boolean; wrongContents?: boolean; diagnosticFails?: boolean } = {}) {
  const { sizes = [[1400, 1000]], viewports, maxima = [614], attachmentFails = false } = options;
  const attachments: Array<{ name: string; value: any }> = [], annotations: unknown[] = [], polls: Array<{ timeout: number; expected: unknown; attempts: number }> = [];
  let alive = true, index = 0, currentSize = sizes[0];
  const expire = (stage: typeof options.expire) => { if (options.expire === stage) alive = false; };
  const getContentSize = vi.fn(() => { currentSize = sizes[Math.min(index++, sizes.length - 1)]; expire('get'); return currentSize; });
  const getDisplayMatching = vi.fn(() => ({ id: 9, bounds: { x: 0, y: 0, width: 1920, height: 1200 }, workArea: { x: 0, y: 30, width: 1920, height: 1100 }, scaleFactor: 2 }));
  const native = { id: 1, webContents: { id: 2, getZoomFactor: vi.fn(() => 1) }, isDestroyed: vi.fn(() => false), setMinimumSize: vi.fn(), setContentSize: vi.fn(() => { expire('set'); }), center: vi.fn(() => { expire('center'); }), getContentSize,
    getBounds: vi.fn(() => { if (options.diagnosticFails) throw Error('合成补充诊断失败'); return { x: 0, y: 30, width: currentSize[0], height: currentSize[1] + 35 }; }),
    getContentBounds: vi.fn(() => ({ x: 0, y: 65, width: currentSize[0], height: currentSize[1] })), getMinimumSize: vi.fn(() => [720, 320]),
  };
  const api = { BrowserWindow: { fromId: vi.fn(() => ({ ...native, id: options.wrongWindow ? 3 : native.id, webContents: { ...native.webContents, id: options.wrongContents ? 4 : native.webContents.id } })) }, screen: { getDisplayMatching } };
  const handle = { evaluate: vi.fn(async (action: (window: typeof native, value: any) => unknown, value: unknown) => { const result = action(native, value); if (handle.evaluate.mock.calls.length === 1) expire('identity'); return result; }) };
  const evaluate = vi.fn(async () => { const n = evaluate.mock.calls.length - 1, view = viewports?.[Math.min(n, viewports.length - 1)] ?? currentSize; const value = { ...pageGeometry(maxima[Math.min(n, maxima.length - 1)]), viewport: { width: view[0], height: view[1], devicePixelRatio: 2 } }; expire('page'); return value; });
  const applicationEvaluate = vi.fn(async (action: (modules: typeof api, identity: unknown) => unknown, identity: unknown) => action(api, identity));
  const owner = { application: { browserWindow: vi.fn(async () => handle), evaluate: applicationEvaluate }, page: { evaluate }, closed: false, confirmed: false } as unknown as IndentNativeOwner;
  const assertCurrent = vi.fn(() => { if (!alive) throw Error('原scope已失效'); });
  const run = new EditorIndentNativeRun({ assertCurrent } as unknown as IndentNativePort); run.acquiredOwner(owner);
  const info = { annotations, attach: vi.fn(async (name: string, input: { body: Buffer }) => {
    attachments.push({ name, value: JSON.parse(input.body.toString()) }); expire('attach'); if (attachmentFails) throw Error('合成附件写入失败');
  }) };
  // 至多四次立即采样只用于RAM验证分支；不模拟真实间隔或5秒，不替代原生验收。
  const poll = (sample: () => Promise<unknown>, options: { timeout: number }) => {
    const record = { timeout: options.timeout, expected: undefined as unknown, attempts: 0 }; polls.push(record);
    const check = async (expected: unknown, compare: (actual: unknown) => void) => {
      record.expected = expected; let failure: unknown;
      for (let attempt = 0; attempt < 4; attempt++) { record.attempts++; const actual = await sample(); try { compare(actual); return; } catch (reason) { failure = reason; } }
      throw failure;
    };
    return { toBe: (expected: unknown) => check(expected, actual => expect(actual).toBe(expected)), toBeGreaterThan: (expected: number) => check(expected, actual => expect(actual).toBeGreaterThan(expected)) };
  };
  const nativeCode = ts.transpileModule(nativeHelper, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const readNative = runInNewContext(nativeCode + '\nexports.readQueryLayoutNativeWindow', { exports: {} });
  const code = ts.transpileModule(functions + '\nglobalThis.actions={resize,readyMaximum};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actions = runInNewContext(code + '\nactions', { expect: { poll }, Buffer, process: { platform: options.platform ?? 'darwin' }, readQueryLayoutNativeGeometry() {}, readQueryLayoutNativeWindow: readNative }) as { resize(run: EditorIndentNativeRun, owner: IndentNativeOwner, width: number, height: number, info: unknown): Promise<void>; readyMaximum(run: EditorIndentNativeRun, owner: IndentNativeOwner, info: unknown): Promise<void> };
  return { resize: (height = 1000) => actions.resize(run, owner, 1400, height, info), ready: () => actions.readyMaximum(run, owner, info), run, owner, native, evaluate, applicationEvaluate, getDisplayMatching, attachments, annotations, polls };
}

it('只发一次原请求，连续真实一致样本后才完成尺寸观察', async () => {
  const f = fixture({ sizes: [[1400, 612], [1400, 1000], [1400, 1000]] }); await f.resize();
  expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(1400, 1000);
  expect(f.native.getContentSize).toHaveBeenCalledTimes(3); expect(f.polls).toEqual([{ timeout: 5000, expected: true, attempts: 3 }]);
  expect(f.attachments.map(value => value.value.actual.height)).toEqual([612, 1000, 1000]);
  expect(f.attachments.map(value => value.value.stable)).toEqual([false, false, true]); expect(f.run.retained).toBe(false);
});
it('同一原窗口完成尺寸请求后只居中一次，不能沿用小窗口原y造成外框越界', async () => {
  const f = fixture(); await f.resize();
  expect(f.native.center).toHaveBeenCalledOnce();
  expect(f.native.center.mock.invocationCallOrder[0]).toBeGreaterThan(f.native.setContentSize.mock.invocationCallOrder[0]);
  expect(f.native.center.mock.invocationCallOrder[0]).toBeLessThan(f.native.getContentSize.mock.invocationCallOrder[0]);
});
it('Windows保留原尺寸设置，不继承Mac居中准备而触发系统尺寸收缩', async () => {
  const f = fixture({ platform: 'win32' }); await f.resize();
  expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(1400, 1000); expect(f.native.center).not.toHaveBeenCalled();
  expect(f.attachments.at(-1)?.value).toMatchObject({ actual: { width: 1400, height: 1000 }, stable: true });
});
it('尺寸返回后原scope失效不能继续居中；居中报错不能继续读取几何', async () => {
  const stale = fixture({ expire: 'set' }); await expect(stale.resize()).rejects.toThrow('原scope已失效'); expect(stale.native.center).not.toHaveBeenCalled();
  const broken = fixture(); broken.native.center.mockImplementationOnce(() => { throw Error('合成原窗口定位失败'); });
  await expect(broken.resize()).rejects.toThrow('合成原窗口定位失败'); expect(broken.native.getContentSize).not.toHaveBeenCalled(); expect(broken.attachments).toEqual([]);
});
it.each([942, 645])('OS实得%s高度可完成观察，但仍须真实原>410准入', async actual => {
  const f = fixture({ sizes: [[1400, actual]], maxima: [410] }); await f.resize(); await expect(f.ready()).rejects.toThrow();
  expect(f.attachments[0].value.requested).toEqual({ width: 1400, height: 1000 }); expect(f.attachments[0].value.actual.height).toBe(actual);
  expect(f.attachments[0].value.native.diagnostics).toMatchObject({ minimumSize: [720, 320], display: { id: 9, scaleFactor: 2 } });
  expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(1400, 1000); expect(f.polls.map(poll => poll.expected)).toEqual([true, 410]);
});
it.each([[1399, 942], [1400, 0], [1400, -1], [1400, NaN], [1400, 1001]])('宽度未达原请求或高度无效/超过原请求仍失败：%s×%s', async (width, height) => { const f = fixture({ sizes: [[width, height]] }); await expect(f.resize()).rejects.toThrow(); expect(f.native.setContentSize).toHaveBeenCalledOnce(); });
it('native与视口持续不一致不能继续', async () => { const f = fixture({ sizes: [[1400, 942]], viewports: [[1400, 941]] }); await expect(f.resize()).rejects.toThrow(); expect(f.polls[0].attempts).toBe(4); });
it('native与视口每次一致但高度不稳定仍失败', async () => { const f = fixture({ sizes: [[1400, 942], [1400, 645], [1400, 942], [1400, 645]] }); await expect(f.resize()).rejects.toThrow(); expect(f.attachments.every(value => !value.value.stable)).toBe(true); });
it('不一致样本打断稳定链，不能拼接两端相同尺寸', async () => { const f = fixture({ sizes: [[1400, 942]], viewports: [[1400, 942], [1400, 941], [1400, 942], [1400, 941]] }); await expect(f.resize()).rejects.toThrow(); });
it('缩小仍只发原480请求，实得高度超过480不能观察通过', async () => { const f = fixture({ sizes: [[1400, 645]] }); await expect(f.resize(480)).rejects.toThrow(); expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(1400, 480); });
it('真实尺寸已到而布局尚未完成可在原5秒观察，410门槛保持', async () => {
  const f = fixture({ maxima: [226, 614] }); await f.ready();
  expect(f.polls).toEqual([{ timeout: 5000, expected: 410, attempts: 2 }]);
  expect(f.attachments.map(value => value.value.separator.maximum)).toEqual([226, 614]);
  expect(f.native.setContentSize).not.toHaveBeenCalled();
});
it.each([226, 410])('实际上限%s始终不满足原严格准入，不能放宽为当前值', async maximum => {
  const f = fixture({ maxima: [maximum] }); await expect(f.ready()).rejects.toThrow(); expect(f.polls[0].expected).toBe(410);
});
it('native读回后原scope失效，不能追加页面或附件观察', async () => {
  const f = fixture({ expire: 'get' }); await expect(f.resize()).rejects.toThrow('原scope已失效');
  expect(f.evaluate).not.toHaveBeenCalled(); expect(f.attachments).toEqual([]); expect(f.run.retained).toBe(true);
});
it.each(['identity', 'set', 'center', 'page', 'attach'] as const)('%s异步返回后scope过期，不能继续下一动作', async expire => {
  const f = fixture({ expire, attachmentFails: expire === 'attach' }); await expect(f.resize()).rejects.toThrow('原scope已失效'); expect(f.run.retained).toBe(true);
  if (expire === 'identity') expect(f.native.setContentSize).not.toHaveBeenCalled();
  if (expire === 'identity' || expire === 'set') expect(f.applicationEvaluate).not.toHaveBeenCalled();
  if (expire === 'page') expect(f.attachments).toEqual([]);
  const count = f.applicationEvaluate.mock.calls.length; await expect(f.resize()).rejects.toThrow(); expect(f.applicationEvaluate).toHaveBeenCalledTimes(count);
});
it.each(['wrongWindow', 'wrongContents'] as const)('Main解析出的%s身份不符时立即停链', async key => { const f = fixture({ [key]: true }); await expect(f.resize()).rejects.toThrow('身份已失效'); expect(f.evaluate).not.toHaveBeenCalled(); expect(f.run.retained).toBe(true); });
it('诊断附件失败不遮盖原尺寸失败，也不能伪造尺寸完成', async () => {
  const f = fixture({ sizes: [[1400, 942]], viewports: [[1400, 941]], attachmentFails: true }); await expect(f.resize()).rejects.toThrow();
  expect(f.annotations).toHaveLength(4); expect(f.polls[0].attempts).toBe(4);
  expect(JSON.stringify(f.annotations)).not.toContain('合成附件写入失败');
});
it('附件失败不改变已满足的原尺寸/布局断言', async () => {
  const f = fixture({ attachmentFails: true }); await f.resize(); await f.ready(); expect(f.annotations).toHaveLength(3); expect(f.run.retained).toBe(false);
});
it('补充getter失败保留未知，不补读screen，也不能遮盖真实尺寸不一致', async () => { const f = fixture({ diagnosticFails: true, viewports: [[1400, 941]] }); await expect(f.resize()).rejects.toThrow(); expect(f.getDisplayMatching).not.toHaveBeenCalled(); expect(f.attachments.every(value => value.value.native.diagnostics === null)).toBe(true); expect(JSON.stringify(f.attachments)).not.toContain('合成补充诊断失败'); });
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
