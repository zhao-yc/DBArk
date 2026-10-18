import React, { act } from 'react';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

const io = vi.hoisted(() => ({ editor: null as any }));
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
      const editor = new ContentEditorPort(new ContentModelPort(props.value));
      const bridge = editorContentBridge(editor as any, () => ({ value: latest.current.value, readOnly: !!latest.current.readOnly, onChange: (sql: string) => latest.current.onChange?.(sql) }), () => {});
      current.current = bridge; io.editor = editor; props.onReady?.(editor);
      return () => { bridge.dispose(); editor.dispose(); current.current = undefined; };
    }, []);
    return createElement('div', { 'aria-label': '文件保存的RAM编辑器端口' });
  } };
});
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
let commands: Array<{ command: string; input: any }>, menus: Set<(action: string) => void>, hook: undefined | ((command: string, input: any) => Promise<any> | undefined);
let fileView: any, completed: boolean[], startClose: () => void;
const sqlDigest = (sql: string) => createHash('sha256').update(sql).digest('hex');
const sourceView = (sql = 'SELECT 初始;', revision = 1, name = '合成.sql') => ({ ref: { id: '11111111-1111-4111-8111-111111111111', revision }, name, displayPath: 'RAM展示目录/' + name, encoding: 'utf8', bom: 'none', eol: 'lf', savedSqlDigest: sqlDigest(sql) });
const saved = (sql: string, revision = 2, name = '合成.sql') => ({ state: 'saved', binding: sourceView(sql, revision, name), savedSqlDigest: sqlDigest(sql), unchanged: false });
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
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); hook = undefined; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** Main、原生选择和文件写入全部为RAM端口，拒绝SQL执行、建连及其它外界命令。 */
async function mount(bound = false) {
  commands = []; menus = new Set(); hook = undefined; completed = []; fileView = bound ? sourceView() : undefined;
  (window as any).dbark = { onTask: () => () => {}, onMenu: (listener: (action: string) => void) => { menus.add(listener); return () => menus.delete(listener); }, invoke: async (command: string, input: any) => {
    commands.push({ command, input }); const pending = hook?.(command, input); if (pending) return pending;
    if (command === 'settings.save') return;
    if (command === 'queryFileSources.status') return fileView ? { state: 'bound', binding: fileView } : { state: 'unbound' };
    if (command === 'queryFileSources.saveAs' || command === 'queryFileSources.save') { const result = saved(input.sql, (fileView?.ref.revision ?? 0) + 1); fileView = result.binding; return result; }
    if (command === 'queryFileSources.open') { fileView = sourceView('SELECT 文件打开;', (fileView?.ref.revision ?? 0) + 1); return { state: 'opened', binding: fileView, sql: 'SELECT 文件打开;' }; }
    if (command === 'queryFileSources.release') return { released: true };
    throw Error('禁止外界调用：' + command);
  } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', connectionId: 'c', title: '合成查询', sql: 'SELECT 初始;', ...(bound ? { fileSourceBinding: fileView.ref } : {}) }] }, connections: [{ id: 'c', name: '合成连接', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'offline' }], activeJobs: {}, dirtyTabs: {}, queryFileDirty: {}, connectionVersions: {}, notice: undefined });
  function View() {
    const tabs = useWorkspace(state => state.settings.tabs), [request, setRequest] = React.useState<any>(); startClose = () => setRequest({ tabId: 't' });
    return tabs.map(tab => <section key={tab.id} hidden={tab.id !== useWorkspace.getState().settings.activeTabId}><QueryTab tab={tab} closeRequest={tab.id === 't' ? request : undefined} onCloseRequestFinished={(_request, close) => { completed.push(close); setRequest(undefined); if (close) useWorkspace.getState().closeTab(tab.id); }} onHistory={() => {}}/></section>);
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

describe('真实QueryTab与文件另存的正文捕获接线（RAM）', () => {
  it('关联文件的菜单保存直接使用原引用写回，不打开查询库或路径选择', async () => {
    const editor = await mount(true); editor.model.deferred = true; editor.nativeInput('SELECT 文件新正文;');
    await act(async () => { for (const menu of menus) menu('save-query'); });
    expect(commands.filter(item => item.command === 'queryFileSources.save')).toEqual([{ command: 'queryFileSources.save', input: { tabId: 't', source: sourceView().ref, sql: 'SELECT 文件新正文;' } }]);
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
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toEqual([{ command: 'queryFileSources.saveAs', input: { tabId: 't', encoding: 'utf8', bom: 'none', eol: 'preserve', sql: 'SELECT 点击时最新, \'😀\';' } }]);
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
    expect(commands[readIndex].input).toEqual({ tabId: opened.id, encoding: 'utf8' });
  });
  it('另存文件切换主来源，移除查询库键，不改变当前正文或分栏高度', async () => {
    await mount(); await act(async () => useWorkspace.getState().updateTab('t', { sourceBinding: { id: 'q', digest: 'a'.repeat(64), context: { state: 'legacy' } }, queryEditorHeight: 420 }));
    await click('另存 SQL 文件'); await click('选择并保存 SQL 文件'); const tab = useWorkspace.getState().settings.tabs[0];
    expect(tab).toMatchObject({ sql: 'SELECT 初始;', queryEditorHeight: 420, fileSourceBinding: fileView.ref }); expect(Object.hasOwn(tab, 'sourceBinding')).toBe(false);
  });
  it.each([['utf8', 'utf8', 'lf'], ['utf16le', 'utf16le', 'crlf'], ['gb18030', 'none', 'cr']] as const)('另存显式选择%s/%s/%s，只发送编码BOM换行和opaque来源', async (encoding, bom, eol) => {
    await mount(true); await click('另存 SQL 文件'); await select('文件编码', encoding); await select('字节顺序标记（BOM）', bom); await select('换行策略', eol); await click('选择并保存 SQL 文件');
    expect(commands.filter(item => item.command === 'queryFileSources.saveAs')).toEqual([{ command: 'queryFileSources.saveAs', input: { tabId: 't', source: sourceView().ref, sql: 'SELECT 初始;', encoding, bom, eol } }]);
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
    expect(commands.filter(item => item.command === 'queryFileSources.open')).toEqual([{ command: 'queryFileSources.open', input: { tabId: 't', source: sourceView().ref, encoding: 'utf8' } }]);
  });
});
