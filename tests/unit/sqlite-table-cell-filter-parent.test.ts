import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { sqliteTableDraft, type SqliteFilterDraft } from '../../src/renderer/sqliteTableBrowser';

/** 真实父入口负责整组校验和一次发布；端口使用内存，不冒称窗口或数据库操作。 */
function fixture() {
  const source = ts.createSourceFile('parent.tsx', readFileSync(new URL('../../src/renderer/components/SqliteTableTab.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let method = ''; function walk(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'appendCellFilter') method = node.getText(source); ts.forEachChild(node, walk); } walk(source); expect(method).not.toBe('');
  const token = {}, page = {}, state = { current: true }, draft = vi.fn((exclude: boolean, id: string): SqliteFilterDraft => ({ id, column: 'v', operator: exclude ? 'ne' : 'eq', kind: 'integer', value: '9223372036854775807' }));
  const owner = { id: 'owner', page, source: { current: () => state.current, draft } }, filters: SqliteFilterDraft[] = [{ id: 'old', column: 'v', operator: 'eq', kind: 'text', value: '保留原草稿', enabled: false }];
  const setFilters = vi.fn(), setConditions = vi.fn(), setValidation = vi.fn(), setCellFilterOwner = vi.fn(), notify = vi.fn(), request = vi.fn(() => { throw Error('加入条件不得请求数据库'); });
  const context: any = createContext({ page, editRender: { current: token }, editRenderTicket: token, cellFilterRef: { current: owner }, cellFilterOwner: owner, available: () => state.current, view: { busy: false }, externalBusy: false, filters, limit: 7, mode: 'or', sort: [{ id: 'sort', column: 'v', direction: 'desc' }], tab: { connectionId: 'source', database: 'main', table: 'subject' }, uid: () => 'new', sqliteTableDraft, setFilters, setConditions, setValidation, setCellFilterOwner, useWorkspace: { getState: () => ({ notify, selection: { connectionId: 'other', database: 'other' } }) }, cellFilterText: { added: '已加入草稿' }, errorMessage: (error: Error) => error.message, invoke: request });
  runInContext(ts.transpileModule(method + '\nglobalThis.api={appendCellFilter};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, filters, owner, state, draft, setFilters, setConditions, setValidation, setCellFilterOwner, notify, request, append: context.api.appendCellFilter as (exclude: boolean) => void };
}
it.each([false, true])('等值/排除=%s仅追加准确typed草稿，保既有停用条件/OR/排序，零请求且单次消费', exclude => {
  const f = fixture(); f.append(exclude);
  expect(f.setFilters).toHaveBeenCalledExactlyOnceWith([...f.filters, { id: 'new', column: 'v', operator: exclude ? 'ne' : 'eq', kind: 'integer', value: '9223372036854775807' }]);
  expect(f.filters).toHaveLength(1); expect(f.context.mode).toBe('or'); expect(f.context.sort).toEqual([{ id: 'sort', column: 'v', direction: 'desc' }]); expect(f.setConditions).toHaveBeenCalledExactlyOnceWith(true); expect(f.notify).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled();
  f.append(exclude); expect(f.setFilters).toHaveBeenCalledOnce(); expect(f.draft).toHaveBeenCalledOnce();
});
it.each(['old-render', 'old-owner', 'page', 'inactive', 'busy', 'external'] as const)('%s拒绝旧动作，不改草稿和原选择', change => {
  const f = fixture(); if (change === 'old-render') f.context.editRender.current = {}; if (change === 'old-owner') f.context.cellFilterRef.current = { ...f.owner }; if (change === 'page') f.context.page = {}; if (change === 'inactive') f.state.current = false; if (change === 'busy') f.context.view.busy = true; if (change === 'external') f.context.externalBusy = true;
  f.append(false); expect(f.setFilters).not.toHaveBeenCalled(); expect(f.setCellFilterOwner).not.toHaveBeenCalled(); expect(f.draft).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it.each(['count', 'value', 'invalid'] as const)('整组%s校验拒绝不产生半条条件，不消费准确选择', kind => {
  const f = fixture(); if (kind === 'count') f.context.filters = Array.from({ length: 32 }, (_, i) => ({ ...f.filters[0], id: String(i) })); if (kind === 'value') f.context.filters = Array.from({ length: 2 }, (_, i) => ({ ...f.filters[0], id: String(i), value: 'x'.repeat(65536) })); if (kind === 'invalid') f.filters[0] = { ...f.filters[0], kind: 'integer', value: 'not-number' };
  f.append(false); expect(f.setFilters).not.toHaveBeenCalled(); expect(f.setValidation).toHaveBeenCalledOnce(); expect(f.context.cellFilterRef.current).toBe(f.owner); expect(f.setConditions).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
