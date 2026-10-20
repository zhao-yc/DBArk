import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { SnippetsDialog } from '../../src/renderer/components/SnippetsDialog';
import { snippetTransferZh as text, type SnippetTransferPreview } from '../../src/shared/snippetTransfer';
import { zh } from '../../src/renderer/locales/zh-CN';

// 只替换Monaco与IPC外部端口；正式父弹窗、传输组件和ReactDOM保持真实。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value }: { value: string }) => <pre>{value}</pre> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const sample = { id: '用户一', name: '片段一', group: '', description: '<img src=x>', sql: "SELECT '🚢';\r\n", updatedAt: '' }, scopeId = '12345678-1234-4234-8234-123456789abc';
const preview = (): SnippetTransferPreview => ({ previewId: scopeId, expiresAt: Date.now() + 10000, entries: [{ snippet: { ...sample, sql: 'SELECT 2' }, previous: sample, status: 'replace', warnings: [] }, { snippet: { ...sample, id: '副本' }, status: 'add', warnings: [text.sameName] }] });
const invoke = vi.fn(), close = vi.fn(), insert = vi.fn();
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); Object.assign(document, { oninput: null }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name); Object.assign(node, { scrollIntoView() {} });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(o => (o as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const o of node.querySelectorAll('option')) (o as MemoryNode & { selected?: boolean }).selected = o.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  Object.assign(window, { dbark: { invoke } }); ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; invoke.mockReset(); close.mockReset(); insert.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function button(label: string) { const node = document.body.querySelectorAll('button').find(n => n.textContent === label); if (!node) throw Error(`未找到按钮：${label}`); return node; }
function label(value: string) { const node = document.body.querySelectorAll('[aria-label]').find(n => n.getAttribute('aria-label') === value); if (!node) throw Error(`未找到标签：${value}`); return node; }
async function click(node: MemoryNode) { await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function mount(overrides?: (command: string, input: any) => unknown) {
  invoke.mockImplementation(async (command, input) => {
    const result = overrides?.(command, input); if (result !== undefined) return result;
    if (command === 'snippets.list') return [sample]; if (command === 'snippets.transferOpen') return { scopeId }; if (command === 'snippets.transferPreview') return preview(); if (command === 'snippets.transferCancel') return { cancelled: true }; if (command === 'snippets.transferExport') return { count: 1 }; if (command === 'snippets.transferApply') return { items: [sample, { ...sample, id: '副本' }], added: 1, replaced: 0, skipped: 1 }; throw Error('未预期IPC');
  });
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element); await act(async () => root!.render(<SnippetsDialog initialSql="SELECT 1" onInsert={insert} onClose={close}/>));
}
it('真实片段弹窗预览零保存，冲突默认跳过；显式逐项选择与确认只回传ID/动作', async () => {
  await mount(); await click(button(text.import)); expect(invoke.mock.calls.filter(c => c[0] === 'snippets.transferApply')).toHaveLength(0); expect(label('片段一（用户一）导入动作').value).toBe('skip');
  expect(document.body.querySelectorAll('img')).toHaveLength(0); expect(document.body.textContent).toContain('SELECT 2'); expect(document.body.textContent).toContain(sample.sql);
  await act(async () => { const select = label('片段一（用户一）导入动作'); select.value = 'replace'; select.dispatchEvent(new MemoryEvent('change')); });
  await click(button(text.confirm)); expect(invoke).toHaveBeenCalledWith('snippets.transferApply', { scopeId, previewId: scopeId, decisions: [{ id: sample.id, action: 'replace' }, { id: '副本', action: 'skip' }] }); expect(document.body.textContent).toContain(text.applied(1, 0, 1)); expect(insert).not.toHaveBeenCalled();
});
it('预览期间父弹窗关闭/编辑/插入被锁定，取消仅释放能力，不保存', async () => {
  await mount(); await click(label('选择片段：片段一')); await click(button(text.import)); expect(button(zh.common.close).disabled).toBe(true); expect(button(zh.snippets.edit).disabled).toBe(true); expect(button(zh.snippets.insert).disabled).toBe(true);
  await click(label(zh.dialogs.text001)); expect(close).not.toHaveBeenCalled(); await click(button(text.closePreview)); expect(invoke).toHaveBeenCalledWith('snippets.transferCancel', { scopeId }); expect(invoke.mock.calls.some(c => c[0] === 'snippets.transferApply')).toBe(false); expect(button(zh.common.close).disabled).toBe(false);
});
it('打开能力迟到且弹窗已卸载，仅关闭迟到scope，不选择文件或自动确认', async () => {
  const gate = deferred<{ scopeId: string }>(); await mount(command => command === 'snippets.transferOpen' ? gate.promise : undefined); await click(button(text.import)); await act(async () => root!.unmount()); root = undefined;
  await act(async () => gate.resolve({ scopeId })); expect(invoke).toHaveBeenCalledWith('snippets.transferCancel', { scopeId, close: true }); expect(invoke.mock.calls.some(c => c[0] === 'snippets.transferPreview')).toBe(false);
});
it('预览迟到取消不复活，不阻止随后新请求，也不自动落盘', async () => {
  const gate = deferred<SnippetTransferPreview>(); let first = true; await mount(command => { if (command === 'snippets.transferPreview' && first) { first = false; return gate.promise; } });
  await click(button(text.import)); await click(button(text.cancel)); await click(button(text.import)); expect(document.body.textContent).toContain(text.preview); await act(async () => gate.resolve({ ...preview(), entries: [] })); expect(document.body.textContent).toContain(sample.description); expect(invoke.mock.calls.some(c => c[0] === 'snippets.transferApply')).toBe(false);
});
it('确认期间禁取消和关闭；失败消费预览并保留错误，不能自动重试', async () => {
  let reject!: (error: Error) => void; const failed = new Promise((_, no) => { reject = no; });
  await mount(command => command === 'snippets.transferApply' ? failed : undefined); await click(button(text.import)); await click(button(text.confirm)); expect(button(text.closePreview).disabled).toBe(true); expect(button(zh.common.close).disabled).toBe(true);
  await act(async () => reject(Error('整批未保存'))); expect(document.body.textContent).toContain('整批未保存'); expect(document.body.textContent).not.toContain(text.confirm); expect(invoke.mock.calls.filter(c => c[0] === 'snippets.transferApply')).toHaveLength(1);
});
it('导出使用受控IPC，取消发布被Main拒绝时等待原结果，不声称撤销', async () => {
  const gate = deferred<{ count: number }>(); await mount(command => command === 'snippets.transferExport' ? gate.promise : command === 'snippets.transferCancel' ? { cancelled: false } : undefined);
  await click(button(text.export)); await click(button(text.cancel)); expect(document.body.textContent).toContain(text.committing); expect(button(zh.common.close).disabled).toBe(true); await act(async () => gate.resolve({ count: 1 })); expect(document.body.textContent).toContain(text.exported(1)); expect(button(zh.common.close).disabled).toBe(false);
});
it.each(['success','failure'] as const)('取消IPC失败仍等原导出%s，不提前解锁或丢失原结局',async outcome=>{
  const gate=deferred<{count:number}>();
  await mount((command,input)=>command==='snippets.transferExport'?gate.promise:command==='snippets.transferCancel'&&!input.close?Promise.reject(Error('取消请求失败')):undefined);
  await click(button(text.export));await click(button(text.cancel));
  const prematurelyUnlocked=!button(zh.common.close).disabled||!button(text.export).disabled;
  expect(document.body.textContent).toContain('取消请求失败');await click(button(text.export));
  const requests=invoke.mock.calls.filter(call=>call[0]==='snippets.transferExport').length;
  await act(async()=>outcome==='success'?gate.resolve({count:1}):gate.reject(Error('原导出失败')));
  expect(prematurelyUnlocked).toBe(false);expect(requests).toBe(1);expect(button(zh.common.close).disabled).toBe(false);
  expect(document.body.textContent).toContain(outcome==='success'?text.exported(1):'原导出失败');
});
it.each([
  ['success', 'committing'], ['success', 'rejected'], ['failure', 'committing'], ['failure', 'rejected']
] as const)('原导出%s已结算后，迟到取消%s不能覆盖真实结局或恢复等待提示', async (outcome, cancellation) => {
  const exporting = deferred<{ count: number }>(), cancelling = deferred<{ cancelled: boolean }>();
  await mount((command, input) => command === 'snippets.transferExport' ? exporting.promise : command === 'snippets.transferCancel' && !input.close ? cancelling.promise : undefined);
  await click(button(text.export)); await click(button(text.cancel));
  // 两个请求均来自同一代次；原操作先结束，取消回包此时还没有到达。
  await act(async () => outcome === 'success' ? exporting.resolve({ count: 1 }) : exporting.reject(Error('原导出终态失败')));
  const unlocked = !button(zh.common.close).disabled && !button(text.export).disabled;
  await act(async () => cancellation === 'committing' ? cancelling.resolve({ cancelled: false }) : cancelling.reject(Error('迟到取消错误')));
  // 所有异步请求先结算再断言，失败报告不会遗留悬挂的测试承诺。
  expect(unlocked).toBe(true); expect(button(zh.common.close).disabled).toBe(false);
  expect(document.body.textContent).toContain(outcome === 'success' ? text.exported(1) : '原导出终态失败');
  expect(document.body.textContent).not.toContain(text.committing); expect(document.body.textContent).not.toContain('迟到取消错误');
});
it('原片段尚未保存时必须先处理丢弃确认，取消保留编辑且不申请文件能力', async () => {
  await mount(); await click(label('选择片段：片段一')); await click(button(zh.snippets.edit));
  await act(async () => { const description = document.body.querySelectorAll('textarea')[0]; description.value = '尚未保存'; description.dispatchEvent(new MemoryEvent('input')); });
  await click(button(text.import)); expect(label(zh.snippets.unsavedTitle)).toBeDefined(); expect(invoke.mock.calls.some(c => c[0] === 'snippets.transferOpen')).toBe(false);
  await click(button(zh.common.cancel)); expect(document.body.querySelectorAll('textarea')[0].value).toBe('尚未保存'); await click(button(text.import)); await click(button(zh.snippets.discard));
  expect(invoke).toHaveBeenCalledWith('snippets.transferPreview', { scopeId }); expect(invoke.mock.calls.some(c => c[0] === 'snippets.save')).toBe(false);
});
