import { installNavigationMenuRamPort, navigationMenuRamButton } from '../helpers/navigationMenuRamPort';
let restoreNavigationMenuPort: () => void = () => {};
import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
const io = vi.hoisted(() => ({ source: '', eol: '\n', start: 0, end: 0, multi: false, readOnly: false, events: [] as string[], editor: null as any, closeRequest: undefined as undefined | { tabId: string }, rerender: () => {}, format: undefined as undefined | (() => void) }));
/** 只替换Monaco外界端口；真实QueryTab、store和DOM负责按钮、正文回传及副作用边界。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { useEffect, createElement } = await import('react');
  return { SqlEditor(props: any) {
    io.format = props.onFormat;
    useEffect(() => {
      // 与Monaco及正文桥原合同一致：模型只暴露自身EOL，初始化不回传为用户修改。
      io.source = props.value.replace(/\r\n|\r|\n/g, io.eol); let version = 1;
      const position = (offset: number) => { const lines = io.source.slice(0, offset).split(io.eol); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 }; };
      const offset = (p: any) => io.source.split(io.eol).slice(0, p.lineNumber - 1).reduce((sum, line) => sum + line.length + io.eol.length, 0) + p.column - 1;
      const range = (start: number, end: number) => ({ startLineNumber: position(start).lineNumber, startColumn: position(start).column, endLineNumber: position(end).lineNumber, endColumn: position(end).column, selectionStartLineNumber: position(start).lineNumber, selectionStartColumn: position(start).column, positionLineNumber: position(end).lineNumber, positionColumn: position(end).column, getStartPosition: () => position(start), getEndPosition: () => position(end), isEmpty: () => start === end });
      const model = { isDisposed: () => false, getValue: () => io.source, getValueLength: () => io.source.length, getVersionId: () => version, getOffsetAt: offset, getFullModelRange: () => range(0, io.source.length), getEOL: () => io.eol };
      const subscribe = () => ({ dispose() {} });
      io.editor = { onDidChangeModel: subscribe, onDidChangeModelContent: subscribe, onDidChangeCursorSelection: subscribe, onDidChangeConfiguration: subscribe, onDidDispose: subscribe, getModel: () => model, getSelections: () => io.multi ? [range(0, 0), range(0, 0)] : [range(io.start, io.end)], getRawOptions: () => ({ readOnly: io.readOnly }), pushUndoStop: () => { io.events.push('undo-stop'); return true; }, executeEdits: (name: string, edits: any[]) => { io.events.push(name); for (const edit of edits) io.source = io.source.slice(0, offset(edit.range.getStartPosition())) + edit.text + io.source.slice(offset(edit.range.getEndPosition())); version++; props.onChange(io.source); return true; }, focus: () => io.events.push('focus') };
      props.onReady?.(io.editor);
    }, []);
    return createElement('div');
  } };
});
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let commands: string[];
beforeAll(async () => { document = memoryDocument(); restoreNavigationMenuPort = installNavigationMenuRamPort(document); ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store')); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } await flushSettings(); });
afterAll(() => { restoreNavigationMenuPort(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 格式化只允许普通草稿恢复写入；任何执行、建连、会话、历史或保存查询调用都失败。 */
async function mount(source: string, start = 0, end = 0, eol = '\n') {
  io.closeRequest = undefined; io.eol = eol; io.start = start; io.end = end; io.multi = false; io.readOnly = false; io.events = []; commands = [];
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string) => { commands.push(command); if (command === 'settings.save') return; throw Error('禁止格式化产生外界命令'); } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 't', tabs: [{ id: 't', kind: 'query', title: '合成查询', connectionId: 'c', sql: source, databaseContext: { state: 'known', database: null }, sourceBinding: { id: '来源', digest: 'a'.repeat(64), connectionId: 'c', context: { state: 'known', database: null } } }] }, connections: [{ id: 'c', name: '离线连接', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'offline', group: '', color: '' }], connectionVersions: {}, activeJobs: {}, dirtyTabs: {} });
  function View() { const [, tick] = React.useState(0); io.rerender = () => tick(value => value + 1); const tab = useWorkspace(state => state.settings.tabs[0]); return tab ? <QueryTab tab={tab} closeRequest={io.closeRequest} onHistory={() => {}}/> : null; }
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<View/>));
}
async function click(entry: '按钮' | '快捷回调') { if (entry === '快捷回调') { expect(io.format).toBeTypeOf('function'); await act(async () => io.format!()); await flushSettings(); return; } const button = navigationMenuRamButton(document.body, '格式化 SQL') ?? document.body.querySelectorAll('button').find(node => node.getAttribute('aria-label') === '格式化 SQL'); expect(button).toBeDefined(); await act(async () => button!.dispatchEvent(new MemoryEvent('click'))); await flushSettings(); }

describe.each(['按钮', '快捷回调'] as const)('真实QueryTab格式化%s', entry => {
  it.each([['\n', '\r\n', 'preserve'], ['\n', '\r\n', 'upper'], ['\n', '\r\n', 'lower'], ['\r\n', '\n', 'preserve'], ['\r\n', '\n', 'upper'], ['\r\n', '\n', 'lower']] as const)('模型EOL与来源换行不同：来源%j/模型%j/偏好%s仍经原事务格式化', async (sourceEol, modelEol, keywordCase) => {
    const source = "select a,b,'原文😀'" + sourceEol + 'from sample where id=1;'; await mount(source, 0, 0, modelEol);
    await act(async () => useWorkspace.getState().updateSettings({ sqlKeywordCase: keywordCase }));
    const before = useWorkspace.getState(), binding = before.settings.tabs[0].sourceBinding, model = io.editor.getModel();
    expect(before.settings.tabs[0].sql).toBe(source); expect(io.source).toBe(source.replace(/\r\n|\r|\n/g, modelEol)); expect(io.events).toEqual([]);
    await click(entry); await vi.waitFor(() => expect(io.events).toHaveLength(4), { timeout: 10000 });
    expect(io.events).toEqual(['undo-stop', 'dbark-sql-format', 'undo-stop', 'focus']); expect(io.editor.getModel()).toBe(model); expect(model.getEOL()).toBe(modelEol);
    expect(io.source).toContain("'原文😀'"); expect(io.source).not.toBe(source.replace(/\r\n|\r|\n/g, modelEol)); expect(io.source.replaceAll(modelEol, '')).not.toMatch(/[\r\n]/);
    const after = useWorkspace.getState(); expect(after.settings.tabs[0].sql).toBe(io.source); expect(after.settings.tabs[0].sourceBinding).toBe(binding); expect(after.activeJobs).toEqual(before.activeJobs); expect(after.dirtyTabs).toEqual(before.dirtyTabs); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });
  it('模型EOL等价的混合换行只格式化选区，区外正文和同一模型保持', async () => {
    const prefix = 'select Outside;\r', body = 'select a,b\nfrom sample where id=1;', suffix = '\r\nselect Tail;', normalizedPrefix = 'select Outside;\r\n', normalizedBody = body.replaceAll('\n', '\r\n');
    await mount(prefix + body + suffix, normalizedPrefix.length, normalizedPrefix.length + normalizedBody.length, '\r\n'); const model = io.editor.getModel();
    await click(entry); expect(io.source.startsWith(normalizedPrefix)).toBe(true); expect(io.source.endsWith(suffix)).toBe(true); expect(io.editor.getModel()).toBe(model); expect(io.events).toEqual(['undo-stop', 'dbark-sql-format', 'undo-stop', 'focus']);
  });
  it.each(['空格', '标点', '字符', '缺换行'] as const)('模型EOL比较不能吞掉%s正文差异', async change => {
    const source = 'select a,b\nfrom sample;'; await mount(source, 0, 0, '\r\n'); const original = io.source;
    if (change === '空格') io.source = original.replace('a,b', 'a, b'); if (change === '标点') io.source = original.replace('a,b', 'a+b'); if (change === '字符') io.source = original.replace('sample', 'another'); if (change === '缺换行') io.source = original.replace('\r\n', ' ');
    const changed = io.source; await click(entry); expect(io.source).toBe(changed); expect(io.events).toEqual([]); expect(useWorkspace.getState().settings.tabs[0].sql).toBe(source); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });
  it('模型EOL未声明为LF或CRLF时保留原正文且拒绝格式化', async () => {
    await mount('select a,b from sample;'); io.eol = '\r'; const source = io.source; await click(entry); expect(io.source).toBe(source); expect(io.events).toEqual([]); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });
  it.each([['upper', true], ['upper', false], ['lower', true], ['lower', false]] as const)('关键字偏好%s沿真实入口用于选区/全文%s，改偏好本身不改模型且只产生原单次编辑事务', async (keywordCase, selected) => {
    const prefix = 'select PriorValue from BeforeTable;\n', body = keywordCase === 'lower' ? 'SELECT MiXeD,t.order,count(a),@from FROM T t WHERE t.id=1;' : 'select MiXeD,t.order,count(a),@from from T t where t.id=1;', suffix = '\nselect Tail from AfterTable;', source = prefix + body + suffix;
    await mount(source, selected ? prefix.length : 0, selected ? prefix.length + body.length : 0);
    const model = io.editor.getModel(), binding = useWorkspace.getState().settings.tabs[0].sourceBinding;
    await act(async () => useWorkspace.getState().updateSettings({ sqlKeywordCase: keywordCase }));
    expect(io.source).toBe(source); expect(io.events).toEqual([]); expect(io.editor.getModel()).toBe(model);
    await click(entry); await vi.waitFor(() => expect(io.events).toHaveLength(4), { timeout: 10000 }); expect(io.events).toEqual(['undo-stop', 'dbark-sql-format', 'undo-stop', 'focus']); expect(io.editor.getModel()).toBe(model);
    expect(io.source).toContain(keywordCase === 'upper' ? 'SELECT' : 'select'); expect(io.source).toContain('MiXeD'); expect(io.source).toContain('t.order'); expect(io.source).toContain('count('); expect(io.source).toContain('@from');
    if (selected) { expect(io.source.startsWith(prefix)).toBe(true); expect(io.source.endsWith(suffix)).toBe(true); }
    expect(useWorkspace.getState().settings.tabs[0].sourceBinding).toBe(binding); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  });

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


describe.each(['upper', 'lower'] as const)('真实QueryTab%s加载等待', keywordCase => {
it.each(['切走切回', '关闭再取消', '选区漂移', '原owner被替换'] as const)('显式大小写模块等待中的%s不能产生迟到编辑', async change => {
  const formatting = await import('../../src/renderer/sqlFormatting'); let release!: () => void;
  const waiting = new Promise<void>(done => { release = done; }), load = vi.spyOn(formatting, 'prepareSqlFormattingRoles').mockImplementation(() => waiting);
  try {
    await mount('select MiXeD from T;'); await act(async () => useWorkspace.getState().updateSettings({ sqlKeywordCase: keywordCase })); await click('按钮'); expect(load).toHaveBeenCalledOnce(); expect(io.events).toEqual([]);
    if (change === '切走切回') await act(async () => { useWorkspace.getState().updateSettings({ activeTabId: 'other' }); useWorkspace.getState().updateSettings({ activeTabId: 't' }); });
    if (change === '关闭再取消') { await act(async () => { io.closeRequest = { tabId: 't' }; io.rerender(); }); await act(async () => { io.closeRequest = undefined; io.rerender(); }); }
    if (change === '选区漂移') io.start = io.end = 1;
    if (change === '原owner被替换') await act(async () => useWorkspace.setState({ settings: { ...useWorkspace.getState().settings, tabs: useWorkspace.getState().settings.tabs.map(tab => ({ ...tab })) } }));
    await act(async () => release()); expect(io.source).toBe('select MiXeD from T;'); expect(io.events).toEqual([]);
  } finally { release?.(); load.mockRestore(); }
});

it('显式大小写模块实际加载失败由原错误区显示，正文和Undo保持原样', async () => {
  const formatting = await import('../../src/renderer/sqlFormatting'), failure = Error('模块加载实际失败'), load = vi.spyOn(formatting, 'prepareSqlFormattingRoles').mockRejectedValue(failure);
  try { await mount('select MiXeD from T;'); await act(async () => useWorkspace.getState().updateSettings({ sqlKeywordCase: keywordCase })); await click('按钮'); await vi.waitFor(() => expect(document.body.textContent).toContain(failure.message)); expect(io.source).toBe('select MiXeD from T;'); expect(io.events).toEqual([]); }
  finally { load.mockRestore(); }
});

it.each(['偏好往返', '连接版本往返', '连接对象往返', '后台作业往返', '模态往返'] as const)('%s留下永久墓碑，原状态恢复也不能授权迟到编辑', async change => {
  const formatting = await import('../../src/renderer/sqlFormatting'); let release!: () => void;
  const load = vi.spyOn(formatting, 'prepareSqlFormattingRoles').mockImplementation(() => new Promise<void>(yes => { release = yes; }));
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver'); let observer: { records: MutationRecord[] } | undefined;
  /** 仅模拟浏览器排队的DOM记录；真实QueryTab执行takeRecords、模态扫描及墓碑判断。 */
  class RamObserver {
    records: MutationRecord[] = [];
    constructor() { observer = this; }
    observe() {}
    takeRecords() { return this.records.splice(0); }
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'MutationObserver', { value: RamObserver, configurable: true });
  try {
    const source = 'SELECT MiXeD FROM T;'; await mount(source); await act(async () => useWorkspace.getState().updateSettings({ sqlKeywordCase: keywordCase })); await click('按钮'); expect(load).toHaveBeenCalledOnce();
    await act(async () => {
      const original = useWorkspace.getState();
      if (change === '偏好往返') { original.updateSettings({ sqlKeywordCase: 'preserve' }); original.updateSettings({ sqlKeywordCase: keywordCase }); }
      if (change === '连接版本往返') { useWorkspace.setState({ connectionVersions: { c: 1 } }); useWorkspace.setState({ connectionVersions: original.connectionVersions }); }
      if (change === '连接对象往返') { useWorkspace.setState({ connections: original.connections.map(profile => ({ ...profile })) }); useWorkspace.setState({ connections: original.connections }); }
      if (change === '后台作业往返') { original.setBusy('t', true); original.setBusy('t', false); }
      if (change === '模态往返') { const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); observer!.records.push({ addedNodes: [modal] } as unknown as MutationRecord); }
    });
    await act(async () => release()); expect(io.source).toBe(source); expect(io.events).toEqual([]); expect(commands.filter(command => command !== 'settings.save')).toEqual([]);
  } finally { release?.(); load.mockRestore(); if (originalObserver) Object.defineProperty(globalThis, 'MutationObserver', originalObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver'); }
});

});
