import { sidebarMenuRamPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { tableTruncateZh as text } from '../../src/renderer/locales/tableTruncate.zh-CN';
const source = readFileSync(new URL('../e2e/table-truncate-live.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 显式排队迟到结果；不以计时器或真实窗口制造竞态。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

/** 只在VM中运行真实正式定义，所有UI/SQL均为RAM端口；禁止导入实际夹具或连接库。 */
function fixture() {
  const info = {}, application = {}, nextApplication = {}, ui: string[] = [], nextUi: string[] = [], sql: string[] = [], confirmations: string[] = [];
  let activeInfo = info, currentApplication = application, currentPage: unknown, closed = false, retained = false, globalReads = 0, run!: () => Promise<void>, action = 0, pauseAt = 0, holdDialog = false;
  const entered = deferred<void>(), release = deferred<void>(), closing = deferred<void>(), releasedDialog = deferred<void>();
  async function step(label: string) { ui.push(label); if (++action === pauseAt) { entered.resolve(); await release.promise; } }
  function locator(log: string[], label = ''): any {
    const value: any = { label, locator: (name: string) => locator(log, name), filter: () => value, getByRole: (_role: string, options: { name?: string } = {}) => locator(log, String(options.name ?? '')), getByText: (name: string) => locator(log, name), getByLabel: (name: string) => locator(log, name) };
    for (const method of ['focus', 'click', 'fill', 'check']) value[method] = async (input?: string) => {
      if (method === 'fill' && label === text.confirmation) confirmations.push(input!);
      if (log === ui) await step(method + ':' + label); else log.push(method + ':' + label);
    };
    return value;
  }
  const oldPage = { locator: (name: string) => locator(ui, name), getByRole: (_role: string, options: { name?: string } = {}) => locator(ui, String(options.name ?? '')), getByText: (name: string) => locator(ui, name), evaluate: vi.fn(async () => { await step('tasks'); return [{ kind: 'schema.tableTruncate.apply' }]; }) };
  const nextPage = { locator: (name: string) => locator(nextUi, name), getByRole: (_role: string, options: { name?: string } = {}) => locator(nextUi, String(options.name ?? '')) };
  currentPage = oldPage;
  const lost = Error('本例owner失效'), retain = vi.fn(() => { retained = true; });
  const observer = { query: vi.fn(async (statement: string) => {
    sql.push(statement);
    if (statement.startsWith('SELECT @@version')) return [[{ version: '8.4.11', os: 'Linux', names: 0 }]];
    if (statement.startsWith('SELECT id')) return [sql.length === 4 ? [{ id: 20 }] : sql.length === 7 ? [{ id: 1 }] : []];
    return [[]];
  }) };
  const test = Object.assign((_title: string, body: (input: {}, info: unknown) => Promise<void>) => { run = () => body({}, info); }, { use: vi.fn() });
  const desktop: any = { test, expect: (value: any) => {
    const assertion: any = expect(value);
    for (const method of ['toHaveCount', 'toBeEnabled', 'toBeDisabled', 'toContainText', 'toBeVisible']) assertion[method] = async (expected?: unknown) => {
      await step(method + ':' + value.label);
      if (method === 'toHaveCount' && value.label === text.title && expected === 0 && holdDialog) { closing.resolve(); await releasedDialog.promise; }
    };
    return assertion;
  }, ownedDesktopResources: (value: unknown) => { if (value !== activeInfo || retained) { retained = true; throw lost; } return { page: currentPage, application: currentApplication, closed }; }, retainOwnedDesktopResources: retain };
  Object.defineProperty(desktop, 'page', { get: () => { globalReads++; throw Error('禁止读取全局page'); } });
  const exports: any = {};
  runInContext(compiled, createContext({ exports, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
    if (name === './desktop-fixture') return desktop;
    if (name === './live-helpers') return { environment: {}, isolatedDatabase: async (body: Function) => body({ connectionId: 'RAM连接', connectionName: '本例连接', database: 'dbark_e2e_ram', observer }) };
    if (name === '../../src/renderer/locales/tableTruncate.zh-CN') return { tableTruncateZh: text };
    if (name === '../helpers/tableTruncateTarget') return { assertTableTruncateLiveTarget: () => {} };
    throw Error('禁止真实导入：' + name);
  } }));
  exports.registerTableTruncateUiTests();
  return { run: () => run(), observer, ui, nextUi, sql, confirmations, retain, lost, entered, release, closing, releasedDialog,
    pause: (at: number) => { pauseAt = at; }, holdDialog: () => { holdDialog = true; },
    lose: () => { activeInfo = {}; currentApplication = nextApplication; currentPage = nextPage; },
    rebind: () => { currentApplication = nextApplication; currentPage = nextPage; }, close: () => { closed = true; }, globalReads: () => globalReads,
  };
}

describe('TRUNCATE正式用例本例owner与未知观察（仅RAM）', () => {
  it('稳定owner保留原7条SQL、准确确认、单次任务和数据清空/自增重置合同', async () => {
    const f = fixture(); await f.run(); expect(f.observer.query).toHaveBeenCalledTimes(7);
    expect(f.sql).toEqual([
      'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names',
      'CREATE TABLE `dbark_e2e_ram`.`basic`(id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,s VARCHAR(80)) ENGINE=InnoDB AUTO_INCREMENT=20',
      "INSERT INTO `dbark_e2e_ram`.`basic`(s) VALUES('合成数据')", 'SELECT id FROM `dbark_e2e_ram`.`basic`', 'SELECT id FROM `dbark_e2e_ram`.`basic`',
      "INSERT INTO `dbark_e2e_ram`.`basic`(s) VALUES('重置后')", 'SELECT id FROM `dbark_e2e_ram`.`basic`',
    ]);
    expect(f.confirmations).toEqual(['dbark_e2e_ram.basic ', 'dbark_e2e_ram.basic']); expect(f.ui.filter(x => x === 'click:' + text.apply)).toHaveLength(1);
    expect(f.ui.at(-1)).toBe('toHaveCount:' + text.title); expect(f.globalReads()).toBe(0); expect(f.retain).not.toHaveBeenCalled();
  });
  it.each(['lose', 'rebind', 'close'] as const)('首个UI await后%s即停链，不碰新页面或后续SQL', async mode => {
    const f = fixture(); f.pause(1); const pending = f.run().catch(reason => reason); await f.entered.promise; f[mode](); f.release.resolve();
    expect((await pending).message).toMatch(/owner失效|归属已变化或关闭/); expect(f.nextUi).toEqual([]); expect(f.observer.query).toHaveBeenCalledTimes(3); expect(f.confirmations).toEqual([]); expect(f.globalReads()).toBe(0);
  });
  it.each([1, 2, 3, 4, 5, 6, 7])('第%d条观察SQL未知保留原首因，所有后续SQL与UI停链', async index => {
    const f = fixture(), unknown = Error('本例观察结果未知'), normal = f.observer.query.getMockImplementation()!; let calls = 0;
    f.observer.query.mockImplementation(statement => ++calls === index ? Promise.reject(unknown) : normal(statement));
    expect(await f.run().catch(reason => reason)).toBe(unknown); expect(f.observer.query).toHaveBeenCalledTimes(index); expect(f.retain).toHaveBeenCalledTimes(1); expect(f.nextUi).toEqual([]); expect(f.ui).not.toContain('click:' + text.close);
  });
  it('观察请求迟到成功但owner已失效仍保留，不进入CREATE或UI', async () => {
    const f = fixture(), response = deferred<any>(), sent = deferred<void>(); f.observer.query.mockImplementationOnce(() => { sent.resolve(); return response.promise; });
    const pending = f.run().catch(reason => reason); await sent.promise; f.lose(); response.resolve([[{ version: '8.4.11' }]]);
    expect(await pending).toBe(f.lost); expect(f.retain).toHaveBeenCalledTimes(1); expect(f.observer.query).toHaveBeenCalledTimes(1); expect(f.ui).toEqual([]); expect(f.nextUi).toEqual([]);
  });
  it('保留标记异常不覆盖观察SQL首因', async () => {
    const f = fixture(), unknown = Error('原观察失败'); f.observer.query.mockRejectedValueOnce(unknown); f.retain.mockImplementationOnce(() => { throw Error('保留失败'); }); expect(await f.run().catch(reason => reason)).toBe(unknown);
  });
  it('同例窗口已关闭时在首个观察SQL之前停链', async () => {
    const f = fixture(); f.close(); await expect(f.run()).rejects.toThrow('关闭'); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.ui).toEqual([]); expect(f.retain).toHaveBeenCalledTimes(1);
  });
  it('弹窗异步资源释放未结束不能返回；关闭期间owner变化同样拒绝', async () => {
    const f = fixture(); f.holdDialog(); let finished = false; const pending = f.run().catch(reason => reason).finally(() => { finished = true; });
    await f.closing.promise; expect(finished).toBe(false); expect(f.observer.query).toHaveBeenCalledTimes(7); f.rebind(); f.releasedDialog.resolve();
    expect((await pending).message).toMatch(/归属已变化或关闭/); expect(f.nextUi).toEqual([]); expect(f.retain).toHaveBeenCalledTimes(1);
  });
  it('所有关键await后重核，七个SQL只走observe；原正式身份和双门入口不变', () => {
    const tree = ts.createSourceFile('table-truncate-live.ts', source, ts.ScriptTarget.Latest, true); let awaits = 0, queries = 0;
    function visit(node: ts.Node) {
      if (ts.isAwaitExpression(node) && !(ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === 'isolatedDatabase')) {
        let statement: ts.Node = node; while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
        if (ts.isBlock(statement.parent)) { const siblings = statement.parent.statements; expect(siblings[siblings.indexOf(statement as ts.Statement) + 1]?.getText(tree)).toBe('owner.assertCurrent();'); awaits++; }
      }
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'context.observer.query') { queries++; expect(ts.isArrowFunction(node.parent)).toBe(true); expect(node.parent.parent.getText(tree)).toMatch(/^observe\(owner,/); }
      ts.forEachChild(node, visit);
    }
    visit(tree); expect(awaits).toBeGreaterThan(20); expect(queries).toBe(7);
    expect(source).toContain("test('真实UI准确表名与完整风险确认；旧预览不能双发，数据和自增经观察连接核对'");
    expect(source).not.toMatch(/clipboard\.|quitDesktop\(|confirmOwnedDesktopExit\(|test\.setTimeout|retries/);
  });
});
