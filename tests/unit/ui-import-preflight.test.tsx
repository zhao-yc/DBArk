import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { ImportPreflightPanel, type ImportPreflightPanelProps } from '../../src/renderer/components/ImportPreflightPanel';
import { importPreflightZh as text } from '../../src/renderer/locales/importPreflight.zh-CN';
import type { FileImportPreflightInput, FileImportPreflightReport } from '../../src/shared/fileImportPreflight';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 使用真实React事件和控制器，只有外部只读服务采用可控终态。 */
function fixture() {
  const pending = deferred<FileImportPreflightReport>(); let input!: FileImportPreflightInput;
  const props: ImportPreflightPanelProps = { source: { identity: {}, input: { connectionId: '连接', database: '库', table: '表', fileToken: '秘密令牌', format: 'csv', encoding: 'utf8', mapping: { first: '甲', last: '乙' } } }, busy: false, onActivity: vi.fn(), onReport: vi.fn(),
    services: { run: vi.fn(value => { input = value; return pending.promise; }), cancel: vi.fn(async () => {}), chooseReport: vi.fn(async () => ({ token: '输出', name: '报告.json' })), exportReport: vi.fn(async value => ({ rows: value.result.rows.length })), uid: () => '任务' } };
  const report = (): FileImportPreflightReport => ({ taskId: input.taskId, target: { connectionId: input.connectionId, database: input.database, table: input.table }, format: 'csv', encoding: 'utf8', checkedRecords: 30, validRecords: 19, invalidRecords: 11, issueCount: 22, issues: Array.from({ length: 22 }, (_, index) => ({ record: 20 + Math.floor(index / 2), source: index % 2 ? 'last' : 'first', target: index % 2 ? '乙' : '甲', code: 'invalid-value', message: '秘密原字段值' })), complete: true, termination: 'complete', truncated: false, sourceFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64), sourceBytes: 999, warnings: [] });
  return { props, pending, report };
}
async function render(props: ImportPreflightPanelProps) { await act(async () => root!.render(<ImportPreflightPanel {...props}/>)); }
async function mount(props: ImportPreflightPanelProps) { const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await render(props); }
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
function callback(label: string) { const node = button(label); return (node as any)[Object.keys(node).find(key => key.startsWith('__reactProps$'))!].onClick as () => void; }

it('同一控制器获取使用最新表单守卫，重渲染及卸载后释放仍精确配对原获取方', async () => {
  const f = fixture(), initial = vi.fn(() => { throw Error('旧表单身份'); }), acquired = vi.fn(), later = vi.fn();
  await mount({ ...f.props, onActivity: initial }); await render({ ...f.props, onActivity: acquired });
  await click(text.run); expect(initial).not.toHaveBeenCalled(); expect(acquired.mock.calls).toEqual([[1]]); expect(f.props.services.run).toHaveBeenCalledTimes(1);
  await render({ ...f.props, onActivity: later }); await act(async () => root!.unmount()); root = undefined;
  await act(async () => f.pending.resolve(f.report())); expect(acquired.mock.calls).toEqual([[1], [-1]]); expect(later).not.toHaveBeenCalled();
});

it('显式运行且双击不重入，翻页显示第21条后的多字段错误，导出含汇总和精确范围', async () => {
  const f = fixture(); await mount(f.props); expect(f.props.services.run).not.toHaveBeenCalled();
  const old = callback(text.run); await act(async () => { old(); old(); }); expect(f.props.services.run).toHaveBeenCalledTimes(1);
  await act(async () => f.pending.resolve(f.report())); expect(document.body.textContent).toContain('异常 11 条；错误总数 22 条');
  expect(document.querySelectorAll('tr')).toHaveLength(21);
  await click(text.next); expect(document.querySelectorAll('td').map(node => node.textContent)).toEqual(['30', 'first', '甲', 'invalid-value', text.issues['invalid-value'], '30', 'last', '乙', 'invalid-value', text.issues['invalid-value']]);
  await click(text.export); const output = vi.mocked(f.props.services.exportReport).mock.calls[0][0]; expect(output.result.rows).toHaveLength(23);
  expect(JSON.stringify(output.result)).not.toMatch(/秘密|令牌/); expect(f.props.onActivity).toHaveBeenCalledTimes(4);
});

it('来源ABA使原事件和迟到报告失效，卸载仍释放原任务占用', async () => {
  const f = fixture(); await mount(f.props); const old = callback(text.run); await click(text.run);
  await render({ ...f.props, source: { ...f.props.source!, identity: {} } }); await render(f.props); await act(async () => old());
  expect(f.props.services.run).toHaveBeenCalledTimes(1); await act(async () => root!.unmount()); root = undefined;
  await act(async () => f.pending.resolve(f.report())); expect(vi.mocked(f.props.onReport!).mock.calls.filter(([, report]) => report !== null)).toHaveLength(0);
  expect(vi.mocked(f.props.onActivity).mock.calls).toEqual([[1], [-1]]);
});

it('取消失败等待原run终态，失败不会偷偷重试或导入', async () => {
  const f = fixture(); vi.mocked(f.props.services.cancel).mockRejectedValue(Error('路径和秘密'));
  await mount(f.props); await click(text.run); await click(text.cancel);
  expect(button(text.run).disabled).toBe(true); expect(document.body.textContent).toContain(text.cancelFailed); expect(f.props.onActivity).toHaveBeenCalledTimes(1);
  await act(async () => f.pending.reject(Error('原任务已取消')));
  expect(button(text.run).disabled).toBe(false); expect(f.props.services.run).toHaveBeenCalledTimes(1); expect(f.props.services.exportReport).not.toHaveBeenCalled(); expect(f.props.onActivity).toHaveBeenCalledTimes(2);
});

it('导出文件选择迟到不得写出旧报告，原导出占用成对收尾', async () => {
  const f = fixture(), choice = deferred<{ token: string; name: string } | null>(); vi.mocked(f.props.services.chooseReport).mockReturnValue(choice.promise);
  await mount(f.props); await click(text.run); await act(async () => f.pending.resolve(f.report())); const old = callback(text.export);
  await act(async () => { old(); old(); }); await render({ ...f.props, source: null }); await act(async () => choice.resolve({ token: '迟到', name: '旧.json' }));
  expect(f.props.services.chooseReport).toHaveBeenCalledTimes(1); expect(f.props.services.exportReport).not.toHaveBeenCalled(); expect(vi.mocked(f.props.onActivity).mock.calls).toEqual([[1], [-1], [1], [-1]]);
});
