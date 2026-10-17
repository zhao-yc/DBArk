import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
const io = vi.hoisted(() => ({ source: '', start: 0, end: 0, multi: false, readOnly: false, events: [] as string[], editor: null as any, format: undefined as undefined | (() => void) }));
/** 只替换Monaco外界端口；真实QueryTab、store和DOM负责按钮、正文回传及副作用边界。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { useEffect, createElement } = await import('react');
  return { SqlEditor(props: any) {
    io.format = props.onFormat;
    useEffect(() => {
      io.source = props.value; let version = 1;
      const position = (offset: number) => { const lines = io.source.slice(0, offset).split('\n'); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 }; };
      const offset = (p: any) => io.source.split('\n').slice(0, p.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + p.column - 1;
      const range = (start: number, end: number) => ({ getStartPosition: () => position(start), getEndPosition: () => position(end), isEmpty: () => start === end });
      const model = { isDisposed: () => false, getValue: () => io.source, getValueLength: () => io.source.length, getVersionId: () => version, getOffsetAt: offset, getFullModelRange: () => range(0, io.source.length), getEOL: () => '\n' };
      io.editor = { getModel: () => model, getSelections: () => io.multi ? [range(0, 0), range(0, 0)] : [range(io.start, io.end)], getRawOptions: () => ({ readOnly: io.readOnly }), pushUndoStop: () => { io.events.push('undo-stop'); return true; }, executeEdits: (name: string, edits: any[]) => { io.events.push(name); for (const edit of edits) io.source = io.source.slice(0, offset(edit.range.getStartPosition())) + edit.text + io.source.slice(offset(edit.range.getEndPosition())); version++; props.onChange(io.source); return true; }, focus: () => io.events.push('focus') };
      props.onReady?.(io.editor);
    }, []);
    return createElement('div');
  } };
});
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let commands: string[];
beforeAll(async () => { document = memoryDocument(); ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store')); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 格式化只允许普通草稿恢复写入；任何执行、建连、会话、历史或保存查询调用都失败。 */
async function mount(source: string, start = 0, end = 0) {
  io.start = start; io.end = end; io.multi = false; io.readOnly = false; io.events = []; commands = [];
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string) => { commands.push(command); if (command === 'settings.save') return; throw Error('禁止格式化产生外界命令'); } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', title: '合成查询', connectionId: 'c', sql: source, databaseContext: { state: 'known', database: null }, sourceBinding: { id: '来源', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } }] }, connections: [{ id: 'c', name: '离线连接', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'offline', group: '', color: '' }], connectionVersions: {}, activeJobs: {}, dirtyTabs: {} });
  function View() { const tab = useWorkspace(state => state.settings.tabs[0]); return <QueryTab tab={tab} onHistory={() => {}}/>; }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<View/>));
}
async function click(entry: '按钮' | '快捷回调') { if (entry === '快捷回调') { expect(io.format).toBeTypeOf('function'); await act(async () => io.format!()); await flushSettings(); return; } const button = document.body.querySelectorAll('button').find(node => node.getAttribute('aria-label') === '格式化 SQL'); expect(button).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click'))); await flushSettings(); }

describe.each(['按钮', '快捷回调'] as const)('真实QueryTab格式化%s', entry => {
  it.each([[8, true], [4, false]] as const)('显式操作使用当前全局宽度%s/空格%s，不自动格式化或新增副作用', async (editorTabSize, editorInsertSpaces) => {
    const source = 'select a,b from 表 where id=1;'; await mount(source);
    await act(async () => useWorkspace.getState().updateSettings({ editorTabSize, editorInsertSpaces }));
    expect(io.source).toBe(source); expect(io.events).toEqual([]); await click(entry);
    expect(io.source).toContain('\n' + (editorInsertSpaces ? ' '.repeat(editorTabSize) : '\t') + 'a,'); expect(io.events).toEqual(['undo-stop', 'dbark-sql-format', 'undo-stop', 'focus']); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });
  it.each([true, false])('选区/全文只走单次executeEdits及两侧undo stop，不改变来源或执行状态 %s', async selected => {
    const prefix = 'select 0;\n', body = "select 名称,'🚢' from 表 where id=1;", suffix = '\nselect 9;', source = prefix + body + suffix;
    await mount(source, selected ? prefix.length : 0, selected ? prefix.length + body.length : 0);
    const before = useWorkspace.getState(), binding = before.settings.tabs[0].sourceBinding;
    await click(entry); expect(io.events).toEqual(['undo-stop', 'dbark-sql-format', 'undo-stop', 'focus']);
    const after = useWorkspace.getState(); expect(after.settings.tabs[0].sql).toBe(io.source); expect(io.source).not.toBe(source);
    if (selected) { expect(io.source.startsWith(prefix)).toBe(true); expect(io.source.endsWith(suffix)).toBe(true); }
    expect(after.settings.tabs[0].sourceBinding).toBe(binding); expect(after.activeJobs).toEqual(before.activeJobs); expect(after.dirtyTabs).toEqual(before.dirtyTabs); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });
  it.each(['分隔符', '未闭合', '格式器异常', '多选区', '只读', '过期草稿', '非活动标签', '后台作业', '弹窗'])('%s拒绝时正文与编辑栈未触碰', async reason => {
    const source = reason === '分隔符' ? 'DELIMITER $$\nselect 1$$' : reason === '未闭合' ? "select '未闭合" : reason === '格式器异常' ? 'select [合成字段] from 表;' : 'select a,b from 表;'; await mount(source);
    if (reason === '多选区') io.multi = true; if (reason === '只读') io.readOnly = true;
    if (reason === '过期草稿') await act(async () => useWorkspace.getState().updateTab('t', { sql: 'select 外部新草稿;' }));
    if (reason === '非活动标签') await act(async () => useWorkspace.getState().updateSettings({ activeTabId: '其他' }));
    if (reason === '后台作业') await act(async () => useWorkspace.getState().setBusy('t', true));
    let dialog: any; if (reason === '弹窗') { dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.appendChild(dialog); }
    await click(entry); expect(io.source).toBe(source); expect(io.events).toEqual([]); expect(commands.filter(command => command !== 'settings.save')).toEqual([]); dialog?.parentNode?.removeChild(dialog);
  });
});
