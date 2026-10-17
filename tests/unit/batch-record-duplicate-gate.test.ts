import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindBatchDuplicateTarget, batchDuplicateTargetKeys, BatchDuplicatePreparation } from '../helpers/batchRecordDuplicateUi';
import * as paths from 'node:path';

const source = readFileSync(new URL('../e2e/table-record-duplicate-batch.spec.ts', import.meta.url), 'utf8');
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
/** 只运行真实spec声明，owner/driver是禁止加载的哨兵，绝不调用用例主体。 */
function declare(env: Record<string, string | undefined>, argv: string[]) {
  const names: string[] = [], loaded: string[] = [], registered = vi.fn();
  const requireMock = (name: string) => { loaded.push(name); if (name === '@playwright/test') return { test: { skip: (title: string) => names.push(title) } }; if (name.endsWith('/batchRecordDuplicateUi')) return { bindBatchDuplicateTarget, batchDuplicateTargetKeys }; if (name === './table-record-duplicate-batch-live') return { registerBatchRecordDuplicate: registered }; throw Error('关闭门禁止模块：' + name); };
  runInNewContext(compile(source), { require: requireMock, exports: {}, process: { env, argv } }); return { names, loaded, registered };
}
it.each([{ argv: [] }, { argv: ['--list'] }, { argv: ['--list=true'] }])('默认关闭或列表$argv先短路，不接触任何实跑参数', ({ argv }) => {
  const env = new Proxy({}, { get(_target, key) { if (!argv.length && key === 'DBARK_INTEGRATION_ENABLED') return undefined; throw Error('关闭门读取了实跑配置'); } });
  const result = declare(env, argv); expect(result.names).toHaveLength(3); expect(result.loaded).toEqual(['@playwright/test']); expect(result.registered).not.toHaveBeenCalled();
});

/** 提取真实自动夹具和原launch，不手写替代启动状态机；原生端口立即拒绝且从不启动应用。 */
function preparationPort(hook = true) {
  const source = readFileSync(new URL('../e2e/desktop-fixture.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('desktop.ts', source, ts.ScriptTarget.Latest, true);
  const functions: string[] = []; let automatic = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['ownedDesktopState', 'recordOwnedDesktopProcesses', 'bindOwnedDesktopExit', 'launchDesktop', 'retainOwnedDesktopResources'].includes(node.name?.text ?? '')) functions.push(node.getText(tree));
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'desktopLifetime' && ts.isArrayLiteralExpression(node.initializer)) automatic = node.initializer.elements[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (functions.length !== 5 || !automatic) throw Error('启动准备未提取完整原函数');
  const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }, states = new WeakMap<object, any>(), launch = vi.fn(async () => { throw Error('仅RAM原生边界'); }), remove = vi.fn(); let now = 1, resolve!: (value: string) => void;
  const directory = new Promise<string>(done => { resolve = done; }), preparation = new BatchDuplicatePreparation(info, () => now), guard = { assertCurrent: vi.fn(), ...(hook ? { assertPreparation: vi.fn((current: unknown) => { if (current !== info) throw Error('TestInfo被替换'); preparation.assertCurrent(); }) } : {}) };
  const context: any = { exports: {}, Error, AggregateError, preservedDesktopExits: states, process: { env: {} }, electron: { launch }, createSnippetsNativeDiagnostics: () => undefined, snippetsDiagnosticsArmed: false, snippetsDiagnostics: undefined, pageErrors: [], dataDir: undefined, desktop: undefined, page: undefined, closed: true, mkdtemp: vi.fn(() => directory), tmpdir: () => 'C:\\RAM', join: paths.join, rm: remove };
  runInNewContext(compile(functions.join('\n') + '\nglobalThis.fixture=' + automatic + ';globalThis.retain=retainOwnedDesktopResources;'), context);
  return { info, states, launch, remove, guard, context, resolve, time: (value: number) => { now = value; }, start: () => context.fixture({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: guard, trace: 'off' }, async () => { throw Error('不得进入实际body'); }, info).catch((reason: unknown) => reason) };
}
it('P2 真实自动夹具：目录等待中原WeakMap保留后，晚包不启动且不清理', async () => {
  const f = preparationPort(), work = f.start(); f.context.retain(f.info); f.resolve('C:\\RAM\\dbark-e2e-late'); await work; expect(f.launch).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.states.get(f.info).retained).toBe(true);
});
it('P2 真实自动夹具：status仍passed但原期限到达时晚目录不启动', async () => {
  const f = preparationPort(), work = f.start(); f.time(120000); f.resolve('C:\\RAM\\dbark-e2e-late'); await work; expect(f.launch).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.states.get(f.info).retained).toBe(true);
});
it('P2 真实自动夹具：内层目录完成与外层恢复之间保留，不覆盖下一owner目录', async () => {
  const f = preparationPort(), work = f.start(); f.resolve('C:\\RAM\\dbark-e2e-old');
  queueMicrotask(() => { f.context.dataDir = 'C:\\RAM\\dbark-e2e-next'; f.context.retain(f.info); });
  await work; expect(f.context.dataDir).toBe('C:\\RAM\\dbark-e2e-next'); expect(f.launch).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
});
it('P2 真实自动夹具：合法准备到达同一原生RAM端口，不能无条件拦截', async () => {
  const f = preparationPort(), work = f.start(); f.resolve('C:\\RAM\\dbark-e2e-good'); await work; expect(f.launch).toHaveBeenCalledTimes(1); expect(f.guard.assertPreparation).toHaveBeenCalledWith(f.info); expect(f.remove).not.toHaveBeenCalled();
});
it('P2 无hook兼容：旧strict保持原两次guard调用及正常启动边界', async () => {
  const f = preparationPort(false), work = f.start(); f.resolve('C:\\RAM\\dbark-e2e-old'); await work; expect(f.launch).toHaveBeenCalledTimes(1); expect(f.guard.assertCurrent).toHaveBeenCalledTimes(2); expect(f.remove).not.toHaveBeenCalled();
});
it('P2 真实自动夹具：目录恢复后的字节核对耗尽原期限也不启动', async () => {
  const f = preparationPort(); f.guard.assertCurrent.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { f.time(120000); });
  const work = f.start(); f.resolve('C:\\RAM\\dbark-e2e-late'); await work; expect(f.launch).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.states.get(f.info).retained).toBe(true);
});
it.each(['active失效', 'state替换'] as const)('P2 真实自动夹具：%s后迟到目录不能操作旧或新owner', async mode => {
  const f = preparationPort(), work = f.start(), old = f.states.get(f.info), replacement = { active: true, retained: false };
  if (mode === 'active失效') old.active = false; else f.states.set(f.info, replacement);
  f.resolve('C:\\RAM\\dbark-e2e-late'); await work; expect(f.launch).not.toHaveBeenCalled(); expect(old.retained).toBe(true); expect(replacement.retained).toBe(false); expect(f.remove).not.toHaveBeenCalled();
});
it('仅integration或仅专项门开启也不加载目标/正式模块', () => {
  for (const env of [{ DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_D02_BATCH_DUPLICATE_RECORD_UI: '1' }]) expect(declare(env, []).loaded).toEqual(['@playwright/test']);
});
it('双门都开但缺本轮参数时在加载live前拒绝', () => { expect(() => declare({ DBARK_INTEGRATION_ENABLED: '1', DBARK_D02_BATCH_DUPLICATE_RECORD_UI: '1' }, [])).toThrow('显式一致'); });
it('双门和既有资源参数齐全后仅登记live，不调用任何真实主体', () => {
  const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_D02_BATCH_DUPLICATE_RECORD_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '内存账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_BATCH_DUPLICATE_DATABASE: 'dbark_batch_ram', DBARK_BATCH_DUPLICATE_TABLE: 'subject', DBARK_BATCH_DUPLICATE_DDL_SHA256: 'a'.repeat(64), DBARK_BATCH_DUPLICATE_ROWS_SHA256: 'b'.repeat(64) };
  const result = declare(env, []); expect(result.registered).toHaveBeenCalledTimes(1); expect(result.loaded).toEqual(['@playwright/test', '../helpers/batchRecordDuplicateUi', './table-record-duplicate-batch-live']);
});
it('真实live仅注册3例，严格owner/120秒/0重试/关闭采集保持，不执行body', () => {
  const live = readFileSync(new URL('../e2e/table-record-duplicate-batch-live.ts', import.meta.url), 'utf8'), names: string[] = [], options: unknown[] = [], timeouts: number[] = [], configurations: unknown[] = [];
  const beforeEach = vi.fn(), retain = vi.fn();
  const test = Object.assign((title: string, _body: unknown) => names.push(title), { use: (option: unknown) => options.push(option), setTimeout: (timeout: number) => timeouts.push(timeout), describe: { configure: (configuration: unknown) => configurations.push(configuration) }, beforeEach, afterEach: vi.fn() });
  const exported: any = {};
  runInNewContext(compile(live), { exports: exported, require(name: string) { if (name === './desktop-fixture') return { test, retainOwnedDesktopResources: retain }; if (name.startsWith('node:') || name === 'mysql2/promise' || name.endsWith('/connection') || name.endsWith('/batchRecordDuplicateUi') || name.includes('/locales/')) return {}; throw Error('注册阶段禁止其它加载：' + name); } });
  exported.registerBatchRecordDuplicate({ target: {}, assertCurrent: vi.fn() }); expect(names).toHaveLength(3); expect(options[0]).toMatchObject({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); expect(timeouts).toEqual([120000]); expect(configurations).toEqual([{ mode: 'serial', retries: 0 }]);
  expect(live).not.toMatch(/from ['"].*live-helpers/); expect(live).not.toMatch(/\.invoke\(['"](?:table\.apply|query\.execute|table\.copySourceRead|table\.copyInsertSql)/); expect(live).not.toMatch(/query(?:<[^>]+>)?\(['"`]\s*(?:CREATE|DROP|INSERT|UPDATE|DELETE|GRANT)\b/i);
  const captureGuard = beforeEach.mock.calls[0][0]; captureGuard({ trace: 'off', screenshot: 'off', video: 'off' }, {}); expect(() => captureGuard({ trace: 'on', screenshot: 'off', video: 'off' }, {})).toThrow('禁止轨迹'); expect(retain).toHaveBeenCalledTimes(1);
});
