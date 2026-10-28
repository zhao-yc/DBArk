import React, { act, useState } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { TableCreateCheck } from '../../src/shared/tableCreateChecks';
import { NewTableChecksRows, withNewTableChecks } from '../../src/renderer/newTableChecksUi';
import { tableCreateChecksZh as text } from '../../src/renderer/locales/tableCreateChecks.zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Editor: typeof import('../../src/renderer/components/NewTableChecksEditor')['NewTableChecksEditor'], Modal: typeof import('../../src/renderer/components/ui')['Modal'];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => { document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); const create = document.createElement.bind(document); document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text'; node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; }; ({ createRoot } = await import('react-dom/client')); ({ NewTableChecksEditor: Editor } = await import('../../src/renderer/components/NewTableChecksEditor')); ({ Modal } = await import('../../src/renderer/components/ui')); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function field(label: string) { const node = [...document.querySelectorAll('input'), ...document.querySelectorAll('textarea')].find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function fill(label: string, value: string) { const node = field(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
function callback(node: MemoryNode, key = 'onChange'): any { const name = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!name) throw Error('缺少真实React回调'); return (node as any)[name][key]; }
async function mount(initial?: TableCreateCheck[], strict = false) {
  const invoke = vi.fn(), changed = vi.fn(), scope = { current: true }; (window as any).dbark = { invoke };
  const original = { columns: [{ name: 'amount', defaultValue: '', nullable: true }], indexes: [{ name: 'PRIMARY', columns: ['id'] }], foreignKeys: [{ name: 'fk', columns: ['parent_id'] }], ...(initial ? { checks: initial } : {}) };
  let latest: typeof original = original;
  function Wrapper({ disabled = false }: { disabled?: boolean }) { const [design, setDesign] = useState(original); latest = design; return <Modal title={text.title} onClose={() => {}}><Editor checks={design.checks} disabled={disabled} isCurrent={() => scope.current} onChange={checks => { changed(checks); setDesign(current => withNewTableChecks(current, checks)); }}/></Modal>; }
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); const render = async (disabled = false) => { await act(async () => root!.render(strict ? <React.StrictMode><Wrapper disabled={disabled}/></React.StrictMode> : <Wrapper disabled={disabled}/>)); }; await render(); return { original, current: () => latest, changed, invoke, scope, render };
}
it('实际行控件保持Unicode名称/精确表达式原文和稳定焦点，只有草稿意图且零IO', async () => {
  const f = await mount(); expect(document.body.textContent).toContain(text.empty); await click(text.add); expect(document.activeElement === field(text.name(1))).toBe(true); const name = field(text.name(1)); await fill(text.name(1), '财务 😀 检查'); expect(field(text.name(1)) === name).toBe(true);
  const expression = "  `amount` > 18446744073709551615 AND ' 原文 ' = ' 原文 ' /*注释*/\n"; field(text.expression(1)).focus(); const area = field(text.expression(1)); await fill(text.expression(1), expression); expect(field(text.expression(1)) === area).toBe(true); expect(document.activeElement === area).toBe(true); expect(f.current().checks).toEqual([{ name: '财务 😀 检查', expression, enforced: true }]); expect(f.current().columns).toBe(f.original.columns); expect(f.current().indexes).toBe(f.original.indexes); expect(f.current().foreignKeys).toBe(f.original.foreignKeys); expect(document.body.textContent).toContain(text.capability); expect(f.invoke).not.toHaveBeenCalled();
});
it('同名行保持独立身份，重排后旧输入/删除闭包不能改另一行', async () => {
  const a = { name: 'same', expression: 'A /*原文*/', enforced: true }, b = { name: 'same', expression: 'B', enforced: false }, f = await mount([a, b]), oldInput = callback(field(text.expression(1))), oldRemove = callback(button(text.remove(1)), 'onClick'), oldName = field(text.name(2));
  await click(text.up(2)); expect(f.current().checks).toEqual([b, a]); expect(field(text.name(1)) === oldName).toBe(true); await act(async () => { oldInput({ target: { value: '旧输入' } }); oldRemove(); }); expect(f.current().checks).toEqual([b, a]); await fill(text.name(1), 'new-name'); expect(f.current().checks![0]).toMatchObject({ name: 'new-name', expression: 'B', enforced: false }); expect(f.current().checks![1]).toBe(a);
});
it('最后一项删除真删own checks，普通字段/索引/FK对象不变', async () => {
  const f = await mount([{ name: 'ck', expression: '`amount` > 0', enforced: true }]); await click(text.remove(1)); expect(Object.hasOwn(f.current(), 'checks')).toBe(false); expect(f.changed).toHaveBeenCalledExactlyOnceWith(undefined); expect(f.current().columns).toBe(f.original.columns); expect(f.current().indexes).toBe(f.original.indexes); expect(f.current().foreignKeys).toBe(f.original.foreignKeys); expect(document.body.textContent).toContain(text.empty); expect(f.invoke).not.toHaveBeenCalled();
});
it('disabled/父来源失效/隐藏/其它模态均拒旧控件，卸载不能编辑后来窗口', async () => {
  const f = await mount([{ name: 'ck', expression: '1', enforced: true }]), old = callback(field(text.name(1))); await f.render(true); await act(async () => old({ target: { value: '禁用覆盖' } })); expect(f.current().checks![0].name).toBe('ck'); await f.render(false); const live = callback(field(text.name(1))); f.scope.current = false; await act(async () => live({ target: { value: '旧来源' } })); expect(f.current().checks![0].name).toBe('ck'); f.scope.current = true;
  const host = document.querySelectorAll('div').find(node => node.classList.contains('new-table-checks'))!; host.hidden = true; await act(async () => live({ target: { value: '隐藏' } })); host.hidden = false;
  const alert = document.createElement('div'); alert.setAttribute('role', 'alertdialog'); document.body.appendChild(alert); await act(async () => live({ target: { value: '模态穿透' } })); document.body.removeChild(alert); expect(f.current().checks![0].name).toBe('ck'); await act(async () => root!.unmount()); root = undefined; await act(async () => live({ target: { value: '卸载' } })); expect(f.changed).not.toHaveBeenCalled();
});
it('StrictMode可编辑，生效选项仅保持用户请求，不读取Maria能力或执行SQL', async () => {
  const f = await mount(undefined, true); await click(text.add); const input = field(text.enforced(1)); await act(async () => { input.checked = false; input.dispatchEvent(new MemoryEvent('click')); }); expect(f.current().checks![0].enforced).toBe(false); expect(document.body.textContent).toContain(text.notEnforcedIntent); expect(f.invoke).not.toHaveBeenCalled();
});
it('分页后的旧行回调不能认领下一页同位置，新添行能定位最后页', async () => {
  const checks = Array.from({ length: 51 }, (_, index) => ({ name: `ck_${index}`, expression: `${index} >= 0`, enforced: true })), f = await mount(checks), old = callback(field(text.name(1))); expect(document.querySelectorAll('fieldset')).toHaveLength(50); await click(text.next); expect(field(text.name(51)).value).toBe('ck_50'); await act(async () => old({ target: { value: '跨页旧值' } })); expect(f.current().checks![0]).toBe(checks[0]); await click(text.add); expect(field(text.name(52)).value).toBe(''); expect(document.activeElement === field(text.name(52))).toBe(true);
});
it('小型行模型不按名称猜对象、拒边界移动及超预算追加，清空不留下undefined键', () => {
  const rows = new NewTableChecksRows(), a = { name: '', expression: 'x', enforced: true }, b = { name: '', expression: 'y', enforced: false }; expect(rows.key(a)).not.toBe(rows.key(b)); expect(rows.move([a, b], a, -1)).toBeUndefined(); expect(rows.patch([a], { ...a }, { expression: '替代' })).toBeUndefined(); expect(rows.append(Array(512).fill(a))).toBeUndefined(); const next = rows.patch([a, b], a, { name: '重命名' })!; expect(rows.key(next[0])).toBe(rows.key(a)); expect(next[1]).toBe(b); expect(Object.hasOwn(withNewTableChecks({ checks: [a] }, []), 'checks')).toBe(false);
});
