import React, { act } from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import { QueryLayoutSplitter, queryEditorVisualHeight, type QueryLayoutLease } from '../../src/renderer/components/QueryLayoutSplitter';
import { queryLayoutMaximum } from '../../src/renderer/useQueryLayoutMaximum';
import { queryLayoutZh as text } from '../../src/renderer/locales/queryLayout.zh-CN';

const savedGlobals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let props: React.ComponentProps<typeof QueryLayoutSplitter>, preferred = 300, valid = true, revoked: (() => void) | undefined;
let commits: number[], preview: ReturnType<typeof vi.fn>, disposed: ReturnType<typeof vi.fn>, windowListeners: Map<string, Set<EventListener>>;
let captures = new Map<MemoryNode, Set<number>>();
const captureNames = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const;
const captureOriginals = captureNames.map(name => [name, Object.getOwnPropertyDescriptor(MemoryNode.prototype, name)] as const);
beforeAll(async () => {
  doc = memoryDocument();
  Object.assign(MemoryNode.prototype, {
    setPointerCapture(this: MemoryNode, id: number) { const ids = captures.get(this) ?? new Set<number>(); ids.add(id); captures.set(this, ids); },
    hasPointerCapture(this: MemoryNode, id: number) { return captures.get(this)?.has(id) ?? false; },
    releasePointerCapture(this: MemoryNode, id: number) { captures.get(this)?.delete(id); const event = Object.assign(new MemoryEvent('lostpointercapture'), { pointerId: id }); this.dispatchEvent(event); },
  });
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => {
  preferred = 300; valid = true; commits = []; captures = new Map(); preview = vi.fn(); disposed = vi.fn(); windowListeners = new Map(); revoked = undefined;
  window.addEventListener = ((name: string, listener: EventListener) => { const set = windowListeners.get(name) ?? new Set(); set.add(listener); windowListeners.set(name, set); }) as typeof window.addEventListener;
  window.removeEventListener = ((name: string, listener: EventListener) => { windowListeners.get(name)?.delete(listener); }) as typeof window.removeEventListener;
  props = { value: preferred, min: 130, max: 600, defaultValue: 300, controls: 'real-editor', scope: 'query-a', onPreview: preview,
    begin(cancel) { if (!valid) return null; revoked = cancel; let active = true; const original = preferred;
      const lease: QueryLayoutLease = { value: original, current: () => active && valid && preferred === original, commit(value) { if (!lease.current()) return false; active = false; commits.push(value); preferred = value; return true; }, dispose() { active = false; disposed(); } }; return lease; }
  };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; expect([...windowListeners.values()].every(list => !list.size)).toBe(true); expect([...captures.values()].every(set => !set.size)).toBe(true); });
afterAll(() => { for (const [name, descriptor] of captureOriginals) if (descriptor) Object.defineProperty(MemoryNode.prototype, name, descriptor); else Reflect.deleteProperty(MemoryNode.prototype, name); for (const [name, descriptor] of savedGlobals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function handle() { return doc.querySelector('[role="separator"]')!; }
async function render() { await act(async () => root!.render(<QueryLayoutSplitter {...props}/>)); }
async function mount() { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as any); await render(); }
async function down(id = 7) { await act(async () => handle().dispatchEvent(Object.assign(new MemoryEvent('pointerdown'), { pointerId: id, clientY: 100, isPrimary: true }))); }
async function native(name: string, y = 140, id = 7) { const event = Object.assign(new MemoryEvent(name), { pointerId: id, clientY: y }); await act(async () => { for (const callback of [...windowListeners.get(name) ?? []]) callback(event as unknown as Event); }); }

it('真实指针只预览，pointerup取最终坐标只提交一次；清监听与capture', async () => {
  await mount(); await down(); await native('pointermove', 145); expect(preview).toHaveBeenLastCalledWith(345); expect(commits).toEqual([]);
  await native('pointerup', 155); expect(commits).toEqual([355]); await native('pointerup', 180); expect(commits).toEqual([355]); expect(disposed).toHaveBeenCalledOnce();
});
it.each(['pointercancel', 'lostcapture', 'Escape', 'blur', '身份撤销', '卸载'])('%s永久停旧手势，不保存且迟到up无效', async reason => {
  await mount(); await down(); await native('pointermove', 150); const late = [...windowListeners.get('pointerup')!][0];
  if (reason === 'pointercancel') await native('pointercancel');
  if (reason === 'lostcapture') await act(async () => handle().dispatchEvent(Object.assign(new MemoryEvent('lostpointercapture'), { pointerId: 7 })));
  if (reason === 'Escape') await act(async () => { for (const callback of [...windowListeners.get('keydown')!]) callback(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }) as unknown as Event); });
  if (reason === 'blur') await native('blur');
  if (reason === '身份撤销') await act(async () => { valid = false; revoked!(); });
  if (reason === '卸载') { await act(async () => root!.unmount()); root = undefined; }
  await act(async () => late(Object.assign(new MemoryEvent('pointerup'), { pointerId: 7, clientY: 200 }) as unknown as Event)); expect(commits).toEqual([]);
});
it('另一pointer不影响原手势，新偏好到来取消时只清预览不回滚旧值', async () => {
  await mount(); await down(); await native('pointerup', 150, 9); expect(commits).toEqual([]); await native('pointermove', 160);
  preferred = 520; props = { ...props, value: preferred }; await render(); await native('pointerup', 160); expect(commits).toEqual([]); expect(preferred).toBe(520); expect(preview).toHaveBeenLastCalledWith(null);
});
it('无位移与短窗口只视觉clamp，不将300偷偷写成上限；明确恢复仍可操作', async () => {
  await mount(); await down(); await native('pointerup', 100); expect(commits).toEqual([]);
  props = { ...props, value: 500, max: 70 }; preferred = 500; await render(); await down(); await native('pointerup', 120); expect(commits).toEqual([]); expect(handle().getAttribute('aria-valuenow')).toBe('70');
  await act(async () => doc.querySelector('button')!.dispatchEvent(new MemoryEvent('click'))); expect(commits).toEqual([300]);
});
it('键盘可达并从最新租约微调，Home明确恢复默认；不创建编辑器或模型', async () => {
  await mount(); expect(handle().getAttribute('aria-label')).toBe(text.separator); expect(handle().getAttribute('aria-controls')).toBe('real-editor');
  for (const key of ['ArrowDown', 'ArrowDown', 'Home']) await act(async () => handle().dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key })));
  expect(commits).toEqual([310, 320, 300]);
});
it('实际可用空间扣chrome及结果区，极短窗口不产生负高度或保存动作', () => {
  expect(queryLayoutMaximum(650, 130, 8192)).toBe(424); expect(queryLayoutMaximum(180, 100, 8192)).toBe(0);
  expect(queryEditorVisualHeight(300, 70)).toBe(70); expect(queryEditorVisualHeight(8192, -20)).toBe(0);
});
it('视觉上限的无效方向键不重写大偏好，反方向有位移时才明确提交', async () => {
  preferred = 900; props = { ...props, value: 900, max: 600 }; await mount();
  await act(async () => handle().dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'ArrowDown' }))); expect(commits).toEqual([]); expect(preferred).toBe(900);
  await act(async () => handle().dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'ArrowUp' }))); expect(commits).toEqual([590]);
});
it('旧回调遇到新手势也无权提交或清除新监听，只有新pointerup结算', async () => {
  await mount(); await down(); const old = [...windowListeners.get('pointerup')!][0]; await native('pointercancel');
  await down(); await native('pointermove', 130);
  await act(async () => old(Object.assign(new MemoryEvent('pointerup'), { pointerId: 7, clientY: 240 }) as unknown as Event)); expect(commits).toEqual([]); expect(windowListeners.get('pointerup')!.size).toBe(1);
  await native('pointerup', 140); expect(commits).toEqual([340]);
});
