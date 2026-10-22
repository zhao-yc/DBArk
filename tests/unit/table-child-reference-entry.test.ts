import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { ChildReferenceIntent } from '../../src/renderer/childReferenceIntent';
import type { TableInfo } from '../../src/shared/contracts';

const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map<string, string>(); let disabled = '';
/** 提取生产按钮及原处理器；仅替换store、DOM、setter，不另造一套入口判定。 */
function visit(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name && ['openChildReferences', 'closeChildReferences'].includes(node.name.text)) methods.set(node.name.text, node.getText(tree));
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button') {
    const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(tree), attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(tree) : '']));
    if (props.get('onClick') === 'openChildReferences') disabled = props.get('disabled') ?? '';
  }
  ts.forEachChild(node, visit);
}
visit(tree);
/** 精确的父草稿状态来自RAM，实际函数仍完整执行冻结与动态回验。 */
function fixture() {
  const base = { connectionId: 'connection', database: 'parent_db', table: 'parent' }, tab = { id: 'tab', kind: 'table', ...base };
  const info: TableInfo = { database: base.database, name: base.table, engine: 'InnoDB', objectKind: 'table', columns: [{ name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: '', comment: '', generated: false }], indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: 'CREATE TABLE parent (`id` bigint)' };
  const row = { id: 'row', data: { id: '9223372036854775807' }, original: { id: '1' }, deleted: false }, page = {}, profile = { id: base.connectionId };
  const workspace = { settings: { tabs: [tab], activeTabId: tab.id }, connectionVersions: { connection: 5 }, connections: [profile] }, ticket = {};
  const show = vi.fn(), record = { hasInput: () => false }, port = createContext({ structuredClone, ChildReferenceIntent, source, info, page, connection: profile, connectionVersion: 5, tab, base, referenceRow: row, blocked: false, blockedRef: { current: false }, externalStale: false, gridEditing: false, childReferenceValues: [info, page], childReferenceIntent: { current: null }, rowsRef: { current: [row] }, selectionRef: { current: { rowId: row.id, key: 'id' } }, record, recordControllerRef: { current: record }, recordContextRef: { current: { info } }, recordPageSource: { current: page }, loadGeneration: { current: 3 }, mounted: { current: true }, activeGridEditor: { current: null }, tableReadAction: { current: ticket }, tableReadRender: ticket, document: { querySelector: () => null }, useWorkspace: { getState: () => workspace }, batchFillIntent: { current: null }, presetUiEpoch: { current: 0 }, setChildReferenceDialog: show });
  runInContext(ts.transpileModule([...methods.values()].join('\n') + '\nglobalThis.handlers={openChildReferences,closeChildReferences,disabled:()=>(' + disabled + ')};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port);
  return { port, row, info, page, workspace, show, handlers: port.handlers as { openChildReferences(): void; closeChildReferences(intent: ChildReferenceIntent): void; disabled(): boolean }, intent: () => port.childReferenceIntent.current as ChildReferenceIntent | null };
}
it('实际入口无outgoingFK亦启用，冻结当前草稿且不改父行或发送SQL', () => {
  expect(methods.size).toBe(2); expect(disabled).not.toBe(''); const f = fixture(); expect(f.handlers.disabled()).toBe(false); f.handlers.openChildReferences(); const captured = f.intent()!; expect(captured.current()).toBe(true); expect(captured.data).toEqual(f.row.data); expect(captured.source.foreignKeys).toEqual([]); expect(f.show).toHaveBeenCalledOnce(); expect(f.row.original.id).toBe('1'); f.handlers.openChildReferences(); expect(f.show).toHaveBeenCalledOnce(); f.handlers.closeChildReferences(captured); expect(f.intent()).toBeNull(); expect(captured.current()).toBe(false);
});
it.each(['view', 'deleted', 'input', 'busy', 'stale', 'editor', 'old-action', 'modal'])('实际入口%s时拒绝且不清父草稿', mode => {
  const f = fixture(); if (mode === 'view') f.info.objectKind = 'view'; else if (mode === 'deleted') f.row.deleted = true; else if (mode === 'input') f.port.record.hasInput = () => true; else if (mode === 'busy') f.port.blockedRef.current = true; else if (mode === 'stale') f.port.externalStale = true; else if (mode === 'editor') f.port.gridEditing = true; else if (mode === 'old-action') f.port.tableReadAction.current = {}; else f.port.document.querySelector = () => ({}); f.handlers.openChildReferences(); expect(f.show).not.toHaveBeenCalled(); expect(f.row.data.id).toBe('9223372036854775807');
});
it.each(['row', 'generation', 'version', 'active-tab', 'profile', 'page', 'input'])('原%s变化永久撤销，恢复后旧意图不复活', mode => {
  const f = fixture(); f.handlers.openChildReferences(); const captured = f.intent()!; let restore: () => void;
  if (mode === 'row') { const original = f.port.rowsRef.current; f.port.rowsRef.current = []; restore = () => { f.port.rowsRef.current = original; }; }
  else if (mode === 'generation') { f.port.loadGeneration.current++; restore = () => { f.port.loadGeneration.current--; }; }
  else if (mode === 'version') { f.workspace.connectionVersions.connection++; restore = () => { f.workspace.connectionVersions.connection--; }; }
  else if (mode === 'active-tab') { f.workspace.settings.activeTabId = 'other'; restore = () => { f.workspace.settings.activeTabId = 'tab'; }; }
  else if (mode === 'profile') { const original = f.workspace.connections; f.workspace.connections = [{ id: 'connection' }]; restore = () => { f.workspace.connections = original; }; }
  else if (mode === 'page') { const original = f.port.recordPageSource.current; f.port.recordPageSource.current = {}; restore = () => { f.port.recordPageSource.current = original; }; }
  else { f.port.record.hasInput = () => true; restore = () => { f.port.record.hasInput = () => false; }; }
  expect(captured.current()).toBe(false); restore(); expect(captured.current()).toBe(false);
});
it('旧关闭回调不能关闭新意图，原页面路径保持正式Dialog及活动锁接线', () => {
  const f = fixture(); f.handlers.openChildReferences(); const first = f.intent()!; f.handlers.closeChildReferences(first); f.handlers.openChildReferences(); const second = f.intent(); f.handlers.closeChildReferences(first); expect(f.intent()).toBe(second); expect(source).toContain('<ChildReferenceDialog base={base} intent={childReferenceDialog}'); expect(source).toContain('onActivity={referenceActivity}'); expect(source).toContain('busy || referenceBusy || !!childReferenceDialog');
});
