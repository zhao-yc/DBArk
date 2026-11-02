import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/sqlite-table-browse-native.spec.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('sqlite-table-browse-native.spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
/** 执行实际spec的端口和step闭包；不加载Electron或重写它们的身份判断。 */
function extract(name: string, scope: Record<string, unknown>) {
  const nodes: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) nodes.push(node); ts.forEachChild(node, visit); }
  visit(ast); expect(nodes).toHaveLength(1); expect(nodes[0].initializer).toBeDefined();
  const output = { extracted: undefined as unknown };
  const code = ts.transpileModule('exports.extracted = ' + nodes[0].initializer!.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { ...scope, exports: output }); return output.extracted as (...args: any[]) => Promise<any>;
}
/** RAM只替代Main传输，原回调在自己的globalThis执行；性能计数不参与任何授权。 */
function ports(state: Record<string, unknown> | undefined) {
  let ticks = 0;
  const observation = { guardCalls: 0, guardMs: 0, snapshotCalls: 0, snapshotMs: 0 };
  const application = { evaluate: vi.fn(async (callback: () => unknown) => callback()) };
  const scope = { application, observation, performance: { now: () => ++ticks }, __sqliteTableBrowseNative: state };
  return { application, observation, guard: extract('guard', scope), audit: extract('audit', scope) };
}
/** 每条链记录本地owner与Main检查顺序，错误即停在实际原step中。 */
function chain(options: { armed?: boolean; closed?: boolean; mainFailAt?: number; localFailAt?: number } = {}) {
  const calls: string[] = []; let main = 0, local = 0;
  const check = () => { calls.push('local'); if (++local === options.localFailAt) throw Error('本地owner已失效'); };
  const guard = vi.fn(async () => { calls.push('main'); if (++main === options.mainFailAt) throw Error('Main原观察器已失效'); });
  const audit = vi.fn(() => { throw Error('不能用完整快照代替门卫'); });
  const step = extract('step', { stage: '测试阶段', reportedStage: '测试阶段', check, guard, audit, armed: options.armed ?? true, closed: options.closed ?? false });
  const action = vi.fn(async () => { calls.push('action'); return '原结果'; });
  return { calls, action, audit, step };
}

describe('SQLite原只读表页观察端口与身份边界', () => {
  it('门卫仍执行原check，但不读取未消费的页历史；业务端口仍读全量原字段', async () => {
    const check = vi.fn(), history = vi.fn(() => { throw Error('历史应仅由业务断言读取'); });
    const state: Record<string, unknown> = { check }; Object.defineProperty(state, 'pages', { get: history });
    const f = ports(state); await expect(f.guard()).resolves.toBeUndefined(); expect(check).toHaveBeenCalledTimes(1); expect(history).not.toHaveBeenCalled();
    await expect(f.audit()).rejects.toThrow('历史应仅由业务断言读取'); expect(check).toHaveBeenCalledTimes(2); expect(history).toHaveBeenCalledTimes(1);
    expect(f.observation.guardCalls).toBe(1); expect(f.observation.snapshotCalls).toBe(1); expect(f.observation.guardMs).toBeGreaterThan(0); expect(f.observation.snapshotMs).toBeGreaterThan(0);
  });
  it('完整业务回执保留全部原字段与对象，不投影掉拒绝记录、原请求或回包', async () => {
    const state = { check: vi.fn(), pending: 3, denied: ['拒绝事实'], forks: ['准确worker'], pickerCalls: 1, connectionId: '本例', commands: ['sqlite.tablePage'], lookups: [{ request: '原候选请求', reply: '原候选回包' }], pages: [{ request: '原页请求', reply: '完整原页' }] };
    const f = ports(state), result = await f.audit(); expect(Object.keys(result).sort()).toEqual(['pending', 'denied', 'forks', 'pickerCalls', 'connectionId', 'commands', 'lookups', 'pages'].sort());
    for (const key of Object.keys(result)) expect(result[key]).toBe(state[key as keyof typeof state]); expect(state.check).toHaveBeenCalledTimes(1);
  });
  it.each(['guard', 'audit'] as const)('%s不吞掉观察器缺失或原check抛出的身份错误', async name => {
    const missing = ports(undefined); await expect(missing[name]()).rejects.toThrow('原SQLite表浏览观察器不存在');
    const changed = ports({ check() { throw Error('IPC或文档已更换'); } }); await expect(changed[name]()).rejects.toThrow('IPC或文档已更换');
  });
  it('每个界面边界的本地与Main检查次数和顺序保持，不领取完整快照', async () => {
    const f = chain(); await expect(f.step(f.action)).resolves.toBe('原结果'); expect(f.calls).toEqual(['local', 'main', 'action', 'local', 'main']); expect(f.audit).not.toHaveBeenCalled();
  });
  it.each([1, 2])('第%d次Main检查失败即停止原链，动作前后均不可越过', async mainFailAt => {
    const f = chain({ mainFailAt }); await expect(f.step(f.action)).rejects.toThrow('Main原观察器已失效'); expect(f.action).toHaveBeenCalledTimes(mainFailAt - 1); expect(f.audit).not.toHaveBeenCalled();
  });
  it.each([1, 2])('第%d次本地owner检查失败即停止，不借用其它窗口', async localFailAt => {
    const f = chain({ localFailAt }); await expect(f.step(f.action)).rejects.toThrow('本地owner已失效'); expect(f.action).toHaveBeenCalledTimes(localFailAt - 1); expect(f.audit).not.toHaveBeenCalled();
  });
  it('仅原restore出口可显式跳过事后Main检查，事前和本地事后检查仍保留', async () => {
    const f = chain(); await expect(f.step(f.action, true)).resolves.toBe('原结果'); expect(f.calls).toEqual(['local', 'main', 'action', 'local']);
  });
  it.each([{ armed: false }, { closed: true }])('尚未安装或已正常退出时沿原本地owner门：%j', async options => {
    const f = chain(options); await expect(f.step(f.action)).resolves.toBe('原结果'); expect(f.calls).toEqual(['local', 'action', 'local']); expect(f.audit).not.toHaveBeenCalled();
  });
});
