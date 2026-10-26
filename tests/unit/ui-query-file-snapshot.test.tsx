import React, { act } from 'react';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';
import type { TaskEvent } from '../../src/shared/contracts';
import { queryFileReloadZh as reloadText } from '../../src/shared/queryFileReload.zh-CN';
import { queryFileTextDifference } from '../../src/shared/queryFileReload';

const io = vi.hoisted(() => ({ editor: null as any, entries: [] as Array<{ editor: any; initial: string }> }));
/** 只替换Monaco端口；保存入口、正文桥、ReactDOM和工作区store均为真实实现。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { createElement, useEffect, useLayoutEffect, useRef } = await import('react');
  const { editorContentBridge } = await import('../../src/renderer/editorContentBridge');
  const { ContentEditorPort, ContentModelPort } = await import('./editor-content-test-ports');
  return { SqlEditor(props: any) {
    const latest = useRef(props), current = useRef<ReturnType<typeof editorContentBridge> | undefined>(undefined);
    useLayoutEffect(() => { latest.current = props; });
    useLayoutEffect(() => { current.current?.sync(); }, [props.value, props.readOnly]);
    useEffect(() => {
      // RAM模拟空模型采用Windows默认CRLF；完整正文按Monaco的行尾多数规则检测。
      const endings: string[] = props.value.match(/\r\n|\r|\n/g) ?? [], cr = endings.filter(value => value !== '\n').length;
      const eol = !endings.length || cr > endings.length / 2 ? '\r\n' : '\n';
      const editor = new ContentEditorPort(new ContentModelPort(props.value, eol));
      (editor as any).getSelection = () => null;
      const bridge = editorContentBridge(editor as any, () => ({ value: latest.current.value, readOnly: !!latest.current.readOnly, onChange: (sql: string) => latest.current.onChange?.(sql) }), () => {});
      current.current = bridge; io.editor = editor; io.entries.push({ editor, initial: props.value }); props.onReady?.(editor);
      return () => { bridge.dispose(); editor.dispose(); current.current = undefined; };
    }, []);
    return createElement('div', { 'aria-label': '文件保存的RAM编辑器端口' });
  } };
});

describe('追加任务合同的真实UI接线（RAM）', () => {
  it('未持有本窗口租约的文件任务也分类到文件进度，不能借普通SQL取消', async () => {
    await mount(); const id = crypto.randomUUID();
    await act(async () => useWorkspace.getState().onTask({ taskId: id, status: 'running', progress: 10, message: '不可展示的系统路径', queryFileSource: { tabId: '其它文档', operation: 'open', phase: 'reading', bytesProcessed: 10, wrote: 'no', cancellable: true } }));
    await act(async () => showTaskCenter()); const center = document.body.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === '任务中心')!;
    expect(center.textContent).toContain('正在读取文件'); expect(center.textContent).not.toContain('不可展示'); const cancel = center.querySelectorAll('button').find(node => node.textContent === '取消文件操作')!;
    await act(async () => cancel.dispatchEvent(new MemoryEvent('click'))); expect(commands.some(item => item.command === 'query.cancel' || item.command === 'queryFileSources.cancel' || item.command === 'tasks.cancelState')).toBe(false);
    await act(async () => useWorkspace.getState().onTask({ taskId: id, status: 'completed', progress: 100, message: '不可展示的系统路径', queryFileSource: { tabId: '其它文档', operation: 'open', phase: 'terminal', bytesProcessed: 20, wrote: 'no', cancellable: false } })); expect(useWorkspace.getState().queryFileTasks[id].running).toBe(false);
  });
  it('每次保存/另存都有新UUID并在invoke前已订阅；任务中心精确取消而不走SQL取消', async () => {
    const editor = await mount(true), pending = deferred(); let id = '';
    hook = command => {
      if (command === 'queryFileSources.save') { expect(taskListeners.size).toBeGreaterThanOrEqual(2); id = fileEvent('staging'); return pending.promise; }
      return undefined;
    };
    await act(async () => { for (const menu of menus) menu('save-query'); }); await act(async () => showTaskCenter());
    const center = document.body.querySelectorAll('[role="dialog"]').find(node => node.getAttribute('aria-label') === '任务中心')!;
    expect(center.textContent).toContain('123 / 456'); expect(center.textContent).not.toContain('不可展示');
    const cancel = center.querySelectorAll('button').find(node => node.textContent === '取消文件操作')!;
    await act(async () => cancel.dispatchEvent(new MemoryEvent('click'))); await act(async () => cancel.dispatchEvent(new MemoryEvent('click')));
    expect(commands.filter(item => item.command === 'queryFileSources.cancel')).toEqual([{ command: 'queryFileSources.cancel', input: { tabId: 't', taskId: id } }]); expect(commands.some(item => item.command === 'query.cancel' || item.command === 'tasks.cancelState')).toBe(false);
    await act(async () => editor.nativeInput('SELECT 取消期间新草稿;')); await act(async () => pending.resolve({ state: 'cancelled' }));
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: 'SELECT 取消期间新草稿;', fileSourceBinding: sourceView().ref }); expect(useWorkspace.getState().queryFileTasks[id]).toMatchObject({ status: 'cancelled', wrote: 'no', running: false });
  });
  it('用户先请求取消、随后进入替换提交点且Main返回不能取消，最终saved仍是已写成功', async () => {
    await mount(true); const pending = deferred(), cancellation = deferred(); let id = '';
    hook = command => command === 'queryFileSources.save' ? (id = fileEvent('staging'), pending.promise) : command === 'queryFileSources.cancel' ? cancellation.promise : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); }); await click('取消文件操作'); await act(async () => { fileEvent('replacing', false, 'yes'); fileEvent('staging', true, 'no'); cancellation.resolve({ cancelled: false }); });
    await click('取消文件操作'); expect(commands.filter(item => item.command === 'queryFileSources.cancel')).toHaveLength(1);
    await act(async () => { const result = saved('SELECT 初始;'); fileView = result.binding; pending.resolve(result); });
    expect(useWorkspace.getState().queryFileTasks[id]).toMatchObject({ status: 'completed', wrote: 'yes', running: false }); expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding?.revision).toBe(2); expect(useWorkspace.getState().notice?.text).toContain('SQL 文件已保存');
  });
  it.each(['关闭重建', '换来源', '换来源ABA', '换数据库'] as const)('%s发精确取消，迟到已写回包不触碰新文档或新来源', async kind => {
    await mount(true); const pending = deferred(); let id = '';
    hook = command => command === 'queryFileSources.save' ? (id = fileEvent('staging'), pending.promise) : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); });
    if (kind === '关闭重建') { await act(async () => useWorkspace.getState().closeTab('t')); await act(async () => { useWorkspace.getState().openTab({ id: 't', kind: 'query', connectionId: 'c', title: '新文档', sql: 'SELECT 新文档;' }); useWorkspace.getState().setBusy('t', true); }); }
    else await act(async () => {
      if (kind === '换数据库') useWorkspace.getState().updateTab('t', { databaseContext: { state: 'known', database: '新库' }, sql: 'SELECT 新库草稿;' });
      else { useWorkspace.getState().updateTab('t', { fileSourceBinding: { ...sourceView().ref, revision: 77 }, sql: 'SELECT 新来源草稿;' }); if (kind === '换来源ABA') useWorkspace.getState().updateTab('t', { fileSourceBinding: sourceView().ref }); }
    });
    await act(async () => pending.resolve(saved('SELECT 初始;')));
    expect(commands.filter(item => item.command === 'queryFileSources.cancel')).toEqual([{ command: 'queryFileSources.cancel', input: { tabId: 't', taskId: id } }]); expect(useWorkspace.getState().queryFileTasks[id]).toMatchObject({ status: 'completed', wrote: 'yes' }); const tab = useWorkspace.getState().settings.tabs[0];
    if (kind === '关闭重建') { expect(tab).toMatchObject({ title: '新文档', sql: 'SELECT 新文档;' }); expect(Object.hasOwn(tab, 'fileSourceBinding')).toBe(false); expect(useWorkspace.getState().activeJobs.t).toBe(true); }
    if (kind === '换来源') expect(tab).toMatchObject({ sql: 'SELECT 新来源草稿;', fileSourceBinding: { revision: 77 } }); if (kind === '换来源ABA') expect(tab.fileSourceBinding?.revision).toBe(1); if (kind === '换数据库') expect(tab).toMatchObject({ sql: 'SELECT 新库草稿;', databaseContext: { state: 'known', database: '新库' }, fileSourceBinding: sourceView().ref });
  });
  it('相同SQL另存格式仍发送任务，后续明确保存使用另一个UUID', async () => {
    await mount(true); await click('另存 SQL 文件'); await select('文件编码', 'utf16le'); await select('字节顺序标记（BOM）', 'utf16le'); await select('换行策略', 'crlf'); await click('选择并保存 SQL 文件');
    await act(async () => { for (const menu of menus) menu('save-query'); }); const requests = commands.filter(item => ['queryFileSources.saveAs', 'queryFileSources.save'].includes(item.command));
    expect(requests).toHaveLength(2); for (const item of requests) expect(item.input.taskId).toEqual(uuid()); expect(new Set(requests.map(item => item.input.taskId)).size).toBe(2); expect(requests[0].input).toMatchObject({ sql: 'SELECT 初始;', encoding: 'utf16le', bom: 'utf16le', eol: 'crlf' }); expect(requests.every(item => !Object.hasOwn(item.input, 'displayPath') && !Object.hasOwn(item.input, 'path'))).toBe(true);
  });
  it('文件转查询库先release再移除字段，release等待期间的新编辑仍保留', async () => {
    const editor = await mount(true), pending = deferred(), library = { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' as const } };
    hook = command => command === 'queries.create' ? Promise.resolve({ source: library, name: '库副本' }) : command === 'queryFileSources.release' ? pending.promise : undefined;
    await click('另存到本地查询库'); await click('另存为新查询'); expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding).toEqual(sourceView().ref); expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBeUndefined();
    await act(async () => editor.nativeInput('SELECT 释放期间新正文;')); await act(async () => pending.resolve({ released: true }));
    const tab = useWorkspace.getState().settings.tabs[0]; expect(tab).toMatchObject({ sql: 'SELECT 释放期间新正文;', sourceBinding: library }); expect(Object.hasOwn(tab, 'fileSourceBinding')).toBe(false);
    const releaseIndex = commands.findIndex(item => item.command === 'queryFileSources.release'), saveIndex = commands.findIndex(item => item.command === 'settings.save' && item.input.tabs.some((tab: any) => tab.sourceBinding?.id === 'q')); expect(saveIndex).toBeGreaterThan(releaseIndex);
  });
  it('release未获确认不移除文件来源；直接store双主来源写入在本地即拒绝', async () => {
    await mount(true); const library = { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' as const } };
    expect(() => useWorkspace.getState().updateTab('t', { sourceBinding: library })).toThrow('不能同时'); expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBeUndefined();
    hook = command => command === 'queries.create' ? Promise.resolve({ source: library, name: '库副本' }) : command === 'queryFileSources.release' ? Promise.resolve({ released: false }) : undefined;
    await click('另存到本地查询库'); await click('另存为新查询'); expect(document.body.textContent).toContain('文件来源未能解除'); expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: 'SELECT 初始;', fileSourceBinding: sourceView().ref }); expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBeUndefined();
  });
  it('共享摘要拒绝非法代理项，原文仍留在编辑器且不会创建文件任务', async () => {
    const editor = await mount(true); await act(async () => editor.nativeInput('SELECT \ud800'));
    await act(async () => { for (const menu of menus) menu('save-query'); }); expect(editor.getValue()).toBe('SELECT \ud800'); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT \ud800'); expect(commands.filter(item => item.command === 'queryFileSources.save')).toEqual([]); expect(useWorkspace.getState().queryFileDirty.t).toBe(true);
  });
});
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
let TasksDialog: typeof import('../../src/renderer/components/ActivityDialog')['TasksDialog'], showTaskCenter: () => void, taskListeners: Set<(event: TaskEvent) => void>;
let commands: Array<{ command: string; input: any }>, menus: Set<(action: string) => void>, hook: undefined | ((command: string, input: any) => Promise<any> | undefined);
let fileView: any, completed: boolean[], startClose: () => void, frozenFileTab: any, withholdFileTabs = false;
const sqlDigest = (sql: string) => createHash('sha256').update(sql).digest('hex');
const sourceView = (sql = 'SELECT 初始;', revision = 1, name = '合成.sql') => ({ ref: { id: '11111111-1111-4111-8111-111111111111', revision }, name, displayPath: 'RAM展示目录/' + name, encoding: 'utf8', bom: 'none', eol: 'lf', savedSqlDigest: sqlDigest(sql) });
const saved = (sql: string, revision = 2, name = '合成.sql') => ({ state: 'saved', binding: sourceView(sql, revision, name), savedSqlDigest: sqlDigest(sql), unchanged: false });
const uuid = () => expect.stringMatching(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument();
  // ReactDOM受控select需要真实子option集合和值反射；只补RAM DOM只读端口。
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) });
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store'));
  ({ TasksDialog } = await import('../../src/renderer/components/ActivityDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); hook = undefined; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** Main、原生选择和文件写入全部为RAM端口，拒绝SQL执行、建连及其它外界命令。 */
async function mount(bound = false) {
  commands = []; menus = new Set(); taskListeners = new Set(); hook = undefined; completed = []; fileView = bound ? sourceView() : undefined; io.entries = []; frozenFileTab = undefined; withholdFileTabs = false;
  (window as any).dbark = { onTask: (listener: (event: TaskEvent) => void) => { taskListeners.add(listener); return () => { taskListeners.delete(listener); }; }, onMenu: (listener: (action: string) => void) => { menus.add(listener); return () => menus.delete(listener); }, invoke: async (command: string, input: any) => {
    commands.push({ command, input }); const pending = hook?.(command, input); if (pending) return pending;
    if (command === 'settings.save') return;
    if (command === 'queryFileSources.status') return fileView ? { state: 'bound', binding: fileView } : { state: 'unbound' };
    if (command === 'queryFileSources.recent') return [{ id: '834573d5-d9f0-4f20-998a-78be62162755', name: '最近合成.sql', displayPath: '仅用于本机展示/最近合成.sql', encoding: 'gb18030' }];
    if (command === 'queryFileSources.forgetRecent') return { removed: true };
    if (command === 'queryFileSources.saveAs' || command === 'queryFileSources.save') { const result = saved(input.sql, (fileView?.ref.revision ?? 0) + 1); fileView = result.binding; return result; }
    if (command === 'queryFileSources.open') { fileView = sourceView('SELECT 文件打开;', (fileView?.ref.revision ?? 0) + 1); return { state: 'opened', binding: fileView, sql: 'SELECT 文件打开;' }; }
    if (command === 'queryFileSources.release') return { released: true };
    if (command === 'queryFileSources.cancel') return { cancelled: true };
    throw Error('禁止外界调用：' + command);
  } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', connectionId: 'c', title: '合成查询', sql: 'SELECT 初始;', ...(bound ? { fileSourceBinding: fileView.ref } : {}) }] }, connections: [{ id: 'c', name: '合成连接', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'offline' }], activeJobs: {}, dirtyTabs: {}, queryFileDirty: {}, queryFileTasks: {}, tasks: [], connectionVersions: {}, notice: undefined });
  function View() {
    const tabs = useWorkspace(state => state.settings.tabs), [request, setRequest] = React.useState<any>(), [tasks, setTasks] = React.useState(false); startClose = () => setRequest({ tabId: 't' }); showTaskCenter = () => setTasks(true);
    return <>{tabs.map(tab => <section key={tab.id} hidden={tab.id !== useWorkspace.getState().settings.activeTabId}>{withholdFileTabs && tab.id !== 't' ? null : <QueryTab tab={frozenFileTab?.id === tab.id ? frozenFileTab : tab} closeRequest={tab.id === 't' ? request : undefined} onCloseRequestFinished={(_request, close) => { completed.push(close); setRequest(undefined); if (close) useWorkspace.getState().closeTab(tab.id); }} onHistory={() => {}}/>}</section>)}{tasks && <TasksDialog onClose={() => setTasks(false)}/>}</>;
  }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<View/>));
  return io.editor as ContentEditorPort & { model: ContentModelPort };
}
async function click(label: string) {
  const button = document.body.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  expect(button, '应从真实界面找到入口：' + label).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click')));
}
/** 只向真实受控select派发change，不能直接改控制器选项或伪造最终IPC。 */
async function select(label: string, value: string) {
  const field = document.body.querySelectorAll('label').find(node => node.textContent.startsWith(label)), node = field?.querySelector('select');
  expect(node).toBeDefined(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('change')); });
}
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }

describe('0.29真实QueryTab外部检查与当前草稿重载（RAM）', () => {
  const external = "-- 外部<img>\r\nSELECT '🚢';\r\n";
  const checked = () => ({ state: 'preview', previewId: '22222222-2222-4222-8222-222222222222', expiresAt: Date.now() + 10000, change: 'replaced', dirty: true, binding: { ...sourceView(external), eol: 'crlf' }, difference: queryFileTextDifference('SELECT 初始;', external) });
  async function start(pending?: ReturnType<typeof deferred>, applying?: ReturnType<typeof deferred>) {
    const editor = await mount(true), model = editor.model;
    const edits = model.pushEditOperations.bind(model); model.pushEditOperations = (before, values, cursor) => values.length ? edits(before, values, cursor) : cursor([]);
    // 本组只给原RAM模型补充重载所需公开方法，Undo/EOL历史由独立真实Monaco栈用例验证。
    Object.assign(model, { getAlternativeVersionId() { return model.getVersionId(); }, pushEOL(value: number) { model.eol = value === 1 ? '\r\n' : '\n'; model.edit(model.value); }, getPositionAt(offset: number) { const lines = model.value.slice(0, offset).split(model.eol); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 }; } });
    hook = command => command === 'queryFileSources.checkExternal' ? pending?.promise ?? Promise.resolve(checked()) : command === 'queryFileSources.reload' ? applying?.promise ?? Promise.resolve({ state: 'reloaded', sql: external, binding: { ...sourceView(external, 2), eol: 'crlf' } }) : command === 'queryFileSources.discardReload' ? Promise.resolve({ discarded: true }) : undefined;
    await click(reloadText.check);
    if (!pending) await vi.waitFor(async () => { await act(async () => {}); expect(document.body.textContent).toContain(reloadText.dirty); });
    return editor;
  }
  async function accept() {
    const reload = document.body.querySelector(`[aria-label="${reloadText.title}"]`); expect(reload).not.toBeNull();
    const checkbox = reload!.querySelectorAll('input').find(node => node.type === 'checkbox'); expect(checkbox).toBeDefined();
    await act(async () => { checkbox!.checked = true; checkbox!.dispatchEvent(new MemoryEvent('click')); });
  }
  it('显示有界只读差异与dirty确认，预览零保存；确认只更新原模型及ref/EOL/摘要', async () => {
    const editor = await start(), originalModel = editor.model; expect(editor.readOnly).toBe(true); expect(commands.some(c => c.command === 'queryFileSources.reload')).toBe(false); expect(document.body.textContent).toContain(reloadText.dirty); expect(document.body.querySelectorAll('img')).toHaveLength(0);
    const confirm = document.body.querySelectorAll('button').find(node => node.textContent === reloadText.confirm)!; expect(confirm.getAttribute('disabled')).not.toBeNull();
    await accept(); await click(reloadText.confirm); await vi.waitFor(async () => { await act(async () => {}); expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding?.revision).toBe(2); }); expect(editor.model).toBe(originalModel); expect(editor.model.getValue()).toBe(external); expect(editor.model.getEOL()).toBe('\r\n'); expect(editor.readOnly).toBe(false);
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: external, fileSourceBinding: { revision: 2 } }); expect(editor.setValueCalls).toBe(0); expect(io.entries).toHaveLength(1); expect(commands.some(c => c.command.startsWith('query.') || c.command === 'queryFileSources.save')).toBe(false);
  });
  it('取消预览原模型/来源/SQL都不变，解锁；并不启动执行或保存', async () => {
    const editor = await start(), old = useWorkspace.getState().settings.tabs[0]; await click(reloadText.cancel); expect(editor.model.getValue()).toBe('SELECT 初始;'); expect(useWorkspace.getState().settings.tabs[0]).toBe(old); expect(editor.readOnly).toBe(false); expect(commands.some(c => c.command === 'queryFileSources.reload')).toBe(false);
  });
  it('执行中不读源文件，不清除查询自己的busy；预览期间执行菜单也被挡住', async () => {
    const editor = await start(); await act(async () => { for (const menu of menus) menu('execute'); }); expect(commands.some(c => c.command === 'query.execute')).toBe(false); await click(reloadText.cancel);
    await act(async () => useWorkspace.getState().setBusy('t', true)); await click(reloadText.check); expect(commands.filter(c => c.command === 'queryFileSources.checkExternal')).toHaveLength(1); expect(useWorkspace.getState().activeJobs.t).toBe(true); expect(editor.readOnly).toBe(false);
  });
  it.each(['新正文', '正文ABA', '连接修订', '切换标签', '关闭请求'])('%s取消旧预览，迟到检查不复活或覆盖当前草稿', async kind => {
    const pending = deferred(), editor = await start(pending);
    await act(async () => {
      const state = useWorkspace.getState(); if (kind === '新正文' || kind === '正文ABA') { state.updateTab('t', { sql: '后来的输入' }); if (kind === '正文ABA') state.updateTab('t', { sql: 'SELECT 初始;' }); }
      if (kind === '连接修订') useWorkspace.setState({ connectionVersions: { c: 1 } }); if (kind === '切换标签') state.updateSettings({ activeTabId: '另一个标签' }); if (kind === '关闭请求') startClose();
    });
    await act(async () => pending.resolve(checked())); expect(commands.some(c => c.command === 'queryFileSources.reload')).toBe(false); expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding?.revision).toBe(1); expect(editor.model.getValue()).not.toBe(external);
  });
  it('确认在途期间新输入使旧回包失效，不能覆盖新草稿或旧来源；不自动重试', async () => {
    const pending = deferred(), editor = await start(undefined, pending); await accept(); await click(reloadText.confirm); await vi.waitFor(async () => { await act(async () => {}); expect(commands.filter(c => c.command === 'queryFileSources.reload')).toHaveLength(1); });
    await act(async () => useWorkspace.getState().updateTab('t', { sql: '更新的草稿\n' })); await act(async () => pending.resolve({ state: 'reloaded', sql: external, binding: { ...sourceView(external, 2), eol: 'crlf' } }));
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: '更新的草稿\n', fileSourceBinding: { revision: 1 } }); expect(editor.model.getValue()).toBe('更新的草稿\r\n'); expect(commands.filter(c => c.command === 'queryFileSources.reload')).toHaveLength(1);
  });
});

describe('新文件占位首次模型与操作世代（真实store/hook/QueryTab与RAM）', () => {
  /** 原生读取仅用待决IPC；用户仍从正式打开入口进入，不直接调用控制器。 */
  async function waiting() {
    const original = await mount(), pending = deferred();
    hook = command => command === 'queryFileSources.open' ? pending.promise : undefined;
    await click('打开 SQL 文件'); await click('选择并打开 SQL 文件');
    const request = commands.find(item => item.command === 'queryFileSources.open')!;
    expect(request).toBeDefined(); return { original, pending, targetId: request.input.tabId, taskId: request.input.taskId };
  }
  function opened(sql = 'SELECT 文件原文;\n') { fileView = sourceView(sql); return { state: 'opened', sql, binding: fileView }; }
  it('首次挂载错过文件阶段而父props仍旧时不创建空模型（组件输入边界）', async () => {
    const original = await mount(), pending = deferred(); withholdFileTabs = true;
    hook = command => command === 'queryFileSources.open' ? pending.promise : undefined;
    await click('打开 SQL 文件'); await click('选择并打开 SQL 文件');
    const targetId = commands.find(item => item.command === 'queryFileSources.open')!.input.tabId;
    frozenFileTab = useWorkspace.getState().settings.tabs.find(tab => tab.id === targetId);
    const sql = 'SELECT 首次完整原文;\n'; await act(async () => pending.resolve(opened(sql)));
    expect(useWorkspace.getState().queryFileOpenings[targetId]).toBeUndefined(); expect(io.entries).toHaveLength(1);
    // 这是明确构造的父组件输入边界，不声称已在实际App调度或原生窗口复现。
    withholdFileTabs = false; await act(async () => useWorkspace.getState().updateSettings({ tabs: [...useWorkspace.getState().settings.tabs], activeTabId: targetId }));
    expect(io.entries).toHaveLength(1); expect(io.entries[0].editor).toBe(original);
    frozenFileTab = undefined; await act(async () => useWorkspace.getState().updateSettings({ tabs: [...useWorkspace.getState().settings.tabs], activeTabId: targetId }));
    expect(io.entries).toHaveLength(2); expect(io.entries[1].initial).toBe(sql); expect(io.entries[1].editor.model.getEOL()).toBe('\n');
  });
  it('隐藏或选中占位期间均零新模型；完整LF全文第一次建模，正文恢复后原严格摘要clean', async () => {
    const f = await waiting(); expect(io.entries).toHaveLength(1); expect(io.entries[0].editor).toBe(f.original);
    await act(async () => useWorkspace.getState().updateSettings({ activeTabId: f.targetId })); expect(io.entries).toHaveLength(1); expect(document.body.textContent).toContain('正在打开 SQL 文件');
    const sql = 'SELECT 文件原文;\n'; await act(async () => f.pending.resolve(opened(sql)));
    expect(io.entries).toHaveLength(2); const added = io.entries[1]; expect(added.initial).toBe(sql); expect(added.editor.model.getEOL()).toBe('\n'); expect(added.editor.model.controlledEdits).toBe(0);
    expect(useWorkspace.getState().queryFileOpenings).toEqual({}); expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)).toMatchObject({ sql, fileSourceBinding: fileView.ref });
    await act(async () => { await new Promise(done => setTimeout(done, 150)); }); expect(useWorkspace.getState().queryFileDirty[f.targetId]).toBe(false);
    await act(async () => added.editor.nativeInput('SELECT 修改后;\n')); await act(async () => { await new Promise(done => setTimeout(done, 150)); }); expect(useWorkspace.getState().queryFileDirty[f.targetId]).toBe(true);
    // RAM恢复实际正文只验证桥接/摘要接线；不冒充真实键盘Undo或原生撤销栈验收。
    await act(async () => added.editor.nativeInput(sql)); await act(async () => { await new Promise(done => setTimeout(done, 150)); }); expect(useWorkspace.getState().queryFileDirty[f.targetId]).toBe(false);
    expect(io.entries[1]).toBe(added); expect(io.entries[0].editor).toBe(f.original);
  });
  it.each(['甲\r\n乙\r\n', '甲\r\n乙\n丙\r'])('首次完整原文%s不改Main正文与保存摘要，已有模型不重建', async sql => {
    const f = await waiting(); await act(async () => f.pending.resolve(opened(sql)));
    expect(io.entries).toHaveLength(2); expect(io.entries[1].initial).toBe(sql); expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)?.sql).toBe(sql); expect(fileView.savedSqlDigest).toBe(sqlDigest(sql));
    expect(io.entries[0].editor).toBe(f.original);
  });
  it('阶段已解除但父props仍停留旧空标签时继续等待；props更新后首次模型才接收原文', async () => {
    const f = await waiting(); frozenFileTab = useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId);
    await act(async () => f.pending.resolve(opened())); expect(useWorkspace.getState().queryFileOpenings).toEqual({}); expect(io.entries).toHaveLength(1);
    frozenFileTab = undefined; await act(async () => useWorkspace.getState().updateSettings({ tabs: [...useWorkspace.getState().settings.tabs] }));
    expect(io.entries).toHaveLength(2); expect(io.entries[1].initial).toBe('SELECT 文件原文;\n'); expect(io.entries[0].editor).toBe(f.original);
  });
  it.each(['取消', '拒绝', 'RPC失败'] as const)('%s移除本操作未改动空占位，不创建空模型', async reason => {
    const f = await waiting();
    await act(async () => f.pending.resolve(reason === '取消' ? { state: 'cancelled' } : reason === '拒绝' ? { state: 'blocked', reason: 'missing', wrote: 'no', message: '文件缺失' } : Promise.reject(Error('RAM读取拒绝'))));
    expect(io.entries).toHaveLength(1); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(useWorkspace.getState().queryFileOpenings).toEqual({}); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
  });
  it('首轮flush失败不发打开RPC，清理仅本空占位且不创建模型', async () => {
    await mount(); let failed = false;
    hook = (command, input) => command === 'settings.save' && input.tabs.length === 2 ? (failed = true, Promise.reject(Error('RAM首次保存失败'))) : undefined;
    await click('打开 SQL 文件'); await click('选择并打开 SQL 文件'); hook = undefined;
    expect(failed).toBe(true); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false); expect(io.entries).toHaveLength(1); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(useWorkspace.getState().queryFileOpenings).toEqual({});
  });
  it('成功原子发布后flush失败仍保留完整文件正文和来源，不回滚或重建模型', async () => {
    const f = await waiting(), result = opened();
    hook = (command, input) => command === 'settings.save' && input.tabs.some((tab: any) => tab.id === f.targetId && tab.fileSourceBinding) ? Promise.reject(Error('RAM成功后保存失败')) : undefined;
    await act(async () => f.pending.resolve(result)); hook = undefined;
    expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)).toMatchObject({ sql: result.sql, fileSourceBinding: result.binding.ref }); expect(useWorkspace.getState().queryFileOpenings).toEqual({});
    expect(io.entries).toHaveLength(2); expect(io.entries[1].initial).toBe(result.sql); expect(document.body.textContent).toContain('保存结果未能确认');
  });
  it.each(['连接修订', '原来源ABA', '关闭原标签'] as const)('%s精确取消旧task，迟到回包不绑定，未改动占位可归本owner收尾', async change => {
    const f = await waiting();
    await act(async () => {
      const state = useWorkspace.getState();
      if (change === '连接修订') state.invalidateConnection('c');
      if (change === '原来源ABA') { state.updateTab('t', { fileSourceBinding: sourceView().ref }); const tab = useWorkspace.getState().settings.tabs.find(item => item.id === 't')!; const next = { ...tab }; delete next.fileSourceBinding; state.updateSettings({ tabs: useWorkspace.getState().settings.tabs.map(item => item.id === 't' ? next : item) }); }
      if (change === '关闭原标签') state.closeTab('t');
    });
    await act(async () => f.pending.resolve(opened()));
    expect(commands.filter(item => item.command === 'queryFileSources.cancel')).toContainEqual({ command: 'queryFileSources.cancel', input: { tabId: f.targetId, taskId: f.taskId } });
    expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)).toBeUndefined(); expect(useWorkspace.getState().queryFileOpenings).toEqual({}); expect(io.entries).toHaveLength(1);
  });
  it('目标外部草稿先变化则首次模型属于新稿；旧回包不覆盖、不清其它busy', async () => {
    const f = await waiting(); await act(async () => { useWorkspace.getState().updateTab(f.targetId, { sql: '外部新稿\n', title: '新稿' }); useWorkspace.getState().setBusy(f.targetId, true); });
    expect(io.entries).toHaveLength(2); expect(io.entries[1].initial).toBe('外部新稿\n'); await act(async () => f.pending.resolve(opened()));
    expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)).toMatchObject({ sql: '外部新稿\n', title: '新稿' }); expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)?.fileSourceBinding).toBeUndefined(); expect(useWorkspace.getState().activeJobs[f.targetId]).toBe(true); expect(io.entries).toHaveLength(2); expect(useWorkspace.getState().queryFileOpenings).toEqual({});
  });
  it('关闭目标后同id新来源/新busy仍属于新文档，旧打开回包不能覆盖或收尾', async () => {
    const f = await waiting(); await act(async () => {
      const state = useWorkspace.getState(); state.closeTab(f.targetId); state.openTab({ id: f.targetId, kind: 'query', connectionId: 'c', title: '同id新文档', sql: '新来源正文\n', fileSourceBinding: { ...sourceView().ref, revision: 77 } }); state.setBusy(f.targetId, true);
    });
    const before = useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId); await act(async () => f.pending.resolve(opened()));
    expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === f.targetId)).toBe(before); expect(before?.fileSourceBinding?.revision).toBe(77); expect(useWorkspace.getState().activeJobs[f.targetId]).toBe(true); expect(useWorkspace.getState().queryFileOpenings).toEqual({}); expect(io.entries).toHaveLength(2);
  });
  it('已有模型在保存绑定修订、恢复配置和通用busy变化中保持，不借新占位路径重建', async () => {
    const editor = await mount(true); await act(async () => { for (const menu of menus) menu('save-query'); }); expect(io.entries).toHaveLength(1); expect(io.entries[0].editor).toBe(editor);
    await act(async () => { const state = useWorkspace.getState(); state.updateSettings({ tabs: state.settings.tabs.map(tab => ({ ...tab })) }); state.setBusy('t', true); state.setBusy('t', false); });
    expect(io.entries).toHaveLength(1); expect(io.entries[0].editor).toBe(editor); expect(useWorkspace.getState().queryFileOpenings).toEqual({});
  });
});

describe('最近SQL文件真实工具栏/对话框/控制器接线（RAM）', () => {
  const recentId = '834573d5-d9f0-4f20-998a-78be62162755';
  it('最近缓存读取失败不自动重试，用户明确重试仅重读元数据且不打开正文', async () => {
    await mount(); let reads = 0;
    hook = command => command === 'queryFileSources.recent' && ++reads === 1 ? Promise.reject(Error('RAM最近记录初始化未保存')) : undefined;
    await click('最近 SQL 文件'); expect(document.body.textContent).toContain('RAM最近记录初始化未保存'); await act(async () => {}); expect(reads).toBe(1); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false);
    await click('重试读取最近列表'); expect(reads).toBe(2); expect(document.body.textContent).toContain('最近合成.sql'); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
  });
  it('文件菜单同样只打开元数据列表，不在进入时打开正文', async () => {
    await mount(); await act(async () => { for (const menu of menus) menu('recent-sql-file'); });
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('最近 SQL 文件'); expect(commands.filter(item => item.command === 'queryFileSources.recent')).toHaveLength(1); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false);
  });
  it('仅明确确认才打开所选ID，沿新文档与任务链路，原草稿及当前连接上下文保留', async () => {
    await mount(); await act(async () => useWorkspace.getState().updateTab('t', { databaseContext: { state: 'known', database: '当前库' }, sql: 'SELECT 原草稿;' }));
    await click('最近 SQL 文件'); expect(commands.filter(item => item.command === 'queryFileSources.recent')).toHaveLength(1); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false);
    await select('最近的 SQL 文件', recentId); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false); await select('文件编码', 'utf16le'); await click('打开选中的 SQL 文件');
    const request = commands.find(item => item.command === 'queryFileSources.open')!; expect(request.input).toMatchObject({ recentId, encoding: 'utf16le', taskId: uuid() }); expect(request.input.tabId).not.toBe('t'); expect(Object.keys(request.input).sort()).toEqual(['encoding', 'recentId', 'tabId', 'taskId']);
    const tabs = useWorkspace.getState().settings.tabs; expect(tabs.find(tab => tab.id === 't')).toMatchObject({ sql: 'SELECT 原草稿;' }); expect(tabs.find(tab => tab.id === request.input.tabId)).toMatchObject({ sql: 'SELECT 文件打开;', connectionId: 'c', databaseContext: { state: 'known', database: '当前库' }, fileSourceBinding: fileView.ref });
    expect(commands.some(item => /^(connections\.open|sessions\.open|query\.execute)/.test(item.command))).toBe(false);
  });
  it('移除只发元数据ID，不打开文件或删除草稿', async () => {
    await mount(); await click('最近 SQL 文件'); await select('最近的 SQL 文件', recentId); await click('从最近列表移除');
    expect(commands.filter(item => item.command === 'queryFileSources.forgetRecent')).toEqual([{ command: 'queryFileSources.forgetRecent', input: { tabId: 't', recentId } }]); expect(commands.some(item => item.command === 'queryFileSources.open')).toBe(false); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;'); expect(document.body.textContent).toContain('暂无最近 SQL 文件');
  });
  it('失效路径明确给出重新选择入口，失败占位移除且原草稿保持', async () => {
    await mount(); hook = command => command === 'queryFileSources.open' ? Promise.resolve({ state: 'blocked', reason: 'missing', wrote: 'no', message: '合成最近文件已不存在' }) : undefined;
    await click('最近 SQL 文件'); await select('最近的 SQL 文件', recentId); await click('打开选中的 SQL 文件'); expect(document.body.textContent).toContain('合成最近文件已不存在'); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
    await click('重新选择 SQL 文件'); hook = undefined; await click('选择并打开 SQL 文件'); const requests = commands.filter(item => item.command === 'queryFileSources.open'); expect(requests).toHaveLength(2); expect(requests[0].input.recentId).toBe(recentId); expect(requests[1].input.recentId).toBeUndefined(); expect(requests[1].input.path).toBeUndefined();
  });
});
/** 仅向已订阅的真实任务监听器发布RAM进度，阶段不直接修改组件或store。 */
function fileEvent(phase: NonNullable<TaskEvent['queryFileSource']>['phase'], cancellable = true, wrote: 'no' | 'yes' | 'unknown' = 'no') {
  const request = commands.filter(item => ['queryFileSources.save', 'queryFileSources.saveAs', 'queryFileSources.open'].includes(item.command)).at(-1)!;
  const event: TaskEvent = { taskId: request.input.taskId, status: 'running', progress: 30, message: '不可展示的进度路径/SQL', queryFileSource: { tabId: request.input.tabId, operation: request.command.split('.').at(-1) as any, phase, bytesProcessed: 123, totalBytes: 456, cancellable, wrote } };
  for (const listener of [...taskListeners]) listener(event);
  return request.input.taskId as string;
}
/** 真实主执行按钮，保留其busy检查；RAM桥接仍会记录每次SQL发送。 */
async function executeButton() {
  const button = document.body.querySelectorAll('button').find(node => node.querySelector('kbd')?.textContent === '⌘ / Ctrl ↵');
  expect(button).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click')));
}

describe('P2文件作业不得清除查询自己的busy（真实UI与RAM）', () => {
  it.each(['另存', '打开', '重读'] as const)('查询尚未返回时%s获取失败，原查询保持互斥；实际完成后才能再次执行', async mode => {
    await mount(true); const query = deferred();
    hook = command => command === 'connections.open' || command === 'sessions.close' ? Promise.resolve(undefined) : command === 'sessions.open' ? Promise.resolve({ sessionId: 'RAM会话' }) : command === 'query.completionState' ? Promise.resolve({ databaseKnown: true, database: null }) : command === 'query.execute' ? query.promise : undefined;
    await executeButton(); expect(commands.filter(item => item.command === 'query.execute')).toHaveLength(1); expect(useWorkspace.getState().activeJobs.t).toBe(true);
    await click(mode === '打开' ? '打开 SQL 文件' : '另存 SQL 文件'); await click(mode === '打开' ? '选择并打开 SQL 文件' : '选择并保存 SQL 文件');
    if (mode === '重读') await click('重读为新草稿');
    expect(useWorkspace.getState().activeJobs.t).toBe(true); expect(commands.filter(item => ['queryFileSources.save', 'queryFileSources.saveAs', 'queryFileSources.open'].includes(item.command))).toEqual([]);
    await click('取消'); await act(async () => { for (const menu of menus) menu('execute'); }); expect(commands.filter(item => item.command === 'query.execute')).toHaveLength(1); expect(useWorkspace.getState().activeJobs.t).toBe(true);
    await act(async () => query.resolve({ results: [] })); expect(useWorkspace.getState().activeJobs.t).toBe(false);
    await executeButton(); expect(commands.filter(item => item.command === 'query.execute')).toHaveLength(2);
  });
});

describe('真实QueryTab与文件另存的正文捕获接线（RAM）', () => {
  it('关联文件的菜单保存直接使用原引用写回，不打开查询库或路径选择', async () => {
    const editor = await mount(true); editor.model.deferred = true; editor.nativeInput('SELECT 文件新正文;');
    await act(async () => { for (const menu of menus) menu('save-query'); });
    expect(commands.filter(item => item.command === 'queryFileSources.save')).toEqual([{ command: 'queryFileSources.save', input: { tabId: 't', taskId: uuid(), source: sourceView().ref, sql: 'SELECT 文件新正文;' } }]);
    expect(commands.some(item => item.command.startsWith('queries.') || item.command === 'queryFileSources.saveAs')).toBe(false); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding?.revision).toBe(2);
    await act(async () => { await new Promise(done => setTimeout(done, 130)); }); expect(useWorkspace.getState().queryFileDirty.t).toBe(false); expect(document.body.textContent).toContain('文件正文已保存');
  });
  it('关联文件恢复只读status不读外部文件，显示来源编码BOM换行；新正文与空正文都dirty', async () => {
    const editor = await mount(true); await act(async () => { await new Promise(done => setTimeout(done, 130)); });
    expect(commands.filter(item => item.command !== 'settings.save').map(item => item.command)).toEqual(['queryFileSources.status']); expect(document.body.textContent).toContain('RAM展示目录/合成.sql'); expect(document.body.textContent).toContain('UTF-8 / 无 BOM / LF'); expect(useWorkspace.getState().queryFileDirty.t).toBe(false);
    await act(async () => editor.nativeInput('')); expect(useWorkspace.getState().queryFileDirty.t).toBe(true); expect(document.body.textContent).toContain('有未保存的文件修改');
  });
  it('正文或修订一变化就同步撤销clean，旧摘要确认不能把新草稿标成已保存', async () => {
    await mount(true); await act(async () => { await new Promise(done => setTimeout(done, 130)); }); const previous = useWorkspace.getState().settings.tabs[0];
    await act(async () => { useWorkspace.getState().updateTab('t', { sql: 'SELECT 外部新草稿;' }); expect(useWorkspace.getState().queryFileDirty.t).toBe(true); useWorkspace.getState().setQueryFileDirty('t', false, previous); expect(useWorkspace.getState().queryFileDirty.t).toBe(true); });
    const beforeRevision = useWorkspace.getState().settings.tabs[0];
    await act(async () => { useWorkspace.getState().updateTab('t', { fileSourceBinding: { ...fileView.ref, revision: 77 } }); useWorkspace.getState().setQueryFileDirty('t', false, beforeRevision); expect(useWorkspace.getState().queryFileDirty.t).toBe(true); });
  });
  it('菜单另存先flush全文，原生选择等待期间新编辑不改变本次写入且保留新草稿', async () => {
    const editor = await mount(), choice = deferred();
    await act(async () => { for (const menu of menus) menu('save-sql-file'); });
    editor.model.deferred = true; editor.nativeInput('SELECT 点击时最新, \'😀\';');
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
    hook = command => command === 'queryFileSources.saveAs' ? choice.promise : undefined;
    await click('选择并保存 SQL 文件');
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 点击时最新, \'😀\';');
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toHaveLength(1);
    await act(async () => { editor.nativeInput('SELECT 选择期间新草稿;'); editor.model.flush(); });
    await act(async () => { const result = saved('SELECT 点击时最新, \'😀\';', 1); fileView = result.binding; choice.resolve(result); });
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toEqual([{ command: 'queryFileSources.saveAs', input: { tabId: 't', taskId: uuid(), encoding: 'utf8', bom: 'none', eol: 'preserve', sql: 'SELECT 点击时最新, \'😀\';' } }]);
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 选择期间新草稿;'); expect(editor.setValueCalls).toBe(0); expect(editor.undoStops).toBe(0);
    expect(useWorkspace.getState().settings.tabs[0].fileSourceBinding).toEqual(fileView.ref); expect(commands.every(item => ['settings.save', 'queryFileSources.status', 'queryFileSources.saveAs'].includes(item.command))).toBe(true);
  });
  it('只读正文捕获失败时不打开原生选择、不写文件，仍保留对话框', async () => {
    const editor = await mount(); await click('另存 SQL 文件'); editor.readOnly = true; await click('选择并保存 SQL 文件');
    expect(commands.filter(item => item.command.startsWith('queryFileSources.'))).toEqual([]); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
  });
  it('原生选择取消不写入、不关闭原草稿，也不把文件保存转为本地查询库保存', async () => {
    await mount(); hook = command => command === 'queryFileSources.saveAs' ? Promise.resolve({ state: 'cancelled' }) : undefined;
    await click('另存 SQL 文件'); await click('选择并保存 SQL 文件');
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toHaveLength(1); expect(commands.filter(item => item.command === 'queryFileSources.save' || item.command.startsWith('queries.'))).toEqual([]);
    expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;'); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it('写入失败保留正文和来源，不自动重试或显示成功', async () => {
    await mount(); hook = command => command === 'queryFileSources.saveAs' ? Promise.resolve({ state: 'blocked', reason: 'io', message: '合成写入失败', wrote: 'no' }) : undefined;
    await click('另存 SQL 文件'); await click('选择并保存 SQL 文件');
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toHaveLength(1); expect(document.body.textContent).toContain('合成写入失败');
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ title: '合成查询', sql: 'SELECT 初始;' }); expect(useWorkspace.getState().notice).toBeUndefined();
  });
  it('打开先注册并持久化独立文档，再用合同读取；原标签SQL与查询库来源均保留', async () => {
    await mount(); const library = { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' as const } };
    await act(async () => useWorkspace.getState().updateTab('t', { sourceBinding: library })); await click('打开 SQL 文件'); await click('选择并打开 SQL 文件');
    const tabs = useWorkspace.getState().settings.tabs, opened = tabs.find(item => item.id !== 't')!;
    expect(tabs.find(item => item.id === 't')).toMatchObject({ sql: 'SELECT 初始;', sourceBinding: library }); expect(opened).toMatchObject({ sql: 'SELECT 文件打开;', fileSourceBinding: fileView.ref, title: '合成.sql' }); expect(Object.hasOwn(opened, 'sourceBinding')).toBe(false);
    const readIndex = commands.findIndex(item => item.command === 'queryFileSources.open'); expect(readIndex).toBeGreaterThan(0); expect(commands.slice(0, readIndex).some(item => item.command === 'settings.save' && item.input.tabs.some((tab: any) => tab.id === opened.id))).toBe(true);
    expect(commands[readIndex].input).toEqual({ tabId: opened.id, taskId: uuid(), encoding: 'utf8' });
  });
  it('另存文件切换主来源，移除查询库键，不改变当前正文或分栏高度', async () => {
    await mount(); await act(async () => useWorkspace.getState().updateTab('t', { sourceBinding: { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' } }, queryEditorHeight: 420 }));
    await click('另存 SQL 文件'); await click('选择并保存 SQL 文件'); const tab = useWorkspace.getState().settings.tabs[0];
    expect(tab).toMatchObject({ sql: 'SELECT 初始;', queryEditorHeight: 420, fileSourceBinding: fileView.ref }); expect(Object.hasOwn(tab, 'sourceBinding')).toBe(false);
  });
  it.each([['utf8', 'utf8', 'lf'], ['utf16le', 'utf16le', 'crlf'], ['gb18030', 'none', 'cr']] as const)('另存显式选择%s/%s/%s，只发送编码BOM换行和opaque来源', async (encoding, bom, eol) => {
    await mount(true); await click('另存 SQL 文件'); await select('文件编码', encoding); await select('字节顺序标记（BOM）', bom); await select('换行策略', eol); await click('选择并保存 SQL 文件');
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toEqual([{ command: 'queryFileSources.saveAs', input: { tabId: 't', taskId: uuid(), source: sourceView().ref, sql: 'SELECT 初始;', encoding, bom, eol } }]);
  });
  it('文件标签显式另存查询库后仅有查询库来源，并精确释放旧文件引用', async () => {
    await mount(true); const library = { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' as const } };
    hook = command => command === 'queries.create' ? Promise.resolve({ source: library, name: '库副本' }) : undefined;
    await click('另存到本地查询库'); await click('另存为新查询'); const tab = useWorkspace.getState().settings.tabs[0];
    expect(tab).toMatchObject({ sql: 'SELECT 初始;', sourceBinding: library, title: '库副本' }); expect(Object.hasOwn(tab, 'fileSourceBinding')).toBe(false);
    expect(commands.filter(item => item.command === 'queryFileSources.release')).toEqual([{ command: 'queryFileSources.release', input: { tabId: 't', source: sourceView().ref } }]);
  });
  it('保存后关闭直接写回原文件并在设置持久化成功后关闭，不经过查询库对话框', async () => {
    await mount(true); await act(async () => startClose()); await click('保存后关闭');
    expect(completed).toEqual([true]); expect(useWorkspace.getState().settings.tabs).toHaveLength(0); expect(commands.filter(item => item.command === 'queryFileSources.save')).toHaveLength(1); expect(commands.some(item => item.command.startsWith('queries.'))).toBe(false);
  });
  it.each(['新正文', '新标题', '标题ABA', '新来源', '来源ABA'] as const)('关闭保存等待期间%s保留当前草稿，不凭旧回包关闭', async kind => {
    const editor = await mount(true), wait = deferred(); hook = command => command === 'queryFileSources.save' ? wait.promise : undefined;
    await act(async () => startClose()); await click('保存后关闭');
    await act(async () => {
      if (kind === '新正文') editor.nativeInput('SELECT 关闭期间新正文;');
      if (kind === '新标题' || kind === '标题ABA') { useWorkspace.getState().updateTab('t', { title: '用户新标题' }); if (kind === '标题ABA') useWorkspace.getState().updateTab('t', { title: '合成查询' }); }
      if (kind === '新来源' || kind === '来源ABA') { useWorkspace.getState().updateTab('t', { fileSourceBinding: { ...sourceView().ref, revision: 77 } }); if (kind === '来源ABA') useWorkspace.getState().updateTab('t', { fileSourceBinding: sourceView().ref }); }
    });
    await act(async () => wait.resolve(saved('SELECT 初始;')));
    expect(completed).toEqual([false]); const tab = useWorkspace.getState().settings.tabs[0]; expect(tab).toBeDefined();
    if (kind === '新正文') { expect(tab.sql).toBe('SELECT 关闭期间新正文;'); expect(tab.fileSourceBinding?.revision).toBe(2); expect(useWorkspace.getState().queryFileDirty.t).toBe(true); }
    if (kind === '新标题') expect(tab.title).toBe('用户新标题'); if (kind === '标题ABA') expect(tab.title).toBe('合成查询');
    if (kind === '新来源') expect(tab.fileSourceBinding?.revision).toBe(77); if (kind === '来源ABA') expect(tab.fileSourceBinding?.revision).toBe(1);
    expect(commands.filter(item => item.command === 'queryFileSources.save')).toHaveLength(1);
  });
  it.each([['external-change', 'no'], ['missing', 'no'], ['identity-changed', 'no'], ['io', 'no'], ['storage', 'yes'], ['uncertain', 'unknown']] as const)('%s/%s保留草稿，恢复窗口只提供显式重读、另存、取消', async (reason, wrote) => {
    const editor = await mount(true); await act(async () => editor.nativeInput('SELECT 未存草稿;'));
    hook = command => command === 'queryFileSources.save' ? Promise.resolve({ state: 'blocked', reason, wrote, message: '合成文件冲突' }) : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); });
    expect(document.body.textContent).toContain('合成文件冲突'); expect(document.body.textContent).toContain('重读为新草稿'); expect(document.body.textContent).toContain('另存 SQL 文件');
    if (wrote === 'yes') expect(document.body.textContent).toContain('文件已写入'); if (wrote === 'unknown') expect(document.body.textContent).toContain('无法确定文件最终结果');
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: 'SELECT 未存草稿;', fileSourceBinding: sourceView().ref }); expect(commands.filter(item => item.command === 'queryFileSources.save')).toHaveLength(1); expect(commands.some(item => item.command.startsWith('queries.'))).toBe(false);
    await click('取消'); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });
  it('IPC拒绝按结果不确定处理，不透出系统异常或自动重试', async () => {
    await mount(true); hook = command => command === 'queryFileSources.save' ? Promise.reject(Error('不可展示的合成系统路径/SQL')) : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); });
    expect(document.body.textContent).toContain('无法确定文件最终结果'); expect(document.body.textContent).not.toContain('不可展示'); expect(commands.filter(item => item.command === 'queryFileSources.save')).toHaveLength(1); expect(useWorkspace.getState().settings.tabs[0].sql).toBe('SELECT 初始;');
  });
  it('文件已保存但设置落盘失败时明确已写，保留标签且不重复写文件', async () => {
    await mount(true); hook = command => command === 'settings.save' && commands.some(item => item.command === 'queryFileSources.save') ? Promise.reject(Error('不可展示的设置存储路径')) : undefined;
    await act(async () => startClose()); await click('保存后关闭');
    expect(completed).toEqual([false]); expect(document.body.textContent).toContain('文件已写入'); expect(document.body.textContent).toContain('标签来源状态未能持久化'); expect(document.body.textContent).not.toContain('不可展示'); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(commands.filter(item => item.command === 'queryFileSources.save')).toHaveLength(1); hook = undefined;
  });
  it('原视图卸载后旧回包不绑定同ID新文档，也不清除新作业标记', async () => {
    await mount(true); const wait = deferred(); hook = command => command === 'queryFileSources.save' ? wait.promise : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); }); await act(async () => useWorkspace.getState().closeTab('t'));
    await act(async () => { useWorkspace.getState().openTab({ id: 't', kind: 'query', connectionId: 'c', title: '新文档', sql: 'SELECT 新文档;' }); useWorkspace.getState().setBusy('t', true); });
    await act(async () => wait.resolve(saved('SELECT 初始;')));
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ title: '新文档', sql: 'SELECT 新文档;' }); expect(Object.hasOwn(useWorkspace.getState().settings.tabs[0], 'fileSourceBinding')).toBe(false); expect(useWorkspace.getState().activeJobs.t).toBe(true);
  });
  it('关闭保存失败完成否定回执并留在恢复入口，不能隐式转到本地查询库', async () => {
    await mount(true); hook = command => command === 'queryFileSources.save' ? Promise.resolve({ state: 'blocked', reason: 'external-change', wrote: 'no', message: '合成外部冲突' }) : undefined;
    await act(async () => startClose()); await click('保存后关闭'); expect(completed).toEqual([false]); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(document.body.textContent).toContain('合成外部冲突'); expect(commands.some(item => item.command.startsWith('queries.'))).toBe(false);
  });
  it('原生打开取消只移除未修改占位文档，保留原查询及其来源', async () => {
    await mount(true); hook = command => command === 'queryFileSources.open' ? Promise.resolve({ state: 'cancelled' }) : undefined;
    await click('打开 SQL 文件'); await click('选择并打开 SQL 文件'); expect(useWorkspace.getState().settings.tabs).toHaveLength(1); expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ id: 't', sql: 'SELECT 初始;', fileSourceBinding: sourceView().ref }); expect(useWorkspace.getState().settings.activeTabId).toBe('t');
  });
  it('显式重读保留原草稿并另开未关联副本，只推进原文件基线', async () => {
    const editor = await mount(true); await act(async () => editor.nativeInput('SELECT 保留原草稿;'));
    hook = command => command === 'queryFileSources.save' ? Promise.resolve({ state: 'blocked', reason: 'external-change', wrote: 'no', message: '外部已改' }) : undefined;
    await act(async () => { for (const menu of menus) menu('save-query'); }); await click('重读为新草稿');
    const tabs = useWorkspace.getState().settings.tabs; expect(tabs.find(item => item.id === 't')).toMatchObject({ sql: 'SELECT 保留原草稿;', fileSourceBinding: fileView.ref }); const copy = tabs.find(item => item.id !== 't')!;
    expect(copy.sql).toBe('SELECT 文件打开;'); expect(copy.title).toContain('重读副本，未关联'); expect(Object.hasOwn(copy, 'fileSourceBinding')).toBe(false); expect(Object.hasOwn(copy, 'sourceBinding')).toBe(false);
    expect(commands.filter(item => item.command === 'queryFileSources.open')).toEqual([{ command: 'queryFileSources.open', input: { tabId: 't', taskId: uuid(), source: sourceView().ref, encoding: 'utf8' } }]);
  });
});
