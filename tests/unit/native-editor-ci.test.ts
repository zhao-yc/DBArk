import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sealEditorIndentLaunchIdentity } from '../e2e/editor-indentation-native-identity';
import { lstat, realpath, readdir, readFile } from 'node:fs/promises';
import { assertEditorIndentNativeEnvironment } from '../e2e/editor-indentation-native-gate';
import { assertQueryLayoutNativeEnvironment } from '../e2e/query-layout-native-gate';

// 通过原生ESM加载真实脚本；不转写实现，不执行脚本CLI入口或实际构建/Playwright。
const identity: any = await import(new URL('../../scripts/native-editor-ci-identity.mjs', import.meta.url).href);
const runner: any = await import(new URL('../../scripts/native-editor-ci.mjs', import.meta.url).href);
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const context = { commit: 'a'.repeat(40), runId: '123', attempt: '1', job: 'desktop', platform: process.platform, arch: process.arch, version: '0.28.0' };
/** 仅本任务缓存内的合成公开字节；无端口、安装器执行、真实SQL文件或外部目录。 */
function fixture() {
  const parent = resolve('.cache/native-editor-ci-tests'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, '独立-')); directories.push(directory);
  const put = (path: string, text = '公开合成字节') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path; };
  const project = join(directory, 'project');
  put(join(project, 'package.json'), JSON.stringify({ main: 'dist/main/index.cjs', version: '0.28.0' }));
  put(join(project, 'scripts/check-offline-query-port.mjs')); put(join(project, 'dist/main/index.cjs')); put(join(project, 'dist/renderer/index.html'));
  const executable = put(join(directory, 'electron', process.platform === 'win32' ? 'electron.exe' : 'Electron'));
  const resources = dirname(put(join(directory, 'electron/resources/default_app.asar')));
  const output = join(project, 'test-results/native-editor-ci');
  const build = vi.fn(() => ({ status: 0, stdout: '仅RAM编译端口', stderr: '' }));
  const approve = () => runner.buildSourceApproval({ project, output, context, executable, resources }, build);
  return { directory, put, project, executable, resources, output, build, approve };
}
/** 保留原Playwright报告形状和原终态字段；只有子进程返回端口由测试提供。 */
function report(specialty: any, patch: Record<string, unknown> = {}) {
  const proof = { accepted: true, normalOwners: [0, 1].map(() => ({ confirmed: true, willQuit: true, closed: true, recordedPids: 3 })), directoryRemoved: true, systemClipboard: 0, sqlExecution: 0, ...(specialty.name === 'indent' ? { sqliteChecked: true } : { schema: 9 }), ...patch };
  return { errors: [], suites: [{ specs: [{ file: specialty.spec.split('/').at(-1), ok: true, tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [], attachments: [{ name: specialty.attachment, contentType: 'application/json', body: Buffer.from(JSON.stringify(proof)).toString('base64') }] }] }] }] }] };
}
const port = { stat: async (path: string) => { const value = await lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }, real: realpath, list: readdir, bytes: readFile };

describe('原生专项CI同次构建批准及精确运行', () => {
  it('编译失败不签任何清单、不启动测试、不重试', () => {
    const f = fixture(), execute = vi.fn(() => ({ status: 1, stdout: '原编译失败', stderr: '' }));
    expect(() => runner.buildSourceApproval({ ...f, context }, execute)).toThrow('退出码');
    expect(execute).toHaveBeenCalledTimes(1); expect(existsSync(join(f.output, 'source-approval.json'))).toBe(false);
  });
  it('仅专属tsc显式使用4096MiB堆，原两次构建次序和后续build参数保持', () => {
    const f = fixture(); f.approve();
    expect(f.build.mock.calls).toEqual([
      [process.execPath, ['--max-old-space-size=4096', join(f.project, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: f.project }],
      [process.execPath, [join(f.project, 'scripts/build.mjs')], { cwd: f.project }],
    ]);
    for (const name of ['typecheck', 'build']) expect(JSON.parse(readFileSync(join(f.output, name + '.process.json'), 'utf8'))).toEqual({ status: 0, signal: null, errorCode: null });
  });
  it.each([
    { result: { status: null, signal: 'SIGABRT', stdout: '原类型检查输出', stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' }, terminal: { status: null, signal: 'SIGABRT', errorCode: null } },
    { result: { status: null, signal: null, stdout: '', stderr: '', error: Object.assign(Error('原进程无法启动'), { code: 'ENOMEM' }) }, terminal: { status: null, signal: null, errorCode: 'ENOMEM' } },
  ])('类型检查未知/失败保留原终态，不签批准、不构建或启动专项：$terminal.errorCode/$terminal.signal', ({ result, terminal }) => {
    const f = fixture(), execute = vi.fn(() => result), native = vi.fn();
    expect(() => {
      const approval = runner.buildSourceApproval({ ...f, context }, execute);
      runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: {} }, native);
    }).toThrow();
    expect(execute).toHaveBeenCalledOnce(); expect(native).not.toHaveBeenCalled();
    expect(readFileSync(join(f.output, 'typecheck.stdout.log'), 'utf8')).toBe(result.stdout);
    expect(readFileSync(join(f.output, 'typecheck.stderr.log'), 'utf8')).toBe(result.stderr);
    const path = join(f.output, 'typecheck.process.json'), bytes = readFileSync(path);
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(terminal);
    for (const name of ['build.stdout.log', 'build.stderr.log', 'build.process.json', 'source-approval.json', 'source-indent-manifest.json', 'source-layout-manifest.json', 'source-indent', 'source-layout']) expect(existsSync(join(f.output, name))).toBe(false);
    expect(() => runner.buildSourceApproval({ ...f, context }, execute)).toThrow('现场已存在');
    expect(execute).toHaveBeenCalledOnce(); expect(readFileSync(path)).toEqual(bytes);
  });
  it('成功build后批准的两个清单可直接通过原identity；不复制校验器', async () => {
    const f = fixture(), approval = f.approve(); expect(f.build).toHaveBeenCalledTimes(2);
    for (const value of Object.values(approval.value.manifests) as any[]) {
      const original = await sealEditorIndentLaunchIdentity(value.path, value.sha256, f.project, port, () => {});
      expect(original.manifest.kind).toBe('source'); await original.assertCurrent();
    }
    expect(() => f.approve()).toThrow(); // 同一输出不能被重新批准覆盖。
    expect(f.build).toHaveBeenCalledTimes(2);
  });
  it('源码/job身份在build等待后变化时不生成批准', () => {
    const f = fixture(); expect(() => runner.buildSourceApproval({ ...f, context, currentContext: () => ({ ...context, commit: 'b'.repeat(40) }) }, f.build)).toThrow('漂移');
    expect(existsSync(join(f.output, 'source-approval.json'))).toBe(false);
  });
  it.each(['bytes', 'extra', 'manifest', 'job'] as const)('批准后%s漂移阻止后续执行且不重签', mode => {
    const f = fixture(), approval = f.approve(), initial = readFileSync(approval.path);
    if (mode === 'bytes') f.put(join(f.project, 'dist/main/index.cjs'), '后来新字节');
    if (mode === 'extra') f.put(join(f.project, 'dist/renderer/多出.js'));
    if (mode === 'manifest') writeFileSync(approval.value.manifests.indent.path, '{}');
    expect(() => identity.readApproval(approval.path, approval.sha256, mode === 'job' ? { ...context, attempt: '2' } : context)).toThrow();
    expect(readFileSync(approval.path)).toEqual(initial);
  });
  it('两个单例分别开门，原gate真实接受最小环境，且只运行一次各自spec', () => {
    const f = fixture(), approval = f.approve(), environments: any[] = [];
    const execute = vi.fn((_executable: string, args: string[], options: any) => {
      const specialty = runner.nativeSpecialties[environments.length]; environments.push(options.env);
      expect(args).toContain(specialty.spec); expect(args).toContain('--retries=0'); expect(args).not.toContain('--list');
      const platform = process.platform === 'win32' ? 'win32' : 'darwin';
      (specialty.name === 'indent' ? assertEditorIndentNativeEnvironment : assertQueryLayoutNativeEnvironment)(options.env, args, platform);
      writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(report(specialty))); return { status: 0, stdout: '仅RAM运行端口', stderr: '' };
    });
    const result = runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: { PATH: '合成路径', KEEP_FIXTURE: '不能继承', DBARK_EDITOR_FONT_NATIVE_TEST: '1' } }, execute);
    expect(result.cleanupAllowed).toBe(true); expect(execute).toHaveBeenCalledTimes(2);
    // receipt固定原报告字节和同次批准；不以绿色step或另一次报告代替本专项。
    for (const specialty of runner.nativeSpecialties) {
      const directory = join(f.output, 'source-' + specialty.name);
      const receipt = JSON.parse(readFileSync(join(directory, 'accepted.json'), 'utf8'));
      expect(receipt).toMatchObject({ phase: 'source', specialty: specialty.name, spec: specialty.spec, approvalSha256: approval.sha256, reportSha256: identity.sha256(readFileSync(join(directory, 'report.json'))) });
    }
    expect(environments[0].DBARK_QUERY_LAYOUT_NATIVE_TEST).toBe('0'); expect(environments[1].DBARK_EDITOR_INDENT_NATIVE_TEST).toBe('0');
    expect(Object.hasOwn(environments[1], 'DBARK_EDITOR_INDENT_MANIFEST')).toBe(false); expect(Object.hasOwn(environments[0], 'DBARK_QUERY_LAYOUT_MANIFEST')).toBe(false);
    for (const env of environments) { expect(env.KEEP_FIXTURE).toBeUndefined(); expect(env.DBARK_EDITOR_FONT_NATIVE_TEST).toBeUndefined(); expect(env.DBARK_EXECUTABLE_PATH).toBeUndefined(); }
  });
  it('首个专项失败即停，不运行第二项或覆盖原报告，不授权清理', () => {
    const f = fixture(), approval = f.approve();
    const execute = vi.fn((_executable: string, _args: string[], options: any) => { writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE, '原失败报告'); return { status: 1, stdout: '原失败', stderr: '原错误' }; });
    expect(() => runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: {} }, execute)).toThrow();
    expect(execute).toHaveBeenCalledTimes(1); expect(existsSync(join(f.output, 'source-layout'))).toBe(false);
    expect(readFileSync(join(f.output, 'source-indent/report.json'), 'utf8')).toBe('原失败报告'); expect(runner.packageCleanupAllowed(true, undefined, Error('失败'))).toBe(false);
    expect(() => runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: {} }, execute)).toThrow();
    expect(execute).toHaveBeenCalledTimes(1); // 原现场目录也阻止手动重复调用覆盖首个失败。
  });
  it('未知子进程退出不能用绿色报告冒认通过，也不进入第二专项', () => {
    const f = fixture(), approval = f.approve();
    const execute = vi.fn((_executable: string, _args: string[], options: any) => {
      writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(report(runner.nativeSpecialties[0])));
      return { status: null, signal: 'SIGTERM', stdout: '未确认正常退出', stderr: '' };
    });
    expect(() => runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: {} }, execute)).toThrow('退出码');
    expect(execute).toHaveBeenCalledOnce(); expect(existsSync(join(f.output, 'source-indent/accepted.json'))).toBe(false);
    expect(existsSync(join(f.output, 'source-layout'))).toBe(false);
  });
  it.each(['DBARK_PASSWORD', 'NODE_OPTIONS', 'dbark_integration_enabled'])('危险环境%s明确拒绝而不把值写入日志', key => {
    const f = fixture(), approval = f.approve();
    expect(() => runner.specialtyEnvironment({ [key]: '合成敏感值' }, runner.nativeSpecialties[0], approval, 'report')).toThrow(key);
  });
  it.each([{ accepted: false }, { normalOwners: [] }, { directoryRemoved: false }, { sqliteChecked: false }])('退出原证明不完整拒绝清理：%j', patch => {
    expect(() => runner.assertSpecialtyResult(report(runner.nativeSpecialties[0], patch), runner.nativeSpecialties[0])).toThrow();
  });
  it('重试通过、skip和非本专项报告均不能替代新专项', () => {
    const specialty = runner.nativeSpecialties[0], retried = report(specialty); retried.suites[0].specs[0].tests[0].results[0].retry = 1;
    expect(() => runner.assertSpecialtyResult(retried, specialty)).toThrow();
    expect(() => runner.assertSpecialtyResult(report(runner.nativeSpecialties[1]), specialty)).toThrow();
    const skipped = report(specialty); skipped.suites[0].specs[0].tests[0].results[0].status = 'skipped'; expect(() => runner.assertSpecialtyResult(skipped, specialty)).toThrow();
  });
});

describe('0.28原footer与关闭默认门', () => {
  it('分栏严格消费原schema9终态，旧schema8不能误认当前安装通过', () => {
    const layout = runner.nativeSpecialties[1];
    expect(runner.assertSpecialtyResult(report(layout), layout).schema).toBe(9);
    expect(() => runner.assertSpecialtyResult(report(layout, { schema: 8 }), layout)).toThrow('退出证明');
  });
  it.each(['confirmed', 'willQuit', 'closed', 'recordedPids'] as const)('原owner的%s缺失时不接受receipt', field => {
    const owners = [0, 1].map(() => ({ confirmed: true, willQuit: true, closed: true, recordedPids: 3 }));
    Object.assign(owners[1], { [field]: field === 'recordedPids' ? 0 : false });
    expect(() => runner.assertSpecialtyResult(report(runner.nativeSpecialties[0], { normalOwners: owners }), runner.nativeSpecialties[0])).toThrow('退出证明');
  });
  it('其它DBARK门与未知外部环境均不进入专项，且没有观察层依赖', () => {
    const f = fixture(), approval = f.approve();
    const env = runner.specialtyEnvironment({ PATH: '合成路径', DBARK_UNUSED_DIAGNOSTIC: '1', UNAPPROVED: '合成值' }, runner.nativeSpecialties[0], approval, 'report');
    expect(env.DBARK_UNUSED_DIAGNOSTIC).toBeUndefined(); expect(env.UNAPPROVED).toBeUndefined();
    const source = readFileSync(new URL('../../scripts/native-editor-ci.mjs', import.meta.url), 'utf8');
    expect(source).not.toContain('native-editor-progress'); expect(source).not.toContain('native-startup-wire');
  });
});

describe('真实安装后的字节批准与保守清理', () => {
  it.each(['win32', 'darwin'])('%s安装器仅作输入，实际app匹配参考后才批准且原identity可消费', async platform => {
    const f = fixture(), source = f.approve(), artifact = f.put(join(f.project, 'release', platform === 'win32' ? 'DBArk-0.28.0-win-x64-unsigned.exe' : 'DBArk-0.28.0-mac-arm64-unsigned.dmg'), '只有合成安装输入');
    const executions: string[] = [];
    const execute = vi.fn((_executable: string, args: string[], options: any) => {
      const specialty = runner.nativeSpecialties.find((value: any) => args.includes(value.spec));
      executions.push((options.env.DBARK_EXECUTABLE_PATH ? 'installed-' : 'source-') + specialty.name);
      writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(report(specialty)));
      return { status: 0, stdout: '仅RAM执行端口，未启动安装程序', stderr: '' };
    });
    runner.runNativeEditorSpecialties({ approval: source, output: f.output, parentEnv: {} }, execute);
    const suffix = platform === 'win32' ? 'DBArk.exe' : 'DBArk.app/Contents/MacOS/DBArk';
    const referenceExecutable = f.put(join(f.project, 'release/reference', suffix), '真实app合成字节');
    const referenceRoot = platform === 'win32' ? dirname(referenceExecutable) : resolve(dirname(referenceExecutable), '../..');
    const resources = platform === 'win32' ? join(referenceRoot, 'resources') : join(referenceRoot, 'Contents/Resources');
    f.put(join(resources, 'app.asar'), '合成完整应用资源');
    const proof = identity.preparePackageIdentity({ sourcePath: source.path, sourceHash: source.sha256, context, artifact, referenceExecutable, project: f.project, platform });
    const executable = f.put(join(f.directory, 'installed', suffix), '真实app合成字节');
    const installedRoot = platform === 'win32' ? dirname(executable) : resolve(dirname(executable), '../..');
    const installedResources = platform === 'win32' ? join(installedRoot, 'resources') : join(installedRoot, 'Contents/Resources');
    f.put(join(installedResources, 'app.asar'), '合成完整应用资源');
    expect(() => identity.approveInstalled(proof, artifact, f.output)).toThrow();
    const approval = identity.approveInstalled(proof, executable, f.output);
    runner.runNativeEditorSpecialties({ approval, output: f.output, parentEnv: {} }, execute);
    expect(executions).toEqual(['source-indent', 'source-layout', 'installed-indent', 'installed-layout']);
    expect(execute).toHaveBeenCalledTimes(4);
    for (const phase of ['source', 'installed']) for (const specialty of runner.nativeSpecialties) {
      const directory = join(f.output, phase + '-' + specialty.name);
      const receipt = JSON.parse(readFileSync(join(directory, 'accepted.json'), 'utf8'));
      expect(receipt).toMatchObject({ phase, specialty: specialty.name, spec: specialty.spec, approvalSha256: phase === 'source' ? source.sha256 : approval.sha256, reportSha256: identity.sha256(readFileSync(join(directory, 'report.json'))) });
    }
    const manifest = approval.value.manifests.layout;
    const accepted = await sealEditorIndentLaunchIdentity(manifest.path, manifest.sha256, f.project, port, () => {}); expect(accepted.manifest.kind).toBe('installed');
    const env = runner.specialtyEnvironment({}, runner.nativeSpecialties[1], approval, 'report'); expect(env.DBARK_EXECUTABLE_PATH).toBe(executable);
    expect(runner.packageCleanupAllowed(true, { cleanupAllowed: true, proofs: [{}, {}] }, undefined)).toBe(true);
    expect(runner.packageCleanupAllowed(true, { cleanupAllowed: true, proofs: [{}, {}] }, Error('后来全量失败'))).toBe(false);
  });
  it('安装字节错误或安装输入后来变化时拒绝批准', () => {
    const f = fixture(), source = f.approve(), artifact = f.put(join(f.project, 'release/installer.exe'));
    const referenceExecutable = f.put(join(f.project, 'release/reference/DBArk.exe')); f.put(join(dirname(referenceExecutable), 'resources/app.asar'), '原资源');
    const proof = identity.preparePackageIdentity({ sourcePath: source.path, sourceHash: source.sha256, context, artifact, referenceExecutable, project: f.project, platform: 'win32' });
    const executable = f.put(join(f.directory, 'installed/DBArk.exe')); f.put(join(dirname(executable), 'resources/app.asar'), '错资源');
    expect(() => identity.approveInstalled(proof, executable, f.output)).toThrow('不一致');
    f.put(artifact, '漂移安装输入'); expect(() => identity.approveInstalled(proof, executable, f.output)).toThrow('安装输入漂移');
    expect(existsSync(join(f.output, 'installed-approval.json'))).toBe(false);
  });
});
