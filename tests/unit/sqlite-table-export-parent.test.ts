import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableQuery } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableExportIntent } from '../../src/renderer/sqliteTableExportUi';
import { sqliteTableExportZh as exportText } from '../../src/renderer/locales/sqliteTableExport.zh-CN';

const file = ts.createSourceFile('SqliteTableTab.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods = new Map<string, string>();
/** 原父组件的准入、租约与关闭函数保持原样，只隔离 store/React 及页面目录的观察端口。 */
function inspect(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && ['openAllExport', 'fullExportActivity', 'closeAllExport'].includes(node.name.text)) methods.set(node.name.text, node.getText(file)); ts.forEachChild(node, inspect); } inspect(file);
function fixture() {
  const tab = { id: 'tab', connectionId: 'sqlite', database: 'main', table: '表', kind: 'table' }, profile = { id: 'sqlite', dialect: 'sqlite' }, version = 7;
  const page: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '表', kind: 'table' }, columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }], truncated: false, elapsedMs: 1, statement: '' }, limit: 5, offset: 5, hasMore: true };
  const query: SqliteTableQuery = { limit: 5, mode: 'and', filters: [], sort: [{ column: 'id', direction: 'asc' }] }, applied = { current: query }, latest = { current: { tab, active: true } }, fullExportRef = { current: null as any };
  const workspace = { settings: { tabs: [tab], activeTabId: tab.id }, connections: [profile], connectionVersions: { sqlite: version }, activeJobs: {} as Record<string, boolean> };
  let pageNow: SqliteTablePage | undefined = page, leaseOwner = 0; const releases = vi.fn(), acquisitionObserved: boolean[] = [], setFullExport = vi.fn(), setValidation = vi.fn();
  const notify = () => fullExportRef.current?.intent.current();
  const acquireWorkspaceBusy = vi.fn(() => {
    if (workspace.activeJobs.tab) throw Error('其他作业仍占用'); const owner = ++leaseOwner; workspace.activeJobs.tab = true; acquisitionObserved.push(notify()); const owns = () => workspace.activeJobs.tab && leaseOwner === owner;
    return { owns, release() { if (!owns()) return false; releases(); workspace.activeJobs.tab = false; notify(); return true; } };
  });
  const vm: any = createContext({ page, applied, tab, profile, version, active: true, latest, fullExportRef, useWorkspace: { getState: () => workspace }, controller: { pageCurrent: (expected: SqliteTablePage) => pageNow === expected }, available: () => true, SqliteTableExportIntent, exportText, acquireWorkspaceBusy, setFullExport, setValidation, errorMessage: (reason: Error) => reason.message, Error });
  expect(methods.size).toBe(3); runInContext(ts.transpileModule([...methods.values()].join('\n') + '\nglobalThis.handlers={openAllExport,fullExportActivity,closeAllExport};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, vm);
  vm.handlers.openAllExport(); const owner = fullExportRef.current; expect(owner).not.toBeNull();
  return { vm, owner, tab, profile, version, query, applied, latest, workspace, fullExportRef, releases, acquisitionObserved, setFullExport, notify, page(value?: SqliteTablePage) { pageNow = value; notify(); }, replaceLease() { leaseOwner++; workspace.activeJobs.tab = true; notify(); } };
}

describe('SQLite 全量导出 parent 的真实自有busy与来源失效', () => {
  it('原JSX完成回调区分结构文件和数据行数，晚成功不把结构伪称0行数据', () => {
    const callbacks: string[] = [];
    /** 直接抽取实际组件属性，避免另写一个格式化函数掩盖父页接线遗漏。 */
    function find(node: ts.Node): void {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'SqliteTableExportDialog') for (const property of node.attributes.properties) if (ts.isJsxAttribute(property) && property.name.getText(file) === 'onCommitted' && property.initializer && ts.isJsxExpression(property.initializer) && property.initializer.expression) callbacks.push(property.initializer.expression.getText(file));
      ts.forEachChild(node, find);
    }
    find(file); expect(callbacks).toHaveLength(1); const notify = vi.fn(), context = createContext({ exportText, useWorkspace: { getState: () => ({ notify }) } });
    runInContext(ts.transpileModule('globalThis.complete=' + callbacks[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const complete = (context as any).complete; complete({ rows: 0, fileCommitted: true }, true, 'structure'); expect(notify).toHaveBeenLastCalledWith(exportText.structureCommittedChanged);
    for (const content of [undefined, 'data', 'structure-data']) { complete({ rows: 3, fileCommitted: true }, true, content); expect(notify).toHaveBeenLastCalledWith(exportText.committedChanged(3)); }
  });
  it('chooser/导出自有busy同步通知不使意图自失效，结束仅释放原租约', () => {
    const f = fixture(); expect(f.owner.intent.current()).toBe(true); f.vm.handlers.fullExportActivity(f.owner, 1); expect(f.acquisitionObserved).toEqual([true]); expect(f.owner.intent.current()).toBe(true); expect(f.workspace.activeJobs.tab).toBe(true);
    f.vm.handlers.fullExportActivity(f.owner, -1); expect(f.releases).toHaveBeenCalledOnce(); expect(f.workspace.activeJobs.tab).toBe(false); expect(f.owner.intent.current()).toBe(true);
  });
  it('他人接管后意图永久失效，旧finally不清他人的busy', () => {
    const f = fixture(); f.vm.handlers.fullExportActivity(f.owner, 1); f.replaceLease(); expect(f.owner.intent.current()).toBe(false); f.vm.handlers.fullExportActivity(f.owner, -1); expect(f.releases).not.toHaveBeenCalled(); expect(f.workspace.activeJobs.tab).toBe(true);
  });
  it.each(['tab', 'profile', 'version', 'active', 'page', 'applied'] as const)('%s ABA 通过同步store/controller重核留下永久墓碑', kind => {
    const f = fixture();
    if (kind === 'tab') { f.workspace.settings.tabs = [{ ...f.tab }]; f.notify(); f.workspace.settings.tabs = [f.tab]; }
    else if (kind === 'profile') { f.workspace.connections = [{ ...f.profile }]; f.notify(); f.workspace.connections = [f.profile]; }
    else if (kind === 'version') { f.workspace.connectionVersions.sqlite++; f.notify(); f.workspace.connectionVersions.sqlite = f.version; }
    else if (kind === 'active') { f.workspace.settings.activeTabId = '其他页'; f.notify(); f.workspace.settings.activeTabId = f.tab.id; }
    else if (kind === 'page') { f.page(undefined); f.page(f.vm.page); }
    else { f.applied.current = { ...f.query }; f.notify(); f.applied.current = f.query; }
    f.notify(); expect(f.owner.intent.current()).toBe(false); expect(() => f.owner.intent.input({ format: 'csv', encoding: 'utf8', columns: ['id'] }, 'file', 'task')).toThrow('失效');
  });
  it('关闭意图本身不提前释放运行中租约，原操作finally仍能准确释放', () => {
    const f = fixture(); f.vm.handlers.fullExportActivity(f.owner, 1); f.vm.handlers.closeAllExport(f.owner); expect(f.fullExportRef.current).toBeNull(); expect(f.releases).not.toHaveBeenCalled(); expect(f.workspace.activeJobs.tab).toBe(true); f.vm.handlers.fullExportActivity(f.owner, -1); expect(f.releases).toHaveBeenCalledOnce(); expect(f.workspace.activeJobs.tab).toBe(false);
  });
});
