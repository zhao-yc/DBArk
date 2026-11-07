import { act } from 'react';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { PostgresTransactionSettingsDialog } from '../../src/renderer/components/PostgresTransactionSettingsDialog';
import { QueryTransactionSettingsIntent, type QueryTransactionSettingsScope } from '../../src/renderer/queryTransactionSettingsIntent';
import { postgresTransactionSettingsZh as text } from '../../src/renderer/locales/postgresTransactionSettings.zh-CN';
import type { PostgresTransactionDefaults, PostgresTransactionSnapshot } from '../../src/shared/postgresTransactionSettings';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const originals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const intents: QueryTransactionSettingsIntent[] = [];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', {configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); }}); }
    if (name === 'select') Object.defineProperty(node, 'options', {configurable: true, get: () => node.querySelectorAll('option')});
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({createRoot} = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; intents.splice(0).forEach(intent => intent.dispose()); document.body.textContent = ''; });
afterAll(() => { for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
const baseline: PostgresTransactionSnapshot = {processId: 123, backendStart: '1000.1', database: 'db', isolation: 'READ COMMITTED', readOnly: false, deferrable: false, transactionOpen: false, transactionFailed: false};
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function chooseReadOnly() { const input = document.querySelectorAll('input')[0]; expect(input.disabled).toBe(false); await act(async () => { input.checked = !input.checked; input.dispatchEvent(new MemoryEvent('click')); }); }
/** 内存界面只测真实组件及租约；原生布局、焦点与数据库由窗口专项验证。 */
async function mount(read: () => Promise<PostgresTransactionSnapshot> = async () => ({...baseline}),
  apply: (before: PostgresTransactionSnapshot, next: PostgresTransactionDefaults) => Promise<PostgresTransactionSnapshot> = async (before, next) => ({...before, ...next})) {
  let scope: QueryTransactionSettingsScope = {tabId: 'q', connectionId: 'c', connectionVersion: 1, connection: {}, sessionId: 's', present: true, active: true, closing: false};
  let changed = () => {}; const intent = new QueryTransactionSettingsIntent(() => scope, fn => { changed = fn; return () => {}; }, text.changed); intents.push(intent);
  const onRead = vi.fn(read), onApply = vi.fn(apply), onClose = vi.fn();
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<PostgresTransactionSettingsDialog intent={intent} connectionName="原连接" onRead={onRead} onApply={onApply} onClose={onClose}/>));
  return {onRead, onApply, onClose, change() { scope = {...scope, active: false}; changed(); scope = {...scope, active: true}; changed(); }};
}
it('首次读取后显示原快照，未更改不能应用；只在明确点击发送原快照和草稿', async () => {
  const f = await mount(); expect(f.onRead).toHaveBeenCalledOnce(); expect(button(text.apply).disabled).toBe(true);
  expect(document.body.textContent).toContain('123'); expect(document.body.textContent).toContain(text.semantics);
  await chooseReadOnly(); await click(text.apply); expect(f.onApply).toHaveBeenCalledExactlyOnceWith(baseline, {isolation: 'READ COMMITTED', readOnly: true, deferrable: false});
  expect(document.body.textContent).toContain(text.applied); expect(button(text.apply).disabled).toBe(true);
});
it('设置失败保持原输入但撤销提交资格，必须明确重新读取', async () => {
  const f = await mount(undefined, async () => { throw Error('设置可能已改变'); }); await chooseReadOnly(); await click(text.apply);
  expect(document.body.textContent).toContain('设置可能已改变'); expect(button(text.apply).disabled).toBe(true); expect(f.onRead).toHaveBeenCalledOnce();
  await click(text.refresh); await chooseReadOnly(); expect(button(text.apply).disabled).toBe(false); expect(f.onApply).toHaveBeenCalledOnce();
});
it('活动事务允许刷新和关闭，所有设置只读', async () => {
  const f = await mount(async () => ({...baseline, transactionOpen: true}));
  expect(document.body.textContent).toContain(text.active); expect(document.querySelectorAll('input').every(node => node.disabled)).toBe(true);
  expect(button(text.apply).disabled).toBe(true); await click(text.refresh); expect(f.onRead).toHaveBeenCalledTimes(2); await click(text.close); expect(f.onClose).toHaveBeenCalledOnce();
});
it('等待请求不能关闭或重复读取；来源离开再返回不能发布迟到快照', async () => {
  let finish!: (value: PostgresTransactionSnapshot) => void;
  const f = await mount(() => new Promise(resolve => { finish = resolve; }));
  expect(button(text.close).disabled).toBe(true); expect(button(text.refresh).disabled).toBe(true);
  await act(async () => f.change()); await act(async () => finish(baseline));
  expect(document.body.textContent).toContain(text.changed); expect(button(text.refresh).disabled).toBe(true); expect(f.onApply).not.toHaveBeenCalled();
});
it('读回不同物理身份不得当作确认，也不能自动重试', async () => {
  const f = await mount(undefined, async (before, next) => ({...before, ...next, backendStart: '9999.1'})); await chooseReadOnly(); await click(text.apply);
  expect(document.body.textContent).toContain(text.changed); expect(button(text.apply).disabled).toBe(true); expect(f.onApply).toHaveBeenCalledOnce();
});
