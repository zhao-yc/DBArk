import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CopyInsertSqlButtons } from '../../src/renderer/components/CopyInsertSqlButtons';
import { prepareCopyInsertSql } from '../../src/renderer/copyInsertSql';
import { copyInsertSql } from '../../src/main/copyInsertSql';
import { copyInsertSqlZh } from '../../src/shared/copyInsertSql.zh-CN';
import { fixture } from '../helpers/copyInsertPage';

const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = '', wiring = '';
/** 执行生产 TableTab 原处理器；只替换 IPC 端口，不把它描述为真实 GUI/剪贴板验收。 */
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'copyRowsAsInsert') handler = node.getText(tree);
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'CopyInsertSqlButtons') wiring = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
function port() {
  const f = fixture(), tab = { id: '标签', connectionId: '连接', database: '库', table: '表' };
  const workspace = { settings: { activeTabId: tab.id, tabs: [tab] }, connections: [{ id: '连接' }], connectionVersions: { 连接: 7 } };
  let resolve!: () => void;
  const context = createContext({ Set, Error, prepareCopyInsertSql, copyInsertSqlZh, tab, useWorkspace: { getState: () => workspace }, getRecordContext: () => f.context, page: f.page, copyPage: { current: f.binding }, rowsRef: { current: f.rows }, selectionRef: { current: { rowId: '行0' } }, selectedRowsRef: { current: new Set(['行1']) }, mounted: { current: true }, loadingCount: { current: 0 }, referenceCount: { current: 0 }, applyingRef: { current: false }, preferencesLock: { current: false }, previewingRef: { current: false }, copyPendingRef: { current: false }, inputDirtyRef: { current: false }, activeGridEditor: { current: null }, rootElement: { current: { querySelector: () => null } }, record: { dirty: false, hasInput: () => false }, insertCopyBlockedRef: { current: false }, copyEnvironment: { current: {} }, setError: vi.fn(), setDuplicateNotice: vi.fn(), errorMessage: (error: unknown) => (error as Error).message, invoke: vi.fn(() => new Promise<void>(done => { resolve = done; })) });
  runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { f, tab, workspace, context, click(selected = false) { runInContext(`copyRowsAsInsert(${selected})`, context); }, async settle() { resolve(); await Promise.resolve(); await Promise.resolve(); } };
}
describe('表页 INSERT 入口的纯端口验证（实际 GUI/OS 为零）', () => {
  it('真实组件接在 TableTab，中文标题说明原值策略，分别控制当前与勾选入口', () => {
    expect(wiring).toContain('onCopy={copyRowsAsInsert}');
    const html = renderToStaticMarkup(<CopyInsertSqlButtons disabled={false} current selected={false} onCopy={() => {}}/>);
    expect(html).toContain(copyInsertSqlZh.current); expect(html).toContain(copyInsertSqlZh.selected); expect(html).toContain(copyInsertSqlZh.policy); expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
  it('当前行和勾选行只调用专用 IPC，不调用查询、补取或表写入命令', async () => {
    const p = port(); p.click(); expect(p.context.invoke).toHaveBeenCalledExactlyOnceWith('table.copyInsertSql', expect.objectContaining({ rows: [p.f.page.rows[0]] })); await p.settle();
    p.context.invoke.mockClear(); p.context.selectedRowsRef.current = new Set(['行0', '行1']); p.click(true); expect(p.context.invoke).toHaveBeenCalledExactlyOnceWith('table.copyInsertSql', expect.objectContaining({ rows: p.f.page.rows }));
  });
  it.each(['inactive', 'closed', 'removed-connection', 'version', 'target', 'loading', 'reference', 'applying', 'preferences', 'preview', 'copy-read', 'dirty', 'input', 'editor', 'modal', 'live-input', 'unmounted'])('%s 同步状态改变后旧回调也不能发起复制', condition => {
    const p = port(), c = p.context;
    if (condition === 'inactive') p.workspace.settings.activeTabId = '别页'; else if (condition === 'closed') p.workspace.settings.tabs = []; else if (condition === 'removed-connection') p.workspace.connections = [];
    else if (condition === 'version') p.workspace.connectionVersions.连接++; else if (condition === 'target') p.tab.table = '另表';
    else if (condition === 'loading') c.loadingCount.current++; else if (condition === 'reference') c.referenceCount.current++;
    else if (condition === 'applying') c.applyingRef.current = true; else if (condition === 'preferences') c.preferencesLock.current = true; else if (condition === 'preview') c.previewingRef.current = true; else if (condition === 'copy-read') c.copyPendingRef.current = true;
    else if (condition === 'dirty') c.record.dirty = true; else if (condition === 'input') c.inputDirtyRef.current = true; else if (condition === 'editor') c.activeGridEditor.current = {}; else if (condition === 'modal') c.insertCopyBlockedRef.current = true; else if (condition === 'live-input') c.record.hasInput = () => true; else c.mounted.current = false;
    p.click(); expect(c.invoke).not.toHaveBeenCalled(); expect(c.setError).toHaveBeenCalledWith(copyInsertSqlZh.busy);
  });
  it('单次点击即提交不可变快照；迟到成功不在已换页环境显示误导提示或再次写入', async () => {
    const p = port(); p.click(); p.context.copyEnvironment.current = {}; p.context.setDuplicateNotice.mockClear(); await p.settle();
    expect(p.context.setDuplicateNotice).not.toHaveBeenCalled(); expect(p.context.invoke).toHaveBeenCalledTimes(1);
  });
  it('实际主进程 case 只走专用生成器，等待原生写入结果且不访问引擎', async () => {
    const main = ts.createSourceFile('index.ts', readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    let statements = '';
    function find(node: ts.Node) { if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'table.copyInsertSql') statements = node.statements.map(statement => statement.getText(main)).join('\n'); ts.forEachChild(node, find); }
    find(main); expect(statements).not.toBe('');
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; }), writeText = vi.fn(() => pending), input = fixture().prepare();
    const context = createContext({ copyInsertSql, input, clipboard: { writeText } });
    const result = runInContext(ts.transpileModule(`(function () { ${statements} })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    expect(result).toBe(pending); expect(writeText).toHaveBeenCalledTimes(1); finish(); await result;
  });
  it.each([false, true])('--list=%s 时即使全部许可开关存在也不导入实跑配置或桌面', listing => {
    const native = readFileSync(new URL('../e2e/copy-insert-sql.spec.ts', import.meta.url), 'utf8');
    const skip = vi.fn(), register = vi.fn(), imported: string[] = [];
    const context = createContext({ exports: {}, process: { argv: listing ? ['node', '--list'] : ['node'], env: listing ? { DBARK_INTEGRATION_ENABLED: '1', DBARK_COPY_INSERT_SQL_UI: '1', DBARK_COPY_INSERT_SQL_NATIVE_CLIPBOARD: '1' } : {} }, require: (name: string) => { imported.push(name); if (name === '@playwright/test') return { test: { skip } }; return { registerCopyInsertSqlNativeTest: register }; } });
    runInContext(ts.transpileModule(native, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    expect(imported).toEqual(['@playwright/test']); expect(skip).toHaveBeenCalledTimes(1); expect(register).not.toHaveBeenCalled();
  });
});
