import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { sqlFormattingZh as text } from '../../src/renderer/locales/sqlFormatting.zh-CN';
import { validateCommand } from '../../src/shared/validation';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Panel: typeof import('../../src/renderer/components/SqlKeywordCasePreferences')['SqlKeywordCasePreferences'];
let store: typeof import('../../src/renderer/store')['useWorkspace'], flush: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let saved: any[], reply: () => Promise<void> | void, settingsRead: any;
const legacy = () => ({ theme: 'light' as const, sidebarWidth: 333, pageSize: 100, resultLimit: 987, dataTypeColors: true, editorFontSize: 20, editorWordWrap: false, editorTabSize: 8, editorInsertSpaces: false, activeTabId: 'q', tabs: [{ id: 'q', kind: 'query' as const, title: '合成', connectionId: 'c', sql: 'select MiXeD;' }] });
beforeAll(async () => {
  document = memoryDocument();
  // 仅补充原生select/option的机械选择状态，React组件、store、schema均执行生产代码。
  const create = document.createElement.bind(document); document.createElement = name => {
    const node = create(name) as any;
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.childNodes }); Object.defineProperty(node, 'value', { get: () => node.childNodes.find((option: any) => option.selected)?.value ?? '', set: value => { for (const option of node.childNodes) option.selected = option.value === value; } }); }
    if (name === 'option') { Object.defineProperty(node, 'value', { get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { if (value && node.parentNode) for (const option of node.parentNode.childNodes) if (option !== node) option.selected = false; selected = value; } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SqlKeywordCasePreferences: Panel } = await import('../../src/renderer/components/SqlKeywordCasePreferences')); ({ useWorkspace: store, flushSettings: flush } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } reply = () => {}; await flush(); document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 只允许配置IPC，任何业务/执行/剪贴板等调用立即失败。 */
function ports() {
  saved = []; reply = () => {}; settingsRead = legacy();
  (window as any).dbark = { invoke: async (command: string, input: any) => {
    if (command === 'settings.get') return settingsRead; if (['connections.list', 'tasks.list'].includes(command)) return [];
    if (command !== 'settings.save') throw Error('偏好禁止其它外部命令'); saved.push(structuredClone(validateCommand('settings.save', input))); await reply();
  } };
}
async function mount(settings: any = legacy()) { ports(); store.setState({ ready: true, settings, activeJobs: {}, dirtyTabs: {}, notice: undefined }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Panel/>)); }
const select = () => document.querySelector(`select[aria-label="${text.keywordCase}"]`)!;
async function choose(value: string) { await act(async () => { select().value = value; select().dispatchEvent(new MemoryEvent('change')); }); }
async function click(label: string) { const button = document.querySelectorAll('button').find(value => value.textContent === label); expect(button).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click'))); }

describe.each(['upper', 'lower'] as const)('偏好%s正式面板', keywordCase => {
it('中文三选项默认原样；修改/取消/恢复草稿零保存，显式保存只合并当前偏好而不还原后来SQL', async () => {
  await mount(); expect(select().childNodes.map(option => option.textContent)).toEqual([text.preserve, text.upper, text.lower]); expect(select().value).toBe('preserve'); await choose(keywordCase); expect(saved).toEqual([]); expect(store.getState().settings).toEqual(legacy());
  await click(text.cancelDraft); expect(select().value).toBe('preserve'); await choose(keywordCase); await click(text.reset); expect(select().value).toBe('preserve'); expect(saved).toEqual([]);
  await choose(keywordCase); const tabs = [{ ...legacy().tabs[0], sql: 'select 后来输入;' }]; await act(async () => store.setState({ settings: { ...store.getState().settings, tabs, sidebarWidth: 345 } }));
  await click(text.save); expect(saved).toEqual([{ ...legacy(), tabs, sidebarWidth: 345, sqlKeywordCase: keywordCase }]); expect(store.getState().settings.tabs).toBe(tabs); expect(document.body.textContent).toContain(text.saved);
});

it('恢复默认需要保存；重读正式settings后保持原样，其它字段不受影响', async () => {
  await mount({ ...legacy(), sqlKeywordCase: keywordCase }); await click(text.reset); expect(store.getState().settings.sqlKeywordCase).toBe(keywordCase); expect(saved).toEqual([]);
  await click(text.save); expect(saved[0]).toEqual({ ...legacy(), sqlKeywordCase: 'preserve' }); settingsRead = saved[0];
  await act(async () => store.getState().initialize()); expect(store.getState().settings).toEqual(settingsRead);
});

it('保存失败可重试，不回滚/覆盖当前SQL，只有当前面板显示错误', async () => {
  await mount(); reply = () => { throw Error('合成落盘失败'); }; await choose(keywordCase); await click(text.save); expect(document.body.textContent).toContain(text.preferenceFailed);
  const tabs = [{ ...legacy().tabs[0], sql: '后来新SQL' }]; await act(async () => store.setState({ settings: { ...store.getState().settings, tabs } })); reply = () => {};
  await click(text.save); expect(saved.at(-1).tabs).toEqual(tabs); expect(store.getState().settings.tabs).toBe(tabs); expect(document.body.textContent).toContain(text.saved);
});

it('旧保存等待中关闭并打开新面板，迟到回包不改新面板状态或新SQL', async () => {
  await mount(); let resolve!: () => void; const pending = new Promise<void>(done => { resolve = done; }); reply = () => pending;
  await choose(keywordCase); await click(text.save); await act(async () => root!.render(<></>));
  const tabs = [{ ...legacy().tabs[0], sql: 'select 新窗口SQL;' }]; await act(async () => { store.setState({ settings: { ...store.getState().settings, tabs } }); root!.render(<Panel/>); });
  reply = () => {}; await act(async () => resolve()); expect(store.getState().settings.tabs).toBe(tabs); expect(document.body.textContent).not.toContain(text.saved); expect(select().value).toBe(keywordCase);
});


});

it('损坏存量由真实renderer初始化局部回退，加载不触发写盘', async () => {
  await mount(); settingsRead = { ...legacy(), sqlKeywordCase: 'mixed' }; await act(async () => store.getState().initialize());
  expect(store.getState().settings).toEqual({ ...legacy(), sqlKeywordCase: 'preserve' }); expect(saved).toEqual([]);
});
