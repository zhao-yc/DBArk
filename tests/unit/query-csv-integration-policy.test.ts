import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as policy from '../helpers/queryCsvIntegration';
import { qisLifetime, qisUsingHandle } from '../helpers/queryInsertIntegration';

const entry = readFileSync(new URL('../integration/engine-query-csv-delimiter.integration.test.ts', import.meta.url), 'utf8');
const live = readFileSync(new URL('../integration/query-csv-delimiter-live.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const allowed = (): Record<string, string | undefined> => ({ DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_CSV_INTEGRATION_ENABLED: '1', DBARK_QCSV_RUN_NONCE: 'a'.repeat(32), DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'RAM用户', DBARK_TEST_PASSWORD: 'RAM口令', DBARK_TEST_EXPECTED_SERVER_UUID: policy.qcsvUuid });

/** 只执行正式声明，回调存RAM；任何live、驱动或产品模块被导入即失败。 */
function declare(env: Record<string, string | undefined>, argv: string[]) {
  const cases: any[] = [], suites: any[] = [], modules: string[] = [];
  runInNewContext(compile(entry), { exports: {}, process: { env, argv }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { describe: { skipIf: (skip: boolean) => (title: string, options: unknown, callback: () => void) => { suites.push({ skip, title, options }); callback(); } }, it: (name: string, options: unknown, callback: unknown) => cases.push({ name, callback, options }) };
    if (name === '../helpers/queryCsvIntegration') return policy; throw Error('声明不得导入live：' + name);
  } }); return { cases, suites, modules };
}

describe('QCSV声明与18个明确场景', () => {
  it.each(['list', '--list', '--list=true'])('%s零环境getter、零live/产品导入', value => {
    const result = declare(new Proxy(allowed(), { get() { throw Error('列表禁止读取环境'); } }), [value]);
    expect(result.suites[0].skip).toBe(true); expect(result.cases).toHaveLength(18); expect(result.modules).toEqual(['vitest', '../helpers/queryCsvIntegration']);
  });
  it('默认及双门收集都只登记，默认只读双门而不读凭据', () => {
    const reads: string[] = [], env = new Proxy({}, { get(_target, key: string) { reads.push(key); if (key === 'DBARK_INTEGRATION_ENABLED') return '1'; if (key === policy.qcsvGate) return undefined; throw Error('不得读凭据'); } });
    expect(declare(env, []).suites[0].skip).toBe(true); expect(reads).toEqual(['DBARK_INTEGRATION_ENABLED', policy.qcsvGate]);
    const active = declare(allowed(), []); expect(active.suites[0]).toMatchObject({ skip: false, options: { sequential: true, concurrent: false } });
    expect(active.modules).toEqual(['vitest', '../helpers/queryCsvIntegration']); expect(active.cases.every(value => value.options.timeout === 120000 && value.options.retry === 0 && value.options.repeats === 0)).toBe(true);
  });
  it('2格式×3编码×缺省/分号/Tab身份唯一；默认不夹带显式逗号', () => {
    expect(policy.qcsvCases.map(value => value.id)).toEqual(['csv/utf8/default','csv/utf8/semicolon','csv/utf8/tab','csv/utf16le/default','csv/utf16le/semicolon','csv/utf16le/tab','csv/gb18030/default','csv/gb18030/semicolon','csv/gb18030/tab','csv-zip/utf8/default','csv-zip/utf8/semicolon','csv-zip/utf8/tab','csv-zip/utf16le/default','csv-zip/utf16le/semicolon','csv-zip/utf16le/tab','csv-zip/gb18030/default','csv-zip/gb18030/semicolon','csv-zip/gb18030/tab']);
    expect(live).toContain("scenario.separator === 'default' ? {} : { csvDelimiter: scenario.delimiter }");
    expect(live).toContain("{ kind: 'row-result', ordinal: 2 }"); expect(live).toContain("expectedStatements = ['SELECT 0 AS '");
  });
  it('旧INSERT专用门不能开启CSV入口，必须单独提供新门和本轮nonce', () => {
    const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_INSERT_INTEGRATION_ENABLED: '1' };
    expect(declare(env, []).suites[0].skip).toBe(true); expect(() => policy.bindQcsvTarget(() => env, 'RAM')).toThrow();
  });
});

describe('QCSV新授权及原Vitest120秒', () => {
  it.each(['DBARK_INTEGRATION_ENABLED', policy.qcsvGate, 'DBARK_QCSV_RUN_NONCE', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('缺失或错误%s拒绝且不补旧配置', key => {
    const env = allowed(); delete env[key]; expect(() => policy.bindQcsvTarget(() => env, 'RAM')).toThrow(); env[key] = ''; expect(() => policy.bindQcsvTarget(() => env, 'RAM')).toThrow();
  });
  it('缺失口令拒绝；Root显式空串原样保留，profile无SSH/TLS/扩权项', () => {
    const env = allowed(); delete env.DBARK_TEST_PASSWORD; expect(() => policy.bindQcsvTarget(() => env, 'RAM')).toThrow(); env.DBARK_TEST_PASSWORD = '';
    expect(policy.bindQcsvTarget(() => env, 'RAM').profile).toEqual({ id: 'RAM', name: '完整CSV后台隔离验收准备', group: '', color: '', dialect: 'mysql', host: '192.168.31.200', port: 13384, user: 'RAM用户', password: '' });
  });
  it.each(['DBARK_TEST_SSH', 'DBARK_TEST_CA', 'DBARK_TEST_CERT', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'dbark_test_user'])('%s初始和漂移均拒绝，ABA不复活', key => {
    const initial = { ...allowed(), [key]: '' }; expect(() => policy.bindQcsvTarget(() => initial, 'RAM')).toThrow();
    const env = allowed(), target = policy.bindQcsvTarget(() => env, 'RAM'); env[key] = ''; expect(() => target.assertCurrent()).toThrow(); delete env[key]; expect(() => target.assertCurrent()).toThrow();
  });
  it('读环境本身失败也永久撤销当前绑定', () => {
    let fail = false; const target = policy.bindQcsvTarget(() => { if (fail) throw Error('RAM环境失效'); return allowed(); }, 'RAM'); fail = true; expect(() => target.assertCurrent()).toThrow(); fail = false; expect(() => target.assertCurrent()).toThrow();
  });
  it('不重写已验guard及原句柄finally；真实Vitest起点正常完成', { timeout: 120000, retry: 0 }, context => {
    expect(policy.qcsvLifetime).toBe(qisLifetime); expect(policy.qcsvUsingHandle).toBe(qisUsingHandle);
    let retained = 0; const life = policy.qcsvLifetime(context, { assertCurrent() {} }, () => retained++); life.check(); life.finish(); life.end(); expect(retained).toBe(0); expect(() => life.check()).toThrow();
  });
  it.each(['deadline', 'task', 'result', 'start', 'timeout', 'retry', 'repeat', 'concurrent', 'state', 'clock', 'end'] as const)('%s在await期间失效，晚回和后续动作均拒绝', async mode => {
    const context = { task: { id: 'RAM', timeout: 120000, retry: 0, repeats: 0, concurrent: false, result: { startTime: 0, state: 'run' } } };
    const task = context.task, result = task.result; let now = 1, release!: () => void;
    const life = policy.qcsvLifetime(context, { assertCurrent() {} }, () => {}, () => now), pending = life.step(() => new Promise<void>(yes => { release = yes; }));
    if (mode === 'deadline') now = 120000; if (mode === 'task') context.task = { ...task }; if (mode === 'result') task.result = { ...result }; if (mode === 'start') result.startTime = 1; if (mode === 'timeout') task.timeout = 240000; if (mode === 'retry') task.retry = 1; if (mode === 'repeat') task.repeats = 1; if (mode === 'concurrent') task.concurrent = true; if (mode === 'state') result.state = 'pass'; if (mode === 'clock') now = 0; if (mode === 'end') life.end();
    release(); await expect(pending).rejects.toThrow(); context.task = task; task.result = result; result.startTime = 0; task.timeout = 120000; task.retry = task.repeats = 0; task.concurrent = false; result.state = 'run'; now = 1;
    const next = vi.fn(async () => {}); await expect(life.step(next)).rejects.toThrow(); expect(next).not.toHaveBeenCalled();
  });
});

let beforeOpen = '', openFactory = '', checkSource = '', fileSource = '', directorySource = '';
function visit(node: ts.Node) {
  if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'io.beforeOpen' && ts.isArrowFunction(node.right)) beforeOpen = node.right.getText(tree);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'vi.mock') openFactory = node.arguments[1].getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'check') checkSource = node.getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'file') fileSource = node.getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'ownedDirectory') directorySource = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
/** 提取实际护栏，只替换操作系统端口，不导入live或任何数据库模块。 */
function actual<T>(text: string, scope: object): T { const exports: any = {}; runInNewContext(compile(text), { exports, ...scope }); return exports.value; }

describe('QCSV写前登记与原资源身份', () => {
  it.each(['stream', 'thread', 'profile', 'broken', 'closed', 'premature-close'])('%s改变后恢复也不能继续原任务', mode => {
    const context = { task: { id: 'RAM', timeout: 120000, result: { startTime: 0, state: 'run' } } }, life = policy.qcsvLifetime(context, { assertCurrent() {} }, () => {}, () => 1);
    const profile = {}, native: any = { stream: { closed: false }, threadId: 7 }, original = native.stream, managed = { connection: native, profile, broken: false }, source = { native, managed, stream: original, thread: 7, normalClosed: false };
    const check = actual<() => void>(checkSource + ';exports.value=check;', { life, binding: { profile }, owned: [source], source, closingEngine: false }); check();
    if (mode === 'stream') native.stream = { closed: false }; if (mode === 'thread') native.threadId = 9; if (mode === 'profile') managed.profile = {}; if (mode === 'broken') managed.broken = true; if (mode === 'closed') original.closed = true; if (mode === 'premature-close') source.normalClosed = true;
    expect(check).toThrow(); native.stream = original; native.threadId = 7; managed.profile = profile; managed.broken = false; original.closed = false; source.normalClosed = false; expect(check).toThrow();
  });
  it('登记fsync完成前原open不调用；并发第二partial拒绝且句柄不投影', async () => {
    const plan = policy.qcsvPlan(policy.qcsvCases[0], 'b'.repeat(32), 'c'.repeat(64)), directory = resolve('C:/RAM', plan.directory), partials = new Set<string>(), events: string[] = []; let release!: () => void;
    const waiting = new Promise<void>(yes => { release = yes; });
    const hook = actual<(path: string) => Promise<void>>('exports.value=' + beforeOpen, { dirname, basename, resolve, directory, plan, partials, check() {}, record: async () => { events.push('登记'); await waiting; } });
    const identity = vi.fn(), handle = { identity }, factory = actual<(original: () => Promise<object>) => Promise<any>>('exports.value=' + openFactory, { io: { beforeOpen: hook } });
    const port = await factory(async () => ({ open: async () => { events.push('open'); return handle; } }));
    const pending = port.open(join(directory, plan.file + '.dbark-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.partial'), 'wx'); await Promise.resolve(); expect(events).toEqual(['登记']);
    await expect(port.open(join(directory, plan.file + '.dbark-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.partial'), 'wx')).rejects.toThrow();
    release(); expect(await pending).toBe(handle); expect(events).toEqual(['登记', 'open']); await expect(port.open('C:/未知/外部.partial', 'wx')).rejects.toThrow();
  });
  it.each(['same', 'inode', 'path', 'link'] as const)('原目录%s校验不按相同路径重新认领', async mode => {
    const directory = resolve('C:/RAM/owned');
    const ownedDirectory = actual<() => Promise<void>>(directorySource + ';exports.value=ownedDirectory;', { check() {}, directory, directoryId: '1:7', actualFs: { lstat: async () => ({ dev: 1, ino: mode === 'inode' ? 8 : 7, isDirectory: () => true, isSymbolicLink: () => mode === 'link' }), realpath: async () => mode === 'path' ? resolve('C:/RAM/else') : directory } });
    if (mode === 'same') await expect(ownedDirectory()).resolves.toBeUndefined(); else await expect(ownedDirectory()).rejects.toThrow();
  });
  it.each(['same', 'inode', 'bytes', 'link', 'path', 'nlink', 'oversize'] as const)('原文件%s反例不能授权删除', async mode => {
    const directory = resolve('C:/RAM/owned'), path = join(directory, 'target.csv'), bytes = Buffer.from('固定字节'), hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex'); let read = false;
    const stat = () => ({ dev: 1, ino: read && mode === 'inode' ? 99 : 11, size: mode === 'oversize' ? 3 * 1024 * 1024 : bytes.length, nlink: mode === 'nlink' ? 2 : 1, isFile: () => true, isSymbolicLink: () => mode === 'link' });
    const file = actual<(path: string, expected: object) => Promise<any>>(fileSource + ';exports.value=file;', { check() {}, ownedDirectory: async () => {}, directory, dirname, resolve, hash, actualFs: { lstat: async () => stat(), realpath: async () => read && mode === 'path' ? join(directory, 'other.csv') : path, readFile: async () => { read = true; return mode === 'bytes' ? Buffer.from('不同字节') : bytes; } } });
    const expected = { dev: '1', ino: '11', size: bytes.length, hash: hash(bytes) };
    if (mode === 'same') expect((await file(path, expected)).identity).toEqual(expected); else await expect(file(path, expected)).rejects.toThrow();
  });
});

it('样本301行与每例新随机计划覆盖精度、微秒、JSON大整数及CSV特殊值', () => {
  const rows = policy.qcsvRows(); expect(rows).toHaveLength(301); expect(rows[0].expected.id).toBe('18446744073709550000'); expect(rows[300].expected.id).toBe('18446744073709550300'); expect(rows[0].expected.signed_value).toBe('-9223372036854775808'); expect(rows[300].expected.happened).toBe('2026-10-18 01:02:03.000300');
  expect(rows.slice(0, 3).map(row => row.values[5])).toEqual([null, '', 'NULL']); expect(rows[2].values[10]).toContain('18446744073709551615'); expect(rows[0].values[7]).toBe('\\N'); expect(rows[0].values[8]).toContain('\r\n逗,号;Tab\t'); expect(rows.slice(0, 3).map(row => row.expected.payload_hex)).toEqual([null, '', '0001FF805C27']);
  const row = { ...rows[2].expected, doc_hex: Buffer.from(String(rows[2].values[10])).toString('hex') };
  expect(policy.qcsvExpectedFields(row)).toEqual([String(rows[2].values[0]), String(rows[2].values[1]), String(rows[2].values[2]), String(rows[2].values[3]), String(rows[2].values[4]), 'NULL', '', '\\\\N', String(rows[2].values[8]), 'base64:AAH/gFwn', String(rows[2].values[10])]);
  for (const scenario of policy.qcsvCases) { const plan = policy.qcsvPlan(scenario, 'b'.repeat(32), 'c'.repeat(64)); expect(plan.database).toMatch(/^dbark_qcsv_[a-f0-9]{32}$/); expect(plan.tables).toEqual(['__qcsv_owner','source','neighbor']); expect(JSON.stringify(plan)).not.toContain('RAM口令'); }
  expect(() => policy.qcsvPlan({ ...policy.qcsvCases[0] }, 'b'.repeat(32), 'c'.repeat(64))).toThrow();
});

it('真实流、单次查询和严格正常退出后收尾接线；finally只留现场，无恢复动作', () => {
  expect(live).toContain("vi.spyOn(protocol, 'consumeQueryFrames')"); expect(live).toContain('return (original as any).apply(this, args)'); expect(live).toContain('expect(sourceExecutions).toBe(1)'); expect(live).toContain('expect(exportCommands).toEqual(expectedStatements.map');
  expect(live).toContain("flags: ['-IGNORE_SPACE']"); expect(live).toContain(".n).toBe('301')");
  expect(live).not.toMatch(/DROP DATABASE IF EXISTS|CREATE USER|\bGRANT\b|\bREVOKE\b|KILL QUERY|\.destroy\(|\.readRecords\(|dotenv|recursive:\s*true/);
  const tail = live.slice(live.indexOf('// 成功任务结算'));
  const marks = ['engine!.closeAll()', 'information_schema.PROCESSLIST', "table('__qcsv_owner')", 'information_schema.TABLES', 'SHOW CREATE TABLE', "['TRIGGERS'", 'actualFs.unlink(target)', 'DROP DATABASE ', 'closeMysqlConnection', 'actualFs.rmdir(directory)', "record('cleaned')"].map(mark => tail.indexOf(mark));
  expect(marks.every(value => value >= 0)).toBe(true); expect([...marks].sort((a, b) => a - b)).toEqual(marks);
  const run = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runQcsvCase') as ts.FunctionDeclaration;
  const final = run.body!.statements.find(ts.isTryStatement)!.finallyBlock!.getText(tree); expect(final).not.toMatch(/await |\.close\(|\.closeAll\(|\.query\(|\.unlink\(|\.rmdir\(|\.handle\(/);
});
