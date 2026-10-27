import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TableDraftDocument, TableDraftPayload } from '../../src/shared/tableDraft';
import type { TableDraftDialogProps, TableDraftDialogServices } from '../../src/renderer/components/TableDraftDialog';
import { tableDraftFilesZh as text } from '../../src/renderer/locales/tableDraftFiles.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableDraftDialog')['TableDraftDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null;
  const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableDraftDialog: Dialog } = await import('../../src/renderer/components/TableDraftDialog'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 只使用RAM合成草稿；正文的原始值不应渲染到对话框。 */
function payload(): TableDraftPayload {
  return { target: { connectionId: 'c', database: 'db', table: 'subject' }, metadataKey: '结构摘要', changes: [
    { kind: 'insert', values: { value: '不得显示的新增值' } },
    { kind: 'update', before: { id: '18446744073709551615', value: '不得显示的原始值' }, values: { value: '不得显示的修改值' } },
    { kind: 'delete', before: { id: '3', value: null } },
  ] };
}
function file(): { name: string; document: TableDraftDocument } { return { name: 'synthetic.dbark-draft.json', document: { ...payload(), kind: 'dbark.table-draft', version: 1, endpointKey: 'a'.repeat(64) } }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 组件走真实ReactDOM事件委派；内存端口不代表系统输入或原生窗口验收。 */
async function mount(mode: TableDraftDialogProps['mode'], overrides: Partial<TableDraftDialogServices> = {}, strict = false) {
  const callbacks = { assertCurrent: vi.fn(), onRestore: vi.fn(), onClose: vi.fn(), onBusy: vi.fn() };
  const services = { open: vi.fn(async () => file() as ReturnType<typeof file> | null), save: vi.fn(async () => ({ name: 'saved.dbark-draft.json' }) as { name: string } | null), verify: vi.fn(async () => ({ verifiedChanges: 3 })), cancel: vi.fn(async () => undefined), ...overrides };
  const source = payload(), props: TableDraftDialogProps = { mode, target: source.target, ...(mode === 'save' ? { payload: source } : {}), ...callbacks, services };
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(strict ? <StrictMode><Dialog {...props}/></StrictMode> : <Dialog {...props}/>));
  return { callbacks, services, props, source };
}
function button(label: string) { const value = doc.querySelectorAll('button').find(node => node.textContent === label); expect(value, label).toBeDefined(); return value!; }
function checkbox() { const value = doc.querySelector('input'); expect(value).not.toBeNull(); return value!; }
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function acknowledge(value = true) { const node = checkbox(); expect(node.disabled).toBe(false); await act(async () => { node.checked = value; node.dispatchEvent(new MemoryEvent('click')); }); }
function reactProps(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('未找到真实React事件属性'); return Reflect.get(node, key); }
async function chooseAndConfirm() { await click(button(text.choose)); await acknowledge(); }

describe('显式表格草稿文件正式对话框（RAM）', () => {
  it('保存需先确认未加密与原始数据风险，不在挂载或确认前打开文件选择器', async () => {
    const { services } = await mount('save');
    expect(doc.body.textContent).toContain('未加密'); expect(doc.body.textContent).toContain('修改前的原始数据');
    expect(doc.body.textContent).not.toContain('不得显示的'); expect(button(text.saveAction).disabled).toBe(true); expect(services.save).not.toHaveBeenCalled();
    await acknowledge(); expect(button(text.saveAction).disabled).toBe(false); expect(services.save).not.toHaveBeenCalled();
  });

  it('保存成功只写本地文件，不恢复或关闭父草稿，忙碌状态成对释放', async () => {
    const { services, callbacks, source } = await mount('save'); await acknowledge(); await click(button(text.saveAction));
    expect(services.save).toHaveBeenCalledExactlyOnceWith(source); expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]);
    expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(doc.body.textContent).toContain(text.saved); expect(doc.body.textContent).toContain(text.localOnly); expect(button(text.saveAction).disabled).toBe(true);
  });

  it.each(['save', 'restore'] as const)('%s原生文件选择取消后无成功、无自动恢复，仍保留对话框', async mode => {
    const { callbacks } = await mount(mode, { open: async () => null, save: async () => null });
    if (mode === 'save') { await acknowledge(); await click(button(text.saveAction)); } else await click(button(text.choose));
    expect(doc.querySelector('[role="dialog"]')).not.toBeNull(); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled(); expect(doc.body.textContent).not.toContain(text.saved);
    expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it('文件保存等待期间冻结已捕获值，禁止关闭与重复投递', async () => {
    const held = deferred<{ name: string } | null>(), save = vi.fn<TableDraftDialogServices['save']>(() => held.promise), { source, callbacks } = await mount('save', { save });
    await acknowledge(); const originalAction = reactProps(button(text.saveAction)).onClick; await click(button(text.saveAction));
    source.changes[0] = { kind: 'insert', values: { value: '等待时的新草稿' } };
    await act(async () => { originalAction(); reactProps(button(text.close)).onClick(); });
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toEqual(payload()); expect(callbacks.onClose).not.toHaveBeenCalled(); expect(callbacks.onBusy.mock.calls).toEqual([[true]]);
    await act(async () => held.resolve({ name: 'saved.json' })); expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it('恢复先选文件只显示操作统计和文件名，不显示原始值、不自动核验或写库', async () => {
    const { services, callbacks } = await mount('restore'); expect(services.open).not.toHaveBeenCalled(); await click(button(text.choose));
    expect(doc.body.textContent).toContain(file().name); expect(doc.body.textContent).toContain('新增：1；修改：1；删除：1'); expect(doc.body.textContent).not.toContain('不得显示的');
    expect(button(text.restoreAction).disabled).toBe(true); expect(services.verify).not.toHaveBeenCalled(); expect(callbacks.onRestore).not.toHaveBeenCalled();
    await acknowledge(); expect(services.verify).not.toHaveBeenCalled();
  });

  it('只有准确完整核验回执才能恢复一次，先释放忙碌再关闭，不自动提交', async () => {
    const calls: string[] = [], { services, callbacks } = await mount('restore');
    callbacks.onRestore.mockImplementation(() => { calls.push('restore'); callbacks.assertCurrent.mockImplementation(() => { throw Error('恢复自身已改变父页'); }); }); callbacks.onBusy.mockImplementation(value => { calls.push(value ? 'busy' : 'idle'); }); callbacks.onClose.mockImplementation(() => { calls.push('close'); });
    await chooseAndConfirm(); calls.length = 0; await click(button(text.restoreAction));
    expect(services.verify).toHaveBeenCalledTimes(1); const [document, taskId] = (services.verify as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).toEqual(file().document); expect(taskId).toMatch(/^[a-f0-9-]{36}$/); expect(callbacks.onRestore).toHaveBeenCalledExactlyOnceWith(file().document);
    expect(calls).toEqual(['busy', 'restore', 'idle', 'close']); expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, {}, { verifiedChanges: 2 }, { verifiedChanges: 4 }, { verifiedChanges: '3' }, { verifiedChanges: 3, extra: true }])('坏核验回执不恢复任何修改 %#', result => {
    return (async () => { const { callbacks } = await mount('restore', { verify: async () => result as { verifiedChanges: number } }); await chooseAndConfirm(); await click(button(text.restoreAction)); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.invalid); })();
  });

  it.each(['verify-first', 'cancel-first'] as const)('取消只针对原任务，%s结算仍须等待两个原Promise', async order => {
    const verification = deferred<{ verifiedChanges: number }>(), cancellation = deferred<unknown>(), verify = vi.fn<TableDraftDialogServices['verify']>(() => verification.promise), cancel = vi.fn<TableDraftDialogServices['cancel']>(() => cancellation.promise);
    const { callbacks } = await mount('restore', { verify, cancel }); await chooseAndConfirm(); callbacks.onBusy.mockClear(); await click(button(text.restoreAction));
    const id = verify.mock.calls[0][1], oldCancel = reactProps(button(text.cancel)).onClick; await click(button(text.cancel)); await act(async () => oldCancel());
    expect(cancel).toHaveBeenCalledExactlyOnceWith(id); expect(callbacks.onBusy.mock.calls).toEqual([[true]]); expect(button(text.close).disabled).toBe(true);
    if (order === 'verify-first') await act(async () => verification.resolve({ verifiedChanges: 3 })); else await act(async () => cancellation.resolve(undefined));
    expect(callbacks.onBusy.mock.calls).toEqual([[true]]); expect(callbacks.onRestore).not.toHaveBeenCalled();
    if (order === 'verify-first') await act(async () => cancellation.resolve(undefined)); else await act(async () => verification.resolve({ verifiedChanges: 3 }));
    expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.cancelled);
  });

  it('原表页在文件读取等待期间失效，迟到文件不能显示或被恢复', async () => {
    const held = deferred<ReturnType<typeof file> | null>(), open = vi.fn<TableDraftDialogServices['open']>(() => held.promise), { callbacks } = await mount('restore', { open }); await click(button(text.choose));
    callbacks.assertCurrent.mockImplementation(() => { throw Error('原表页已失效'); }); await act(async () => held.resolve(file()));
    expect(doc.body.textContent).not.toContain(file().name); expect(doc.body.textContent).toContain('原表页已失效'); expect(callbacks.onRestore).not.toHaveBeenCalled();
    callbacks.assertCurrent.mockImplementation(() => undefined); expect(button(text.choose).disabled).toBe(true);
  });

  it('原行核验等待中发生来源变化，成功回执仍不允许恢复', async () => {
    const held = deferred<{ verifiedChanges: number }>(), { callbacks } = await mount('restore', { verify: () => held.promise }); await chooseAndConfirm(); await click(button(text.restoreAction));
    callbacks.assertCurrent.mockImplementation(() => { throw Error('连接修订已变化'); }); await act(async () => held.resolve({ verifiedChanges: 3 }));
    expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain('连接修订已变化');
  });

  it('卸载后精确取消旧核验，迟到成功不发布，原占门在全部结算后释放', async () => {
    const verification = deferred<{ verifiedChanges: number }>(), cancellation = deferred<unknown>(), verify = vi.fn<TableDraftDialogServices['verify']>(() => verification.promise), cancel = vi.fn<TableDraftDialogServices['cancel']>(() => cancellation.promise);
    const { callbacks } = await mount('restore', { verify, cancel }); await chooseAndConfirm(); callbacks.onBusy.mockClear(); await click(button(text.restoreAction));
    await act(async () => root!.unmount()); root = undefined; expect(cancel).toHaveBeenCalledExactlyOnceWith(verify.mock.calls[0][1]); expect(callbacks.onBusy.mock.calls).toEqual([[true]]);
    await act(async () => verification.resolve({ verifiedChanges: 3 })); expect(callbacks.onBusy.mock.calls).toEqual([[true]]);
    await act(async () => cancellation.resolve(undefined)); expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('同一确认状态撤销再确认后，旧开始闭包不获得新授权', async () => {
    const { services } = await mount('save'); await acknowledge(); const old = reactProps(button(text.saveAction)).onClick;
    await acknowledge(false); await acknowledge(true); await act(async () => old()); expect(services.save).not.toHaveBeenCalled();
    await click(button(text.saveAction)); expect(services.save).toHaveBeenCalledTimes(1);
  });

  it('错误内容只以文本显示，不创建HTML元素', async () => {
    const { callbacks } = await mount('save', { save: async () => { throw Error('<img src=x>磁盘失败'); } }); await acknowledge(); await click(button(text.saveAction));
    expect(doc.body.textContent).toContain('<img src=x>磁盘失败'); expect(doc.querySelectorAll('img')).toHaveLength(0); expect(callbacks.onRestore).not.toHaveBeenCalled();
  });

  it('文件目标不匹配时拒绝领取，不能进入核验', async () => {
    const other = file(); other.document.target.table = 'another'; const { services, callbacks } = await mount('restore', { open: async () => other });
    await click(button(text.choose)); expect(doc.body.textContent).toContain(text.changed); expect(services.verify).not.toHaveBeenCalled(); expect(callbacks.onRestore).not.toHaveBeenCalled();
  });

  it('StrictMode效果重挂后仍可执行新显式操作', async () => {
    const { services } = await mount('save', {}, true); await acknowledge(); await click(button(text.saveAction)); expect(services.save).toHaveBeenCalledTimes(1); expect(doc.body.textContent).toContain(text.saved);
  });

  it('核验回执访问器不执行，也不能冒充全部原行已核验', async () => {
    let reads = 0; const result = Object.defineProperty({}, 'verifiedChanges', { enumerable: true, get() { reads++; return 3; } });
    const { callbacks } = await mount('restore', { verify: async () => result as { verifiedChanges: number } }); await chooseAndConfirm(); await click(button(text.restoreAction));
    expect(reads).toBe(0); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.invalid);
  });

  it('原保存已成功但原页随后失效，仍明确保留已写文件事实且不重试或提交', async () => {
    const held = deferred<{ name: string } | null>(), save = vi.fn<TableDraftDialogServices['save']>(() => held.promise);
    const { callbacks } = await mount('save', { save }); await acknowledge(); await click(button(text.saveAction));
    callbacks.assertCurrent.mockImplementation(() => { throw Error('仅活动标签已变化'); });
    await act(async () => held.resolve({ name: '原文件已写入.dbark-draft.json' }));
    expect(doc.body.textContent).toContain(text.savedStale); expect(doc.body.textContent).toContain('原文件已写入.dbark-draft.json');
    expect(doc.body.textContent).toContain('数据库修改仍未提交'); expect(doc.body.textContent).not.toContain('仅活动标签已变化');
    expect(save).toHaveBeenCalledTimes(1); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]); expect(button(text.saveAction).disabled).toBe(true);
  });

  it('原Main保存报告结果未知时保留原错误，不借页面失效冒称文件已保存', async () => {
    const held = deferred<{ name: string } | null>(), save = vi.fn<TableDraftDialogServices['save']>(() => held.promise);
    const { callbacks } = await mount('save', { save }); await acknowledge(); await click(button(text.saveAction));
    callbacks.assertCurrent.mockImplementation(() => { throw Error('原页已失效'); });
    const original = '草稿文件替换已投递，结果未能确认，请核对目标文件；不会自动重试';
    await act(async () => held.reject(Error(original)));
    expect(doc.body.textContent).toContain(original); expect(doc.body.textContent).not.toContain(text.savedStale); expect(doc.body.textContent).not.toContain(text.saved);
    expect(save).toHaveBeenCalledTimes(1); expect(callbacks.onRestore).not.toHaveBeenCalled(); expect(callbacks.onBusy.mock.calls).toEqual([[true], [false]]);
  });
});