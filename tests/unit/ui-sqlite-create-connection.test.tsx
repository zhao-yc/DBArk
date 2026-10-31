import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { FileChoice, SqliteConnectionProfile } from '../../src/shared/contracts';
import { sqliteZh as text } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request, uid: () => 'ram-sqlite-create' }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Component: typeof import('../../src/renderer/components/ConnectionDialog')['ConnectionDialog'];
const close = vi.fn(), transportChanged = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') Object.defineProperty(node, 'type', { configurable: true, get: () => node.attributes.get('type') ?? 'text', set: value => node.attributes.set('type', value) });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ConnectionDialog: Component } = await import('../../src/renderer/components/ConnectionDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; request.mockReset(); close.mockReset(); transportChanged.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 合成配置只进入真实组件内存；本套件不创建文件、不连接数据库。 */
function profile(patch: Partial<SqliteConnectionProfile> = {}): SqliteConnectionProfile {
  return { id: 'sqlite-form', name: '合成连接', group: '原组', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:\\synthetic\\old.sqlite', readOnly: true, busyTimeoutMs: 1234 }, ...patch };
}
/** React事件函数只用于内存端口无法模拟的原生输入，不复制产品处理器。 */
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return (node as any)[key]; }
function button(name: string) { const node = document.querySelectorAll('button').find(item => item.textContent === name || item.getAttribute('aria-label') === name); expect(node, name).toBeDefined(); return node!; }
function field(label: string) { const node = document.querySelectorAll('label').find(item => item.querySelector('span')?.textContent === label)?.querySelector('input'); expect(node, label).toBeDefined(); return node!; }
function readOnly() { const node = document.querySelectorAll('label').find(item => item.textContent === text.readOnly)?.querySelector('input'); expect(node).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { await act(async () => props(field(label)).onChange({ target: { value } })); }
/** 不重新挂载即可模拟原表单来源变更与ABA；输入草稿保持由真实组件管理。 */
async function render(saved?: SqliteConnectionProfile, copy?: SqliteConnectionProfile) {
  if (!root) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); }
  await act(async () => root!.render(<Component profile={saved} initialProfile={copy} onClose={close} onTransportChanged={transportChanged}/>));
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 测试按钮是读取真实表单提交内容的唯一出口，不通过测试后门访问组件状态。 */
async function testForm() { request.mockResolvedValueOnce({ dialect: 'sqlite', version: '合成版本' }); await click(zh.connections.text034); return request.mock.calls.at(-1)![1] as SqliteConnectionProfile; }

it('新建只授权准确表单ID，保留等待期输入，清旧路径和待授权标记并设读写；不自动连接或保存', async () => {
  const pending = deferred<FileChoice | null>(); request.mockReturnValueOnce(pending.promise);
  await render(undefined, profile({ id: '', pendingFiles: ['sqliteDatabase'] })); await click(text.create);
  expect(request).toHaveBeenCalledExactlyOnceWith('files.createSqlite', { connectionId: 'ram-sqlite-create' });
  await input(zh.connections.text006, '等待期间的新名称'); await input(zh.connections.text013, '等待期间的新组'); await input(text.busyTimeout, '3210');
  await act(async () => pending.resolve({ token: 'new-token', name: '中文🚢.sqlite' }));
  expect(field(text.file).value).toBe('中文🚢.sqlite'); expect(readOnly().checked).toBe(false); expect(document.body.textContent).toContain(text.created);
  expect(request).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled(); expect(transportChanged).not.toHaveBeenCalled();
  const submitted = await testForm();
  expect(submitted).toEqual({ id: 'ram-sqlite-create', name: '等待期间的新名称', group: '等待期间的新组', color: '#123456', dialect: 'sqlite', sqlite: { filePath: undefined, fileToken: 'new-token', fileName: '中文🚢.sqlite', readOnly: false, busyTimeoutMs: 3210 }, pendingFiles: [] });
  expect(request.mock.calls.map(call => call[0])).toEqual(['files.createSqlite', 'connections.test']);
});

it('同步双击、旧选择按钮及表单提交共用原互斥锁，只发一次新建请求', async () => {
  const pending = deferred<FileChoice | null>(); request.mockReturnValueOnce(pending.promise); await render(undefined, profile());
  const create = button(text.create), choose = props(button(text.choose)).onClick, test = props(button(zh.connections.text034)).onClick;
  await act(async () => { create.dispatchEvent(new MemoryEvent('click')); create.dispatchEvent(new MemoryEvent('click')); choose(); test(); props(document.querySelector('form')!).onSubmit({ preventDefault() {} }); });
  expect(request).toHaveBeenCalledExactlyOnceWith('files.createSqlite', { connectionId: 'sqlite-form' }); expect(button(text.create).disabled).toBe(true); expect(button(text.choose).disabled).toBe(true);
  await act(async () => pending.resolve(null)); expect(button(text.create).disabled).toBe(false); expect(field(text.file).value).toBe('D:\\synthetic\\old.sqlite'); expect(readOnly().checked).toBe(true);
});

it.each([true, false])('普通选择既有文件保留只读=%s，不沿用新建成功说明', async readOnlyValue => {
  await render(undefined, profile({ sqlite: { readOnly: readOnlyValue, busyTimeoutMs: 1000 } })); request.mockResolvedValueOnce({ token: 'chosen-token', name: 'existing.sqlite' }); await click(text.choose);
  expect(request).toHaveBeenCalledExactlyOnceWith('files.choose', { purpose: 'sqlite-database', sqliteConnectionId: 'sqlite-form' }); expect(readOnly().checked).toBe(readOnlyValue); expect(document.body.textContent).not.toContain(text.created);
  expect((await testForm()).sqlite).toEqual({ filePath: undefined, fileToken: 'chosen-token', fileName: 'existing.sqlite', readOnly: readOnlyValue, busyTimeoutMs: 1000 });
});

it('新建选择取消保留完整旧配置，不自动执行；新建成功后取消普通选择也保留新令牌与提示', async () => {
  await render(undefined, profile()); request.mockResolvedValueOnce(null); await click(text.create);
  expect(field(text.file).value).toBe('D:\\synthetic\\old.sqlite'); expect(readOnly().checked).toBe(true); expect(document.body.textContent).not.toContain(text.created); expect((await testForm()).sqlite).toEqual({ filePath: 'D:\\synthetic\\old.sqlite', readOnly: true, busyTimeoutMs: 1234 });
  request.mockResolvedValueOnce({ token: 'new-token', name: 'created.sqlite' }); await click(text.create); request.mockResolvedValueOnce(null); await click(text.choose);
  expect(field(text.file).value).toBe('created.sqlite'); expect(document.body.textContent).toContain(text.created); expect((await testForm()).sqlite.fileToken).toBe('new-token');
  expect(request.mock.calls.map(call => call[0])).toEqual(['files.createSqlite', 'connections.test', 'files.createSqlite', 'files.choose', 'connections.test']);
});

it('拒绝覆盖显示原错误并保留文件/只读/输入，不自动重试，用户可明确重选', async () => {
  await render(undefined, profile()); await input(zh.connections.text006, '用户名称'); request.mockRejectedValueOnce(new Error('合成目标已存在，拒绝覆盖')); await click(text.create);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('合成目标已存在，拒绝覆盖'); expect(field(text.file).value).toBe('D:\\synthetic\\old.sqlite'); expect(field(zh.connections.text006).value).toBe('用户名称'); expect(readOnly().checked).toBe(true); expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce({ token: 'retry-token', name: 'retry.sqlite' }); await click(text.create); expect(request).toHaveBeenCalledTimes(2); expect(field(text.file).value).toBe('retry.sqlite'); expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('编辑已有连接的新建不保存/关闭会话，取消表单仅关闭界面，不删除已创建文件', async () => {
  const saved = profile(); await render(saved); request.mockResolvedValueOnce({ token: 'new-token', name: 'created.sqlite' }); await click(text.create);
  expect(saved.sqlite.filePath).toBe('D:\\synthetic\\old.sqlite'); expect(saved.sqlite.readOnly).toBe(true); expect(transportChanged).not.toHaveBeenCalled(); expect(request.mock.calls.map(call => call[0])).toEqual(['files.createSqlite']);
  await click(zh.common.cancel); expect(close).toHaveBeenCalledOnce(); expect(request.mock.calls.map(call => call[0])).toEqual(['files.createSqlite']);
});

it.each(['success', 'failure'] as const)('卸载后的%s迟到回包不修改后继表单，也不发送后续请求', async outcome => {
  const pending = deferred<FileChoice | null>(); request.mockReturnValueOnce(pending.promise); await render(undefined, profile()); await click(text.create);
  await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
  await render(undefined, profile({ id: 'successor', sqlite: { fileName: 'successor.sqlite', fileToken: 'successor-token', readOnly: true, busyTimeoutMs: 1000 } }));
  await act(async () => outcome === 'success' ? pending.resolve({ token: 'late-token', name: 'late.sqlite' }) : pending.reject(new Error('迟到错误')));
  expect(field(text.file).value).toBe('successor.sqlite'); expect(readOnly().checked).toBe(true); expect(document.body.textContent).not.toContain(text.created); expect(document.body.textContent).not.toContain('迟到错误'); expect(request).toHaveBeenCalledTimes(1);
});

it('表单来源ABA永久拒绝旧回包与旧按钮闭包，当前按钮仍可重新明确创建', async () => {
  const a = profile(), b = profile({ id: 'other-source' }), pending = deferred<FileChoice | null>(); request.mockReturnValueOnce(pending.promise); await render(a);
  const oldCreate = props(button(text.create)).onClick; await click(text.create); await render(b); await render(a);
  await act(async () => pending.resolve({ token: 'stale-token', name: 'stale.sqlite' }));
  expect(field(text.file).value).toBe('D:\\synthetic\\old.sqlite'); expect(readOnly().checked).toBe(true); expect(document.body.textContent).not.toContain(text.created);
  await act(async () => oldCreate()); expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce({ token: 'current-token', name: 'current.sqlite' }); await click(text.create); expect(field(text.file).value).toBe('current.sqlite'); expect(request).toHaveBeenCalledTimes(2);
});

it('新表单方言切换再切回不会复活旧新建按钮闭包', async () => {
  await render(undefined, profile()); const oldCreate = props(button(text.create)).onClick;
  const dialect = document.querySelector('select')!;
  await act(async () => props(dialect).onChange({ target: { value: 'mysql' } })); await act(async () => props(dialect).onChange({ target: { value: 'sqlite' } }));
  await act(async () => oldCreate()); expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce({ token: 'current-token', name: 'current.sqlite' }); await click(text.create); expect(request).toHaveBeenCalledExactlyOnceWith('files.createSqlite', { connectionId: 'sqlite-form' });
});

it('父级换源与新建回包同批到达时，状态更新也不能把旧授权送进当前表单', async () => {
  const a = profile(), b = profile({ id: 'batched-successor' }), pending = deferred<FileChoice | null>(); request.mockReturnValueOnce(pending.promise); await render(a); await click(text.create);
  await act(async () => { root!.render(<Component profile={b} onClose={close} onTransportChanged={transportChanged}/>); pending.resolve({ token: 'late-token', name: 'late.sqlite' }); });
  expect(field(text.file).value).toBe('D:\\synthetic\\old.sqlite'); expect(readOnly().checked).toBe(true); expect(document.body.textContent).not.toContain(text.created); expect(request).toHaveBeenCalledTimes(1);
});
