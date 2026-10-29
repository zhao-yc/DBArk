import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import type { PageFindRequest, PageFindResult } from '../../src/renderer/pageFindWorkerClient';
import type { DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo } from '../../src/shared/contracts';

type Node = { type: unknown; props: Record<string, any> };
let compiled: Promise<string> | undefined;
/** 编译完整当前生产面板；只替换React调度、展示及Worker传输端口，不摘取或复制业务处理器。 */
function bundle() {
  return compiled ??= build({ stdin: { contents: "export {PageFindPanel} from './src/renderer/components/PageFindPanel';export * from './src/renderer/pageFindReplace';", resolveDir: fileURLToPath(new URL('../..', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.url': '"file:///PageFindPanel.tsx"' }, plugins: [{ name: '页内面板纯状态端口', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'panel' }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'panel' }));
    build.onResolve({ filter: /^\.\/ui$/ }, args => args.importer.endsWith('PageFindPanel.tsx') ? { path: 'ui', namespace: 'panel' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'panel' }, args => ({ contents: args.path === 'hooks' ? 'export const useState=(...v)=>globalThis.__hooks.state(...v),useRef=(...v)=>globalThis.__hooks.ref(...v),useMemo=(...v)=>globalThis.__hooks.memo(...v),useEffect=(...v)=>globalThis.__hooks.effect(...v);' : args.path === 'jsx' ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";' : 'export const Field="Field",Modal="Modal",ErrorBox="ErrorBox",UsageHelp="UsageHelp";' }));
  } }] }).then(result => result.outputFiles[0].text);
}

/** 独立VM和定时队列，测试之间不改全局定时器、不创建真实GUI或网络连接。 */
export async function pageFindPanelHarness() {
  const timers = new Map<number, { callback(): void; delay: number }>(), workers: Port[] = [], applied: DraftRow[][] = [], jumps: unknown[][] = []; let timer = 0;
  const vm = createContext({ module: { exports: {} }, TextEncoder, TextDecoder, structuredClone, URL, setTimeout: (callback: () => void, delay: number) => { const id = ++timer; timers.set(id, { callback, delay }); return id; }, clearTimeout: (id: number) => timers.delete(id) });
  /** 延迟原响应/终止确认，计算仍调用完整产物里的真实生产匹配和补丁函数。 */
  class Port {
    onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; onmessageerror = null; message?: { id: number; request: PageFindRequest }; receiver?: Port['onmessage']; terminated = false; acknowledged = false; private termination?: Promise<void>; private finish?: () => void;
    constructor() { workers.push(this); queueMicrotask(() => this.onmessage?.({ data: { type: 'dbark-page-find-ready', version: 1 } })); }
    postMessage(message: { id: number; request: PageFindRequest }) { this.message = message; this.receiver = this.onmessage; }
    holdTermination() { this.termination = new Promise(resolve => { this.finish = resolve; }); }
    terminate() { this.terminated = true; if (!this.termination) this.acknowledged = true; return this.termination; }
    acknowledge() { this.acknowledged = true; this.finish?.(); }
    release(late = false) { if (!this.message) throw Error('没有实际发送的Worker请求'); const { id, request: r } = this.message; const result: PageFindResult = r.operation === 'find' ? { status: 'ready', operation: 'find', matches: product.findPageCellsInWorker(r.rows, r.keys, r.options) } : { status: 'ready', operation: 'preview', preview: product.previewPageReplacementInWorker(r.rows, r.keys, r.options, r.replacement, r.info, r.generation, r.only) }; (late ? this.receiver : this.onmessage)?.({ data: { id, result } }); }
  }
  vm.Worker = Port; runInContext(await bundle(), vm); const product = vm.module.exports;
  /** 最小React调度器只维护hook身份、依赖和清理，不实现任何查找、替换或意图判断。 */
  class Renderer {
    slots: any[] = []; cursor = 0; effects: (() => void)[] = []; dirty = true; tree!: Node;
    state(value: any) { const index = this.cursor++; this.slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [this.slots[index].value, (next: any) => { const value = typeof next === 'function' ? next(this.slots[index].value) : next; if (!Object.is(value, this.slots[index].value)) { this.slots[index].value = value; this.dirty = true; } }]; }
    ref(value: any) { return this.slots[this.cursor++] ??= { current: value }; }
    memo(factory: () => unknown, deps: unknown[]) { const index = this.cursor++, old = this.slots[index]; if (!old || !deps.every((value, index) => value === old.deps[index])) this.slots[index] = { value: factory(), deps }; return this.slots[index].value; }
    effect(callback: () => unknown, deps?: unknown[]) { const index = this.cursor++, old = this.slots[index]; if (!old || !deps || !deps.every((value, index) => value === old.deps?.[index])) { this.slots[index] = { deps, cleanup: old?.cleanup }; this.effects.push(() => { old?.cleanup?.(); this.slots[index].cleanup = callback(); }); } }
    render() { let turns = 0; while (this.dirty) { if (++turns > 30) throw Error('组件纯调度没有收敛'); this.dirty = false; this.cursor = 0; vm.__hooks = this; this.tree = product.PageFindPanel(props); const effects = this.effects; this.effects = []; effects.forEach(effect => effect()); } }
    nodes(type: unknown) { const matches: Node[] = []; function visit(value: any) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return; if (value.type === type) matches.push(value); visit(value.props?.children); } visit(this.tree); return matches; }
  }
  const info: TableInfo = { database: '纯组件', name: '当前页', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: ['id', 'note', 'amount', 'payload'].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(30,6)' : name === 'payload' ? 'BLOB' : 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })) };
  const original = { id: '18446744073709551615', note: 'old old', amount: '12345678901234567890.123456', payload: { type: 'binary' as const, base64: 'AAH/' } };
  let selection: unknown;
  const props = { rows: [{ id: 'uuid-1', data: { ...original }, original, inserted: false, deleted: false }] as DraftRow[], keys: ['note', 'amount', 'payload'], info, generation: 1, disabled: false, replaceDisabled: false, focusRequest: { target: 'query', generation: 1 }, onFilter() {}, getSelectionToken: () => selection, onJump(...args: unknown[]) { jumps.push(args); selection = { rowId: args[0], key: args[1] }; }, onApply(plan: unknown) { const next: DraftRow[] = product.applyPageReplacement(props.rows, plan, props.info, props.generation); applied.push(next); props.rows = next; props.generation++; view.dirty = true; return next; } };
  const view = new Renderer(); view.render();
  /** 只清空微任务和React待渲染，不用真实睡眠扩大时间窗口。 */
  async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); view.render(); }
  /** 触发实际debounce回调，启动仍走生产WorkerClient握手。 */
  async function searchTimer() { for (const [id, value] of [...timers]) if (value.delay === 120) { timers.delete(id); value.callback(); } await flush(); }
  /** 调用实际JSX注册的输入/组合/按钮处理器，验证事件接线而不复制业务逻辑。 */
  function change(index: number, value: string) { view.nodes('input')[index].props.onChange({ target: { value } }); view.render(); }
  function enter(index: number) { view.nodes('input')[index].props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {}, stopPropagation() {} }); view.render(); }
  function click(label: string) { const node = view.nodes('button').find(node => node.props.children === label); if (!node || node.props.disabled) throw Error('实际按钮不可用：' + label); node.props.onClick(); view.render(); }
  async function initialize() { change(0, 'old'); await searchTimer(); workers.at(-1)!.release(); await flush(); enter(0); change(4, 'NEW'); await flush(); }
  async function dispose() { workers.forEach(worker => worker.acknowledge()); view.slots.forEach(slot => slot?.cleanup?.()); for (let index = 0; index < 16; index++) await Promise.resolve(); timers.clear(); }
  return { props, original, view, workers, applied, jumps, timers, change, enter, click, flush, searchTimer, initialize, dispose, selection(value: unknown) { selection = value; } };
}
