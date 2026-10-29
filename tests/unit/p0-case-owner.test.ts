import { sidebarMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const text = new Proxy({}, { get: (_target, key) => String(key) });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

/** 只转译固定用例模块；注册、MySQL、page及退出函数全部为RAM端口。 */
function databaseCase(mismatch = false, loseAtVersion = false) {
  const source = readFileSync(new URL('../e2e/database-create-live.ts', import.meta.url), 'utf8');
  const entered = deferred(), release = deferred(), writes: string[] = []; let current = true, clicks = 0, run!: () => Promise<void>;
  const uuid = '00000000-0000-0000-0000-000000000001', info = { id: '本例' };
  const environment = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: 'RAM账户' };
  const observer = { query: vi.fn(async (sql: string) => { if (sql.startsWith('SELECT @@version')) { if (loseAtVersion) current = false; return [[{ version: '8.4.11', uuid: mismatch ? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' : uuid }]]; } return [[]]; }), end: vi.fn(async () => {}) };
  const page = { locator: () => ({ getByRole: () => ({ click: async () => { clicks++; entered.resolve(); await release.promise; } }) }),
    getByRole: () => ({ getByLabel: (label: string) => ({ fill: async (_value: string) => { writes.push(label); throw Error('RAM阻止失效owner继续填表'); } }) }), evaluate: async () => [] };
  const test = Object.assign((_title: string, body: (input: {}, info: unknown) => Promise<void>) => { run = () => body({}, info); }, { use() {}, setTimeout() {}, describe: { configure() {} } });
  const exports: any = {}, retain = vi.fn(() => { current = false; }), confirm = vi.fn(async () => {});
  const context = createContext({ exports, process: { env: { ...environment, DBARK_TEST_EXPECTED_SERVER_UUID: uuid } }, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === 'node:crypto') return { randomUUID: () => uuid };
    if (name === 'mysql2/promise') return { createConnection: async () => observer };
    if (name === './desktop-fixture') return { test, expect, ownedDesktopResources: () => { if (!current) throw Error('owner已失效'); return { page, closed: false }; }, retainOwnedDesktopResources: retain, confirmOwnedDesktopExit: confirm };
    if (name === './live-helpers') return { environment };
    if (name === '../../src/renderer/locales/databaseCreate.zh-CN') return { databaseCreateZh: text };
    throw Error('禁止真实模块：' + name);
  } });
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
  exports.registerDatabaseCreateUiTests(); return { run: () => run(), entered, release, writes, observer, confirm, clicks: () => clicks, lose: () => { current = false; } };
}
describe('P0正式用例显式owner归属（仅RAM）', () => {
  it('新建库专用首个UI await后owner失效，不应继续填写旧实例表单', async () => {
    const f = databaseCase(), pending = f.run().catch(error => error); await f.entered.promise; f.lose(); f.release.resolve(); await pending;
    expect(f.writes).toEqual([]); expect(f.confirm).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled();
  });
  it('UUID不符时首个产品UI动作之前拒绝，零表单写入和DROP', async () => {
    const f = databaseCase(true); await expect(f.run()).rejects.toThrow(); expect(f.writes).toEqual([]); expect(f.observer.query.mock.calls.some(([sql]) => sql.startsWith('DROP DATABASE'))).toBe(false);
  });
  it('观察连接版本读取期间归属失效，零产品动作且不退出或清理', async () => {
    const f = databaseCase(false, true); f.release.resolve(); const failure = await f.run().catch(error => error);
    expect(failure.name).toBe('AggregateError'); expect(failure.errors[0]).toBe(failure.cause); expect(failure.cause).toBeInstanceOf(Error); expect(f.clicks()).toBe(0); expect(f.writes).toEqual([]); expect(f.confirm).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled();
  });
  it('观察连接请求未知保留原错误，不借退出或DROP/end清理现场', async () => {
    const f = databaseCase(), unknown = Error('本例观察请求未知'); f.observer.query.mockRejectedValue(unknown);
    const failure = await f.run().catch(error => error); expect(failure.cause).toBe(unknown); expect(failure.errors[0]).toBe(unknown);
    expect(f.clicks()).toBe(0); expect(f.confirm).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.observer.query).toHaveBeenCalledTimes(1);
  });
  it.each([['table-column-on-update.spec.ts', 'change', ['expression']], ['table-column-add-on-update.spec.ts', 'fill', ['DATETIME', 0]], ['table-column-on-update.spec.ts', 'confirm', []]] as const)('%s/%s首个await后换实例不应向下一页面操作', async (file, method, args) => {
    const source = readFileSync(new URL('../e2e/' + file, import.meta.url), 'utf8'), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let fn!: ts.FunctionDeclaration, access!: ts.VariableStatement;
    tree.forEachChild(node => { if (ts.isFunctionDeclaration(node) && node.name?.text === method) fn = node; if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(tree) === 'page')) access = node; });
    const entered = deferred(), release = deferred(), nextActions: string[] = [];
    const wait = async () => { entered.resolve(); await release.promise; }, action = { click: wait, check: wait }, oldDialog = { getByRole: () => action };
    const desktop = { page: { locator: () => oldDialog, getByRole: () => oldDialog } as any };
    const context = createContext({ desktop, text, expect }); runInContext(ts.transpileModule(access.getText(tree) + '\n' + fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const captured = desktop.page, owner = { page: captured, assertCurrent: () => { if (desktop.page !== captured) throw Error('本例owner已失效'); } };
    const pending = context[method](owner, ...args).catch((error: Error) => error); await entered.promise;
    desktop.page = { getByRole: () => ({ getByRole: () => ({ click: async () => { nextActions.push('click'); throw Error('禁止下一页面'); }, fill: async () => { nextActions.push('fill'); throw Error('禁止下一页面'); }, check: async () => { nextActions.push('check'); throw Error('禁止下一页面'); } }) }) };
    release.resolve(); await pending; expect(nextActions).toEqual([]);
  });
});
