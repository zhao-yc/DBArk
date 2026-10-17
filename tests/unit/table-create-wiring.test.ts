import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableCreateServices } from '../../src/renderer/tableCreateServices';
import { tableCreateZh } from '../../src/renderer/locales/tableCreate.zh-CN';
const port = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _input?: unknown) => ({})) }));
vi.mock('../../src/renderer/lib', () => ({ invoke: port.invoke }));
/** 从生产App提取实际回调；只替换store和React setter，不重写刷新目标逻辑。 */
function harness() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), found = new Map<string, string>(); let wired = false;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['finishTableCreate', 'refreshRenameDatabase', 'markStructureTarget'].includes(node.name?.text ?? '')) found.set(node.name!.text, node.getText(tree));
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SchemaDialog') for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'onCreated') wired = attr.initializer?.getText(tree) === '{finishTableCreate}';
    ts.forEachChild(node, visit);
  } visit(tree); expect(wired).toBe(true); expect(found.size).toBe(3);
  const state = { connectionVersions: { c: 1 }, notify: vi.fn() }, refresh: any[] = [], targets: any[] = [];
  const context = createContext({ useWorkspace: { getState: () => state }, tableCreateZh, columnTargetKey: (t: any) => JSON.stringify([t.connectionId, t.database, t.table]), setObjectRefreshVersions: (update: Function) => refresh.push(update({})), setStructureRefresh: (update: Function) => targets.push(update({})) });
  runInContext(ts.transpileModule([...found.values(), 'globalThis.done=finishTableCreate;'].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, refresh, targets, done: context.done };
}
describe('生产新建表接线与精确刷新（RAM）', () => {
  it('真实App回调只刷新原连接/库/表，不自动改名、打开或重绑其它表页', () => {
    const f = harness(); f.done({ target: { connectionId: 'c', database: 'db', table: 'new' } }, 1);
    expect(Object.keys(f.refresh[0])).toEqual(['["c","db"]']); expect(Object.keys(f.targets[0])).toEqual(['["c","db","new"]']); expect(f.targets[0]['["c","db","new"]']).toMatchObject({ automatic: false });
  });
  it('迟到ACK的连接修订不同，只提示事实，不刷新另一份连接配置', () => {
    const f = harness(); f.state.connectionVersions.c = 2; f.done({ target: { connectionId: 'c', database: 'db', table: 'new' } }, 1); expect(f.refresh).toEqual([]); expect(f.targets).toEqual([]); expect(f.state.notify).toHaveBeenCalledWith(tableCreateZh.mismatch, true);
  });
  it('生产适配器只传结构/令牌，无通用schema.apply fallback', async () => {
    port.invoke.mockClear(); await tableCreateServices.get({ connectionId: 'c', database: 'db', taskId: 'get' }); await tableCreateServices.apply({ previewToken: 'p', confirmation: 'db.t', acknowledgements: [], taskId: 'apply' });
    expect(port.invoke.mock.calls.map(call => call[0])).toEqual(['connections.open', 'schema.tableCreate.get', 'schema.tableCreate.apply']); expect(port.invoke.mock.calls.at(-1)?.[1]).not.toHaveProperty('sql');
  });
  it('原修改表入口和原生成器保留，只有新表分支交给专用确认', () => {
    const source = readFileSync(new URL('../../src/renderer/components/SchemaDialog.tsx', import.meta.url), 'utf8'); expect(source).toContain('if (!table && confirming && createDraft) return <TableCreateConfirmation'); expect(source).toContain("invoke('schema.preview', { connectionId: context.connectionId, design: existingDesign(design) })"); expect(source).toContain("invoke('schema.apply', { connectionId: accepted.context.connectionId, database: accepted.context.database, sql: accepted.sql, taskId })"); expect(source).toContain('if (!table) return;');
  });
  it.each(['running', 'failed', 'cancelled', 'unknown'])('未来正式定义afterEach对%s先保留，不由共享默认清理替它取消', async status => {
    const source = readFileSync(new URL('../e2e/table-create-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true), node = tree.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === 'assertCreateSettled'); if (!node) throw Error('缺少实际终态门');
    const info = {}, retain = vi.fn(), page = { evaluate: vi.fn(async () => [{ kind: 'schema.tableCreate.apply', status }]) }, application = {};
    const context = createContext({ ownedDesktopResources: (value: unknown) => { expect(value).toBe(info); return { page, application, closed: false }; }, retainOwnedDesktopResources: retain });
    runInContext(ts.transpileModule(node.getText(tree) + '\nglobalThis.check=assertCreateSettled;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await expect(context.check(info)).rejects.toThrow('终态'); expect(retain).toHaveBeenCalledWith(info);
  });
});
