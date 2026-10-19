import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { fileFirstModelCases } from '../helpers/queryFileFirstModelNative';
import { bindFileFirstModelEnvironment } from '../helpers/queryFileFirstModelNativeGate';
import { firstModelProof, firstModelReport } from '../fixtures/native-file-first-model-ci';

// 原ESM只定义消费者，测试执行端口始终为RAM；不加载CLI或运行原生程序。
const runner: any = await import(new URL('../../scripts/native-file-first-model-ci.mjs', import.meta.url).href);
const identity: any = await import(new URL('../../scripts/native-editor-ci-identity.mjs', import.meta.url).href);
const directories: string[] = [], parent = resolve('.cache/native-file-first-model-ci-tests');
const context = { commit: 'a'.repeat(40), runId: 'RAM-1', attempt: '1', job: 'desktop', platform: process.platform, arch: process.arch, version: '0.28.0' };
/** 只删除本测试新建且已核规范路径的缓存，绝不清理CI或其他人的失败现场。 */
afterEach(() => { for (const directory of directories.splice(0)) { const part = relative(parent, directory); if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part) || lstatSync(directory).isSymbolicLink() || realpathSync.native(directory) !== directory) throw Error('拒绝删除未知测试目录'); rmSync(directory, { recursive: true, force: true }); } });
/** 通过原identity生产器封存公开合成字节，非真实Root批准；不build或安装。 */
function fixture(phase: 'source' | 'installed' = 'source') {
  mkdirSync(parent, { recursive: true }); const directory = realpathSync.native(mkdtempSync(join(parent, '独立-'))); directories.push(directory);
  const put = (file: string, value = '公开RAM字节') => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); return file; };
  const project = join(directory, 'project'); put(join(project, 'package.json'), JSON.stringify({ main: 'dist/main/index.cjs', version: '0.28.0' })); put(join(project, 'scripts/check-offline-query-port.mjs'));
  let root = project, executable: string, resources: string;
  if (phase === 'source') { put(join(project, 'dist/main/index.cjs')); put(join(project, 'dist/renderer/index.html')); executable = put(join(directory, 'electron/Electron')); resources = dirname(put(join(directory, 'electron/resources/default_app.asar'))); }
  else { root = join(directory, 'installed'); executable = put(join(root, 'DBArk.exe')); resources = dirname(put(join(root, 'resources/app.asar'))); }
  const output = join(project, 'test-results/native-file-first-model-ci'), approvalRoot = join(project, 'test-results/native-editor-ci');
  const approval = identity.sealApproval({ identity: identity.collectIdentity({ project, kind: phase, root, executable, resources }), project, output: approvalRoot, phase, context, provenance: { note: '仅合成RAM批准' } });
  const options = { project, approval, phase, output, parentEnv: {}, currentContext: () => context };
  const run = (execute: any, patch: Record<string, unknown> = {}) => runner.runNativeFileFirstModel({ ...options, ...patch }, execute);
  const success = vi.fn((_exe: string, args: string[], input: any) => {
    expect(args).toContain(runner.fileFirstModelSpec); expect(args).not.toContain('--list'); expect(args).toContain('--retries=0');
    const platform = process.platform === 'win32' ? 'win32' : 'darwin'; bindFileFirstModelEnvironment(() => ({ env: input.env, args, platform })).assertCurrent();
    writeFileSync(input.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(firstModelReport())); return { status: 0, stdout: '仅RAM执行', stderr: '' };
  });
  return { directory, put, project, executable, resources, output, approvalRoot, approval, options, run, success };
}

it('四例元数据逐字匹配当前原golden，正式报告绑定live而CLI仍选声明spec', () => {
  expect(runner.fileFirstModelCases).toEqual(fileFirstModelCases.map(({ key, title, entry, eol }) => ({ key, title, entry, eol })));
  expect(runner.assertFileFirstModelResult(firstModelReport()).map((proof: any) => proof.caseKey)).toEqual(fileFirstModelCases.map(value => value.key));
});
it.each(['source', 'installed'] as const)('%s只消费同job原indent清单，独立四例receipt绑定原报告SHA且不重签', phase => {
  const f = fixture(phase), original = [f.approval.path, f.approval.value.manifests.indent.path, f.approval.value.manifests.layout.path].map((file: string) => [file, readFileSync(file)] as const);
  // 故意篡改调用者value副本：消费者必须重新读原批准，不按此选择项目或清单。
  f.approval.value.project = '/不得选择'; f.approval.value.manifests.indent.path = '/不得使用';
  const result = f.run(f.success); expect(f.success).toHaveBeenCalledOnce(); expect(result.proofs).toHaveLength(4);
  for (const [file, bytes] of original) expect(readFileSync(file)).toEqual(bytes);
  const report = join(f.output, phase, 'report.json'), receipt = JSON.parse(readFileSync(join(f.output, phase, 'accepted.json'), 'utf8'));
  expect(receipt).toMatchObject({ phase, spec: runner.fileFirstModelSpec, reportFile: runner.fileFirstModelLive, approvalSha256: f.approval.sha256, reportSha256: identity.sha256(readFileSync(report)), context });
  expect(receipt.manifest.path).toBe(original[1][0]); expect(result.proofs.map((proof: any) => proof.caseKey)).toEqual(fileFirstModelCases.map(value => value.key));
  expect(runner.fileFirstModelCleanupAllowed(result)).toBe(phase === 'installed');
});
it.each(['wrong-absolute', 'wrong-windows-absolute', 'wrong-spec', 'duplicate-title', 'wrong-title', 'duplicate-key', 'retry', 'skip', 'extra-result', 'error', 'missing-footer', 'duplicate-footer', 'missing-case', 'stats-skip'] as const)('拒绝原报告%s，不能以同名或部分通过替代四例', mode => {
  const report: any = firstModelReport(), specs = report.suites[0].specs, test = specs[0].tests[0], result = test.results[0];
  if (mode === 'wrong-absolute') specs[0].file = '/other/query-file-first-model-native-live.ts';
  else if (mode === 'wrong-windows-absolute') specs[0].file = 'C:\\other\\query-file-first-model-native-live.ts';
  else if (mode === 'wrong-spec') specs[0].file = 'query-file-first-model-native.spec.ts';
  else if (mode === 'duplicate-title') specs[1].title = specs[0].title;
  else if (mode === 'wrong-title') specs[0].title += '其他';
  else if (mode === 'duplicate-key') { const proof = firstModelProof(); proof.caseKey = fileFirstModelCases[1].key; result.attachments[0].body = Buffer.from(JSON.stringify(proof)).toString('base64'); }
  else if (mode === 'retry') result.retry = 1;
  else if (mode === 'skip') result.status = 'skipped';
  else if (mode === 'extra-result') test.results.push({ ...result });
  else if (mode === 'error') result.errors.push({ message: '原错误' });
  else if (mode === 'missing-footer') result.attachments = [];
  else if (mode === 'duplicate-footer') result.attachments.push({ ...result.attachments[0] });
  else if (mode === 'missing-case') specs.pop();
  else report.stats.skipped = 1;
  expect(() => runner.assertFileFirstModelResult(report)).toThrow();
});
it.each(['accepted', 'ordinarySingleUndo', 'formatSingleUndo', 'sqliteSchema', 'directoryRemoved', 'systemClipboard', 'sqlExecution', 'queryLibraryWrites', 'dirtyAnswerInstalled', 'owners', 'owner-closed', 'owner-pid', 'identity', 'witness', 'model', 'files'] as const)('footer的%s不完整立即拒绝', field => {
  const proof: any = firstModelProof();
  if (field === 'owners') proof.normalOwners.pop();
  else if (field === 'owner-closed') proof.normalOwners[0].closed = false;
  else if (field === 'owner-pid') proof.normalOwners[0].recordedPids = 0;
  else if (field === 'witness') proof.witnesses.pop();
  else if (field === 'model') delete proof.witnesses[1].model;
  else if (field === 'files') proof.files.pop();
  else delete proof[field];
  expect(() => runner.assertFileFirstModelProof(proof, fileFirstModelCases[0])).toThrow();
});
it.each(['options', 'event', 'selection', 'clean-bytes', 'file-path', 'initial-identity'] as const)('完整footer不能用%s缺口冒充原见证', mode => {
  const proof: any = firstModelProof();
  if (mode === 'options') proof.witnesses[1].model.options = {};
  else if (mode === 'event') delete proof.witnesses[1].model.events[0].undo;
  else if (mode === 'selection') proof.witnesses[1].model.selections[0].position = -1;
  else if (mode === 'clean-bytes') proof.witnesses[2].model.value += ' ';
  else if (mode === 'file-path') proof.files[3].path = '/other.sql';
  else proof.witnesses[0].identity = { ...proof.identity, ino: 'other' };
  expect(() => runner.assertFileFirstModelProof(proof, fileFirstModelCases[0])).toThrow();
});
it.each(['DBARK_AUTH_TOKEN', 'DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'PWDEBUG', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'dbark_native_editor_ci', 'DBARK_FILE_FIRST_MODEL_MANIFEST', 'DBARK_UNKNOWN'])('父环境%s在执行前拒绝，值不进入诊断', key => {
  const f = fixture(); expect(() => f.run(f.success, { parentEnv: { [key]: '合成敏感值' } })).toThrow(key); expect(f.success).not.toHaveBeenCalled();
  expect(readFileSync(join(f.output, 'source/failure.json'), 'utf8')).not.toContain('合成敏感值');
});
it('访问器不执行，旧CI/legacy控制被隔离，新子环境只有准确新门和原manifest', () => {
  const f = fixture(), getter = vi.fn(() => { throw Error('访问器不能执行'); });
  expect(() => f.run(f.success, { parentEnv: Object.defineProperty({}, 'DBARK_AUTH_TOKEN', { get: getter }) })).toThrow(); expect(getter).not.toHaveBeenCalled();
  const env = runner.fileFirstModelEnvironment({ PATH: '合成路径', DBARK_INTEGRATION_ENABLED: '0', DBARK_NATIVE_EDITOR_CI: '1', DBARK_EDITOR_FONT_NATIVE_TEST: '1', KEEP_FIXTURE: '丢弃' }, identity.readApproval(f.approval.path, f.approval.sha256, context), '/RAM/report.json');
  expect(Object.keys(env).filter(key => key.startsWith('DBARK_')).sort()).toEqual(['DBARK_FILE_FIRST_MODEL_MANIFEST', 'DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256', 'DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED', 'DBARK_FILE_FIRST_MODEL_NATIVE_TEST', 'DBARK_INTEGRATION_ENABLED']);
  expect(env.KEEP_FIXTURE).toBeUndefined(); expect(env.DBARK_FILE_FIRST_MODEL_MANIFEST).toBe(f.approval.value.manifests.indent.path);
});
it.each(['bytes', 'manifest', 'job', 'phase', 'output'] as const)('%s漂移不启动、不重签原批准', mode => {
  const f = fixture(), original = readFileSync(f.approval.path), patch: any = {};
  if (mode === 'bytes') f.put(join(f.project, 'dist/main/index.cjs'), '变更');
  else if (mode === 'manifest') writeFileSync(f.approval.value.manifests.indent.path, '{}');
  else if (mode === 'job') patch.currentContext = () => ({ ...context, attempt: '2' });
  else if (mode === 'phase') patch.phase = 'installed';
  else patch.output = join(f.project, 'test-results/legacy-source');
  expect(() => f.run(f.success, patch)).toThrow(); expect(f.success).not.toHaveBeenCalled(); expect(readFileSync(f.approval.path)).toEqual(original);
});
it.each([1, null] as const)('非零/未知退出%s先于绿色JSON拒绝，原报告保留且不能重跑覆盖', status => {
  const f = fixture(), execute = vi.fn((_exe: string, _args: string[], input: any) => { writeFileSync(input.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(firstModelReport())); return { status, stdout: '原日志', stderr: '原错误' }; });
  expect(() => f.run(execute)).toThrow('退出'); expect(execute).toHaveBeenCalledOnce(); expect(existsSync(join(f.output, 'source/accepted.json'))).toBe(false);
  const original = readFileSync(join(f.output, 'source/report.json')); expect(() => f.run(execute)).toThrow(); expect(execute).toHaveBeenCalledOnce(); expect(readFileSync(join(f.output, 'source/report.json'))).toEqual(original);
});
it('进程返回后运行树漂移使原绿色报告失效，不生成receipt', () => {
  const f = fixture(), execute = vi.fn((exe: string, args: string[], input: any) => { const result = f.success(exe, args, input); f.put(join(f.project, 'dist/main/index.cjs'), '迟到变化'); return result; });
  expect(() => f.run(execute)).toThrow(); expect(execute).toHaveBeenCalledOnce(); expect(existsSync(join(f.output, 'source/accepted.json'))).toBe(false);
});
it('进程返回后job代次漂移不能把原报告续签为当前成功', () => {
  const f = fixture(); let current = context;
  const execute = vi.fn((exe: string, args: string[], input: any) => { const result = f.success(exe, args, input); current = { ...context, attempt: '2' }; return result; });
  expect(() => f.run(execute, { currentContext: () => current })).toThrow(); expect(execute).toHaveBeenCalledOnce(); expect(existsSync(join(f.output, 'source/accepted.json'))).toBe(false);
});
it.each([[], ['--list'], ['--list=true'], ['installed']].map(args => ({ args })))('默认/list/非源码CLI参数$args在全部资源前拒绝', ({ args }) => {
  const source = readFileSync(new URL('../../scripts/native-file-first-model-ci.mjs', import.meta.url), 'utf8'), tree = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), entry = tree.statements.find(ts.isIfStatement)!;
  const resource = vi.fn(() => { throw Error('不得启动资源'); }), state = { argv: ['node', '/RAM/script.mjs', ...args], env: {}, exitCode: 0 };
  const code = entry.thenStatement.getText(tree).replaceAll('import.meta.url', '"file:///RAM/script.mjs"');
  runInNewContext(code, { process: state, realpathSync: { native: resource }, fileURLToPath: resource, ciContext: resource, runNativeFileFirstModel: resource, join: posix.join, console: { error: vi.fn() } });
  expect(state.exitCode).toBe(1); expect(resource).not.toHaveBeenCalled();
});
