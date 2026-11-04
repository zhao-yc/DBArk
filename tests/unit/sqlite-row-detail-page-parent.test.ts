import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { SqliteTableBrowser } from '../../src/renderer/sqliteTableBrowser';
import { SqliteRowDetailPageNavigation, sqliteRowDetailPageOffset } from '../../src/renderer/sqliteRowDetailPageNavigation';
import { queryRowDetailsZh as text } from '../../src/renderer/locales/queryRowDetails.zh-CN';

/** 提取准确产品父方法／发布回调／绑定effect，运行正式Browser及只读详情控制器；只有DOM、store和IPC是RAM端口。 */
async function fixture(kind: 'table' | 'view' = 'table') {
  const source = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['rowDetailsCurrent', 'moveRowDetailPage'], methods: string[] = []; let adoption = '', changed = '';
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) methods.push(node.getText(source));
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].getText(source).includes('const intent = detailPageIntentRef.current;')) adoption = node.arguments[0].getText(source);
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'SqliteTableBrowser') {
      const prop = (node.arguments![0] as ts.ObjectLiteralExpression).properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'changed') as ts.PropertyAssignment;
      changed = prop.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); expect(methods).toHaveLength(2); expect(adoption).not.toBe(''); expect(changed).not.toBe('');
  const tab = { id: 't', kind: 'table', connectionId: 'c', database: 'main', table: '原表' }, profile = { id: 'c', dialect: 'sqlite', sqlite: { readOnly: true } }, listeners = new Set<() => void>();
  const state = { settings: { tabs: [tab], activeTabId: 't' }, connections: [profile], connectionVersions: { c: 0 }, activeJobs: {} as Record<string, boolean> };
  const query = { limit: 2, mode: 'and' as const, filters: [{ column: '值', operator: 'notNull' as const }], sort: [{ column: '值', direction: 'desc' as const }] };
  let modal = false, sequence = 0, resolve!: (page: SqliteTablePage) => void, reject!: (reason: Error) => void;
  const refs = Object.fromEntries(['editorRef', 'importRef', 'fullExportRef', 'filteredSelectRef', 'recordPageRef', 'detailPageIntentRef'].map(name => [name, { current: undefined }]));
  const rowDetails = new QueryRowDetails(), read = vi.fn((_input: unknown) => new Promise<SqliteTablePage>((yes, no) => { resolve = yes; reject = no; })), release = vi.fn(async () => {}), cancel = vi.fn(async () => {});
  const context: any = createContext({ ...refs, SqliteRowDetailPageNavigation, sqliteRowDetailPageOffset, tab, profile, version: 0, refreshVersion: 0, latest: { current: { tab, active: true, refreshVersion: 0 } }, applied: { current: query }, useWorkspace: { getState: () => state }, document: { querySelector: () => modal ? {} : null }, available: () => !modal, browserViewRef: { current: { busy: false } }, rowDetails, detailSelectionRef: { current: null }, setDetailSelection: vi.fn(), setRecordPageNotice: vi.fn(), setDetailPageNotice: vi.fn(), errorMessage: (reason: Error) => reason.message });
  context.setRowDetail = vi.fn((next: any) => { context.rowDetail = typeof next === 'function' ? next(context.rowDetail) : next; });
  context.setView = (next: any) => { context.view = next; }; context.setDetailSelection = vi.fn();
  runInContext(ts.transpileModule(methods.join('\n') + '\nglobalThis.adopt=(' + adoption + ');globalThis.changed=(' + changed + ');globalThis.move=moveRowDetailPage;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const publish = () => { for (const fn of [...listeners]) fn(); };
  const browser = new SqliteTableBrowser({ scope: () => ({ tab, profile, connectionId: 'c', database: 'main', table: '原表', version: state.connectionVersions.c, schemaRevision: context.latest.current.refreshVersion, present: state.settings.tabs.includes(tab), active: state.settings.activeTabId === 't', sqlite: true }), acquire: () => { state.activeJobs.t = true; publish(); return { owns: () => !!state.activeJobs.t, release: () => { state.activeJobs.t = false; publish(); return true; } }; }, read, release, cancel, id: () => 'read-' + ++sequence, changed: next => context.changed(next), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } });
  context.controller = browser; listeners.add(() => context.detailPageIntentRef.current?.current()); browser.activate();
  function page(offset: number): SqliteTablePage { return { target: { connectionId: 'c', database: 'main', table: '原表', kind }, schemaKey: 'a'.repeat(64), columns: [{ name: '值', declaredType: '' }], storageTypes: ['i', 't'], offset, limit: 2, hasMore: offset < 4, result: { columns: [{ key: 'c0', name: '值', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }, { c0: '2' }], elapsedMs: 0, statement: '', truncated: false } }; }
  function render(): void { context.detailPage = context.view.page && browser.pageCurrent(context.view.page) ? context.view.page : undefined; context.detailBinding = rowDetails.bind(context.detailPage?.result, [context.detailPage, context.detailPage?.storageTypes]); context.adopt(); }
  async function flush(): Promise<void> { for (let n = 0; n < 20; n++) await Promise.resolve(); render(); }
  async function settle(offset: number, adjust?: (p: SqliteTablePage) => void): Promise<void> { const received = page(offset); adjust?.(received); resolve(received); await flush(); }
  const initial = browser.load(query, 0); await settle(0); await initial;
  const open = (index = 1) => context.rowDetail = rowDetails.open(context.detailBinding, index);
  return { context, state, read, release, cancel, browser, rowDetails, page, settle, flush, open, render, publish, fail: async () => { reject(Error('真实只读页失败')); await flush(); }, modal: () => { modal = true; context.detailPageIntentRef.current?.current(); modal = false; }, dispose: () => browser.dispose() };
}

it.each(['table', 'view'] as const)('%s真实父链一次沿原条件跨页，首末行接管、旧回调拒绝且零写命令', async kind => {
  const f = await fixture(kind), original = f.open(); f.context.move(original, 1); f.render(); expect(f.context.rowDetail).toBeNull(); expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.read.mock.calls[1][0]).toMatchObject({ ...f.context.applied.current, offset: 2 }); await f.settle(2); const next = f.context.rowDetail;
  expect(next.index).toBe(0); expect(next.row).toBe(f.context.detailPage.result.rows[0]); expect(next.values[0]).toBe('9223372036854775807');
  f.context.move(original, 1); expect(f.read).toHaveBeenCalledTimes(2);
  f.context.move(next, -1); f.render(); await f.settle(0); expect(f.context.rowDetail.index).toBe(1); expect(f.release).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); f.dispose();
});
it.each(['active', 'version', 'profile', 'query', 'structure', 'modal'] as const)('%s在途ABA不复活详情；Browser准确新页与任务自行收尾', async change => {
  const f = await fixture(), original = f.open(); f.context.move(original, 1); f.render();
  if (change === 'active') { f.state.settings.activeTabId = 'other'; f.publish(); f.state.settings.activeTabId = 't'; f.publish(); }
  if (change === 'version') { f.state.connectionVersions.c++; f.publish(); f.state.connectionVersions.c--; f.publish(); }
  if (change === 'profile') { const profile = f.state.connections[0]; f.state.connections[0] = { ...profile }; f.publish(); f.state.connections[0] = profile; f.publish(); }
  if (change === 'query') { const query = f.context.applied.current; f.context.applied.current = { ...query }; f.publish(); f.context.applied.current = query; f.publish(); }
  if (change === 'structure') { f.context.latest.current.refreshVersion++; f.publish(); f.context.latest.current.refreshVersion--; f.publish(); }
  if (change === 'modal') f.modal();
  await f.settle(2); expect(f.context.rowDetail).toBeNull(); expect(f.context.setDetailPageNotice).toHaveBeenLastCalledWith(text.sqlitePageStale); expect(f.state.activeJobs.t).toBe(false); expect(f.release).not.toHaveBeenCalled(); f.dispose();
});
it.each(['empty', 'failure', 'stop'] as const)('%s清旧详情且保留可见通知，不循环扫描', async mode => {
  const f = await fixture(); f.context.move(f.open(), 1); f.render();
  if (mode === 'empty') await f.settle(2, page => { page.result.rows = []; page.storageTypes = []; page.hasMore = false; });
  if (mode === 'failure') await f.fail();
  if (mode === 'stop') { const stopping = f.browser.stop(); await f.settle(2); await stopping; f.render(); expect(f.cancel).toHaveBeenCalledOnce(); }
  expect(f.context.rowDetail).toBeNull(); expect(f.context.detailPageIntentRef.current).toBeUndefined(); expect(f.read).toHaveBeenCalledTimes(2); expect(f.context.setDetailPageNotice.mock.calls.at(-1)?.[0]).toBeTruthy(); f.dispose();
});
