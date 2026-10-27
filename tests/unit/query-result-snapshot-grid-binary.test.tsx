import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DataRow, ResultColumn } from '../../src/shared/contracts';
import { binaryCellZh } from '../../src/renderer/locales/binaryCell.zh-CN';
import { binaryCellFilesZh as filesText } from '../../src/renderer/locales/binaryCellFiles.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const port = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _input?: unknown): Promise<unknown> => null), grid: null as any }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
// 仅替换无布局的RDG事件端口；真实网格、字节查看器、Modal与来源守卫均运行。
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select', name: '' }, DataGrid(props: any) { port.grid = props; return <div role="grid"/>; } }));

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Grid: typeof import('../../src/renderer/components/ResultsGrid')['ResultsGrid'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const columns: ResultColumn[] = [{ key: 'payload', name: '二进制结果', type: 'BLOB' }];
const rows: DataRow[] = [{ payload: { type: 'binary', base64: '5Lit5paH' } }];

beforeAll(async () => {
  doc = memoryDocument(); const create = doc.createElement.bind(doc);
  // RAM只补标准HTML属性反射；React受控select读取options及选项value/selected，不改产品判定。
  doc.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    if (name === 'option') {
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
      let selected = false;
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } });
    }
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
  ({ ResultsGrid: Grid } = await import('../../src/renderer/components/ResultsGrid'));
  ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; port.invoke.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 同一真实根可重绘来源；不生成任何连接、会话或测试文件。 */
async function mount(query = false, fileActions?: boolean) {
  const tab = { id: 'q', kind: 'query' as const, title: '原查询', connectionId: 'c', sql: 'SELECT payload' };
  store.setState(state => ({ settings: { ...state.settings, tabs: query ? [tab] : [], activeTabId: query ? tab.id : undefined }, connections: [], activeJobs: {}, connectionVersions: { c: 1 } }));
  port.invoke.mockReset(); let identity: readonly unknown[] = ['原结果'], current = true;
  const render = () => <Grid columns={columns} rows={rows} binaryFileActions={fileActions} binarySourceIdentity={identity} binaryIsCurrent={() => current} isCurrent={() => current}/>;
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(render()));
  return { render, set identity(value: readonly unknown[]) { identity = value; }, set current(value: boolean) { current = value; } };
}
function buttons(label: string) { return doc.querySelectorAll('button').filter(node => node.textContent === label); }
function button(label: string) { const nodes = buttons(label); expect(nodes).toHaveLength(1); return nodes[0]; }
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function openBinary() { await act(async () => { port.grid.onCellDoubleClick({ row: rows[0], column: columns[0] }); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('全局结果快照字节只读端口（纯RAM）', () => {
  it('零连接零标签可查看Hex和原文本，显式false不暴露任何字节文件入口', async () => {
    await mount(false, false); await openBinary();
    expect(store.getState().connections).toEqual([]); expect(store.getState().settings.tabs).toEqual([]);
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(doc.querySelectorAll('textarea')[0].value).toBe('e4 b8 ad e6 96 87');
    expect(buttons(filesText.load)).toHaveLength(0); expect(buttons(filesText.save)).toHaveLength(0);
    await click(button(binaryCellZh.text)); expect(doc.querySelectorAll('textarea').some(node => node.value === '中文')).toBe(true);
    expect(buttons(binaryCellZh.image)).toHaveLength(1); expect(port.invoke).not.toHaveBeenCalled();
  });

  it('default保留原查询归属门：无活动标签只展示，不能另存字节', async () => {
    await mount(); await openBinary(); expect(button(filesText.save).disabled).toBe(true); expect(buttons(filesText.load)).toHaveLength(0); expect(port.invoke).not.toHaveBeenCalled();
  });

  it('default的合法查询仍只读另存完整原字节，未放宽任何载入或数据库入口', async () => {
    await mount(true); await openBinary(); port.invoke.mockResolvedValue({ bytes: 6, name: '原字节.bin' });
    await click(button(filesText.save)); expect(port.invoke.mock.calls).toEqual([['binaryCellFiles.save', { base64: '5Lit5paH', suggestedName: 'binary-cell.bin' }]]); expect(buttons(filesText.load)).toHaveLength(0);
  });

  it.each(['source', 'busy', 'tab'] as const)('default在%s发生ABA后拒绝原文件成功回执，不能误报已保存', async kind => {
    const source = await mount(true), pending = deferred<unknown>(); await openBinary(); port.invoke.mockReturnValue(pending.promise); await click(button(filesText.save));
    if (kind === 'source') {
      source.identity = ['另一结果']; await act(async () => root!.render(source.render())); source.identity = ['原结果']; await act(async () => root!.render(source.render()));
    } else await act(async () => {
      if (kind === 'busy') { store.setState({ activeJobs: { q: true } }); store.setState({ activeJobs: {} }); }
      else { store.setState(state => ({ settings: { ...state.settings, activeTabId: 'other' } })); store.setState(state => ({ settings: { ...state.settings, activeTabId: 'q' } })); }
    });
    await act(async () => pending.resolve({ bytes: 6, name: '旧快照.bin' })); expect(doc.body.textContent).not.toContain('已另存 旧快照.bin'); expect(port.invoke).toHaveBeenCalledTimes(1);
  });

  it('false保留入场current门，失效网格不能打开迟到的字节查看器', async () => {
    const source = await mount(false, false), oldOpen = port.grid.onCellDoubleClick; source.current = false;
    await act(async () => oldOpen({ row: rows[0], column: columns[0] })); expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(0); expect(port.invoke).not.toHaveBeenCalled();
  });

  it('default卸载后原字节另存晚回包不发布成功，也不重试', async () => {
    await mount(true); await openBinary(); const pending = deferred<unknown>(); port.invoke.mockReturnValue(pending.promise); await click(button(filesText.save));
    await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve({ bytes: 6, name: '卸载后.bin' })); expect(doc.body.textContent).not.toContain('卸载后.bin'); expect(port.invoke).toHaveBeenCalledTimes(1);
  });
});
