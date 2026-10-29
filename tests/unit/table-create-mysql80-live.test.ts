import { sidebarMenuRamPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as preparation from '../helpers/tableCreateMysql80Preparation';
import { tableCreateMysql80FactSql, tableCreateMysql80ObservedFacts } from '../helpers/tableCreateMysql80Adapter';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';

const uuid = '11111111-2222-3333-4444-555555555555';
interface Options { raw?: Record<string, string | undefined>; helper?: Record<string, string | undefined>; facts?: Record<string, unknown>; fallback?: boolean; readUnknown?: boolean; closeUnknown?: boolean; ownerLost?: boolean; previewExists?: boolean; applyCount?: number; taskStatus?: string; taskReadUnknown?: boolean; missingRefresh?: boolean; collapsed?: boolean; exitUnknown?: boolean; }
/** 整个生产register和原isolatedDatabase均执行；DOM/驱动只是RAM端口，不是GUI或数据库验收。 */
function harness(options: Options = {}) {
  const source = readFileSync(new URL('../e2e/table-create-mysql80-live.ts', import.meta.url), 'utf8'), helperSource = readFileSync(new URL('../e2e/live-helpers.ts', import.meta.url), 'utf8');
  const isolated = helperSource.slice(helperSource.indexOf('export async function isolatedDatabase'), helperSource.indexOf('/** 选中数据库节点后通过对象树新建查询'));
  const raw: Record<string, string | undefined> = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13380', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid, ...options.raw };
  for (const name of Object.keys(raw)) if (raw[name] === undefined) delete raw[name];
  const environment = { ...raw, ...options.helper }, calls: string[] = [], info = {}, state = { retained: false, lost: false, applied: false, expanded: false, confirmation: '', dialogClosed: false, database: '' };
  let callback: Function | undefined, after: Function | undefined;
  const facts = () => [{ version: '8.0.46', os: 'Linux', names: 0, uuid, ...options.facts }];
  const tasks = () => state.applied ? Array.from({ length: options.applyCount ?? 1 }, () => ({ kind: 'schema.tableCreate.apply', status: options.taskStatus ?? 'completed' })) : [];
  class Locator {
    constructor(readonly path = '', readonly name: unknown = '') {}
    locator(value: string) { return new Locator(this.path + '/' + value); }
    filter(_value: unknown) { return this; }
    getByRole(role: string, value: { name?: unknown } = {}) { return new Locator(this.path + '/' + role, value.name); }
    getByLabel(name: string, _value?: unknown) { return new Locator(this.path + '/label', name); }
    getByText(name: string, _value?: unknown) { return new Locator('refresh-target', name); }
    async focus() { calls.push('focus'); }
    async fill(value: string) { if (this.name === text.confirmation) state.confirmation = value; }
    async check() {}
    async uncheck() {}
    async click() {
      if (this.name === state.database && this.path.includes('database-row')) { calls.push('db-expand'); state.expanded = !options.collapsed; }
      if (this.name === text.apply) { calls.push('apply'); state.applied = true; }
      if (this.name === text.close) state.dialogClosed = true;
    }
  }
  const page = { locator: (value: string) => new Locator(value), getByRole: (role: string, value?: { name?: unknown }) => new Locator().getByRole(role, value), evaluate: async (_callback: unknown) => { calls.push('tasks-read'); if (options.taskReadUnknown && state.applied) throw Error('合成任务读取未知'); return tasks(); } };
  const resource = { page, application: {}, closed: false };
  const owned = (value: unknown) => { expect(value).toBe(info); if (state.retained || state.lost) throw Error('合成归属未知'); return resource; };
  const retain = () => { calls.push('retain'); state.retained = true; };
  const uiExpect = (value: unknown) => value instanceof Locator ? {
    async toContainText(expected: string) { expect(expected).toBe('CREATE TABLE'); calls.push('preview-ddl'); },
    async toHaveAttribute(name: string, expected: string) { calls.push('assert-expanded'); expect(name).toBe('aria-expanded'); expect(String(state.expanded)).toBe(expected); },
    async toBeDisabled() { expect(state.applied || state.confirmation.endsWith(' ')).toBe(true); },
    async toHaveText(expected: string) { expect(state.applied).toBe(true); expect(expected).toBe(text.succeeded); },
    async toHaveCount(expected: number) { expect(state.dialogClosed ? 0 : 1).toBe(expected); },
    async toBeVisible() { calls.push('assert-refresh'); expect(value.name).toBe('daily_new_table'); expect(!options.missingRefresh).toBe(true); },
  } : expect(value);
  const observer = { query: async (statement: string | { sql: string }) => {
    const sql = typeof statement === 'string' ? statement : statement.sql;
    if (sql === tableCreateMysql80FactSql) { calls.push('isolation-facts'); return [facts()]; }
    if (sql.startsWith('SELECT TABLE_NAME')) { calls.push('preview-absent'); return [options.previewExists ? [{ TABLE_NAME: 'daily_new_table' }] : []]; }
    if (sql.startsWith('SELECT COLUMN_NAME')) return [[{ COLUMN_NAME: 'id', COLUMN_DEFAULT: null }, { COLUMN_NAME: 'amount', COLUMN_DEFAULT: '123456789012345678.123456789012' }]];
    if (sql.startsWith('SELECT INDEX_NAME')) return [[{ INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0 }, { INDEX_NAME: 'uq_amount', NON_UNIQUE: 0 }]];
    calls.push(sql.startsWith('DROP') ? 'drop-database' : 'remaining'); return [[]];
  }, end: async () => { calls.push('observer-end'); } };
  const globals = { exports: {} as Record<string, unknown>, expect: uiExpect, environment, mysql: { createConnection: async () => { calls.push('isolation-observer'); return observer; } }, preservesUnconfirmedExit: () => true, ownedDesktopResources: owned, retainOwnedDesktopResources: retain, tlsCertificate: () => undefined, randomUUID: () => uuid, pageErrors: [], connectAndCreate: async (database: string) => { state.database = database; calls.push('create-database'); return { database, connectionId: '合成连接', connectionName: '合成连接' }; }, confirmOwnedDesktopExit: async () => { calls.push('exit'); if (options.exitUnknown) throw Error('合成退出未知'); resource.closed = true; } };
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true };
  runInContext(ts.transpileModule(isolated, { compilerOptions }).outputText, createContext(globals));
  const test = Object.assign((_name: string, body: Function) => { callback = body; }, { use: vi.fn(), afterEach: (body: Function) => { after = body; } });
  const context = createContext({ exports: {} as Record<string, Function>, process: { env: raw }, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
    if (name === 'node:fs') return { existsSync: () => options.fallback ?? false };
    if (name === './desktop-fixture') return { test, expect: uiExpect, ownedDesktopResources: owned, retainOwnedDesktopResources: retain };
    if (name === './live-helpers') { calls.push('load-helper'); return { environment, isolatedDatabase: globals.exports.isolatedDatabase }; }
    if (name === '../helpers/tableCreateMysql80Preparation') return preparation;
    if (name === '../helpers/tableCreateMysql80Adapter') return { tableCreateMysql80FactSql, tableCreateMysql80ObservedFacts, tableCreateMysql80PreparationPorts: (owner: any) => ({ ...owner, openReadonly: async () => {
      calls.push('readonly-open'); return { readFacts: async () => { calls.push('readonly-facts'); if (options.readUnknown) throw Error('合成读取未知'); if (options.ownerLost) state.lost = true; return tableCreateMysql80ObservedFacts(facts()); }, closeStrict: async () => { calls.push('readonly-strict-close'); if (options.closeUnknown) throw Error('合成关闭未知'); } };
    } }) };
    if (name.endsWith('/zh-CN')) return { zh, formatText };
    if (name.endsWith('/tableCreate.zh-CN')) return { tableCreateZh: text };
    throw Error('不允许实际导入：' + name);
  } });
  runInContext(ts.transpileModule(source, { compilerOptions }).outputText, context);
  return { calls, state, run: async () => { context.exports.registerTableCreateMysql80UiTests(); await callback!({}, info); }, checkAfter: async () => { await after!({}, info); } };
}

describe('8.0.46生产正式回调及隔离前置（纯RAM）', () => {
  it('精确预检严格关闭后才建库，展开前置和Root三处断言实际执行', async () => {
    const f = harness(); await f.run(); await f.checkAfter();
    expect(f.calls.indexOf('readonly-strict-close')).toBeLessThan(f.calls.indexOf('create-database'));
    expect(f.calls.indexOf('db-expand')).toBeLessThan(f.calls.indexOf('assert-expanded'));
    expect(f.calls.indexOf('assert-expanded')).toBeLessThan(f.calls.indexOf('preview-ddl'));
    expect(f.calls.indexOf('preview-absent')).toBeLessThan(f.calls.indexOf('apply'));
    expect(f.calls.filter(value => value === 'apply')).toHaveLength(1); expect(f.calls).toContain('assert-refresh');
    expect(f.calls.indexOf('exit')).toBeLessThan(f.calls.indexOf('drop-database')); expect(f.calls.at(-1)).toBe('observer-end');
  });
  it.each([{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { version: '8.0.47' }, { version: '8.4.11' }, { os: 'Win64' }, { names: 1 }])('事实%s不符时在任何隔离DDL前拒绝并关闭只读连接', async facts => {
    const f = harness({ facts }); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('readonly-strict-close'); expect(f.calls).not.toContain('create-database'); expect(f.calls).not.toContain('drop-database');
  });
  it.each([{ readUnknown: true }, { closeUnknown: true }, { ownerLost: true }])('预检未知%s保留并停止，不进入共享隔离链', async options => {
    const f = harness(options); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain'); expect(f.calls).not.toContain('create-database');
  });
  it.each([{ raw: { DBARK_TEST_USER: undefined }, helper: { DBARK_TEST_USER: '合成回填' } }, { raw: { DBARK_TEST_PASSWORD: undefined }, helper: { DBARK_TEST_PASSWORD: '合成回填' } }, { helper: { DBARK_TEST_PASSWORD: '另一合成密码' } }, { fallback: true }])('缺失/替换/文件回填%s不创建连接或隔离库', async options => {
    const f = harness(options); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('readonly-open'); expect(f.calls).not.toContain('create-database');
  });
  it('预览已产生目标时只读断言阻止apply', async () => {
    const f = harness({ previewExists: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('apply');
  });
  it('库节点仍折叠时展开断言阻止后续创建流程', async () => {
    const f = harness({ collapsed: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('apply');
  });
  it('两个apply时不能以成功提示代单次断言', async () => {
    const f = harness({ applyCount: 2 }); await expect(f.run()).rejects.toThrow(); expect(f.calls).not.toContain('assert-refresh');
  });
  it('原连接树未出现准确新表时刷新断言失败', async () => {
    const f = harness({ missingRefresh: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('assert-refresh');
  });
  it.each(['running', 'failed', 'cancelled', 'unknown'])('apply终态%s未知或失败时保留，不借退出/DROP继续', async taskStatus => {
    const f = harness({ taskStatus }); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain'); expect(f.calls).not.toContain('exit'); expect(f.calls).not.toContain('drop-database');
  });
  it('任务读取未知保留，不以成功提示或取消响应代终态', async () => {
    const f = harness({ taskReadUnknown: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain'); expect(f.calls).not.toContain('exit'); expect(f.calls).not.toContain('drop-database');
  });
  it('实际退出未知不继续清库或关闭观察连接', async () => {
    const f = harness({ exitUnknown: true }); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain'); expect(f.calls).not.toContain('drop-database'); expect(f.calls).not.toContain('observer-end');
  });
});
