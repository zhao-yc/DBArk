import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { parse } from 'csv-parse/sync';
import { describe, expect, it, vi } from 'vitest';
import { bindV027Target, v027Active, v027Build, v027CaseNames, v027CsvColumns, v027CsvInput, v027Lifetime, v027Resources, v027ServerUuid } from '../helpers/v027Acceptance';

const source = (name: string) => readFileSync(new URL('../e2e/' + name, import.meta.url), 'utf8');
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const allowed = (): Record<string, string | undefined> => ({ DBARK_V027_NATIVE_ACCEPTANCE: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_V027_RUN_NONCE: 'a'.repeat(32), DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'RAM用户', DBARK_TEST_PASSWORD: 'RAM口令', DBARK_TEST_EXPECTED_SERVER_UUID: v027ServerUuid, DBARK_V027_PRODUCT_BUILD: v027Build, DBARK_V027_LAUNCH_MANIFEST: 'C:/RAM批准.json', DBARK_V027_LAUNCH_SHA256: 'b'.repeat(64) });

/** VM只登记回调；任何未显式提供的模块加载立即失败，绝不导入真实fixture。 */
function declare(env: Record<string, string | undefined>, argv: string[]) {
  const skipped: unknown[][] = [], register = vi.fn();
  const require = vi.fn((name: string) => {
    if (name === '@playwright/test') return { test: { skip: (...args: unknown[]) => skipped.push(args) } };
    if (name === './v027-native-acceptance-live') return { registerV027Acceptance: register };
    throw Error('声明阶段禁止模块：' + name);
  });
  runInNewContext(compile(source('v027-native-acceptance.spec.ts')), { exports: {}, require, process: { env, argv } });
  return { skipped, register, modules: require.mock.calls.map(call => call[0]) };
}

describe('0.27纯离线入口策略', () => {
  it.each(['--list', '--list=true'])('即使开关已开，%s也完全不读环境、不加载live', arg => {
    const env = new Proxy(allowed(), { get() { throw Error('列表禁止读环境'); } });
    const value = declare(env, [arg]); expect(value.skipped).toHaveLength(2); expect(value.modules).toEqual(['@playwright/test']); expect(value.register).not.toHaveBeenCalled(); expect(v027Active(env, [arg])).toBe(false);
  });
  it('默认路径只读两开关，凭据getter不可触达', () => {
    for (const first of [undefined, '1']) {
      const reads: string[] = [];
      const env = new Proxy({}, { get(_target, name: string) { reads.push(name); if (name === 'DBARK_V027_NATIVE_ACCEPTANCE') return first; if (name === 'DBARK_INTEGRATION_ENABLED') return undefined; throw Error('禁止读取凭据'); } });
      const value = declare(env, []); expect(value.skipped).toHaveLength(2); expect(value.modules).toEqual(['@playwright/test']); expect(reads).toEqual(first ? ['DBARK_V027_NATIVE_ACCEPTANCE', 'DBARK_INTEGRATION_ENABLED'] : ['DBARK_V027_NATIVE_ACCEPTANCE']);
    }
  });
  it('双门仅调用一次登记函数；不执行任何真实回调', () => { const value = declare(allowed(), []); expect(value.skipped).toEqual([]); expect(value.register).toHaveBeenCalledOnce(); });
  it('live登记固定两例、原120秒、串行零重试及全部录制off', () => {
    const callbacks: unknown[] = [], uses: unknown[] = [], configs: unknown[] = [];
    const test = Object.assign((title: string, callback: unknown) => callbacks.push([title, callback]), { use: (value: unknown) => uses.push(value), describe: { configure: (value: unknown) => configs.push(value) }, afterEach: vi.fn() });
    const exports: Record<string, () => void> = {};
    runInNewContext(compile(source('v027-native-acceptance-live.ts')), { exports, require: (name: string) => {
      if (name === './v027-acceptance-fixture') return { test, expect };
      if (name === '../helpers/v027Acceptance') return { v027CaseNames };
      if (name.includes('/locales/')) return {};
      throw Error('登记禁止加载原生模块：' + name);
    } });
    exports.registerV027Acceptance(); expect(callbacks.map((value: any) => value[0])).toEqual(v027CaseNames); expect(uses).toEqual([{ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }]); expect(configs).toEqual([{ mode: 'serial', timeout: 120000, retries: 0 }]);
  });
});

describe('0.27固定目标与原期限', () => {
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_V027_PRODUCT_BUILD', 'DBARK_V027_RUN_NONCE', 'DBARK_V027_LAUNCH_SHA256', 'DBARK_TEST_USER', 'DBARK_V027_LAUNCH_MANIFEST'])('错误%s在资源前拒绝', key => { const env = allowed(); env[key] = ['DBARK_TEST_USER', 'DBARK_V027_LAUNCH_MANIFEST'].includes(key) ? '' : '错误'; expect(() => bindV027Target(() => env)).toThrow(); });
  it('缺少显式口令拒绝；显式空串不推断其它口令', () => { const env = allowed(); delete env.DBARK_TEST_PASSWORD; expect(() => bindV027Target(() => env)).toThrow(); env.DBARK_TEST_PASSWORD = ''; expect(bindV027Target(() => env).target.password).toBe(''); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'dbark_test_password'])('新增%s后即使删除也永久失效', key => { const env = allowed(), binding = bindV027Target(() => env); env[key] = ''; expect(() => binding.assertCurrent()).toThrow(); delete env[key]; expect(() => binding.assertCurrent()).toThrow(); });
  it('原绑定值变化后恢复仍不可复活', () => { const env = allowed(), binding = bindV027Target(() => env); env.DBARK_TEST_PORT = '13385'; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; expect(() => binding.assertCurrent()).toThrow(); });
  it.each(['deadline', 'differentInfo', 'extended', 'timedOut', 'bodyEnd'] as const)('等待中%s后拒绝迟到结果，retain无动作也不能复活', async mode => {
    let now = 1, release!: () => void; const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }; let current = info;
    const life = v027Lifetime(info, { assertCurrent() {} }, () => current, () => {}, () => now);
    const result = life.step(() => new Promise<void>(yes => { release = yes; }));
    if (mode === 'deadline') now = 120000;
    if (mode === 'differentInfo') current = { ...info };
    if (mode === 'extended') info.timeout = 240000;
    if (mode === 'timedOut') info.status = 'timedOut';
    if (mode === 'bodyEnd') life.endBody();
    release(); await expect(result).rejects.toThrow(); now = 1; info.timeout = 120000; info.status = 'passed'; current = info; expect(() => life.check(true)).toThrow(); expect(life.snapshot.retained).toBe(true);
  });
  it('成功正文结束仅允许原fixture收尾，fixtureEnd后永久失效', async () => {
    const info = { _startWallTime: 0, timeout: 120000 }, life = v027Lifetime(info, { assertCurrent() {} }, () => info, () => {}, () => 1);
    life.finish(); life.endBody(); await life.step(async () => {}, true); life.fixtureEnd(); expect(() => life.check(true)).toThrow();
  });
  it('同一owner并发动作停链，第一动作晚返回也拒绝', async () => {
    const info = { _startWallTime: 0, timeout: 120000 }, life = v027Lifetime(info, { assertCurrent() {} }, () => info, () => {}, () => 1); let release!: () => void;
    const first = life.step(() => new Promise<void>(yes => { release = yes; })); await expect(life.step(async () => {})).rejects.toThrow('已有'); release(); await expect(first).rejects.toThrow();
  });
});

describe('0.27输入与写前登记', () => {
  it('真实登记函数只落无凭据计划，fsync和原路径身份核对后才发布记录', async () => {
    const text = source('v027-acceptance-fixture.ts'), begin = text.indexOf('async function record('), end = text.indexOf('\n  const ctx:', begin); expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
    const records: object[] = [], events: string[] = []; let bytes = Buffer.alloc(0);
    const stat = () => ({ dev: 1, ino: 2, nlink: 1, size: bytes.length, isFile: () => true, isSymbolicLink: () => false });
    const exports: { record?: (stage: string) => Promise<void> } = {};
    runInNewContext(compile('let journalSize=0,journalIdentity="",plannedDirectory="",directoryRemoved=false;\n' + text.slice(begin, end) + '\nexports.record=record;'), {
      exports, Buffer, records, journalPath: 'RAM登记', plan: v027Resources('csv', 'c'.repeat(32), 'd'.repeat(64)), files: ['RAM精确文件'], binding: { target: { nonce: 'a'.repeat(32), password: '绝不可落盘口令', user: '绝不可落盘用户' } }, owner: undefined,
      life: { check() {}, step: async (action: () => Promise<void>) => action() },
      open: async (path: string, flag: string, mode: number) => { expect([path, flag, mode]).toEqual(['RAM登记', 'wx', 0o600]); events.push('打开'); return { stat: async () => stat(), writeFile: async (value: Buffer) => { bytes = Buffer.from(value); events.push('写计划'); }, sync: async () => { expect(records).toHaveLength(0); events.push('同步'); }, close: async () => { events.push('关闭'); } }; },
      lstat: async () => { events.push('核路径'); return stat(); },
    });
    await exports.record!('planned'); expect(events).toEqual(['打开', '写计划', '同步', '关闭', '核路径']); expect(records).toHaveLength(1); expect(bytes.toString()).not.toMatch(/绝不可落盘|password|user/); expect(JSON.parse(bytes.toString())).toMatchObject({ stage: 'planned', runNonce: 'a'.repeat(32), schema: 'dbark_v027_csv_' + 'c'.repeat(32) });
  });
  it.each([',', ';', '\t'] as const)('独立CSV解析保留%s字段、空串、NULL标记、文字反斜线和BLOB字节', delimiter => {
    const sample = v027CsvInput(delimiter, [',', ';', '\t'].indexOf(delimiter)), rows = parse(sample.body, { delimiter, columns: true }) as Record<string, string>[];
    expect(Object.keys(rows[0])).toEqual(v027CsvColumns); expect(rows).toHaveLength(2); expect(Buffer.byteLength(sample.body)).toBeLessThan(8192);
    for (const [index, row] of rows.entries()) {
      expect(row.id).toBe(sample.expected[index].id); expect(row.amount).toBe(sample.expected[index].amount); expect(row.nullable_text).toBe(index ? '\\\\N' : '\\N'); expect(row.empty_text).toBe(''); expect(Buffer.from(row.payload.slice(7), 'base64').toString('hex').toUpperCase()).toBe(sample.expected[index].payload); expect(row.note).toBe(sample.expected[index].note); expect(row.note).toContain('\r\n');
    }
  });
  it('计划仅有固定nonce资源，不含凭据，数据库名在64字节以内', () => {
    for (const kind of ['csv', 'time'] as const) { const plan = v027Resources(kind, 'c'.repeat(32), 'd'.repeat(64)); expect(plan.schema.length).toBeLessThanOrEqual(64); expect(plan.tables).toHaveLength(3); expect(plan.files).toHaveLength(kind === 'csv' ? 3 : 0); expect(JSON.stringify(plan)).not.toMatch(/password|RAM口令|RAM用户|fileToken/); }
    expect(() => v027Resources('csv', '../外部', 'd'.repeat(64))).toThrow();
  });
  /** 抽取原fixture实际目录表达式，只注入RAM文件端口，不加载原fixture模块。 */
  async function directory(hook: boolean, mode: 'ok' | 'recordFailure' | 'lateRecord' | 'lateMkdir' = 'ok') {
    const text = source('desktop-fixture.ts'), begin = text.indexOf('const directory = originalGuard?.assertPreparation ?'), end = text.indexOf('\n      // 内层已核目录回包', begin); expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
    const events: string[] = [], state = { retained: false }; let active = true;
    const originalGuard = { assertPreparation() {}, ...(hook ? { beforeDirectoryCreate: async (_info: unknown, path: string) => { events.push('登记:' + path); if (mode === 'recordFailure') throw Error('登记失败'); if (mode === 'lateRecord') active = false; } } : {}) };
    const value = await runInNewContext('(async()=>{' + compile(text.slice(begin, end) + '\nreturn directory;') + '})()', {
      originalGuard, launchGuard: { assertCurrent() { if (!active) throw Error('已停链'); } }, state, testInfo: {}, join, tmpdir: () => '/RAM', randomUUID: () => 'a'.repeat(32), mkdir: async (path: string) => { events.push('创建:' + path); if (mode === 'lateMkdir') active = false; }, mkdtemp: async () => { events.push('旧创建'); return '/RAM/旧目录'; },
    }).then((path: string) => ({ path }), (error: Error) => ({ error: error.message }));
    return { value, events, state };
  }
  it('写前登记完成后才创建同一名字；旧路径仍只调用原mkdtemp', async () => {
    const result = await directory(true); expect(result.events).toEqual(['登记:' + join('/RAM', 'dbark-e2e-' + 'a'.repeat(32)), '创建:' + join('/RAM', 'dbark-e2e-' + 'a'.repeat(32))]); expect(result.value).toHaveProperty('path');
    const old = await directory(false); expect(old.events).toEqual(['旧创建']); expect(old.value).toEqual({ path: '/RAM/旧目录' });
  });
  it.each(['recordFailure', 'lateRecord', 'lateMkdir'] as const)('%s不发布目录，不增加清理或第二次创建', async mode => {
    const result = await directory(true, mode); expect(result.value).toHaveProperty('error'); expect(result.state.retained).toBe(true); expect(result.events.filter(value => value.startsWith('创建:'))).toHaveLength(mode === 'lateMkdir' ? 1 : 0);
  });
});

describe('0.27原收尾授权（纯RAM执行真实finish方法）', () => {
  /** 只抽取真实方法体，所有驱动、窗口与文件端口替换为可审计RAM动作。 */
  async function finish(mode: 'ok' | 'taskFailure' | 'exitUnknown' | 'markerMismatch' | 'extraTable' | 'fileChanged') {
    const text = source('v027-acceptance-fixture.ts'), tree = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true); let method: ts.MethodDeclaration | undefined;
    const visit = (node: ts.Node) => { if (ts.isMethodDeclaration(node) && node.name.getText(tree) === 'finish') method = node; ts.forEachChild(node, visit); }; visit(tree); expect(method).toBeDefined();
    const plan = v027Resources('csv', 'c'.repeat(32), 'd'.repeat(64)), events: string[] = [], bytes = Buffer.from('RAM样本'), stream = { closed: false }, native = { stream }, files = plan.files.map(name => resolve('C:/RAM', name)); let closed = false;
    const identities = new Map(files.map(path => [path, { dev: '1', ino: path, hash: createHash('sha256').update(bytes).digest('hex') }]));
    const connection = { query: async (sql: string) => {
      if (sql.startsWith('SELECT nonce')) { events.push('归属标记'); return [[{ nonce: mode === 'markerMismatch' ? '他人' : plan.nonce, case_hash: plan.caseHash }]]; }
      if (sql.includes('information_schema.TABLES')) { events.push('核表集合'); return [[...plan.tables, ...(mode === 'extraTable' ? ['他人表'] : [])].map(name => ({ name }))]; }
      if (sql.startsWith('DROP')) { events.push('删除准确库'); return [{}]; }
      if (sql.includes('information_schema.SCHEMATA')) { events.push('核库残留'); return [[]]; }
      throw Error('未登记RAM SQL');
    } };
    const ctx = { step: async (action: () => Promise<unknown>) => action(), check() {}, connection, facts: async () => { events.push('复核指纹'); } };
    const run = runInNewContext(compile('const value = {' + method!.getText(tree) + '}; exports.run=value.finish;'), {
      exports: {}, expect, ctx, plan, files, identities, native, originalStream: stream, schemaAck: true, appClosed: false, pageErrors: [], info: {}, owner: { page: { evaluate: async () => [{ status: mode === 'taskFailure' ? 'failed' : 'completed' }] } },
      confirmOwnedDesktopExit: async () => { events.push('正常退出'); if (mode === 'exitUnknown') throw Error('退出未知'); closed = true; }, ownedDesktopResources: () => ({ closed }),
      lstat: async (path: string) => { events.push('核样本'); if (!identities.has(path)) throw Object.assign(Error('无残留'), { code: 'ENOENT' }); return { dev: 1, ino: path, size: bytes.length, nlink: 1, isFile: () => true, isSymbolicLink: () => false }; },
      realpath: async (path: string) => path, resolve, readFile: async () => mode === 'fileChanged' ? Buffer.from('变化') : bytes, createHash,
      unlink: async (path: string) => { events.push('删除准确文件'); identities.delete(path); },
      closeMysqlConnection: async (value: typeof native) => { expect(value).toBe(native); stream.closed = true; events.push('原流正常关闭'); }, record: async (stage: string) => { events.push('登记:' + stage); }, life: { finish() { events.push('完成'); } },
    });
    // runInNewContext返回赋值值；仅执行提取方法，不执行任何模块顶层或真实端口。
    const execute = run as (verify: (closed: boolean) => Promise<void>, count: number) => Promise<void>;
    let error: unknown; try { await execute(async value => { events.push(value ? '退出后独立核对' : '退出前独立核对'); }, 1); } catch (reason) { error = reason; }
    return { events, error };
  }
  it('正常退出、原标记及准确表集合在任何删除前；核无残留和原流close后才完成', async () => {
    const result = await finish('ok'); expect(result.error).toBeUndefined();
    expect(result.events.indexOf('正常退出')).toBeLessThan(result.events.indexOf('删除准确文件')); expect(result.events.indexOf('归属标记')).toBeLessThan(result.events.indexOf('删除准确文件')); expect(result.events.indexOf('核表集合')).toBeLessThan(result.events.indexOf('删除准确文件')); expect(result.events.filter(value => value === '删除准确文件')).toHaveLength(3); expect(result.events.slice(-4)).toEqual(['核库残留', '原流正常关闭', '登记:cleaned', '完成']);
  });
  it.each(['taskFailure', 'exitUnknown', 'markerMismatch', 'extraTable', 'fileChanged'] as const)('%s立即停后续，零删除、零close、零完成', async mode => {
    const result = await finish(mode); expect(result.error).toBeDefined(); expect(result.events).not.toContain('删除准确文件'); expect(result.events).not.toContain('删除准确库'); expect(result.events).not.toContain('原流正常关闭'); expect(result.events).not.toContain('完成');
  });
});
