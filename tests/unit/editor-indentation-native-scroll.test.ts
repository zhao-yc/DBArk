import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/editor-indentation-native.spec.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true);
/** 只执行原spec观察函数，不导入会注册正式用例或加载原生runtime的模块。 */
const compiled = ts.transpileModule(['snapshots', 'settledCurrent', 'contentSnapshot'].map(name => {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); if (!node) throw Error('缺少原观察函数'); return node.getText(tree);
}).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Frame = { top: number; left?: number; pending?: boolean; changedModel?: boolean };

/** DOM、编辑器和原授权门均为RAM；动画状态与坐标由同一真实evaluate回调同步读取。 */
function fixture(frames: Frame[], fault?: '缺getter' | '原门失效') {
  let active = true, sample = 0, current = frames[0];
  const writes = { scroll: vi.fn(), selection: vi.fn(), value: vi.fn() }, pendingReads = vi.fn(() => current.pending);
  const makeModel = () => ({ isDisposed: () => false, getOptions: () => ({ tabSize: 2, indentSize: 2, insertSpaces: true }), getValue: () => "SELECT '900719925474099312345', '🚢';\n\t-- 原Tab", getEOL: () => '\n', getVersionId: () => 7, getAlternativeVersionId: () => 5 });
  const model = makeModel(), changed = makeModel(), pane = {}, node = { isConnected: true, closest: (selector: string) => selector === '.tab-pane' ? pane : {}, getClientRects: () => [{}] };
  const editor = { getContainerDomNode: () => node, getModel: () => current.changedModel ? changed : model, getRawOptions: () => ({ readOnly: false, detectIndentation: false }), getSelections: () => [{ startLineNumber: 68, startColumn: 6, endLineNumber: 68, endColumn: 10, positionLineNumber: 68, positionColumn: 6 }], getScrollTop: () => current.top, getScrollLeft: () => current.left ?? 0, hasPendingScrollAnimation: fault === '缺getter' ? undefined : pendingReads, setScrollPosition: writes.scroll, setSelection: writes.selection, setValue: writes.value };
  const root = { monaco: { editor: { getEditors: () => [editor] } } }, proofs = new WeakMap();
  const guard = vi.fn(() => { if (!active) throw Error('原TestInfo授权已失效'); });
  const owner = { page: { evaluate: async (callback: Function, input: unknown) => { current = frames[Math.min(sample++, frames.length - 1)]; const result = callback(input); if (fault === '原门失效') active = false; return result; } } };
  const run = { assert: guard, step: async <T>(target: unknown, action: () => Promise<T>) => { guard(); expect(target).toBe(owner); const result = await action(); guard(); return result; } };
  const poll = (read: () => Promise<unknown>, options: { timeout: number; intervals: number[] }) => ({ toBe: async (expected: unknown) => { expect(options.timeout).toBe(5000); let value: unknown; for (let attempt = 0; attempt < 20; attempt++) { value = await read(); if (value === expected) return; } throw Error('RAM有界等待仍有挂起动画或坐标变化'); } });
  const nativeExpect = Object.assign((value: unknown) => expect(value), { poll });
  const functions = runInNewContext(compiled + '\n({snapshots,settledCurrent,contentSnapshot})', { expect: nativeExpect, window: root, document: { querySelectorAll: () => [pane] }, getComputedStyle: () => ({ visibility: 'visible' }), scrollProofs: proofs }) as { snapshots(run: unknown, owner: unknown): Promise<Record<string, unknown>[]>; settledCurrent(run: unknown, owner: unknown, stage: string): Promise<Record<string, unknown>>; contentSnapshot(value: unknown): Record<string, unknown> };
  return { settle: (stage = '首次四空格前') => functions.settledCurrent(run, owner, stage), snapshot: () => functions.snapshots(run, owner), content: functions.contentSnapshot, proofs: () => proofs.get(owner), writes, pendingReads, samples: () => sample, guard };
}

describe('run1632首次热更的滚动观察（RAM）', () => {
  it('1170在途样本不能作基线，须等1294连续空闲；首个pending证据仍保留', async () => {
    const f = fixture([{ top: 1170, pending: true }, { top: 1294, pending: false }, { top: 1294, pending: false }]), result = await f.settle();
    expect(result.scrollTop).toBe(1294); expect(result).not.toHaveProperty('pendingAnimation'); expect(f.samples()).toBe(3);
    expect(f.proofs()[0]).toMatchObject({ samples: 3, pendingSamples: 1, first: { scrollTop: 1170, pending: true, accepted: false }, last: { scrollTop: 1294, pending: false, accepted: true } });
    for (const write of Object.values(f.writes)) expect(write).not.toHaveBeenCalled();
  });
  it('pending已false但坐标仍改变时，也须等两个一致样本', async () => {
    const f = fixture([{ top: 1170, pending: false }, { top: 1294, pending: false }, { top: 1294, pending: false }]); expect((await f.settle()).scrollTop).toBe(1294); expect(f.samples()).toBe(3);
  });
  it('坐标相同但pending一直true时有界拒绝，不以停滞位置当空闲', async () => {
    const f = fixture([{ top: 1170, pending: true }]); await expect(f.settle()).rejects.toThrow('有界等待'); expect(f.samples()).toBe(20); expect(f.proofs()[0].last.accepted).toBe(false);
    for (const write of Object.values(f.writes)) expect(write).not.toHaveBeenCalled();
  });
  it('偏好前后稳定值若真从1170变1294，原contentSnapshot精确scroll断言仍必须失败', async () => {
    const beforeFixture = fixture([{ top: 1170, pending: false }]), afterFixture = fixture([{ top: 1294, pending: false }]);
    const before = await beforeFixture.settle(), after = await afterFixture.settle('首次四空格后');
    expect(beforeFixture.content(before)).toHaveProperty('scrollTop', 1170); expect(afterFixture.content(after)).toHaveProperty('scrollLeft', 0);
    expect(() => expect(afterFixture.content(after)).toEqual(beforeFixture.content(before))).toThrow();
  });
  it('等待期间换model不能重签新基线', async () => {
    const f = fixture([{ top: 1170, pending: true }, { top: 1294, pending: false, changedModel: true }]); await expect(f.settle()).rejects.toThrow('原编辑器或模型已变化'); expect(f.samples()).toBe(2);
  });
  it('缺少公共getter时立即拒绝，不把未知状态按false放行', async () => {
    const f = fixture([{ top: 1294, pending: false }], '缺getter'); await expect(f.settle()).rejects.toThrow('公共滚动动画getter'); expect(f.samples()).toBe(1);
  });
  it('读取返回后原授权失效就停止，不继续轮询或发布样本', async () => {
    const f = fixture([{ top: 1294, pending: false }], '原门失效'); await expect(f.settle()).rejects.toThrow('原TestInfo授权已失效'); expect(f.samples()).toBe(1);
  });
  it('默认snapshots不读新动画getter、不增加字段，其它流程保持原观察形状', async () => {
    const f = fixture([{ top: 1170, pending: true }]), values = await f.snapshot(); expect(f.pendingReads).not.toHaveBeenCalled(); expect(values[0]).not.toHaveProperty('pendingAnimation'); expect(values[0]).toHaveProperty('scrollTop', 1170); expect(values[0]).toHaveProperty('scrollLeft', 0);
  });
  it('长等待不滚掉首样本，附件仍能区分原在途位置和最终空闲位置', async () => {
    const f = fixture([...Array.from({ length: 13 }, () => ({ top: 1170, pending: true })), { top: 1294, pending: false }, { top: 1294, pending: false }]); await f.settle();
    expect(f.proofs()[0]).toMatchObject({ samples: 15, pendingSamples: 13, first: { scrollTop: 1170, pending: true }, last: { scrollTop: 1294, pending: false, accepted: true } });
  });
  it('锁定Monaco真实getter可在没有updateOptions时独立产生1170当前值/1294终点差异', () => {
    const require = createRequire(import.meta.url), root = dirname(require.resolve('monaco-editor/package.json')); expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.55.1');
    function method(file: string, owner: string, name: string) {
      const source = readFileSync(join(root, 'esm/vs', file), 'utf8'), tree = ts.createSourceFile('vendor.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); let found: ts.Node | undefined;
      function visit(node: ts.Node) { if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name?.text === owner) found = node.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(tree) === name); ts.forEachChild(node, visit); }
      visit(tree); if (!found) throw Error('锁定Monaco getter缺失'); return runInNewContext('({' + found.getText(tree) + '})[' + JSON.stringify(name) + ']');
    }
    const scrollable: any = { _state: { scrollTop: 1170, scrollLeft: 0 }, _smoothScrolling: { to: { scrollTop: 1294, scrollLeft: 0 } } };
    for (const name of ['getCurrentScrollPosition', 'getFutureScrollPosition', 'hasPendingScrollAnimation']) scrollable[name] = method('base/common/scrollable.js', 'Scrollable', name);
    const layout: any = { _scrollable: scrollable }; for (const name of ['getCurrentScrollTop', 'hasPendingScrollAnimation']) layout[name] = method('editor/common/viewLayout/viewLayout.js', 'ViewLayout', name);
    const editor: any = { _modelData: { viewModel: { viewLayout: layout } } }; for (const name of ['getScrollTop', 'hasPendingScrollAnimation']) editor[name] = method('editor/browser/widget/codeEditor/codeEditorWidget.js', 'CodeEditorWidget', name);
    expect(editor.getScrollTop()).toBe(1170); expect(editor.hasPendingScrollAnimation()).toBe(true); expect(scrollable.getFutureScrollPosition().scrollTop).toBe(1294);
    scrollable._state = scrollable._smoothScrolling.to; scrollable._smoothScrolling = null; expect(editor.getScrollTop()).toBe(1294); expect(editor.hasPendingScrollAnimation()).toBe(false);
  });
});
