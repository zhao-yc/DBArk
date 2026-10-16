import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachMonacoCaretDiagnostic, collectMonacoCaretDiagnostics, readMonacoCaretDiagnostics } from '../e2e/monaco-caret-diagnostics';

/** 只模拟公开getter和settings.get；任何剪贴板访问都会直接失败。 */
function environment(options: { model?: string; main?: string; api?: boolean; focused?: boolean; editorCount?: number; selection?: boolean | null; modelFails?: boolean; mainFails?: boolean; noActiveTab?: boolean } = {}) {
  const expected = '合成私密SQL🙂\nSELECT 1', calls: string[] = [];
  const wrap = { contains: (node: unknown) => node === container };
  const query = { isConnected: true, getClientRects: () => [{}], querySelector: () => wrap, querySelectorAll: () => [{}] };
  const container = { isConnected: true, getClientRects: () => [{}], closest: () => query };
  const model = { isDisposed: () => false, getValue: () => { if (options.modelFails) throw Error('不可输出的模型正文/路径'); return options.model ?? expected; }, getVersionId: () => 7 };
  const editor = { getContainerDomNode: () => container, hasTextFocus: () => options.focused ?? true, getModel: () => model, getSelections: () => options.selection === null ? null : [{ isEmpty: () => options.selection ?? true }] };
  const root = {
    monaco: options.api === false ? undefined : { editor: { getEditors: () => Array(options.editorCount ?? 1).fill(editor) } },
    dbark: { invoke: async (command: string) => { calls.push(command); if (options.mainFails) throw Error('不可输出的凭据/草稿'); return { activeTabId: options.noActiveTab ? undefined : '不可输出的活动标签身份', tabs: [{ id: '不可输出的活动标签身份', kind: 'query', sql: options.main ?? expected }] }; } }
  };
  Object.defineProperty(root, 'clipboard', { get() { throw Error('禁止读取系统剪贴板'); } });
  vi.stubGlobal('window', root);
  vi.stubGlobal('document', { hasFocus: () => options.focused ?? true, querySelectorAll: () => [query] });
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  return { expected, calls };
}
afterEach(() => vi.unstubAllGlobals());

describe('失败诊断的只读白名单', () => {
  it('只比较独立正文，CRLF归一化后仅返回布尔、UTF16长度和选择状态', async () => {
    const h = environment({ model: '合成私密SQL🙂\r\nSELECT 1' });
    const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.model).toEqual({ availability: 'known', matchesExpected: true, utf16Units: h.expected.length, version: 7, selectionCount: 1, singleSelectionEmpty: true });
    expect(result.mainDraft).toMatchObject({ availability: 'known', matchesExpected: true, activeTabPresent: true, activeTabIsQuery: true });
    expect(result.rendererDraft).toEqual({ availability: 'unknown', reason: 'no-public-store-interface', matchesExpected: null, utf16Units: null });
    expect(h.calls).toEqual(['settings.get']);
    const serialized = JSON.stringify(result);
    for (const privateValue of [h.expected, '合成私密SQL', '不可输出的活动标签身份']) expect(serialized).not.toContain(privateValue);
  });
  it('模型匹配而main空串时保留可区分事实，空串长度0只在真实读到空串后出现', async () => {
    const h = environment({ main: '' }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.model.matchesExpected).toBe(true);
    expect(result.mainDraft).toMatchObject({ availability: 'known', matchesExpected: false, utf16Units: 0 });
  });
  it('模型正文缺失和焦点丢失分别记录，不用main正确冒充输入成功', async () => {
    const h = environment({ model: '', focused: false }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.model.matchesExpected).toBe(false); expect(result.mainDraft.matchesExpected).toBe(true);
    expect(result.documentFocused).toBe(false); expect(result.focusedEditorCount).toBe(0);
  });
  it('没有公开模型API时数量和正文均unknown，不猜成零或空串', async () => {
    const h = environment({ api: false }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.visibleEditorCount).toBeNull(); expect(result.focusedEditorCount).toBeNull();
    expect(result.model).toMatchObject({ availability: 'unknown', matchesExpected: null, utf16Units: null });
    expect(result.mainDraft.matchesExpected).toBe(true);
  });
  it('多个可见聚焦编辑器时不猜模型归属', async () => {
    const h = environment({ editorCount: 2 }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.visibleEditorCount).toBe(2); expect(result.focusedEditorCount).toBe(2); expect(result.model.availability).toBe('unknown');
  });
  it('getter和IPC异常不泄露原消息，已经观察到的焦点计数保留', async () => {
    const h = environment({ modelFails: true, mainFails: true }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.focusedEditorCount).toBe(1); expect(result.model.availability).toBe('unknown'); expect(result.mainDraft.availability).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('不可输出');
  });
  it('缺少活动tab或选择接口时保留unknown，不猜选择为空', async () => {
    const h = environment({ noActiveTab: true, selection: null }); const result = await readMonacoCaretDiagnostics(h.expected);
    expect(result.mainDraft.activeTabPresent).toBeNull(); expect(result.mainDraft.utf16Units).toBeNull();
    expect(result.model.selectionCount).toBeNull(); expect(result.model.singleSelectionEmpty).toBeNull();
  });
  it('page不可访问时单次返回unknown，不重试或输出错误', async () => {
    const evaluate = vi.fn(async () => { throw Error('不可输出的原生异常'); });
    const result = await collectMonacoCaretDiagnostics({ evaluate } as never, '合成|SQL');
    expect(evaluate).toHaveBeenCalledTimes(1); expect(result.sample).toBe('page-unavailable');
    expect(result.expectedUtf16Units).toBe(5); expect(result.model.utf16Units).toBeNull(); expect(JSON.stringify(result)).not.toContain('不可输出');
  });
});

/** 回放正式测试体的控制流；所有页面/输入/附件均为纯端口，不执行浏览器或原生API。 */
async function replayCase(attachmentFails: boolean) {
  const source = readFileSync(new URL('../e2e/sql-completion.spec.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('sql-completion.spec.ts', source, ts.ScriptTarget.Latest, true); let body = '', afterBody = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'test' && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '离线语义补全：CTE投影、完整范围替换、键盘接受和撤销，不执行SQL') body = node.arguments[1].getText(tree);
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'test.afterEach') afterBody = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(body).not.toBe('');
  const code = ts.transpileModule('let pendingOfflineDiagnostic; const replay = ' + body + '; const after = ' + afterBody + '; ({replay,after});', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const originalFailure = Error('合成原prepare断言失败'), attachments: { name: string; data: Record<string, unknown> }[] = [], screenshots: string[] = [], timeouts: number[] = [], inputs: string[] = [], chosen: string[] = [];
  const control = { click: async () => undefined, getByRole: () => control };
  const page = { locator: () => control, getByRole: () => control, keyboard: { press: async () => undefined }, screenshot: async ({ path }: { path: string }) => { screenshots.push(path); }, evaluate: async () => ({ model: { availability: 'unknown', utf16Units: null } }) };
  const run = runInNewContext(code, {
    test: { setTimeout: (value: number) => timeouts.push(value) }, offlineQuery: async () => undefined, page, query: () => ({ locator: () => ({}) }), expect: () => ({ toBeVisible: async () => undefined }),
    atCaret: async (marked: string) => { inputs.push(marked); if (inputs.length === 3) throw originalFailure; return marked.replace('|', ''); },
    choose: async (column: string) => { chosen.push(column); }, expectSql: async () => undefined, modifier: 'Control', pageErrors: ['不可输出的真实页面错误'],
    attachMonacoCaretDiagnostic
  }) as { replay: (fixtures: unknown, info: unknown) => Promise<void>; after: (fixtures: unknown, info: unknown) => Promise<void> };
  let received: unknown;
  const info = { testId: '合成同一测试身份', timeout: 90000, duration: 12, outputPath: (name: string) => name, attach: async (name: string, options: { body: string }) => { attachments.push({ name, data: JSON.parse(options.body) }); if (attachmentFails) throw Error('合成附件失败'); } };
  try {
    await run.replay({}, info);
  } catch (error) { received = error; }
  // 原错误在任何诊断前已原样返回；公开duration只在afterEach阶段使用。
  expect(received).toBe(originalFailure); expect(attachments).toHaveLength(0);
  await run.after({}, info);
  return { received, originalFailure, attachments, screenshots, timeouts, inputs, chosen };
}

describe('正式离线CTE测试的prepare失败边界', () => {
  it('第三轮prepare失败有安全附件，原断言原样抛出，前两轮成功截图及90秒期限保持', async () => {
    const result = await replayCase(false);
    expect(result.received).toBe(result.originalFailure); expect(result.inputs).toHaveLength(3); expect(result.chosen).toEqual(['offline_column_0', 'offline_column_1']);
    expect(result.attachments).toEqual([{ name: '离线补全阶段-2', data: { cold: 2, phase: 'prepare', pageErrorCount: 1, diagnostics: { model: { availability: 'unknown', utf16Units: null } } } }]);
    expect(JSON.stringify(result.attachments)).not.toContain('不可输出');
    expect(result.screenshots).toEqual(['offline-completion-cold-0.png', 'offline-completion-cold-1.png']); expect(result.timeouts).toEqual([90000]);
  });
  it('诊断附件本身失败也不能覆盖原prepare错误或重放输入', async () => {
    const result = await replayCase(true); expect(result.received).toBe(result.originalFailure); expect(result.inputs).toHaveLength(3); expect(result.attachments).toHaveLength(1);
  });
});
