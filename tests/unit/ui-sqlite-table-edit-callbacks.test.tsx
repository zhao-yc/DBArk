import { act, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow, SqliteEditView } from '../../src/renderer/sqliteTableEditor';
import { sqliteTableEditZh as text } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { memoryDocument, type MemoryNode } from '../fixtures/memory-dom';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let ValueDialog: typeof import('../../src/renderer/components/SqliteTableEditDialog')['SqliteTableValueDialog'], PreviewDialog: typeof import('../../src/renderer/components/SqliteTableEditDialog')['SqliteTablePreviewDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true }); const create = document.createElement.bind(document);
  /** 仅补标准 HTML 属性端口；组件、hook、原事件回调均运行真实 React 产品代码。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, { options: { configurable: true, get: () => node.querySelectorAll('option') }, value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } } });
    if (name === 'option') { let selected = false, dirty = false; Object.defineProperties(node, { value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) }, selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; } }, defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteTableValueDialog: ValueDialog, SqliteTablePreviewDialog: PreviewDialog } = await import('../../src/renderer/components/SqliteTableEditDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
function page(name: string): SqliteTablePage { return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: name, kind: 'table' }, columns: [{ name: 'mixed', declaredType: '' }], offset: 0, limit: 10, hasMore: false, result: { columns: [{ key: 'c0', name: 'mixed', type: 'SQLITE' }], rows: [{ c0: name }], statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: name, expiresAt: new Date(1800000).toISOString(), columns: [{ name: 'mixed', declaredType: '', generated: false, nullable: true, hasDefault: true }], rows: [[{ kind: 'text', value: name }]], locator: { kind: 'rowid', columns: [] } } }; }
function row(value: string): SqliteDraftRow { return { id: 'original-0', index: 0, deleted: false, values: [{ kind: 'text', value }] }; }
function node(label: string, tag = 'button'): MemoryNode { const found = document.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); expect(found, label).toBeDefined(); return found!; }
/** 持有真实 React 旧回调再换来源，不通过重新查找新按钮冒充旧事件。 */
function callback(element: MemoryNode, name = 'onClick'): (...args: any[]) => unknown { const key = Object.keys(element).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); const fn = Reflect.get(element, key)[name]; if (typeof fn !== 'function') throw Error('缺少真实回调'); return fn; }
async function mount(render: () => ReactNode) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(render())); return async () => { await act(async () => root!.render(render())); }; }
function editView(id: string): SqliteEditView { const source = page('相同目标'); return { page: source, rows: [row(id)], dirty: true, busy: false, valid: true, unknown: false, undo: true, redo: false, message: '', preview: { previewId: id, snapshotId: 'snapshot', target: source.target, schemaKey: source.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.相同目标', counts: { insert: 0, update: 1, delete: 0 }, sql: ['UPDATE "相同目标" SET "mixed" = ?;'] } }; }

describe('SQLite typed Modal 与集中预览真实 React 旧回调隔离', () => {
  it('换页后同original-0的旧save/close/change不修改新窗口；新key使用新字段正文', async () => {
    const oldSave = vi.fn(() => true), oldClose = vi.fn(), nextSave = vi.fn(() => true), nextClose = vi.fn();
    let props = { ticket: {}, page: page('旧页'), row: row('旧内容'), current: () => true, onSave: oldSave, onClose: oldClose }, key = 'old';
    const rerender = await mount(() => <ValueDialog key={key} {...props}/>), save = callback(node(text.saveInput)), close = callback(node(text.cancelInput)), change = callback(node(text.value('mixed'), 'textarea'), 'onChange');
    props = { ticket: {}, page: page('新页'), row: row('新内容'), current: () => true, onSave: nextSave, onClose: nextClose }; key = 'new'; await rerender();
    await act(async () => { save(); close(); change({ target: { value: '旧事件污染' } }); }); expect(node(text.value('mixed'), 'textarea').value).toBe('新内容'); expect(oldSave).not.toHaveBeenCalled(); expect(oldClose).not.toHaveBeenCalled(); expect(nextSave).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
    await act(async () => callback(node(text.saveInput))()); expect(nextSave).toHaveBeenCalledExactlyOnceWith([{ kind: 'text', value: '新内容' }]); expect(nextClose).toHaveBeenCalledOnce();
  });
  it('相同组件key误复用来源时也拒旧owner和新闭包，字段不会静默移交给新页', async () => {
    const save = vi.fn(() => true), close = vi.fn(), nextSave = vi.fn(() => true), nextClose = vi.fn(); let props = { ticket: {}, page: page('旧'), row: row('旧'), current: () => true, onSave: save, onClose: close };
    const rerender = await mount(() => <ValueDialog {...props}/>); props = { ticket: {}, page: page('新'), row: row('新'), current: () => true, onSave: nextSave, onClose: nextClose }; await rerender(); await act(async () => { callback(node(text.saveInput))(); callback(node(text.cancelInput))(); }); expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(nextSave).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
  });
  it('旧字段输入/保存回调不能覆盖后来的同窗口正文，当前保存仍提交准确typed值', async () => {
    const save = vi.fn(() => true), close = vi.fn(), props = { ticket: {}, page: page('页'), row: row('原值'), current: () => true, onSave: save, onClose: close }; await mount(() => <ValueDialog {...props}/>);
    const oldChange = callback(node(text.value('mixed'), 'textarea'), 'onChange'), oldSave = callback(node(text.saveInput)); await act(async () => oldChange({ target: { value: '当前正文' } })); await act(async () => { oldChange({ target: { value: '迟到旧值' } }); oldSave(); }); expect(save).not.toHaveBeenCalled(); expect(node(text.value('mixed'), 'textarea').value).toBe('当前正文'); await act(async () => callback(node(text.saveInput))()); expect(save).toHaveBeenCalledExactlyOnceWith([{ kind: 'text', value: '当前正文' }]);
  });
  it('换preview后旧确认submit/close/checkbox不能写新批次，新预览必须再次确认', async () => {
    const oldApply = vi.fn(), oldClose = vi.fn(), nextApply = vi.fn(), nextClose = vi.fn(); let props = { ticket: {}, view: editView('old'), current: () => true, onApply: oldApply, onClose: oldClose, onStop: vi.fn() }, key = 'old';
    const rerender = await mount(() => <PreviewDialog key={key} {...props}/>); await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); expect(node(text.submit).disabled).toBe(false); const oldSubmit = callback(node(text.submit)), oldCloseHandler = callback(node(text.closePreview)), oldCheck = callback(node(text.confirmation, 'input'), 'onChange');
    props = { ...props, ticket: {}, view: editView('next'), onApply: nextApply, onClose: nextClose }; key = 'next'; await rerender(); expect(node(text.confirmation, 'input').checked).toBe(false); await act(async () => { oldSubmit(); oldCloseHandler(); oldCheck({ target: { checked: true } }); }); expect(oldApply).not.toHaveBeenCalled(); expect(nextApply).not.toHaveBeenCalled(); expect(oldClose).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled(); expect(node(text.submit).disabled).toBe(true);
    await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); await act(async () => callback(node(text.submit))()); expect(nextApply).toHaveBeenCalledOnce();
  });
  it('误复用相同preview key仍拒旧确认；仅回调引用更新不会重新授权旧preview', async () => {
    const apply = vi.fn(), nextApply = vi.fn(); let props = { ticket: {}, view: editView('old'), current: () => true, onApply: apply, onClose: vi.fn(), onStop: vi.fn() }; const rerender = await mount(() => <PreviewDialog {...props}/>); await act(async () => callback(node(text.confirmation, 'input'), 'onChange')({ target: { checked: true } })); props = { ...props, view: editView('next'), onApply: nextApply }; await rerender(); await act(async () => callback(node(text.submit))()); expect(apply).not.toHaveBeenCalled(); expect(nextApply).not.toHaveBeenCalled();
  });
  it('旧pending预览stop回调不取消后继任务，当前同窗口的新任务stop正常', async () => {
    const stopA = vi.fn(), stopB = vi.fn(), value = editView('pending'); value.preview = undefined; value.busy = true; value.taskId = 'preview-task'; let props = { ticket: {}, view: value, current: () => true, onApply: vi.fn(), onClose: vi.fn(), onStop: stopA }; const rerender = await mount(() => <PreviewDialog {...props}/>), oldStop = callback(node(text.stop)); props = { ...props, view: { ...value, taskId: 'apply-task' }, onStop: stopB }; await rerender(); await act(async () => oldStop()); expect(stopA).not.toHaveBeenCalled(); expect(stopB).not.toHaveBeenCalled(); await act(async () => callback(node(text.stop))()); expect(stopB).toHaveBeenCalledOnce();
  });
});
