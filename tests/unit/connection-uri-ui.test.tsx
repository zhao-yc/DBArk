import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connectionUriZh as text } from '../../src/renderer/locales/connectionUri.zh-CN';
import { connectionUriErrors } from '../../src/shared/connectionUri';
import { zh } from '../../src/renderer/locales/zh-CN';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<object>(), invoke: request, uid: () => 'ram-new-connection' }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Component: typeof import('../../src/renderer/components/ConnectionDialog')['ConnectionDialog'];
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
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; request.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 真实ConnectionDialog运行；IPC全部为RAM端口，不访问文件、网络或系统剪贴板。 */
async function mount(profile?: ConnectionProfile, copy?: ConnectionProfile) {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<Component profile={profile} initialProfile={copy} onClose={() => {}} onTransportChanged={() => {}}/>));
}
/** 只替代事件输送，不复制正式表单状态或解析实现。 */
function props(node: any) { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少React事件端口'); return node[key]; }
function button(name: string) { const node = document.querySelectorAll('button').find(item => item.textContent === name); expect(node, name).toBeDefined(); return node!; }
function field(label: string) { const node = document.querySelectorAll('label').find(item => item.querySelector('span')?.textContent === label)?.querySelector('input'); expect(node, label).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { await act(async () => props(field(label)).onChange({ target: { value } })); }

it('URI只填表并清除输入，保留展示字段，解码密码且默认不记住；没有自动IPC', async () => {
  await mount(); await input(zh.connections.text006, 'URI开发库'); await click(text.open); expect(field(text.title).type).toBe('password');
  await input(text.title, 'mysql://dev%40name:synthetic%3Asecret@db.example.test:3308/%E5%BA%93'); await click(text.apply);
  expect(field(zh.connections.text006).value).toBe('URI开发库'); expect(field(zh.connections.text009).value).toBe('db.example.test'); expect(String(field(zh.connections.text010).value)).toBe('3308'); expect(field(zh.common.user).value).toBe('dev@name'); expect(field(zh.connections.text012).value).toBe('库');
  expect(document.querySelector('input[aria-label="' + zh.connections.text011 + '"]')!.value).toBe('synthetic:secret'); expect(document.body.textContent).toContain(text.applied); expect(document.querySelectorAll('input').some(node => node.value.includes('mysql://'))).toBe(false); expect(request).not.toHaveBeenCalled();
});
it('非法参数保持原目标、保留待修URI并显示固定错误，不回显凭据；打开时不能保存或测试', async () => {
  await mount(); await input(zh.connections.text009, 'old.example.test'); await click(text.open); await input(text.title, 'mysql://private-user:private-secret@new.example.test/db?ssl=true');
  expect(button(zh.connections.text034).disabled).toBe(true); expect(button(zh.connections.text036).disabled).toBe(true); await click(text.apply);
  expect(field(zh.connections.text009).value).toBe('old.example.test'); expect(document.body.textContent).toContain(connectionUriErrors.options); expect(document.body.textContent).not.toContain('private-secret'); expect(field(text.title).value).toContain('mysql://'); expect(request).not.toHaveBeenCalled();
  await act(async () => props(document.querySelector('form')).onSubmit({ preventDefault() {} })); expect(request).not.toHaveBeenCalled();
});
it('取消URI不改原表单，再次打开不保留秘密；编辑已有连接不提供重定向入口', async () => {
  await mount(); await click(text.open); await input(text.title, 'mysql://u:discard-me@host/db'); await click(text.cancel); expect(field(zh.connections.text009).value).toBe('127.0.0.1'); await click(text.open); expect(field(text.title).value).toBe('');
  await act(async () => root!.unmount()); root = undefined;
  await mount({ id: 'existing', name: '已有', group: '', color: '#123456', dialect: 'mysql', host: 'old', port: 3306, user: 'old' }); expect(document.querySelectorAll('button').some(node => node.textContent === text.open)).toBe(false); expect(request).not.toHaveBeenCalled();
});
it('复制连接URI填入后不继承SSH/TLS/认证标记；只有显式测试才送出解码目标', async () => {
  await mount(undefined, { id: 'new-copy', name: '复制', group: '组', color: '#123456', dialect: 'mysql', host: 'old', port: 3306, user: 'old', hasPassword: true, rememberPassword: true, pendingFiles: ['sshPrivateKey'], ssh: { enabled: true, host: 'old-ssh', port: 22, user: 'old', privateKeyPath: 'old-key' }, tls: { enabled: true, rejectUnauthorized: false, keyPath: 'old-cert' } });
  await click(text.open); await input(text.title, 'mariadb://new:new%25secret@new.example.test:3310/newdb'); await click(text.apply); expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue({ dialect: 'mariadb', version: '合成版本' }); await click(zh.connections.text034);
  expect(request).toHaveBeenCalledExactlyOnceWith('connections.test', { id: 'new-copy', name: '复制', group: '组', color: '#123456', dialect: 'mariadb', host: 'new.example.test', port: 3310, user: 'new', password: 'new%secret', database: 'newdb', rememberPassword: false });
});
