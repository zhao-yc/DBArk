import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { memoryDocument } from '../fixtures/memory-dom';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';

const port = vi.hoisted(() => ({ props: undefined as any }));
// 仅RDG的布局与事件端口是RAM；Grid真实渲染票据、行身份和来源检查保持。
vi.mock('react-data-grid', () => ({ SelectColumn: { key: '__select', name: '' }, renderCheckbox: () => null, DataGrid(props: any) { port.props = props; props.onSortColumnsChange?.([{ columnKey: 'c0', direction: 'ASC' }]); return <div role="grid"/>; } }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Grid: typeof import('../../src/renderer/components/SqliteTableEditGrid')['SqliteTableEditGrid'];
beforeAll(async () => { document = memoryDocument(); ({ createRoot } = await import('react-dom/client')); ({ SqliteTableEditGrid: Grid } = await import('../../src/renderer/components/SqliteTableEditGrid')); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; port.props = undefined; document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 虚拟网格只收原typed行，不由前端重新排序或转数值。 */
function fixture() {
  const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'g', declaredType: '', generated: true }], page: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, schemaKey: 'a'.repeat(64), columns, offset: 0, limit: 100, hasMore: false, result: { columns: columns.map((c, i) => ({ name: c.name, key: 'c' + i, type: 'SQLITE' })), rows: [], statement: '', elapsedMs: 0, truncated: false } }, rows = [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'integer' as const, value: '9223372036854775807' }, { kind: 'text' as const, value: '原生成' }] }], callback = vi.fn(), alive = { value: true };
  const props: ComponentProps<typeof Grid> = { page, rows, disabled: false, isCurrent: () => alive.value, onSelect: vi.fn(), onEdit: vi.fn(), sort: [{ columnKey: 'c0', direction: 'DESC' }], onSortChange: callback };
  const mount = async (patch: Partial<typeof props> = {}) => { Object.assign(props, patch); if (!root) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as HTMLElement); } await act(async () => root!.render(<Grid {...props}/>)); };
  return { props, page, rows, callback, alive, mount };
}
it('显示反向顺序、隐藏与冻结不重排行或物理key，列头/调宽仍交付原字段', async () => {
  const f = fixture(), resize = vi.fn(), filter = vi.fn(); await f.mount({ projection: [{ index: 1, width: 64, frozen: true }, { index: 0, width: 500, frozen: false }], onColumnResize: resize, onFilterCell: filter });
  expect(port.props.rows).toBe(f.rows); expect(port.props.columns.slice(2).map((column: any) => [column.key, column.width, column.frozen])).toEqual([['c1', 64, true], ['c0', 500, false]]);
  await act(async () => port.props.onCellClick({ row: f.rows[0], column: { key: 'c1' } })); expect(filter).toHaveBeenCalledWith({ row: f.rows[0], column: 1 });
  await act(async () => port.props.onColumnResize({ key: 'c0' }, 400)); expect(resize).toHaveBeenCalledExactlyOnceWith('c0', 400);
  const old = port.props.onColumnResize; await f.mount({ projection: [{ index: 0, frozen: false }] }); await act(async () => old({ key: 'c1' }, 300)); expect(resize).toHaveBeenCalledTimes(1);
});
it('只在提交后把真实header意图交父级，包含生成列且保持原行对象', async () => {
  const f = fixture(); await f.mount(); expect(f.callback).not.toHaveBeenCalled(); expect(port.props.rows).toBe(f.rows); expect(port.props.sortColumns).toBe(f.props.sort); expect(port.props.columns[2].sortable).toBe(true); expect(port.props.columns[3].sortable).toBe(true); expect(port.props.columns[0].sortable).not.toBe(true); expect(port.props.columns[1].sortable).not.toBe(true);
  const rules = [{ columnKey: 'c1', direction: 'ASC' }, { columnKey: 'c0', direction: 'DESC' }]; await act(async () => port.props.onSortColumnsChange(rules)); expect(f.callback).toHaveBeenCalledExactlyOnceWith(rules); expect(port.props.rows).toBe(f.rows); expect(f.props.onSelect).not.toHaveBeenCalled(); expect(f.props.onEdit).not.toHaveBeenCalled();
});
it.each(['disabled', 'source', 'modal', 'old-render', 'unmount'] as const)('%s时旧header回调不排序不选行', async kind => {
  const f = fixture(); await f.mount(); const old = port.props.onSortColumnsChange;
  if (kind === 'disabled') await f.mount({ disabled: true });
  if (kind === 'source') f.alive.value = false;
  if (kind === 'modal') { const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.appendChild(modal); }
  if (kind === 'old-render') await f.mount({ rows: [...f.rows] });
  if (kind === 'unmount') { await act(async () => root!.unmount()); root = undefined; }
  await act(async () => old([{ columnKey: 'c0', direction: 'ASC' }])); expect(f.callback).not.toHaveBeenCalled(); expect(f.props.onSelect).not.toHaveBeenCalled();
});
it('没有排序能力或busy时不展示可排序字段', async () => {
  const f = fixture(); await f.mount({ onSortChange: undefined }); expect(port.props.columns.slice(2).every((c: any) => c.sortable === false)).toBe(true);
  await f.mount({ onSortChange: f.callback, disabled: true }); expect(port.props.columns.slice(2).every((c: any) => c.sortable === false)).toBe(true); await act(async () => port.props.onSortColumnsChange([])); expect(f.callback).not.toHaveBeenCalled();
});
it('真实选格端口允许生成列筛选，原粘贴起点仍拒绝生成列，不在渲染时通知', async () => {
  const f = fixture(), filter = vi.fn(), pasteAnchor = vi.fn(); await f.mount({ onFilterCell: filter, onActiveCell: pasteAnchor }); expect(filter).not.toHaveBeenCalled();
  await act(async () => port.props.onCellClick({ row: f.rows[0], column: { key: 'c1' } }));
  expect(filter).toHaveBeenLastCalledWith({ row: f.rows[0], column: 1 }); expect(pasteAnchor).not.toHaveBeenCalledWith({ row: f.rows[0], column: 1 });
});
it.each(['modal', 'source', 'old-render', 'unmount'] as const)('%s使旧选格端口不能通知新筛选来源', async kind => {
  const f = fixture(), filter = vi.fn(); await f.mount({ onFilterCell: filter }); const old = port.props.onCellClick;
  if (kind === 'modal') { const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.appendChild(modal); }
  if (kind === 'source') f.alive.value = false;
  if (kind === 'old-render') await f.mount({ rows: [...f.rows] });
  if (kind === 'unmount') { await act(async () => root!.unmount()); root = undefined; }
  await act(async () => old({ row: f.rows[0], column: { key: 'c0' } })); expect(filter).not.toHaveBeenCalled();
});
