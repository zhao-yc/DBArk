import { readFileSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as policy from '../helpers/queryInsertIntegration';

const entry = readFileSync(new URL('../integration/engine-query-insert-stream.integration.test.ts', import.meta.url), 'utf8');
const live = readFileSync(new URL('../integration/query-insert-stream-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true);
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const allowed = (): Record<string, string | undefined> => ({ DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_INSERT_INTEGRATION_ENABLED: '1', DBARK_QIS_RUN_NONCE: 'a'.repeat(32), DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'RAM用户', DBARK_TEST_PASSWORD: 'RAM口令', DBARK_TEST_EXPECTED_SERVER_UUID: policy.qisUuid });

/** 原入口整段声明，回调仅收集；任何live/文件/驱动模块加载立即报错。 */
function declare(env: Record<string, string | undefined>, argv: string[]) {
  const cases: any[] = [], suites: any[] = [], modules: string[] = [];
  runInNewContext(compile(entry), { exports: {}, process: { env, argv }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { describe: { skipIf: (skip: boolean) => (title: string, options: unknown, callback: () => void) => { suites.push({ skip, title, options }); callback(); } }, it: (name: string, callback: unknown, options: unknown) => cases.push({ name, callback, options }) };
    if (name === '../helpers/queryInsertIntegration') return policy; throw Error('声明禁止live模块：' + name);
  } }); return { cases, suites, modules };
}

describe('QIS默认/list无live副作用', () => {
  it.each(['list', '--list', '--list=true'])('%s先短路且零环境getter', value => {
    const result = declare(new Proxy(allowed(), { get() { throw Error('列表禁止读环境'); } }), [value]); expect(result.suites[0].skip).toBe(true); expect(result.cases).toHaveLength(6); expect(result.modules).toEqual(['vitest', '../helpers/queryInsertIntegration']);
  });
  it('默认仅看双开关，双门开启的收集阶段同样不导入live', () => {
    const reads: string[] = [], env = new Proxy({}, { get(_target, key: string) { reads.push(key); if (key === 'DBARK_INTEGRATION_ENABLED') return '1'; if (key === policy.qisGate) return undefined; throw Error('禁止读凭据'); } });
    expect(declare(env, []).suites[0].skip).toBe(true); expect(reads).toEqual(['DBARK_INTEGRATION_ENABLED', policy.qisGate]);
    const active = declare(allowed(), []); expect(active.suites[0]).toMatchObject({ skip: false, options: { sequential: true, concurrent: false } }); expect(active.cases.every(value => value.options.timeout === 120000 && value.options.retry === 0 && value.options.repeats === 0)).toBe(true); expect(active.modules).not.toContain('./query-insert-stream-live');
  });
});

describe('QIS准确目标与原120秒', () => {
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_QIS_RUN_NONCE'])('错误%s拒绝，绝不推断默认', key => { const env = allowed(); env[key] = ''; expect(() => policy.bindQisTarget(() => env, 'RAM')).toThrow(); });
  it.each(['DBARK_TEST_SSH', 'DBARK_TEST_CA', 'DBARK_DEV_URL', 'NODE_OPTIONS', 'dbark_test_user'])('%s漂移后恢复不复活', key => { const env = allowed(), target = policy.bindQisTarget(() => env, 'RAM'); env[key] = ''; expect(() => target.assertCurrent()).toThrow(); delete env[key]; expect(() => target.assertCurrent()).toThrow(); });
  it('未显式提供口令拒绝，显式空串仅原样接受', () => { const env = allowed(); delete env.DBARK_TEST_PASSWORD; expect(() => policy.bindQisTarget(() => env, 'RAM')).toThrow(); env.DBARK_TEST_PASSWORD = ''; expect(policy.bindQisTarget(() => env, 'RAM').profile.password).toBe(''); });
  it('实际Vitest任务result.startTime及timeout可用，正常结束不误停后续用例', context => {
    let retained = 0; const life = policy.qisLifetime(context, { assertCurrent() {} }, () => retained++); life.check(); life.finish(); life.end(); expect(retained).toBe(0); expect(() => life.check()).toThrow();
  }, { timeout: 120000, retry: 0 });
  it.each(['deadline', 'replaced', 'timeout', 'result', 'retry', 'ended', 'clock'] as const)('%s发生于await时，晚回拒绝且永不复活', async mode => {
    const context: policy.QisContext = { task: { id: 'RAM', timeout: 120000, result: { startTime: 0, state: 'run' } } }, original = context.task, result = original.result; let now = 1, release!: () => void;
    const life = policy.qisLifetime(context, { assertCurrent() {} }, () => {}, () => now), pending = life.step(() => new Promise<void>(yes => { release = yes; }));
    if (mode === 'deadline') now = 120000; if (mode === 'replaced') context.task = { ...original }; if (mode === 'timeout') original.timeout = 240000; if (mode === 'result') original.result = { ...result }; if (mode === 'retry') original.retry = 1; if (mode === 'ended') life.end(); if (mode === 'clock') now = 0;
    release(); await expect(pending).rejects.toThrow(); now = 1; context.task = original; original.result = result; original.timeout = 120000; original.retry = 0; expect(() => life.check()).toThrow();
  });
});

let beforeOpen = '', openFactory = '', checkSource = '', fileSource = '';
function visit(node: ts.Node) {
  if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'io.beforeOpen' && ts.isArrowFunction(node.right)) beforeOpen = node.right.getText(tree);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'vi.mock') openFactory = node.arguments[1].getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'check') checkSource = node.getText(tree);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'file') fileSource = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
function actual<T>(text: string, scope: object): T { const exports: any = {}; runInNewContext(compile(text), { exports, ...scope }); return exports.value; }

describe('QIS原流/写前登记与文件身份（实际函数，RAM端口）', () => {
  it.each(['stream', 'thread', 'profile', 'broken', 'closed'])('%s变化停链，原值返回也无效', mode => {
    const context = { task: { id: 'RAM', timeout: 120000, result: { startTime: 0, state: 'run' } } }, life = policy.qisLifetime(context, { assertCurrent() {} }, () => {}, () => 1);
    const profile = {}, native: any = { stream: { closed: false }, threadId: 7 }, original = native.stream, managed = { connection: native, profile, broken: false }, source = { native, managed, stream: original, thread: 7, normalClosed: false };
    const check = actual<() => void>(checkSource + ';exports.value=check;', { life, binding: { profile }, owned: [source], source, sourceClosed: false, closingEngine: false }); check();
    if (mode === 'stream') native.stream = { closed: false }; if (mode === 'thread') native.threadId = 9; if (mode === 'profile') managed.profile = {}; if (mode === 'broken') managed.broken = true; if (mode === 'closed') original.closed = true;
    expect(check).toThrow(); native.stream = original; native.threadId = 7; managed.profile = profile; managed.broken = false; original.closed = false; expect(check).toThrow();
  });
  it('实际FS观察器在精确partial登记持久完成前不调用原open；不改原句柄', async () => {
    const plan = policy.qisPlan('utf8', 'b'.repeat(32), 'c'.repeat(64)), directory = resolve('C:/RAM', plan.directory), partials = new Set<string>(), events: string[] = []; let release!: () => void;
    const waiting = new Promise<void>(yes => { release = yes; });
    const hook = actual<(path: string) => Promise<void>>('exports.value=' + beforeOpen, { dirname, basename, resolve, directory, plan, partials, check() {}, record: async () => { events.push('登记'); await waiting; } });
    // 返回同一对象，未来新增的归属方法也不被投影丢失；不重建nativeAtomicFileIO的WritableFile。
    const protectOwnership = vi.fn(async () => {}), factory = actual<(original: () => Promise<object>) => Promise<any>>('exports.value=' + openFactory, { io: { beforeOpen: hook } }), handle = { protectOwnership };
    const port = await factory(async () => ({ open: async () => { events.push('open'); return handle; } }));
    const pending = port.open(join(directory, plan.file + '.dbark-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.partial'), 'wx'); await Promise.resolve(); expect(events).toEqual(['登记']); release(); const acquired = await pending; expect(acquired).toBe(handle); await acquired.protectOwnership(); expect(protectOwnership).toHaveBeenCalledOnce(); expect(events).toEqual(['登记', 'open']);
    await expect(port.open('C:/其他/未知.partial', 'wx')).rejects.toThrow(); expect(events.filter(value => value === 'open')).toHaveLength(1);
  });
  it('已取得句柄后期限失败仅close；关闭失败同时保留首因', async () => {
    const original = Error('原期限失败'), closing = Error('原关闭失败'), events: string[] = []; let error: any;
    try { await policy.qisUsingHandle({ async close() { events.push('close'); throw closing; } }, async () => { throw original; }); } catch (reason) { error = reason; }
    expect(events).toEqual(['close']); expect(error.errors).toEqual([original, closing]); expect(error.cause).toBe(original);
  });
  it.each(['same', 'inode', 'bytes', 'symlink', 'path'])('输出读取%s反例不替换原文件身份', async mode => {
    const path = resolve('C:/RAM/target.sql'), bytes = Buffer.from('固定字节'), hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex'); let read = false;
    const stat = () => ({ dev: 1, ino: read && mode === 'inode' ? 99 : 11, size: bytes.length, nlink: 1, isFile: () => true, isSymbolicLink: () => read && mode === 'symlink' });
    const file = actual<(path: string, expected: object) => Promise<any>>(fileSource + ';exports.value=file;', { check() {}, resolve, hash, actualFs: { lstat: async () => stat(), realpath: async () => read && mode === 'path' ? resolve('C:/RAM/other') : path, readFile: async () => { read = true; return mode === 'bytes' ? Buffer.from('不同字节') : bytes; } } });
    const expected = { dev: '1', ino: '11', size: bytes.length, hash: hash(bytes) };
    if (mode === 'same') expect((await file(path, expected)).identity).toEqual(expected); else await expect(file(path, expected)).rejects.toThrow();
  });
});

it('301行手工样本覆盖精确边界、微秒、NULL/空串/BLOB/JSON及引号换行，计划无凭据', () => {
  const rows = policy.qisRows(); expect(rows).toHaveLength(301); expect(rows[0].expected.id).toBe('18446744073709550000'); expect(rows[300].expected.id).toBe('18446744073709550300'); expect(rows[0].expected.signed_value).toBe('-9223372036854775808'); expect(rows[1].expected.amount).toBe('-12345678901234567890123456789012345.123456789012345678901234567890'); expect(rows[300].expected.happened).toBe('2026-10-18 01:02:03.000300');
  expect(rows.slice(0, 3).map(value => value.values[5])).toEqual([null, '', 'NULL']); expect(rows.slice(0, 3).map(value => value.expected.payload_hex)).toEqual([null, '', '0001FF805C27']); expect(rows[2].values[8]).toContain('18446744073709551615'); expect(rows[2].values[6]).toContain('\0\r\n');
  const plan = policy.qisPlan('utf8', 'b'.repeat(32), 'c'.repeat(64)); expect(plan.database.length).toBeLessThanOrEqual(64); expect(JSON.stringify(plan)).not.toMatch(/RAM口令|password|SQL正文/); expect(() => policy.qisPlan('cancel', '../外部', 'c'.repeat(64))).toThrow();
});
