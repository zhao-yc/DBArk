import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { closeMysqlConnection } from '../../src/engine/connection';

import { bindTableCreateMariaTarget, assertMariaCreateFacts, mariaCreateFactSql, type MariaCreateVersion } from '../helpers/tableCreateMariaTarget';
const bind = (raw: () => Record<string, string | undefined>, helper: Record<string, string | undefined>) => bindTableCreateMariaTarget('10.11.19', raw, helper);
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

const uuid = '11111111-2222-3333-4444-555555555555';
const environment = (version: MariaCreateVersion = '10.11.19'): Record<string, string | undefined> => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: version === '10.11.19' ? '13310' : '13311', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: '合成Maria主机', DBARK_TEST_EXPECTED_SERVER_ID: '27' });
const source = readFileSync(new URL('../e2e/table-create-mariadb-live.ts', import.meta.url), 'utf8');
const compile = (value: string) => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
type Drift = 'helper凭据' | 'helper目标' | 'raw和helper一致变化' | '表单等待后凭据';
type Changes = { serverPort?: number; changedServerPort?: number; version?: MariaCreateVersion; swapStream?: boolean; tableUnknown?: boolean; drift?: Drift; facts?: Record<string, unknown>; missingNative?: boolean; missingStream?: boolean; closeUnknown?: boolean; holdClose?: boolean; queryUnknown?: boolean; afterAbsence?: boolean; beforeSource?: boolean; afterForm?: boolean; replacePage?: boolean; retainThrows?: boolean; completeBody?: boolean; engineSupport?: string; charset?: string; taskPending?: boolean; exitUnknown?: boolean; dropUnknown?: boolean; closeAtEndUnknown?: boolean };

/** 执行正式注册函数和原建库表单，仅替换驱动/桌面端口；没有真实连接、认证文件或GUI。 */
function formal(changes: Changes = {}) {
  const raw = environment(changes.version), helper = { ...raw }, calls: string[] = [], submissions: Record<string, string>[] = [], filled: Record<string, string> = {}, targets: Record<string, unknown>[] = [], cases: Function[] = [];
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
    if (key === 'then') return undefined;
    if (key === '__locator') return true;
    if (key === '__label') return label;
    if (['getByRole', 'getByLabel', 'getByText'].includes(String(key))) return (name: string, options?: { name: string }) => locator(key === 'getByRole' ? options?.name ?? name : name);
    if (key === 'fill') return async (value: string) => { filled[label] = value; calls.push('fill:' + label); if (changes.drift === '表单等待后凭据' && label === '主机地址') mutate(); };
    if (key === 'click' || key === 'dblclick') return async () => { if (label === '执行建库') { calls.push('database-submit'); submissions.push({ ...filled }); if (!changes.beforeSource && !changes.completeBody) throw stop; } if (label === text.apply) { calls.push('table-submit'); if (changes.tableUnknown) throw sourceStop; } };
    if (['focus', 'check', 'uncheck', 'selectOption'].includes(String(key))) return async () => {};
    return () => locator(label);
  } });
  const page = { locator: () => locator(), getByRole: (_name: string, options: { name: string }) => locator(options.name), evaluate: async (callback: Function) => callback.toString().includes('tasks.list') ? changes.completeBody ? [{ kind: 'schema.databaseCreate.apply', status: 'completed' }, { kind: 'schema.tableCreate.apply', status: changes.taskPending ? 'running' : 'completed' }] : [] : [{ name: 'E2E dbark_create_' + uuid.replaceAll('-', ''), id: '合成连接' }] };
  const own = (value: unknown) => { expect(value).toBe(info); if (retained) throw Error('合成归属已保留'); return { page: replacePage ? {} : page, application, closed }; };
  // 注入通知在共享状态落定之前失败；不能用先写retained的替身掩盖本地锁缺失。
  const retain = () => { calls.push('retain'); if (changes.retainThrows) throw Error('合成保留失败'); retained = true; };
  const actualExpect = (value: any) => value?.__locator ? new Proxy({}, { get: () => async () => { if (changes.afterForm && value.__label === 'dbark_create_' + uuid.replaceAll('-', '')) mutate(); } }) : expect(value);
  const helperSource = readFileSync(new URL('../e2e/live-helpers.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('helper.ts', helperSource, ts.ScriptTarget.Latest, true);
  const helperBody = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'connectAndCreate')!.getText(tree);
  const helperContext = { exports: {} as Record<string, Function>, environment: helper, expect: actualExpect, configureTls: async (_form: unknown, owner: { assertCurrent(): void }) => owner.assertCurrent(), databaseText: { charset: '字符集', collation: '排序规则', preview: '建库预览', confirmation: '建库确认', ackDdl: '风险一', ackCreate: '风险二', apply: '执行建库', succeeded: '成功' } };
  runInContext(compile(helperBody), createContext(helperContext));
  const createConnection = async (options: Record<string, unknown>) => {
    const index = ++connectionCount; calls.push('connect'); targets.push(options); expect(options).not.toHaveProperty('database');
    const stream = Object.assign(new EventEmitter(), { closed: false, end(callback: () => void) { calls.push('flush'); queueMicrotask(() => { callback(); const close = () => { stream.closed = true; calls.push('transport-close'); stream.emit('close'); if (changes.swapStream) native.stream = { ...stream } as typeof stream; }; if (changes.holdClose && index === 1) finishClose = close; else close(); }); }, destroy() { stream.closed = true; stream.emit('close'); } });
    const native = Object.assign(new EventEmitter(), { stream, end(callback: (reason?: Error) => void) { calls.push('quit'); queueMicrotask(() => callback(changes.closeUnknown || changes.closeAtEndUnknown && index > 1 ? Error('合成原生关闭失败') : undefined)); }, destroy() { stream.destroy(); } });
    return { connection: changes.missingNative ? undefined : changes.missingStream ? { ...native, stream: undefined } : native, query: async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('SELECT @@version')) {
        if (changes.queryUnknown) throw sourceStop;
        if (changes.drift && changes.drift !== '表单等待后凭据') mutate();
        if (changes.replacePage) replacePage = true;
        return [[{ version: (changes.version ?? '10.11.19') + '-MariaDB', os: 'Linux', names: 0, hostname: '合成Maria主机', serverPort: index > 1 && changes.changedServerPort !== undefined ? changes.changedServerPort : changes.serverPort ?? Number(raw.DBARK_TEST_PORT), serverId: 27, mode: 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', autocommit: 1, innodbStrict: 1, quoteShowCreate: 1, ...changes.facts }]];
      }
      if (sql.startsWith('SELECT ENGINE AS engine')) return [[{ engine: 'InnoDB', support: changes.engineSupport ?? 'DEFAULT' }]];
      if (sql.startsWith('SELECT CHARACTER_SET_NAME AS charset')) return [[{ charset: changes.charset ?? 'utf8mb4' }]];
      if (sql.startsWith('SELECT SCHEMA_NAME')) { if (changes.afterAbsence) mutate(); return [[]]; }
      if (sql.startsWith('CREATE TABLE')) { throw sourceStop; }
      if (changes.completeBody) {
        if (sql.startsWith('SELECT TABLE_NAME') || sql.startsWith('SELECT 1 FROM')) return [[]];
        if (sql.startsWith('SELECT COLUMN_NAME')) return [[{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' }, { COLUMN_NAME: 'literal_null', COLUMN_TYPE: 'varchar(64)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: "'NULL'", EXTRA: '' }, { COLUMN_NAME: 'note', COLUMN_TYPE: 'varchar(64)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: "'普通默认'", EXTRA: '' }]];
        if (sql.startsWith('SELECT INDEX_NAME')) return [[{ INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'id', SEQ_IN_INDEX: 1 }, { INDEX_NAME: 'ix_note', NON_UNIQUE: 1, COLUMN_NAME: 'note', SEQ_IN_INDEX: 1 }, { INDEX_NAME: 'ix_note', NON_UNIQUE: 1, COLUMN_NAME: 'id', SEQ_IN_INDEX: 2 }, { INDEX_NAME: 'uq_literal', NON_UNIQUE: 0, COLUMN_NAME: 'literal_null', SEQ_IN_INDEX: 1 }]];
        if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': "CREATE TABLE `daily_new_table` (`id` int(11) NOT NULL,`literal_null` varchar(64) DEFAULT 'NULL',`note` varchar(64) DEFAULT '普通默认',PRIMARY KEY (`id`),UNIQUE KEY `uq_literal` (`literal_null`),KEY `ix_note` (`note`,`id`)) ENGINE=InnoDB" }]];
        if (sql.startsWith('DROP DATABASE')) { if (changes.dropUnknown) throw sourceStop; return [{}]; }
      }
      throw Error('拒绝未声明观察SQL');
    }, end: async () => { calls.push('promise-end'); } };
  };
  const test = Object.assign((_name: string, body: Function) => cases.push(body), { use: vi.fn(), setTimeout: vi.fn(), describe: { configure: vi.fn() }, afterEach: (callback: Function) => { after = callback; } });
  const context = { exports: {} as Record<string, Function>, process: { env: raw }, require(name: string) {
    if (name === './desktop-fixture') return { test, expect: actualExpect, ownedDesktopResources: own, retainOwnedDesktopResources: retain, confirmOwnedDesktopExit: async () => { calls.push('exit'); if (changes.exitUnknown) throw Error('合成退出未知'); closed = true; } };
    if (name === 'node:crypto') return { randomUUID: () => uuid };
    if (name === 'mysql2/promise') return { __esModule: true, default: { createConnection } };
    if (name === '../../src/engine/connection') return { closeMysqlConnection };
    if (name === './live-helpers') return { environment: helper, connectAndCreate: helperContext.exports.connectAndCreate };

    if (name === '../helpers/tableCreateMariaTarget') return { bindTableCreateMariaTarget, assertMariaCreateFacts, mariaCreateFactSql };
    if (name.endsWith('/tableCreate.zh-CN')) return { tableCreateZh: text };
    if (name.endsWith('/zh-CN')) return { zh, formatText };
    throw Error('拒绝实际导入：' + name);
  } };
  runInContext(compile(source), createContext(context)); context.exports.registerTableCreateMariaUiTests(changes.version ?? '10.11.19');
  return { calls, submissions, targets, stop, sourceStop, raw, helper, clearNotificationFailure: () => { changes.retainThrows = false; }, after: () => after({}, info), run: async () => { try { await cases[0]({}, info); } catch (reason) { return reason as any; } }, retained: () => retained, releaseClose: () => { expect(finishClose).toBeDefined(); finishClose!(); }, waitingClose: () => !!finishClose };
}

/** 聚合收尾可有多层cause；最初请求错误必须保持原对象，不能被通知异常替换。 */
function originalCause(reason: any): unknown { const seen = new Set(); while (reason && Object.hasOwn(reason, 'cause') && !seen.has(reason)) { seen.add(reason); expect(reason.errors[0]).toBe(reason.cause); reason = reason.cause; } return reason; }

describe('保留通知设置前失败也必须本地停链（真实注册函数，仅RAM）', () => {
  it('独审反例：预检观察未知加通知设置前异常，禁止退出及任何后续清理', async () => {
    const f = formal({ queryUnknown: true, retainThrows: true }), reason = await f.run(); expect(originalCause(reason)).toBe(f.sourceStop); expect(f.retained()).toBe(false); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false); expect(f.calls).not.toContain('quit');
    const before = f.calls.length; await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before);
  });
  it('独审反例：原建库提交未知加通知设置前异常，不能用空任务列表放行DROP', async () => {
    const f = formal({ retainThrows: true }), reason = await f.run(); expect(originalCause(reason)).toBe(f.stop); expect(f.submissions).toHaveLength(1); expect(f.retained()).toBe(false); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false);
    const before = f.calls.length; await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before);
  });
  it('活动超时先本地保留，通知异常及迟到close都不能重新建库', async () => {
    const f = formal({ holdClose: true, retainThrows: true }), pending = f.run(); for (let index = 0; index < 50 && !f.waitingClose(); index++) await Promise.resolve(); expect(f.waitingClose()).toBe(true); await expect(f.after()).rejects.toThrow('仍活动'); f.releaseClose(); await pending; expect(f.submissions).toEqual([]); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false); await expect(f.after()).rejects.toThrow('保留');
  });
  it('通知能力恢复也不能清除本例永久保留标记或重试通知', async () => {
    const f = formal({ retainThrows: true }); const reason = await f.run(); expect(originalCause(reason)).toBe(f.stop); const before = f.calls.length; f.clearNotificationFailure(); await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before); expect(f.retained()).toBe(false);
  });
});

describe('准确Maria正式入口主体及隔离收尾（真实注册函数，仅RAM）', () => {
  it.each(['10.11.19', '11.4.13'] as const)('%s完整走原表单、普通和唯一索引、一次apply及独立目录后核，严格退出再清理', async version => {
    const f = formal({ completeBody: true, version }); expect(await f.run()).toBeUndefined(); await expect(f.after()).resolves.toBeUndefined(); expect(f.submissions).toHaveLength(1); expect(f.calls.filter(call => call === 'table-submit')).toHaveLength(1); expect(f.calls.filter(call => call.startsWith('DROP DATABASE'))).toHaveLength(1); expect(f.calls.filter(call => call === 'quit')).toHaveLength(2); expect(f.calls.indexOf('transport-close')).toBeLessThan(f.calls.indexOf('database-submit')); expect(f.calls.indexOf('exit')).toBeLessThan(f.calls.findIndex(call => call.startsWith('DROP DATABASE'))); expect(f.calls.some(call => /information_schema_stats_expiry|sql_generate_invisible_primary_key|sql_require_primary_key/i.test(call))).toBe(false);
  });
  it.each([{ facts: { version: '10.11.18-MariaDB' } }, { facts: { autocommit: undefined } }, { facts: { innodbStrict: 0 } }, { engineSupport: 'NO' }, { charset: 'made_up' }])('实际Maria能力%s不可靠则隔离DDL之前拒绝', async change => {
    const f = formal(change); expect(await f.run()).toBeDefined(); expect(f.submissions).toEqual([]); expect(f.calls).not.toContain('exit'); expect(f.calls.some(call => call.startsWith('DROP DATABASE'))).toBe(false);
  });
  it('清理阶段任务未终态且通知落定前失败，也不能退出或DROP', async () => {
    const f = formal({ completeBody: true, taskPending: true, retainThrows: true }); const reason = await f.run(); expect(reason.message).toContain('未确认终态'); expect(f.retained()).toBe(false); expect(f.calls).not.toContain('exit'); expect(f.calls.some(call => call.startsWith('DROP DATABASE'))).toBe(false); await expect(f.after()).rejects.toThrow('保留');
  });
  it('所属退出未知不能继续清库', async () => {
    const f = formal({ completeBody: true, exitUnknown: true }); expect((await f.run()).message).toContain('退出未知'); expect(f.calls.filter(call => call === 'exit')).toHaveLength(1); expect(f.calls.some(call => call.startsWith('DROP DATABASE'))).toBe(false); await expect(f.after()).rejects.toThrow('保留');
  });
  it('DROP未知不重试、不核缺席或继续关闭观察连接', async () => {
    const f = formal({ completeBody: true, dropUnknown: true }); expect(await f.run()).toBe(f.sourceStop); expect(f.calls.filter(call => call.startsWith('DROP DATABASE'))).toHaveLength(1); expect(f.calls.filter(call => call.startsWith('SELECT SCHEMA_NAME'))).toHaveLength(1); expect(f.calls.filter(call => call === 'quit')).toHaveLength(1); await expect(f.after()).rejects.toThrow('保留');
  });
  it('最后观察连接严格关闭未知不能以已有closed或空目录恢复许可', async () => {
    const f = formal({ completeBody: true, closeAtEndUnknown: true }); expect(await f.run()).toBeDefined(); expect(f.calls.filter(call => call.startsWith('DROP DATABASE'))).toHaveLength(1); expect(f.calls.filter(call => call === 'quit')).toHaveLength(2); const before = f.calls.length; await expect(f.after()).rejects.toThrow('保留'); expect(f.calls).toHaveLength(before);
  });
});

describe('Maria新建表正式入口持续绑定本轮身份', () => {
  it('正常对照等待严格预检close后进入原建库表单', async () => {
    const f = formal(); const reason = await f.run(); expect(f.submissions).toHaveLength(1); expect(f.submissions[0]['主机地址']).toBe('192.168.31.200'); expect(f.submissions[0]['用户名']).toBe('合成账号'); expect(f.calls.indexOf('transport-close')).toBeLessThan(f.calls.indexOf('database-submit')); expect(reason.cause).toBe(f.stop);
  });
  it.each(['helper凭据', 'helper目标', 'raw和helper一致变化', '表单等待后凭据'] as const)('固定身份反例：%s在建库提交前停链', async drift => {
    const f = formal({ drift }); await f.run(); expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true); expect(f.calls).not.toContain('exit'); expect(f.calls.some(sql => sql.startsWith('DROP'))).toBe(false);
  });
  it.each(['missingNative', 'missingStream', 'swapStream', 'closeUnknown', 'queryUnknown', 'afterAbsence', 'replacePage'] as const)('%s未知不进入建库且不退出清库', async flag => {
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
    const f = formal(); f.raw.DBARK_TEST_EXPECTED_SERVER_HOSTNAME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; await f.run(); expect(f.targets).toEqual([]); expect(f.submissions).toEqual([]); expect(f.retained()).toBe(true);
  });
  it('原表单完成前最后一个等待发生漂移，源表DDL仍为零', async () => {
    const f = formal({ beforeSource: true, afterForm: true }); await f.run(); expect(f.submissions).toHaveLength(1); expect(f.calls.filter(sql => sql.startsWith('CREATE TABLE'))).toEqual([]); expect(f.calls).not.toContain('exit'); expect(f.retained()).toBe(true);
  });
  it.each([{ version: '8.0.46' }, { serverId: 28 }, { os: 'Win64' }, { names: null }])('事实%s不准确先严格close再拒绝DDL', async facts => {
    const f = formal({ facts }); await f.run(); expect(f.submissions).toEqual([]); expect(f.calls).toContain('transport-close'); expect(f.calls).not.toContain('exit');
  });
});

describe.each([['mariadb1011', '10.11.19'], ['mariadb114', '11.4.13']] as const)('%s正式spec双门及list优先短路', (suffix, version) => {
  const source = readFileSync(new URL('../e2e/table-create-' + suffix + '.spec.ts', import.meta.url), 'utf8');
  for (const listing of ['--list', '--list=json', '实际参数']) for (const first of ['0', '1']) for (const second of ['0', '1']) it(`${listing}双门${first}/${second}只按本用途注册`, () => {
    const reads: string[] = [], modules: string[] = [], register = vi.fn(), skip = vi.fn();
    const raw: Record<string,string|undefined> = { ...environment(version), DBARK_INTEGRATION_ENABLED: first, ['DBARK_TABLE_CREATE_' + suffix.toUpperCase() + '_UI']: second };
    const context = { exports: {}, process: { argv: ['node', 'playwright', ...(listing === '实际参数' ? [] : [listing])], env: new Proxy(raw, { get(object, key: string) { reads.push(key); return object[key]; } }) }, require(name: string) {
      if (name === '@playwright/test') return { test: { skip } }; modules.push(name);
      if (name === '../helpers/tableCreateMariaTarget') return { bindTableCreateMariaTarget };
      if (name === 'node:fs') return { existsSync: () => false };
      if (name === './table-create-mariadb-live') return { registerTableCreateMariaUiTests: register };
      throw Error('拒绝实际导入');
    } };
    runInContext(compile(source), createContext(context));
    if (listing !== '实际参数') { expect(reads).toEqual([]); expect(modules).toEqual([]); }
    expect(register).toHaveBeenCalledTimes(listing === '实际参数' && first === '1' && second === '1' ? 1 : 0);
  });
});

describe('Maria新建表注册身份不能回填或重绑定', () => {
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_HOSTNAME'])('拒绝继承的%s', key => {
    const values = environment(), raw = Object.assign(Object.create({ [key]: values[key] }), values); delete raw[key]; expect(() => bind(() => raw, values)).toThrow();
  });
  it('保留显式空密码，所有字段及自有属性变化后永久失效', () => {
    for (const key of Object.keys(environment())) { const raw = environment(), helper = { ...raw }, binding = bind(() => raw, helper); expect(binding.target.password).toBe(''); const old = raw[key]; raw[key] = helper[key] = '合成变化'; expect(() => binding.assertCurrent()).toThrow(); raw[key] = helper[key] = old; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('原始或helper自有属性丢失，即便回落到相同原型值也拒绝', () => {
    for (const side of ['raw', 'helper'] as const) {
      const raw = environment(), helper = { ...raw }, binding = bind(() => raw, helper), value = side === 'raw' ? raw : helper;
      Object.setPrototypeOf(value, { DBARK_TEST_PASSWORD: '' }); delete value.DBARK_TEST_PASSWORD; expect(() => binding.assertCurrent()).toThrow();
    }
  });
});


it('Maria表DDL提交未知只保留现场，一次提交后不退出、不DROP、不重放', async () => { const f = formal({ completeBody: true, tableUnknown: true, retainThrows: true }); const reason = await f.run(); expect(originalCause(reason)).toBe(f.sourceStop); expect(f.calls.filter(x => x === 'table-submit')).toHaveLength(1); expect(f.calls).not.toContain('exit'); expect(f.calls.some(x => x.startsWith('DROP'))).toBe(false); await expect(f.after()).rejects.toThrow('保留'); });


describe.each(['10.11.19', '11.4.13'] as const)('%s端口映射与真实监听事实', version => {
  it('外部端口固定13310或13311，真实3306同流关闭后可进入原创建链', async () => { const f = formal({ version, serverPort: 3306, completeBody: true }); expect(await f.run()).toBeUndefined(); expect(f.targets.map(x => x.port)).toEqual([version === '10.11.19' ? 13310 : 13311, version === '10.11.19' ? 13310 : 13311]); expect(f.submissions).toHaveLength(1); });
  it('第二连接的真实监听事实变化，不能降级忽略端口而建库', async () => { const f = formal({ version, serverPort: 3306, changedServerPort: 3307, completeBody: true }); expect(await f.run()).toBeDefined(); expect(f.submissions).toEqual([]); expect(f.calls.some(x => x.startsWith('DROP'))).toBe(false); expect(f.calls).not.toContain('exit'); });
});
