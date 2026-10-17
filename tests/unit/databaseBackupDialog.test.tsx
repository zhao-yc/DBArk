import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { DatabaseBackupDialog } from '../../src/renderer/components/DatabaseBackupDialog';
import { databaseBackupZh as text } from '../../src/renderer/locales/databaseBackup.zh-CN';
import { databaseBackupFixture } from './databaseBackupFixtures';
import type { DatabaseBackupInspection, DatabaseBackupToolSummary } from '../../src/shared/databaseBackup';

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
beforeAll(async () => {
  document = memoryDocument(); Object.assign(document, { oninput: null }); const create = document.createElement.bind(document);
  // 受控 select 与 disabled 的内存属性适配，不模拟原生窗口、布局或系统文件对话框。
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') node.type = 'text';
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 表单动作投递到真实 ReactDOM 事件委派，计划器和向导均使用生产代码。 */
function label(name: string): MemoryNode { const node = document.body.querySelectorAll('[aria-label]').find(item => item.getAttribute('aria-label') === name); if (!node) throw Error(`未找到表单：${name}`); return node; }
function button(name: string): MemoryNode { const node = document.body.querySelectorAll('button').find(item => item.textContent === name); if (!node) throw Error(`未找到按钮：${name}`); return node; }
async function click(name: string) { await act(async () => { button(name).dispatchEvent(new MemoryEvent('click')); }); }
async function fill(name: string, value: string) { await act(async () => { const node = label(name); node.value = value; node.dispatchEvent(new MemoryEvent(node.tagName === 'SELECT' ? 'change' : 'input')); }); }
async function acknowledge() { await act(async () => { const node = label(text.acknowledge); node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); }
async function mount(f: ReturnType<typeof databaseBackupFixture>, tools?: DatabaseBackupToolSummary[]) {
  const closed = vi.fn(), container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  const summaries = tools ?? [{ id: f.tool.id, label: f.tool.label, family: f.tool.family, version: f.tool.version }];
  await act(async () => root!.render(<DatabaseBackupDialog connections={[{ id: 'connection', name: '仅 RAM 连接 <img>' }]} tools={summaries} services={f.services} onClose={closed}/>)); return closed;
}
async function form() { await fill(text.connection, 'connection'); await fill(text.database, 'shop'); await fill(text.tool, 'mysql-tool'); }

describe('B01 正式准备向导（内存 ReactDOM，无外部环境）', () => {
  it('缺工具明确阻断且不会自动检查或启动备份，文本按 React 转义', async () => {
    const f = databaseBackupFixture(); await mount(f, []);
    expect(document.body.textContent).toContain(text.missingTool); expect(button(text.inspect).disabled).toBe(true); expect(f.services.inspect).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<DatabaseBackupDialog connections={[{ id: 'connection', name: '<script>仅文本</script>' }]} tools={[]} services={f.services} onClose={() => undefined}/>);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  });
  it('完整检查、影响确认、文件令牌到计划可操作，始终明确尚未执行或恢复', async () => {
    const f = databaseBackupFixture(); await mount(f); await form(); await click(text.inspect);
    expect(document.body.textContent).toContain('事件：1'); expect(document.body.textContent).toContain('存储函数：1'); expect(document.body.textContent).toContain(text.preliminary);
    expect(button(text.prepare).disabled).toBe(true); await acknowledge(); await click(text.choose); await click(text.prepare);
    expect(document.body.textContent).toContain(text.planned); expect(document.body.textContent).toContain(text.notExecuted); expect(document.body.textContent).toContain('shop.dbark-backup.zip');
    expect(vi.mocked(f.services.inspect).mock.calls[0][0]).toEqual({ connectionId: 'connection', database: 'shop', toolId: 'mysql-tool', taskId: expect.any(String) });
    expect(vi.mocked(f.services.prepare).mock.calls[0][0]).toEqual({ inspectionToken: expect.any(String), fileToken: 'output', acknowledgeGlobalWriteBlock: true, taskId: expect.any(String) });
    expect(document.body.querySelectorAll('button').some(item => item.textContent === '执行备份')).toBe(false);
    await fill(text.database, 'other'); expect(document.body.textContent).not.toContain(text.planned); expect(document.body.textContent).not.toContain('事件：1');
  });
  it('权限或范围不足直接展示原因，不能生成部分计划', async () => {
    const f = databaseBackupFixture(); f.source.visibility.event = 'unknown'; f.source.permissions.routines = 'denied';
    await mount(f); await form(); await click(text.inspect); expect(document.body.textContent).toContain(text.incomplete); expect(document.body.textContent).toContain('完整可见性');
    expect(button(text.choose).disabled).toBe(true); expect(button(text.prepare).disabled).toBe(true); expect(f.services.chooseFile).not.toHaveBeenCalled(); expect(f.services.prepare).not.toHaveBeenCalled();
  });
  it('首次等待前同步持有 owner，不能重入检查或将当前表单切到另一库', async () => {
    const f = databaseBackupFixture(), prepared = await f.planner.inspect(f.input); let finish!: (value: DatabaseBackupInspection) => void;
    const waiting = new Promise<DatabaseBackupInspection>(resolve => { finish = resolve; });
    vi.mocked(f.services.inspect).mockImplementationOnce(input => {
      expect(input.database).toBe('shop'); const node = label(text.database); node.value = 'another'; node.dispatchEvent(new MemoryEvent('input')); button(text.inspect).dispatchEvent(new MemoryEvent('click')); return waiting;
    });
    await mount(f); await form(); await click(text.inspect); expect(f.services.inspect).toHaveBeenCalledTimes(1);
    await act(async () => finish(prepared)); await acknowledge(); await click(text.choose); await click(text.prepare);
    expect(f.services.prepare).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(text.planned);
  });
  it('未知取消即使结果晚到也保留占用，显式再次确认后才允许关闭', async () => {
    const f = databaseBackupFixture(), result = await f.planner.inspect(f.input); let finish!: (value: DatabaseBackupInspection) => void;
    vi.mocked(f.services.inspect).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(f.services.cancel).mockResolvedValueOnce({ state: 'unknown' });
    const closed = await mount(f); await form(); await click(text.inspect); await click(text.cancel); expect(document.body.textContent).toContain(text.unknown);
    await act(async () => finish(result)); expect(button(text.inspect).disabled).toBe(true); expect(document.body.textContent).not.toContain('事件：1'); expect(closed).not.toHaveBeenCalled();
    await click(text.cancel); expect(f.services.cancel).toHaveBeenCalledTimes(2); expect(button(text.inspect).disabled).toBe(false); await click(text.close); expect(closed).toHaveBeenCalledTimes(1);
  });
  it('卸载取消绑定原任务，晚到检查不会重新发布对象清单或计划', async () => {
    const f = databaseBackupFixture(), result = await f.planner.inspect(f.input); let finish!: (value: DatabaseBackupInspection) => void;
    vi.mocked(f.services.inspect).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(f); await form(); await click(text.inspect); const taskId = vi.mocked(f.services.inspect).mock.calls[0][0].taskId;
    await act(async () => root!.unmount()); root = undefined; await act(async () => finish(result));
    expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(taskId); expect(document.body.textContent).toBe(''); expect(f.services.prepare).not.toHaveBeenCalled();
  });
});
