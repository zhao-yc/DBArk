import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableDefaultEncodingZh } from '../../src/renderer/locales/tableDefaultEncoding.zh-CN';
import { tableRenameZh } from '../../src/renderer/locales/tableRename.zh-CN';
import { tableCommentZh } from '../../src/renderer/locales/tableComment.zh-CN';
import { foreignKeyPatchZh } from '../../src/renderer/locales/foreignKeyPatches.zh-CN';
import { indexPatchZh } from '../../src/renderer/locales/indexPatches.zh-CN';
import { columnPatchZh } from '../../src/renderer/locales/columnPatches.zh-CN';

interface Node { type: unknown; props: Record<string, any>; children: any[]; }
/** 只替换React调度及IPC边界，实际执行生产DatabaseNode；不启动浏览器或桌面。 */
function harness() {
  const source = readFileSync(new URL('../../src/renderer/components/Sidebar.tsx', import.meta.url), 'utf8'), ast = ts.createSourceFile('Sidebar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'DatabaseNode'); if (!node) throw new Error('缺少生产数据库节点');
  const slots: any[] = [], effects: { deps?: unknown[]; cleanup?: () => void }[] = [], pending: (() => void)[] = [];
  let cursor = 0, version = 0, tree: Node;
  const request = vi.fn(), notify = vi.fn(), useWorkspace = Object.assign(() => undefined, { getState: () => ({ connectionVersions: { c: version }, select() {}, notify }) });
  const context = createContext({ zh, formatText, tableDefaultEncodingZh, tableRenameZh, tableCommentZh, foreignKeyPatchZh, indexPatchZh, columnPatchZh, invoke: request, useWorkspace, errorMessage: String, kindLabels: { table: '表' },
    React: { createElement: (type: unknown, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat() }) },
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(action: () => void | (() => void), deps: unknown[]) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: action() || undefined }; }); },
    ...Object.fromEntries(['FavoriteButton', 'ChevronDown', 'ChevronRight', 'Database', 'FileCode2', 'Plus', 'RefreshCw', 'Pencil', 'Spinner', 'Table2'].map(name => [name, name])),
  });
  runInContext(ts.transpileModule(node.getText(ast) + '\nglobalThis.render=DatabaseNode;', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  const render = (refreshVersion = 0) => { cursor = 0; tree = context.render({ connectionId: 'c', database: 'db', search: '', refreshVersion }); for (const run of pending.splice(0)) run(); return tree; };
  const find = (current: any, predicate: (node: Node) => boolean): Node | undefined => { if (!current || typeof current !== 'object') return; if (predicate(current)) return current; for (const child of current.children ?? []) { const found = find(child, predicate); if (found) return found; } };
  const load = () => find(tree, value => value.type === 'button' && value.props.title === zh.sidebar.text018)!.props.onClick();
  const text = (value: any): string => typeof value === 'string' ? value : (value?.children ?? []).map(text).join(' ');
  render();
  return { render, load, request, notify, text: () => text(tree), revise: () => version++, unmount: () => { for (const effect of effects) effect?.cleanup?.(); } };
}
function deferred() { let resolve!: (rows: unknown[]) => void, reject!: (error: Error) => void; const promise = new Promise<unknown[]>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { await Promise.resolve(); await Promise.resolve(); }

describe('重命名对象树的真实目录重读与迟到保护', () => {
  it('刷新通知实际调用metadata.objects，旧请求迟到不能把原名重新填回', async () => {
    const value = harness(); value.request.mockResolvedValueOnce([{ name: 'original', kind: 'table' }]); value.load(); await flush(); value.render(); expect(value.text()).toContain('original');
    const old = deferred(), renamed = deferred(); value.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(renamed.promise);
    value.load(); value.render(1); renamed.resolve([{ name: 'renamed', kind: 'table' }]); await flush(); value.render(1);
    expect(value.text()).toContain('renamed'); old.resolve([{ name: 'original', kind: 'table' }]); await flush(); value.render(1);
    expect(value.text()).toContain('renamed'); expect(value.text()).not.toContain('original');
    expect(value.request.mock.calls).toEqual(Array.from({ length: 3 }, () => ['metadata.objects', { connectionId: 'c', database: 'db' }])); value.unmount();
  });
  it('旧错误、卸载后结果和连接修订变化都不能继续投影旧目录或错误', async () => {
    const value = harness(), old = deferred(), latest = deferred(); value.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    value.load(); value.render(1); old.reject(new Error('旧连接错误')); await flush(); expect(value.notify).not.toHaveBeenCalled();
    value.revise(); latest.resolve([{ name: 'wrong_server', kind: 'table' }]); await flush(); value.render(1); expect(value.text()).not.toContain('wrong_server');
    const late = deferred(); value.request.mockReturnValueOnce(late.promise); value.load(); value.unmount(); late.resolve([{ name: 'unmounted', kind: 'table' }]); await flush(); value.render(1); expect(value.text()).not.toContain('unmounted'); expect(value.notify).not.toHaveBeenCalled();
  });
});
