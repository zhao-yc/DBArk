import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { CompletionServerFacts } from '../../src/renderer/completionServerFacts';

type Node = { type: unknown; props: Record<string, any> };
interface Deferred { command: string; input: any; settled: boolean; resolve(value: any): void; reject(error: Error): void }
let compiled: Promise<string> | undefined;
/** 整段执行真实Sidebar及其请求门，只替换调度、展示和IPC端口，不复制业务处理器。 */
function compile(): Promise<string> {
  return compiled ??= build({ entryPoints: [resolve('src/renderer/components/Sidebar.tsx')], write: false, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', plugins: [{ name: '侧栏纯组件测试端口', setup(builder) {
    builder.onLoad({ filter: /[\\/]Sidebar\.tsx$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + '\nexport { ConnectionNode, DatabaseNode, completionServerFacts, beginSidebarConnectionEnd };', loader: 'tsx' }));
    for (const [pattern, path] of [[/^react$/, 'react'], [/^react\/jsx-runtime$/, 'jsx'], [/^lucide-react$/, 'icons'], [/^\.\.\/lib$/, 'lib'], [/^\.\.\/store$/, 'store'], [/^\.\/(?:Workbench|ui)$/, 'ui']] as const) builder.onResolve({ filter: pattern }, () => ({ path, namespace: 'sidebar-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'sidebar-test' }, args => ({ contents: ({
      react: 'export const useState=(...a)=>globalThis.host.state(...a),useRef=(...a)=>globalThis.host.ref(...a),useEffect=(...a)=>globalThis.host.effect(...a);',
      jsx: 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
      icons: 'export const ChevronDown="down",ChevronRight="right",Database="database",Table2="table",Search="search",Plus="plus",Pencil="pencil",RefreshCw="refresh",FileCode2="file",Folder="folder",Unplug="unplug",Trash2="trash",Copy="copy";',
      lib: 'export const invoke=(...a)=>globalThis.sidebarIpcInvoke(...a),errorMessage=e=>e instanceof Error?e.message:String(e),kindLabels={table:"表",view:"视图"};',
      store: 'export const useWorkspace=s=>s(globalThis.store);useWorkspace.getState=()=>globalThis.store;',
      ui: 'export const Spinner="spinner",FavoriteButton="favorite",WorkbenchShelf="shelf";'
    } as Record<string, string>)[args.path] }));
  } }] }).then(result => result.outputFiles[0].text);
}

/** React状态端口按实际依赖处理effect和卸载，断言只从完整生产JSX读取公开状态。 */
export class SidebarComponentRenderer {
  private slots: any[] = [];
  private index = 0;
  private effects: (() => void)[] = [];
  tree!: Node;
  writes = 0;
  mounted = true;
  constructor(private readonly context: Record<string, any>, private readonly component: (props: any) => Node, private readonly props: Record<string, unknown>) { this.render(); }
  state(value: unknown): [unknown, (next: any) => void] { const index = this.index++; if (!(index in this.slots)) this.slots[index] = { value }; return [this.slots[index].value, next => { this.writes++; this.slots[index].value = typeof next === 'function' ? next(this.slots[index].value) : next; }]; }
  ref(value: unknown) { const index = this.index++; return this.slots[index] ??= { current: value }; }
  effect(action: () => (() => void), deps: unknown[]) { const index = this.index++, old = this.slots[index]; if (!old || !deps.every((v, i) => v === old.deps[i])) { this.slots[index] = { deps, cleanup: old?.cleanup }; this.effects.push(() => { old?.cleanup?.(); this.slots[index].cleanup = action(); }); } }
  render(): this { if (!this.mounted) return this; this.context.host = this; this.index = 0; this.tree = this.component(this.props); const effects = this.effects; this.effects = []; effects.forEach(effect => effect()); return this; }
  /** 父组件按真实JSX传下新属性，保留本节点hooks和展开意图。 */
  update(props: Record<string, unknown>): this { Object.assign(this.props, props); return this.render(); }
  all(predicate: (node: Node) => boolean): Node[] { const found: Node[] = []; function visit(node: any) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; if (predicate(node)) found.push(node); visit(node.props?.children); } visit(this.tree); return found; }
  label(): Node { return this.all(node => node.type === 'button' && node.props.className === 'tree-label')[0]; }
  button(name: string): Node { const values = this.all(node => node.type === 'button' && node.props['aria-label'] === name); if (values.length !== 1) throw Error('未找到唯一生产按钮：' + name); return values[0]; }
  click(node = this.label()): void { node.props.onClick(); this.render(); }
  expanded(): boolean { return this.label().props['aria-expanded']; }
  busy(): boolean { return this.label().props['aria-busy']; }
  objects(): string[] { return this.all(node => node.type === 'span' && node.props.className === 'truncate').slice(1).map(node => node.props.children); }
  unmount(): void { this.slots.forEach(slot => slot?.cleanup?.()); this.mounted = false; }
}

/** 每个夹具有独立真实请求门和补全事实缓存，可在同一上下文模拟节点重挂载。 */
export async function sidebarHarness() {
  const calls: Deferred[] = [], notices: string[] = [], renderers: SidebarComponentRenderer[] = [];
  const state = { connections: [{ id: 'c', name: '测试连接', color: '#123456' } as ConnectionProfile], selection: null, connectionVersions: { c: 0 } as Record<string, number>, select() {}, notify(message: string) { notices.push(message); }, openTab() {}, setConnections() {} };
  const module = { exports: {} as Record<string, any> }, context = { module, exports: module.exports, store: state, window: { confirm: () => true }, sidebarIpcInvoke: (command: string, input: unknown) => new Promise((resolve, reject) => calls.push({ command, input, resolve, reject, settled: false })) };
  runInNewContext(await compile(), context);
  const facts = module.exports.completionServerFacts as CompletionServerFacts;
  const callbacks = { onNewConnection() {}, onEditConnection() {}, onCopyConnection() {}, onOpenWorkbench() {}, onEdit() {}, onCopy() {}, onDesign() {}, onColumnPatches() {}, onIndexPatches() {}, onForeignKeyPatches() {}, onTableRename() {}, onTableAutoIncrement() {}, onTableComment() {}, onTableDefaultEncoding() {}, onDdl() {} };
  function create(kind: 'sidebar' | 'connection' | 'database', id = 'c', overrides: Record<string, unknown> = {}) { const component = module.exports[kind === 'sidebar' ? 'Sidebar' : kind === 'connection' ? 'ConnectionNode' : 'DatabaseNode'], profile = { id, name: '测试连接', color: '#123456' } as ConnectionProfile, props = kind === 'sidebar' ? { refreshVersion: 0, objectRefreshVersions: {}, ...callbacks } : kind === 'connection' ? { profile, search: '', objectRefreshVersions: {}, ...callbacks } : { connectionId: id, database: '测试库', search: '', ...callbacks }; const renderer = new SidebarComponentRenderer(context, component, { ...props, ...overrides }); renderers.push(renderer); return renderer; }
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); renderers.forEach(renderer => renderer.render()); }
  async function settle(index: number, value: unknown, failed = false) { const call = calls[index]; if (!call || call.settled) throw Error('无可完成的在途调用：' + JSON.stringify({ index, calls: calls.map(call => call.command), notices })); call.settled = true; if (failed) call.reject(value as Error); else call.resolve(value); await flush(); }
  const beginEnd = module.exports.beginSidebarConnectionEnd as (connectionId: string) => { done: Promise<void>; release(): void } | undefined;
  return { calls, notices, state, facts, create, flush, settle, beginEnd, dispose() { renderers.forEach(renderer => renderer.unmount()); } };
}
