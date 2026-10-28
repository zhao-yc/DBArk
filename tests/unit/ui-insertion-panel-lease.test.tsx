import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument } from '../fixtures/memory-dom';
import type { HistoryInsertionTarget } from '../../src/renderer/historyInsertion';
import { HistoryDialog } from '../../src/renderer/components/ActivityDialog';

interface Child { insertion?: HistoryInsertionTarget | null; onClose(): void; onQueries?(): void; onHistory?(): void; }
const children = vi.hoisted(() => ({ history: undefined as Child | undefined, queries: undefined as Child | undefined }));
vi.mock('../../src/renderer/components/HistoryPagesDialog', () => ({ HistoryPagesDialog: (props: Child) => { children.history = props; return <div>历史</div>; } }));
vi.mock('../../src/renderer/components/SavedQueriesDialog', () => ({ SavedQueriesDialog: (props: Child) => { children.queries = props; return <div>查询库</div>; } }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign(() => ({}), { getState: () => ({}) }) }));
vi.mock('../../src/renderer/lib', () => ({ invoke: vi.fn(), errorMessage: (reason: unknown) => String(reason) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
let source: HistoryInsertionTarget, insert: ReturnType<typeof vi.fn>;

beforeAll(async () => { doc = memoryDocument(); ({ createRoot } = await import('react-dom/client')); });
beforeEach(() => {
  children.history = undefined; children.queries = undefined;
  let live = true; insert = vi.fn();
  source = { title: '原查询', connectionId: '原连接', current: () => live, dispose: () => { live = false; }, insert: sql => { if (!live) throw Error('原目标已变化'); live = false; insert(sql); }, subscribe: () => () => {} };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 真实React严格重订阅，子页只替换显示端口，不替代父组件的租约交付。 */
async function mount() {
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<StrictMode><HistoryDialog insertion={source} onClose={() => source.dispose()}/></StrictMode>));
}

it('StrictMode首次重订阅不撤销有效原目标，切到查询库仍只消费一次', async () => {
  await mount(); const history = children.history!;
  expect(history.insertion?.current()).toBe(true);
  await act(async () => { history.insertion?.dispose(); history.onQueries!(); });
  const queries = children.queries!; expect(queries.insertion?.current()).toBe(true);
  history.insertion?.dispose(); expect(queries.insertion?.current()).toBe(true);
  queries.insertion?.insert('完整正文'); expect(insert).toHaveBeenCalledExactlyOnceWith('完整正文');
  expect(() => history.insertion?.insert('旧页')).toThrow(); expect(() => queries.insertion?.insert('重放')).toThrow();
});

it('原模型失效后切回历史保持失效，普通关闭只结束父的同一原目标', async () => {
  await mount(); const history = children.history!;
  await act(async () => { history.insertion?.dispose(); history.onQueries!(); });
  const queries = children.queries!; source.dispose();
  await act(async () => { queries.insertion?.dispose(); queries.onHistory!(); });
  expect(children.history?.insertion?.current()).toBe(false);
  children.history!.onClose(); expect(source.current()).toBe(false); expect(insert).not.toHaveBeenCalled();
});
