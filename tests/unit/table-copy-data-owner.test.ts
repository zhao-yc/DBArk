import { sidebarMenuRamPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { closeMysqlConnection } from '../../src/engine/connection';
import { tableCopyStructureTarget } from '../helpers/tableCopyStructureTarget';
import { bindTableCopyDataTarget } from '../helpers/tableCopyDataTarget';

const uuid = '11111111-2222-3333-4444-555555555555';
const environment = (): Record<string, string | undefined> => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid });
const source = readFileSync(new URL('../e2e/table-copy-data-live.ts', import.meta.url), 'utf8');
const compile = (value: string) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
type Drift = 'helper凭据' | 'helper目标' | 'raw和helper一致变化' | '表单等待后凭据';
type Changes = { drift?: Drift; facts?: Record<string, unknown>; missingNative?: boolean; missingStream?: boolean; closeUnknown?: boolean; holdClose?: boolean; queryUnknown?: boolean; afterAbsence?: boolean; beforeSource?: boolean; afterForm?: boolean; replacePage?: boolean; retainThrows?: boolean };

/** 执行正式注册函数和原建库表单，仅替换驱动/桌面端口；没有真实连接、认证文件或GUI。 */
function formal(changes: Changes = {}) {
  const raw = environment(), helper = { ...raw }, calls: string[] = [], submissions: Record<string, string>[] = [], filled: Record<string, string> = {}, targets: Record<string, unknown>[] = [], cases: Function[] = [];
  const info = {}, application = {}, stop = Error('合成建库提交边界'), sourceStop = Error('合成源表DDL未知');
  let retained = false, closed = false, didDrift = false, connectionCount = 0, finishClose: (() => void) | undefined, replacePage = false, after!: Function;
  const mutate = () => {
    if (didDrift) return; didDrift = true;
    if (changes.drift === 'helper目标') { helper.DBARK_TEST_HOST = '合成错误目标'; helper.DBARK_TEST_PORT = '19999'; }
    else { helper.DBARK_TEST_USER = '合成漂移账号'; helper.DBARK_TEST_PASSWORD = '合成漂移密码'; }
    if (changes.drift === 'raw和helper一致变化') Object.assign(raw, helper);
    calls.push('drift');
  };
  const locator = (label = ''): any => new Proxy({ __locator: true }, { get(_object, key) {
    // 真实Locator不是Promise；异步菜单返回值不能被通用Proxy误识别为thenable。
    if (key === 'then') return undefined;
    if (key === '__locator') return true;
    if (key === '__label') return label;
    if (['getByRole', 'getByLabel', 'getByText'].includes(String(key))) return (name: string, options?: { name: string }) => locator(key === 'getByRole' ? options?.name ?? name : name);
    if (key === 'fill') return async (value: string) => { filled[label] = value; calls.push('fill:' + label); if (changes.drift === '表单等待后凭据' && label === '主机地址') mutate(); };
    if (key === 'click') return async () => { if (label === '执行建库') { calls.push('database-submit'); submissions.push({ ...filled }); if (!changes.beforeSource) throw stop; } };
    if (['focus', 'check', 'selectOption'].includes(String(key))) return async () => {};
    return () => locator(label);
  } });
  const page = { locator: () => locator(), getByRole: (_name: string, options: { name: string }) => locator(options.name), evaluate: async (callback: Function) => callback.toString().includes('tasks.list') ? [] : [{ name: 'E2E dbark_copy_' + uuid.replaceAll('-', ''), id: '合成连接' }] };
  const own = (value: unknown) => { expect(value).toBe(info); if (retained) throw Error('合成归属已保留'); return { page: replacePage ? {} : page, application, closed }; };
  // 注入共享状态落定前的通知失败，不能先写共享retained掩盖本地状态缺失。
  const retain = () => { calls.push('retain'); if (changes.retainThrows) throw Error('合成保留失败'); retained = true; };
  const actualExpect = (value: any) => value?.__locator ? new Proxy({}, { get: () => async () => { if (changes.afterForm && value.__label === 'dbark_copy_' + uuid.replaceAll('-', '')) mutate(); } }) : expect(value);
  const helperSource = readFileSync(new URL('../e2e/live-helpers.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('helper.ts', helperSource, ts.ScriptTarget.Latest, true);
  const helperBody = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'connectAndCreate')!.getText(tree);
  const helperContext = { ...sidebarMenuRamPort, require(name: string) { if (name === './navigation-menu') return navigationMenuRamPort; throw Error('纯函数接线拒绝未知展示模块：' + name); }, exports: {} as Record<string, Function>, environment: helper, expect: actualExpect, configureTls: async (_form: unknown, owner: { assertCurrent(): void }) => owner.assertCurrent(), databaseText: { charset: '字符集', collation: '排序规则', preview: '建库预览', confirmation: '建库确认', ackDdl: '风险一', ackCreate: '风险二', apply: '执行建库', succeeded: '成功' } };
  runInContext(compile(helperBody), createContext(helperContext));
  const createConnection = async (options: Record<string, unknown>) => {
    const index = ++connectionCount; calls.push('connect'); targets.push(options); expect(options).not.toHaveProperty('database');
    const stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { calls.push('flush'); queueMicrotask(() => { callback(); const close = () => { stream.closed = true; calls.push('transport-close'); stream.emit('close'); }; if (changes.holdClose && index === 1) finishClose = close; else close(); }); }, destroy() { stream.closed = true; stream.emit('close'); } });
    const native = Object.assign(new EventEmitter(), { stream, end(callback: (reason?: Error) => void) { calls.push('quit'); queueMicrotask(() => callback(changes.closeUnknown ? Error('合成原生关闭失败') : undefined)); }, destroy() { stream.destroy(); } });
    return { connection: changes.missingNative ? undefined : changes.missingStream ? { ...native, stream: undefined } : native, query: async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('SELECT @@version')) {
        if (changes.queryUnknown) throw sourceStop;
        if (changes.drift && changes.drift !== '表单等待后凭据') mutate();
        if (changes.replacePage) replacePage = true;
        return [[{ version: '8.4.11', os: 'Linux', names: 0, uuid, ...changes.facts }]];
      }
      if (sql.startsWith('SELECT SCHEMA_NAME')) { if (changes.afterAbsence) mutate(); return [[]]; }
      if (sql.startsWith('CREATE TABLE')) { throw sourceStop; }
      throw Error('拒绝未声明观察SQL');
    }, end: async () => { calls.push('promise-end'); } };
  };
  const test = Object.assign((_name: string, body: Function) => cases.push(body), { use: vi.fn(), setTimeout: vi.fn(), describe: { configure: vi.fn() }, afterEach: (callback: Function) => { after = callback; } });
  const context = { exports: {} as Record<string, Function>, process: { env: raw }, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
    if (name === './table-copy-structure-live') return { cleanupTableCopyStructureCase: async () => { calls.push('old-cleanup'); } };
    if (name === './desktop-fixture') return { test, expect: actualExpect, ownedDesktopResources: own, retainOwnedDesktopResources: retain, confirmOwnedDesktopExit: async () => { calls.push('exit'); closed = true; } };
    if (name === 'node:crypto') return { randomUUID: () => uuid };
    if (name === 'mysql2/promise') return { __esModule: true, default: { createConnection } };
    if (name === '../../src/engine/connection') return { closeMysqlConnection };
    if (name === './live-helpers') return { environment: helper, connectAndCreate: helperContext.exports.connectAndCreate };
    if (name === '../helpers/tableCopyStructureTarget') return { tableCopyStructureTarget };
    if (name === '../helpers/tableCopyDataTarget') return { bindTableCopyDataTarget };
    if (name.endsWith('/tableCopyData.zh-CN')) return { tableCopyDataZh: {} };
    throw Error('拒绝实际导入：' + name);
  } };
  runInContext(compile(source), createContext(context)); context.exports.registerTableCopyDataUiTests();
  return { calls, submissions, targets, stop, sourceStop, raw, helper, clearNotificationFailure: () => { changes.retainThrows = false; }, after: () => after({}, info), run: async () => { try { await cases[0]({}, info); } catch (reason) { return reason as any; } }, retained: () => retained, releaseClose: () => { expect(finishClose).toBeDefined(); finishClose!(); }, waitingClose: () => !!finishClose };
}

/** 聚合首项与cause必须同指原异常对象；沿嵌套收尾仍能找到最初请求首因。 */
function originalCause(reason: any): unknown { const seen = new Set(); while (reason && Object.hasOwn(reason, 'cause') && !seen.has(reason)) { seen.add(reason); expect(reason.errors[0]).toBe(reason.cause); reason = reason.cause; } return reason; }

describe('结构及数据复制通知设置前失败的本地保留锁（真实注册函数，仅RAM）', () => {
  it('预检未知加通知设置前失败，原首因保持且禁止退出、close及DROP', async () => {
    const f = formal({ queryUnknown: true, retainThrows: true }), reason = await f.run(); expect(originalCause(reason)).toBe(f.sourceStop); expect(f.retained()).toBe(false); expect(f.calls).not.toContain('exit'); expect(f.calls).not.toContain('quit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false); const before = f.calls.length; await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before);
  });
  it('原建库提交未知加通知设置前失败，空任务列表不能放行退出或DROP', async () => {
    const f = formal({ retainThrows: true }), reason = await f.run(); expect(originalCause(reason)).toBe(f.stop); expect(f.submissions).toHaveLength(1); expect(f.retained()).toBe(false); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false); const before = f.calls.length; await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before);
  });
  it('活动超时先本地保留，通知异常及迟到close不允许继续建库', async () => {
    const f = formal({ holdClose: true, retainThrows: true }), pending = f.run(); for (let index = 0; index < 50 && !f.waitingClose(); index++) await Promise.resolve(); expect(f.waitingClose()).toBe(true); await expect(f.after()).rejects.toThrow('仍活动'); f.releaseClose(); await pending; expect(f.submissions).toEqual([]); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false); await expect(f.after()).rejects.toThrow('保留');
  });
  it('通知能力恢复不解除本例保留，afterEach不再尝试通知或其他动作', async () => {
    const f = formal({ retainThrows: true }), reason = await f.run(); expect(originalCause(reason)).toBe(f.stop); const before = f.calls.length; f.clearNotificationFailure(); await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before); expect(f.retained()).toBe(false);
  });
});

describe('结构及数据复制正式入口持续绑定本轮身份', () => {
  it('正常对照等待严格预检close后进入原建库表单', async () => {
    const f = formal(); const reason = await f.run(); expect(f.submissions).toHaveLength(1); expect(f.submissions[0]['主机地址']).toBe('192.168.31.200'); expect(f.submissions[0]['用户名']).toBe('合成账号'); expect(f.calls.indexOf('transport-close')).toBeLessThan(f.calls.indexOf('database-submit')); expect(reason.cause).toBe(f.stop);
  });
  it.each(['helper凭据', 'helper目标', 'raw和helper一致变化', '表单等待后凭据'] as const)('独审原红例：%s在建库提交前停链', async drift => {
    const f = formal({ drift }); await f.run(); expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false);
  });
  it.each(['missingNative', 'missingStream', 'closeUnknown', 'queryUnknown', 'afterAbsence', 'replacePage'] as const)('%s未知不进入建库且不退出清库', async flag => {
    const f = formal({ [flag]: true }); await f.run(); expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false);
  });
  it('原生QUIT回调早于close，等待期间零表单提交', async () => {
    const f = formal({ holdClose: true }); const pending = f.run(); for (let index = 0; index < 50 && !f.waitingClose(); index++) await Promise.resolve(); expect(f.waitingClose()).toBe(true); expect(f.submissions).toEqual([]); f.releaseClose(); await pending; expect(f.submissions).toHaveLength(1);
  });
  it('原生close等待期间凭据漂移，close完成后仍不得重绑定建库', async () => {
    const f = formal({ holdClose: true }); const pending = f.run(); for (let index = 0; index < 50 && !f.waitingClose(); index++) await Promise.resolve(); expect(f.waitingClose()).toBe(true); f.helper.DBARK_TEST_PASSWORD = '合成等待期变化'; f.releaseClose(); await pending; expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true); expect(f.calls).not.toContain('exit');
  });
  it('用例超时而close仍待定，afterEach先保留；迟到完成不能建库或自动退出', async () => {
    const f = formal({ holdClose: true }); const pending = f.run(); for (let index = 0; index < 50 && !f.waitingClose(); index++) await Promise.resolve(); await expect(f.after()).rejects.toThrow('仍活动'); expect(f.retained()).toBe(true); f.releaseClose(); await pending; expect(f.submissions).toEqual([]); expect(f.calls).not.toContain('exit');
  });
  it('注册后原始配置变化，首次观察连接之前拒绝', async () => {
    const f = formal(); f.raw.DBARK_TEST_EXPECTED_SERVER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; await f.run(); expect(f.targets).toEqual([]); expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true);
  });
  it('原表单完成前最后一个等待发生漂移，源表DDL仍为零', async () => {
    const f = formal({ beforeSource: true, afterForm: true }); await f.run(); expect(f.submissions).toHaveLength(1); expect(f.calls.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([]); expect(f.calls).not.toContain('exit'); expect(f.retained()).toBe(true);
  });
  it.each([{ version: '8.0.46' }, { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { os: 'Win64' }, { names: null }])('事实%s不准确先严格close再拒绝DDL', async facts => {
    const f = formal({ facts }); await f.run(); expect(f.submissions).toEqual([]); expect(f.calls).toContain('transport-close'); expect(f.calls).not.toContain('exit');
  });
  it('观察DDL未知及保留失败均不能覆盖原首因或继续清库', async () => {
    const f = formal({ beforeSource: true, retainThrows: true }); const reason = await f.run(); expect(reason.cause).toBe(f.sourceStop); expect(f.calls.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false);
  });
});

describe('结构及数据复制注册身份不能回填或重绑定', () => {
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('拒绝继承的%s', key => {
    const values = environment(), raw = Object.assign(Object.create({ [key]: values[key] }), values); delete raw[key]; expect(() => bindTableCopyDataTarget(() => raw, values)).toThrow();
  });
  it('保留显式空密码，所有字段及自有属性变化后永久失效', () => {
    for (const key of Object.keys(environment())) { const raw = environment(), helper = { ...raw }, binding = bindTableCopyDataTarget(() => raw, helper); expect(binding.target.password).toBe(''); const old = raw[key]; raw[key] = helper[key] = '合成变化'; expect(() => binding.assertCurrent()).toThrow(); raw[key] = helper[key] = old; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('原始或helper自有属性丢失，即便回落到相同原型值也拒绝', () => {
    for (const side of ['raw', 'helper'] as const) {
      const raw = environment(), helper = { ...raw }, binding = bindTableCopyDataTarget(() => raw, helper), value = side === 'raw' ? raw : helper;
      Object.setPrototypeOf(value, { DBARK_TEST_PASSWORD: '' }); delete value.DBARK_TEST_PASSWORD; expect(() => binding.assertCurrent()).toThrow();
    }
  });
});

/** 提取真实专属清理，不导入桌面；任务、退出及观察结果分别作为RAM边界。 */
function cleanupCase(change: { pending?: boolean; exitUnknown?: boolean; dropUnknown?: boolean; closeUnknown?: boolean; driftAfterExit?: boolean; wrongName?: boolean; notificationUnknown?: boolean; primary?: unknown } = {}) {
  const tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true);
  const body = tree.statements.filter(node => ts.isFunctionDeclaration(node) && ['cleanupDataCase', 'closeDataObserver'].includes(node.name?.text ?? '')).map(node => node.getText(tree)).join('\n');
  const calls: string[] = []; let closed = false, retained = false, identity = true;
  const own = (allowClosed = false) => { if (!identity || retained || closed && !allowClosed) throw Error('合成归属失效'); return { page: { evaluate: async () => { calls.push('tasks'); return [{ kind: 'schema.tableCopyData.apply', status: change.pending ? 'running' : 'completed' }]; } } }; };
  const stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { queueMicrotask(() => { callback(); stream.closed = true; calls.push('close'); stream.emit('close'); }); }, destroy() { stream.closed = true; stream.emit('close'); } });
  const observer = { connection: Object.assign(new EventEmitter(), { stream, end(callback: (reason?: Error) => void) { queueMicrotask(() => callback(change.closeUnknown ? Error('合成关闭未知') : undefined)); }, destroy() { stream.destroy(); } }), query: async (sql: string) => { calls.push(sql.startsWith('DROP') ? 'drop' : 'absent'); if (change.dropUnknown && sql.startsWith('DROP')) throw Error('合成DROP未知'); return [[]]; } };
  const context = { exports: {}, expect, closeMysqlConnection, retainOwnedDesktopResources() { if (change.notificationUnknown) throw Error('合成通知失败'); retained = true; calls.push('retain'); }, confirmOwnedDesktopExit: async () => { calls.push('exit'); if (change.exitUnknown) throw Error('合成退出未知'); closed = true; if (change.driftAfterExit) identity = false; } };
  const vm = createContext(context); runInContext(compile(body + '\nglobalThis.cleanup=cleanupDataCase;'), vm);
  return { calls, after: () => own(true), run: () => (vm.cleanup as Function)({}, own, () => { retained = true; calls.push('retain'); if (change.notificationUnknown) throw Error('合成通知失败'); }, observer, change.wrongName ? 'unowned' : 'dbark_copy_' + uuid.replaceAll('-', ''), true, change.primary === undefined ? undefined : { reason: change.primary }) };
}

describe('结构及数据复制专属收尾只沿已证明事实推进', () => {
  it('清理阶段首次拒绝也须走本例保留入口，通知抛错不替换任务首因', async () => {
    const f = cleanupCase({ pending: true, notificationUnknown: true }); await expect(f.run()).rejects.toThrow('未确认终态'); expect(() => f.after()).toThrow('归属失效'); expect(f.calls).toEqual(['tasks', 'retain']);
  });
  it('正常清理严格按任务终态、所属退出、DROP、核缺席、原生close顺序', async () => {
    const f = cleanupCase(); await f.run(); expect(f.calls).toEqual(['tasks', 'exit', 'drop', 'absent', 'close']);
  });
  it.each(['pending', 'exitUnknown', 'driftAfterExit', 'wrongName'] as const)('%s阻止DROP及后续观察', async flag => {
    const f = cleanupCase({ [flag]: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('drop'); expect(f.calls).not.toContain('close'); expect(f.calls).toContain('retain');
  });
  it('DROP未知不重试、不核缺席、不继续close，保留原首因', async () => {
    const primary = Error('合成UI首因'), f = cleanupCase({ dropUnknown: true, primary }); const reason = await f.run().catch((value: any) => value); expect(reason.cause).toBe(primary); expect(reason.errors[0]).toBe(primary); expect(f.calls.filter(value => value === 'drop')).toHaveLength(1); expect(f.calls).not.toContain('absent'); expect(f.calls).not.toContain('close');
  });
  it('最后严格close失败不能报告清理成功或重新清库', async () => {
    const f = cleanupCase({ closeUnknown: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls.filter(value => value === 'drop')).toHaveLength(1); expect(f.calls).toContain('retain');
  });
});
