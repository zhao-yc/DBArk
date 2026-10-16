import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {databaseCreateZh as databaseText} from '../../src/renderer/locales/databaseCreate.zh-CN';

/** 只解析生产夹具函数，不导入Electron、MySQL、live模块或任何认证配置。 */
function source(file: string) { return ts.createSourceFile(file, readFileSync(new URL('../e2e/' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n'), ts.ScriptTarget.Latest, true); }
const desktopSource = source('desktop-fixture.ts'), liveSource = source('live-helpers.ts');
function functions(tree: ts.SourceFile, names: string[]) { const found: ts.FunctionDeclaration[] = []; function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')) found.push(node); ts.forEachChild(node, visit); } visit(tree); if (found.length !== names.length) throw Error('缺少真实夹具函数'); return found; }
function lifetime() { let value: ts.ArrowFunction | undefined; function visit(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(desktopSource) === 'desktopLifetime' && ts.isArrayLiteralExpression(node.initializer)) value = node.initializer.elements[0] as ts.ArrowFunction; ts.forEachChild(node, visit); } visit(desktopSource); if (!value) throw Error('缺少实际桌面自动夹具'); return value; }
/** 手动控制close终态；退出请求和desktop.close响应不等于实际close。 */
function deferred() { let resolve!: () => void, reject!: (reason: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fixture(options: { strict?: boolean; holdClose?: boolean; aliveAfterClose?: boolean; bodyFailure?: Error; tasks?: { kind: string; status: string }[] } = {}) {
  const order: string[] = [], close = deferred(), original = options.bodyFailure, info = { status: 'passed', expectedStatus: 'passed', outputPath: () => '仅RAM路径' };
  const observer = { query: vi.fn(async (query: string | { sql: string }) => { const sql = typeof query === 'string' ? query : query.sql; order.push(sql.startsWith('DROP') ? 'drop' : 'catalog'); return [[], []]; }), end: vi.fn(async () => { order.push('observer.end'); }) };
  let context: ReturnType<typeof createContext>;
  const listeners = new Set<() => void>();
  const emitClose = () => { order.push('close'); context.closed = true; for (const listener of listeners) listener(); close.resolve(); };
  const desktop = { evaluate: vi.fn(async (call: Function) => { const source = String(call); if (source.includes('getAppMetrics')) return [101]; if (source.includes('__dbarkE2EDialogs')) order.push('answer'); if (source.includes('app.quit')) order.push('quit-request'); }), process: () => ({ pid: 101 }), on: (_event: string, listener: () => void) => listeners.add(listener), off: (_event: string, listener: () => void) => listeners.delete(listener), waitForEvent: vi.fn(() => close.promise), close: vi.fn(async () => { order.push('close-ack'); if (!options.holdClose) emitClose(); }) };
  const rm = vi.fn(async () => { order.push('rm'); }), force = vi.fn(async () => { order.push('force-default'); });
  const assertion = Object.assign((value: unknown) => expect(value), { poll: (read: () => unknown) => ({ toEqual: async (value: unknown) => { order.push('process-proof'); expect(read()).toEqual(value); } }) });
  context = createContext({ Error, AggregateError, WeakMap, Number, Date, expect: assertion, desktop, closed: false, pageErrors: [], snippetsDiagnostics: undefined, snippetsDiagnosticsArmed: false, quitReady: Promise.resolve(),
    createSnippetsNativeDiagnostics: () => undefined, mkdtemp: vi.fn(async () => join(tmpdir(), 'dbark-e2e-owned')), join, dirname, basename, resolve, tmpdir, rm, forceStopOwnProcess: force,
    launchDesktop: vi.fn(async () => { order.push('launch'); context.closed = false; }), requestQuit: vi.fn(async () => { order.push('quit-request'); }), answerDialogs: vi.fn(async () => { order.push('answer'); }),
    process: { kill: () => { if (options.aliveAfterClose) return true; throw Object.assign(Error('RAM端口确认进程已消失'), { code: 'ESRCH' }); } },
    environment: { DBARK_TEST_HOST: 'offline.invalid', DBARK_TEST_USER: 'RAM端口' }, randomUUID: () => '12345678-1234-1234-1234-123456789abc', tlsCertificate: () => undefined, readFileSync: () => { throw Error('不能读取认证文件'); },
    mysql: { createConnection: vi.fn(async () => observer) }, connectAndCreate: vi.fn(async (database: string) => ({ database, connectionId: 'RAM连接', connectionName: '合成端口' })),
    page: { evaluate: vi.fn(async () => { order.push('tasks'); return options.tasks ?? []; }), screenshot: vi.fn(async () => { throw Error('纯测试禁止截图'); }) },
  });
  let state = ''; for (const statement of desktopSource.statements) if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(node => node.name.getText(desktopSource) === 'preservedDesktopExits')) state = statement.getText(desktopSource);
  const code = state + '\n' + functions(desktopSource, ['preservesUnconfirmedExit', 'retainOwnedDesktopResources', 'ownedDesktopState', 'ownedDesktopResources', 'recordOwnedDesktopProcesses', 'bindOwnedDesktopExit', 'quitOwnedDesktop', 'confirmOwnedDesktopExit', 'quitDesktop']).map(node => node.getText(desktopSource).replace(/^export /, '')).join('\n') + '\n' + functions(liveSource, ['isolatedDatabase'])[0].getText(liveSource).replace(/^export /, '') + '\nglobalThis.handlers={lifetime:' + lifetime().getText(desktopSource) + ',isolatedDatabase};';
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const run = () => context.handlers.lifetime({ trace: 'off', preserveOnUnconfirmedExit: options.strict !== false }, async () => context.handlers.isolatedDatabase(async () => { order.push('body'); if (original) throw original; }, info, { captureFailureScreenshot: false }), info) as Promise<void>;
  return { order, observer, context, desktop, rm, force, run, emitClose, close, info, listeners };
}

/** 真实连接/TLS/确认函数在RAM页面端口运行；不加载Playwright、Electron或证书文件。 */
function connectionFixture(pauseAt?: string, tls = false, strict = true) {
  const f = fixture({ strict }), entered = deferred(), release = deferred(), calls: string[] = []; let paused = false;
  const step = async (label: string) => { calls.push(label); if (!paused && label === pauseAt) { paused = true; entered.resolve(); await release.promise; } };
  function locator(label: string): any {
    return { ramLocator: label, getByRole: (role: string, options?: { name: string }) => locator(options?.name ?? role), getByLabel: (name: string) => locator(name), locator, filter: function () { return this; },
      click: () => step('click:' + label), fill: (_value: string) => step('fill:' + label), check: () => step('check:' + label), focus: () => step('focus:' + label), selectOption: (_value: string) => step('select:' + label) };
  }
  const plainExpect = f.context.expect;
  f.context.expect = Object.assign((value: any) => value?.ramLocator ? {
    toContainText: () => step('expect:' + value.ramLocator), toHaveValue: () => step('expect:' + value.ramLocator), toHaveText: () => step('expect:' + value.ramLocator), toBeVisible: () => step('expect:' + value.ramLocator), toBeHidden: () => step('expect:' + value.ramLocator),
  } : plainExpect(value), { poll: plainExpect.poll });
  Object.assign(f.context.page, { locator, getByRole: (role: string, options?: { name: string }) => locator(options?.name ?? role), evaluate: vi.fn(async () => { await step('profiles'); return [{ name: 'E2E dbark_e2e_ram', id: 'ram-profile' }]; }) });
  const evaluate = f.desktop.evaluate.getMockImplementation()!;
  f.desktop.evaluate.mockImplementation(async call => { if (String(call).includes('__dbarkE2EDialogs')) await step('native-dialog'); return evaluate(call); });
  f.context.tlsCertificate = () => tls ? 'RAM证书，不是文件路径' : undefined;
  f.context.zh = { connections: { text027: '启用TLS', text028: '校验证书' } };
  f.context.databaseText = databaseText;
  const code = functions(desktopSource, ['answerDialogs']).map(node => node.getText(desktopSource).replace(/^export /, '')).join('\n') + '\n'
    + functions(liveSource, ['configureTls', 'acceptNativeConfirmation', 'connectAndCreate']).map(node => node.getText(liveSource).replace(/^export /, '')).join('\n');
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
  const run = () => f.context.handlers.lifetime({ trace: 'off', preserveOnUnconfirmedExit: strict }, async () => {
    const owner = strict ? f.context.ownedDesktopResources(f.info) : undefined;
    return f.context.connectAndCreate('dbark_e2e_ram', owner ? { page: owner.page, application: owner.application, assertCurrent: () => { f.context.ownedDesktopResources(f.info); } } : undefined);
  }, f.info) as Promise<void>;
  return { ...f, run, entered, release, calls };
}

describe('TRUNCATE显式保留模式的真实收尾函数（仅RAM端口）', () => {
  it('成功先收到实际close和进程消失证明，再清库/关观察连接/删临时目录，不进强杀兜底', async () => {
    const f = fixture(); await f.run(); expect(f.order).toEqual(['launch', 'body', 'tasks', 'answer', 'quit-request', 'close-ack', 'close', 'process-proof', 'drop', 'catalog', 'observer.end', 'rm']); expect(f.force).not.toHaveBeenCalled(); expect(f.desktop.waitForEvent).toHaveBeenCalledWith('close', { timeout: 12000 });
  });
  it('退出请求和close调用响应未等到实际close时不清库；未确认后自动夹具也不重试或强杀', async () => {
    const f = fixture({ holdClose: true }), stopped = Error('实际close未确认'); const pending = f.run();
    await vi.waitFor(() => expect(f.desktop.close).toHaveBeenCalledTimes(1)); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
    f.close.reject(stopped); await expect(pending).rejects.toBe(stopped); expect(f.force).not.toHaveBeenCalled(); expect(f.desktop.close).toHaveBeenCalledTimes(1); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('已收到close但进程消失未证明仍保留，不用kill响应或closed布尔放行', async () => {
    const f = fixture({ aliveAfterClose: true }); await expect(f.run()).rejects.toThrow(); expect(f.context.closed).toBe(true); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('旧实例close不能放行已替换实例的清理，仍保留所属资源', async () => {
    const f = fixture({ holdClose: true }), pending = f.run(); await vi.waitFor(() => expect(f.desktop.close).toHaveBeenCalledTimes(1));
    f.context.desktop = { ...f.desktop }; f.emitClose(); await expect(pending).rejects.toThrow('归属已改变'); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it('原用例异常及退出未确认均保留首因，不以finally新错替换原异常', async () => {
    const original = Error('原断言失败'), stopped = Error('退出也未确认'), f = fixture({ bodyFailure: original, holdClose: true }), pending = f.run();
    await vi.waitFor(() => expect(f.desktop.close).toHaveBeenCalledTimes(1)); f.close.reject(stopped); const failure = await pending.catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(original); expect(failure.errors).toEqual([original, stopped]); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('原断言失败但退出完整确认时，完成正常清理且仍返回同一个原异常', async () => {
    const original = Error('原业务断言失败'), f = fixture({ bodyFailure: original }); await expect(f.run()).rejects.toBe(original); expect(f.observer.end).toHaveBeenCalledTimes(1); expect(f.rm).toHaveBeenCalledTimes(1); expect(f.force).not.toHaveBeenCalled();
  });
  it('本例apply未终态时先停链，不用退出来取消它，也不删库、end或进入自动强制清理', async () => {
    const f = fixture({ tasks: [{ kind: 'schema.tableTruncate.apply', status: 'running' }] }); await expect(f.run()).rejects.toThrow('尚未终态'); expect(f.desktop.waitForEvent).not.toHaveBeenCalled(); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('DROP apply运行中保持停链，不发quit或清库/关闭观察连接/删目录', async () => {
    const f = fixture({ tasks: [{ kind: 'schema.tableDrop.apply', status: 'running' }] });
    await expect(f.run()).rejects.toThrow('尚未终态'); expect(f.order).not.toContain('quit-request'); expect(f.desktop.close).not.toHaveBeenCalled(); expect(f.desktop.waitForEvent).not.toHaveBeenCalled();
    expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it('DROP夹具任务读取未知保留原错，不发quit或清库/end/rm', async () => {
    const f = fixture({ tasks: [{ kind: 'schema.tableDrop.apply', status: 'running' }] }), unknown = Error('DROP任务状态未知'); f.context.page.evaluate.mockRejectedValue(unknown);
    await expect(f.run()).rejects.toBe(unknown); expect(f.order).not.toContain('quit-request'); expect(f.desktop.close).not.toHaveBeenCalled();
    expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it('默认选项仍沿原兜底路径，不读取新任务门，退出原错误保持', async () => {
    const f = fixture({ strict: false, holdClose: true }), stopped = Error('旧路径退出失败'), pending = f.run(); await vi.waitFor(() => expect(f.desktop.close).toHaveBeenCalledTimes(1)); f.close.reject(stopped); await expect(pending).rejects.toBe(stopped);
    expect(f.observer.query).toHaveBeenCalledTimes(2); expect(f.observer.end).toHaveBeenCalledTimes(1); expect(f.force).toHaveBeenCalledTimes(1); expect(f.rm).toHaveBeenCalledTimes(1); expect(f.order).not.toContain('tasks');
  });
  it('旧TestInfo在前例完成后失效，不得退出下一例或退回默认清理路径（原红转绿）', async () => {
    const f = fixture(); await f.run(); const nextInfo = { status: 'passed', expectedStatus: 'passed' }, event = deferred(), listeners = new Set<() => void>();
    const next = { evaluate: vi.fn(async (call: Function) => String(call).includes('getAppMetrics') ? [202] : undefined), process: () => ({ pid: 202 }), on: (_: string, listener: () => void) => listeners.add(listener), off: (_: string, listener: () => void) => listeners.delete(listener), waitForEvent: vi.fn(() => event.promise), close: vi.fn(async () => { for (const listener of listeners) listener(); event.resolve(); }) };
    f.context.desktop = next; let lateSucceeded = false, callsBeforeOwnTeardown = -1;
    await f.context.handlers.lifetime({ trace: 'off', preserveOnUnconfirmedExit: true }, async () => {
      await f.context.confirmOwnedDesktopExit(f.info).then(() => { lateSucceeded = true; }, () => {}); callsBeforeOwnTeardown = next.close.mock.calls.length;
    }, nextInfo);
    expect({ lateSucceeded, callsBeforeOwnTeardown }).toEqual({ lateSucceeded: false, callsBeforeOwnTeardown: 0 });
    expect(next.close).toHaveBeenCalledTimes(1); expect(f.context.preservesUnconfirmedExit(f.info)).toBe(true);
    const before = f.context.mysql.createConnection.mock.calls.length;
    await expect(f.context.handlers.isolatedDatabase(async () => {}, f.info, { captureFailureScreenshot: false })).rejects.toThrow('停链');
    expect(f.context.mysql.createConnection).toHaveBeenCalledTimes(before); expect(listeners.size).toBe(0);
  });
  it.each(['EPERM', 'EACCES', undefined])('真实close后PID探测未知%s立即停链；仅ESRCH可放行（原红转绿）', async code => {
    const f = fixture(), unknown = Object.assign(Error('RAM探测未知'), { code });
    const probe = vi.fn(() => { throw unknown; }); f.context.process.kill = probe;
    await expect(f.run()).rejects.toBe(unknown); expect(probe).toHaveBeenCalledTimes(1);
    expect(f.order).toContain('close'); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it.each(['getAppMetrics', '__dbarkE2EDialogs', 'app.quit'])('owner操作%s跨await切换实例，不能向下一实例请求或清理', async stage => {
    const f = fixture(), entered = deferred(), release = deferred(), evaluate = f.desktop.evaluate.getMockImplementation()!;
    f.desktop.evaluate.mockImplementation(async call => { if (String(call).includes(stage)) { entered.resolve(); await release.promise; } return evaluate(call); });
    const next = { evaluate: vi.fn(), close: vi.fn() }, pending = f.run();
    await entered.promise; f.context.desktop = next; release.resolve();
    await expect(pending).rejects.toThrow('归属已改变'); expect(next.evaluate).not.toHaveBeenCalled(); expect(next.close).not.toHaveBeenCalled(); expect(f.desktop.close).not.toHaveBeenCalled();
    expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it('任务读取未知保留首因，随后迟到close和重复确认不复活许可', async () => {
    const original = Error('原断言'), unknown = Error('任务未知'), f = fixture({ bodyFailure: original });
    f.context.page.evaluate.mockRejectedValue(unknown); const failure = await f.run().catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(original); expect(failure.errors).toEqual([original, unknown]);
    f.emitClose(); await expect(f.context.confirmOwnedDesktopExit(f.info)).rejects.toThrow('停链'); expect(f.desktop.close).not.toHaveBeenCalled(); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('并发重复收尾共用一次owner握手，只有实际close加严格PID核对才完成', async () => {
    const f = fixture({ holdClose: true }), pending = f.run(); await vi.waitFor(() => expect(f.desktop.close).toHaveBeenCalledTimes(1));
    const duplicate = f.context.confirmOwnedDesktopExit(f.info); f.emitClose(); await Promise.all([pending, duplicate]);
    expect(f.desktop.close).toHaveBeenCalledTimes(1); expect(f.order.filter(item => item === 'quit-request')).toHaveLength(1); expect(f.observer.end).toHaveBeenCalledTimes(1); expect(f.rm).toHaveBeenCalledTimes(1);
  });
  it('启动后的所属PID清单未知即保留，不进入用例或自动再试退出', async () => {
    const f = fixture(); f.desktop.evaluate.mockResolvedValue([]);
    await expect(f.run()).rejects.toThrow('进程记录未知'); expect(f.order).not.toContain('body'); expect(f.desktop.close).not.toHaveBeenCalled();
    expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
  });
  it('建库首个click换实例时不填写下一例表单（员工2固定P2原红转绿）', async () => {
    const f = fixture(), entered = deferred(), release = deferred(), writes: { label: string; value: string }[] = [];
    f.context.page.locator = vi.fn(() => ({ getByRole: () => ({ click: async () => { entered.resolve(); await release.promise; } }) }));
    const nextForm = { getByLabel: (label: string) => ({ fill: async (value: string) => { writes.push({ label, value }); throw Error('不能填写下一例'); } }) };
    const next = { getByRole: vi.fn(() => nextForm), evaluate: vi.fn(), screenshot: vi.fn() };
    runInContext(ts.transpileModule(functions(liveSource, ['connectAndCreate'])[0].getText(liveSource).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
    const pending = f.run().catch(error => error); await entered.promise;
    const application = { evaluate: vi.fn(), close: vi.fn() }; f.context.page = next; f.context.desktop = application; release.resolve();
    const failure = await pending; expect(failure).toBeInstanceOf(AggregateError); expect(writes).toEqual([]); expect(next.getByRole).not.toHaveBeenCalled(); expect(application.evaluate).not.toHaveBeenCalled();
    expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.force).not.toHaveBeenCalled();
  });
  it.each([['profiles', false], ['click:选择CA 证书', true], ['check:' + databaseText.ackDdl, false]] as const)('连接准备%s跨await换实例，仅旧owner操作已发出且后续全部停链', async (stage, tls) => {
    const f = connectionFixture(stage, tls), nextPage = { getByRole: vi.fn(), locator: vi.fn(), evaluate: vi.fn() }, nextApp = { evaluate: vi.fn(), close: vi.fn() };
    const pending = f.run().catch(error => error); await f.entered.promise;
    f.context.page = nextPage; f.context.desktop = nextApp; f.release.resolve(); const failure = await pending;
    expect(failure).toBeInstanceOf(Error); expect(nextPage.getByRole).not.toHaveBeenCalled(); expect(nextPage.locator).not.toHaveBeenCalled(); expect(nextPage.evaluate).not.toHaveBeenCalled(); expect(nextApp.evaluate).not.toHaveBeenCalled(); expect(nextApp.close).not.toHaveBeenCalled();
    expect(f.desktop.close).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled(); expect(f.observer.query).not.toHaveBeenCalled(); expect(f.observer.end).not.toHaveBeenCalled();
  });
  it('严格连接和TLS准备完成仍使用本例页面及应用，正常握手后才删所属目录', async () => {
    const f = connectionFixture(undefined, true); await f.run();
    expect(f.calls).toContain('fill:连接名称'); expect(f.calls).toContain('click:选择CA 证书'); expect(f.calls).toContain('select:' + databaseText.charset); expect(f.calls).toContain('check:' + databaseText.ackDdl); expect(f.calls).toContain('click:' + databaseText.apply);
    expect(f.desktop.close).toHaveBeenCalledTimes(1); expect(f.rm).toHaveBeenCalledTimes(1); expect(f.force).not.toHaveBeenCalled();
  });
  it('TLS选择失败同时owner切换，保留原错误对象且不在下一实例恢复对话框', async () => {
    const f = connectionFixture('click:选择CA 证书', true), original = Error('原CA选择失败'), nextApp = { evaluate: vi.fn(), close: vi.fn() };
    const pending = f.run().catch(error => error); await f.entered.promise;
    f.context.page = {}; f.context.desktop = nextApp; f.release.reject(original); const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.cause).toBe(original); expect(failure.errors[0]).toBe(original);
    expect(nextApp.evaluate).not.toHaveBeenCalled(); expect(nextApp.close).not.toHaveBeenCalled(); expect(f.rm).not.toHaveBeenCalled();
  });
  it('非严格连接准备无需owner上下文，沿原字段与创建库路径完成', async () => {
    const f = connectionFixture(undefined, false, false); await f.run();
    expect(f.calls).toContain('fill:连接名称'); expect(f.calls).toContain('click:' + databaseText.apply); expect(f.force).toHaveBeenCalledTimes(1); expect(f.rm).toHaveBeenCalledTimes(1);
  });
});

describe('新结构写入未确认成功时的停链',()=>{
  it.each(['running','failed','cancelled'] as const)('列修改%s不能用退出代替服务器结果确认',async status=>{
    const f=fixture({tasks:[{kind:'schema.columns.apply',status}]});await expect(f.run()).rejects.toThrow('未确认成功');
    expect(f.desktop.waitForEvent).not.toHaveBeenCalled();expect(f.observer.query).not.toHaveBeenCalled();expect(f.observer.end).not.toHaveBeenCalled();expect(f.rm).not.toHaveBeenCalled();expect(f.force).not.toHaveBeenCalled();
  });
});

describe('默认路径固定968628d原文及本例显式选项', () => {
  it('旧清库finally与桌面自动夹具默认主体保留Git规范化字节，不改旧335路径', () => {
    const isolated = functions(liveSource, ['isolatedDatabase'])[0], oldTry = isolated.body!.statements.find(ts.isTryStatement)!, select = oldTry.finallyBlock!.statements[0] as ts.IfStatement;
    const fn = lifetime(), body = fn.body as ts.Block, mode = body.statements[0] as ts.IfStatement;
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(hash(select.elseStatement!.getText(liveSource))).toBe('f19c4b4b1be278aff98a0081fb052bf415bd877350d279745805dc62c2303dc9');
    expect(hash(desktopSource.text.slice(mode.end, body.end - 1))).toBe('b8284b726f3cf8cf347b0e483ad162115ea1b57369eb492f99410b7f5ed37cd4');
    expect(hash(functions(desktopSource, ['quitDesktop'])[0].getText(desktopSource))).toBe('70ef0597565cd839b2b6c65db33fee9e26c25f8e8260851f860dbed909e75920');
  });
  it('选项默认false，TRUNCATE和DROP正式UI显式声明true，原用例标题与期限不改', () => {
    const entry = readFileSync(new URL('../e2e/table-truncate-live.ts', import.meta.url), 'utf8'); expect(desktopSource.text).toContain('preserveOnUnconfirmedExit: [false, { option: true }]'); expect(entry).toContain('test.use({ preserveOnUnconfirmedExit: true })');
    expect(entry).toContain("test('真实UI准确表名与完整风险确认；旧预览不能双发，数据和自增经观察连接核对'"); expect(entry).not.toContain('setTimeout');
    const drop = readFileSync(new URL('../e2e/table-drop-live.ts', import.meta.url), 'utf8'); expect(drop).toContain('test.use({ preserveOnUnconfirmedExit: true })');
    expect(drop).toContain("test('单表删除真实入口先预览与准确确认，观察目录消失、关闭旧标签且拒绝旧URI导航'"); expect(drop).not.toContain('setTimeout');
  });
});
