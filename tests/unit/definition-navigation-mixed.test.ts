import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { structureSearchInputSchema } from '../../src/shared/databaseSearch';
import { DefinitionSearchConnectionLease } from '../../src/renderer/definitionNavigation';
import { definitionNavigationZh } from '../../src/renderer/locales/definitionNavigation.zh-CN';
import { databaseSearchZh as text } from '../../src/renderer/locales/databaseSearch.zh-CN';

/** 提取混合App/搜索窗口的真实接线，不用替代组件的另一套判断。 */
function tree(file: string) { const source = readFileSync(new URL('../../src/renderer/' + file, import.meta.url), 'utf8'); return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS); }
const dialogTree = tree('components/StructureSearchDialog.tsx'), functions = new Map<string, string>();
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(dialogTree)); ts.forEachChild(node, visit); } visit(dialogTree);
/** 只控制IPC返回时机和React setter，搜索修订与游标使用产品实现。 */
function fixture() {
  const workspace = { connectionVersions: { c: 4 }, connections: [{ id: 'c' }] };
  const result = { hits: [], failures: [], totalHits: 0, completedScopes: 1, scopeCount: 1, limitReached: false, stoppedOnError: false };
  const c = createContext({ structureSearchInputSchema, DefinitionSearchConnectionLease, definitionNavigationZh, text, useWorkspace: { getState: () => workspace }, connectionId: 'c', databases: 'db', kinds: ['table'], mode: 'contains', keyword: 'Marker', caseSensitive: false, limit: 200, onError: 'stop', searchIn: 'definition', uid: () => '00000000-0000-4000-8000-000000000001',
    work: { current: null }, closeRequested: { current: false }, stopRequested: { current: false }, activeTask: { current: null }, cursor: { current: null }, resultConnection: { current: 'c' }, resultLease: { current: null }, plannedLease: { current: null },
    setBusy: vi.fn(), setError: vi.fn(), setHits: vi.fn(), setPage: vi.fn(), setFailures: vi.fn(), setSelected: vi.fn(), releaseCursor: vi.fn(async () => {}), invoke: vi.fn(async () => result), errorMessage: String });
  runInContext(ts.transpileModule(functions.get('search') + '\nglobalThis.search=search;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, c);
  return { c, workspace, result, observe: () => { c.resultLease.current?.current(); c.plannedLease.current?.current(); } };
}

describe('定义搜索与现有窗口的真实混合接线', () => {
  it('开始前绑定连接修订，一次实际请求携带原范围，不调用预览/写入', async () => {
    const { c } = fixture(); c.search(); const pending = c.work.current; await pending;
    expect(c.invoke.mock.calls.map(([command]: string[]) => command)).toEqual(['search.structure']); expect(c.invoke.mock.calls[0][1]).toMatchObject({ connectionId: 'c', databases: ['db'], kinds: ['table'], searchIn: 'definition' });
    expect(c.resultLease.current.version).toBe(4); expect(c.resultLease.current.current()).toBe(true); expect(c.setPage).toHaveBeenCalledTimes(2);
  });
  it('输入无效先拒绝，不释放旧游标或创建计划来源', async () => {
    const { c } = fixture(); c.keyword = ''; c.search(); const pending = c.work.current; await pending;
    expect(c.releaseCursor).not.toHaveBeenCalled(); expect(c.invoke).not.toHaveBeenCalled(); expect(c.plannedLease.current).toBeNull();
  });
  it('释放旧游标期间连接ABA不默默换源查询，旧结果和引用保持供明确清理', async () => {
    const { c, workspace, observe } = fixture(); let release!: () => void; c.releaseCursor.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    c.search(); const pending = c.work.current; expect(c.plannedLease.current.version).toBe(4); workspace.connectionVersions.c = 5; observe(); workspace.connectionVersions.c = 4; release(); await pending;
    expect(c.invoke).not.toHaveBeenCalled(); expect(c.setHits).not.toHaveBeenCalled(); expect(c.setError).toHaveBeenLastCalledWith(expect.stringContaining(definitionNavigationZh.invalid)); expect(c.plannedLease.current).toBeNull();
  });
  it('实际搜索回包迟到且连接ABA时不追加旧结果，返回游标仍保留给明确释放', async () => {
    const { c, workspace, observe, result } = fixture(); let release!: (value: unknown) => void; c.invoke.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    c.search(); const pending = c.work.current; await vi.waitFor(() => expect(c.invoke).toHaveBeenCalledOnce()); workspace.connectionVersions.c = 5; observe(); workspace.connectionVersions.c = 4;
    release({ ...result, hits: [{ database: 'db', kind: 'table', object: 't', name: 't', parentKind: 'table' }], cursor: '00000000-0000-4000-8000-000000000002' }); await pending;
    expect(c.setHits.mock.calls).toEqual([[[]]]); expect(c.setPage.mock.calls).toEqual([[null]]); expect(c.cursor.current).toEqual({ connectionId: 'c', value: '00000000-0000-4000-8000-000000000002' }); expect(c.setError).toHaveBeenLastCalledWith(expect.stringContaining(definitionNavigationZh.invalid));
  });
  it('失效来源继续搜索先拒绝，不消费游标也不发送实际续页请求', async () => {
    const { c } = fixture(); const lease = new DefinitionSearchConnectionLease('c', 4, () => 4); lease.cancel(); c.resultLease.current = lease; c.cursor.current = { connectionId: 'c', value: '原游标' };
    c.search(true); const pending = c.work.current; await pending; expect(c.invoke).not.toHaveBeenCalled(); expect(c.cursor.current.value).toBe('原游标');
  });
  it('App向只读定义窗口原样传递摘要/位置来源，四属性/原查询接线均仍存在', () => {
    const app = tree('App.tsx'); let callback: ts.Expression | undefined; const existing = new Set<string>();
    function visit(node: ts.Node) { if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) { const tag = node.tagName.getText(app); for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) { if (tag === 'StructureSearchDialog' && attr.name.getText(app) === 'onOpen') callback = attr.initializer.expression; if (['Sidebar', 'TableTab'].includes(tag)) existing.add(tag + '_' + attr.name.getText(app)); } } ts.forEachChild(node, visit); } visit(app);
    if (!callback) throw Error('缺少定义搜索打开接线'); const setDdl = vi.fn(), context = createContext({ setStructureSearch: vi.fn(), setDdl }); runInContext(ts.transpileModule('globalThis.open=' + callback.getText(app), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const binding = { opaque: '原位置来源' }, hit = { database: 'db', object: 't', parentKind: 'table' }; context.open('c', hit, binding); expect(setDdl).toHaveBeenCalledWith({ connectionId: 'c', database: 'db', object: { name: 't', kind: 'table' }, readOnly: true, definitionSearch: binding });
    for (const tag of ['Sidebar', 'TableTab']) for (const method of ['onTableAutoIncrement', 'onTableRename', 'onTableComment', 'onTableDefaultEncoding']) expect(existing.has(tag + '_' + method)).toBe(true);
  });
  it('只读路由进入独立查看器，原显式编辑路径保留原参数及确认执行入口', () => {
    const schema = tree('components/SchemaDialog.tsx'), wrapper = schema.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DdlDialog'); if (!wrapper) throw Error('缺少定义查看路由');
    const c = createContext({ DefinitionViewer: '只读定义', DdlEditorDialog: '原编辑器', jsx: (tag: string, props: unknown) => ({ tag, props }) }); runInContext(ts.transpileModule(wrapper.getText(schema).replace(/^export\s+/, '') + '\nglobalThis.route=DdlDialog;', { fileName: 'route.tsx', compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'jsx', target: ts.ScriptTarget.ES2022 } }).outputText, c);
    const search = { opaque: true }, props = { connectionId: 'c', database: 'db', object: { name: 't', kind: 'table' }, readOnly: true, definitionSearch: search, onClose: vi.fn(), onApplied: vi.fn() };
    expect(c.route(props)).toEqual({ tag: '只读定义', props: { connectionId: 'c', database: 'db', object: props.object, search, onClose: props.onClose } }); expect(c.route({ ...props, readOnly: false })).toEqual({ tag: '原编辑器', props: { ...props, readOnly: false } });
    const source = readFileSync(new URL('../../src/renderer/components/DefinitionViewer.tsx', import.meta.url), 'utf8'); expect(source).not.toMatch(/schema\.apply|query\.execute|table\.apply|onExecute=/); expect(source).toContain('readOnly height={340}'); expect(source).toContain('new DefinitionEditorLease(instance)');
  });
});
