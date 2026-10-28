import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, platform, release, version } from 'node:os';
import { buildSourceApproval, ciContext, executeOnce } from './native-editor-ci.mjs';
import { readApproval, sha256, writeOnce } from './native-editor-ci-identity.mjs';
import { assertKeywordReport } from './v028-keyword-native-ci.mjs';

export const keywordCurrentSpec = 'tests/e2e/sql-keyword-case-native.spec.ts';
export const keywordCurrentJob = 'keyword-current-arm64';

/** 仅当前main的独立托管arm64 job首次运行可领取；手动重跑不是同一次准许。 */
export function requireKeywordCurrentCI(args, actualPlatform, actualArch, env) {
  assert.deepEqual(args, ['source']); assert.equal(actualPlatform, 'darwin'); assert.equal(actualArch, 'arm64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.GITHUB_REPOSITORY, 'zhao-yc/DBArk'); assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_WORKFLOW_REF, 'zhao-yc/DBArk/.github/workflows/sql-keyword-current.yml@refs/heads/main');
  assert.equal(env.GITHUB_JOB, keywordCurrentJob); assert.equal(env.KEYWORD_CURRENT_RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.RUNNER_OS, 'macOS'); assert.equal(env.RUNNER_ARCH, 'ARM64'); assert.equal(env.GITHUB_RUN_ATTEMPT, '1');
  assert.ok(['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)); assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA); assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
}

/** 白名单只保留桌面启动必需项；父DBARK/NODE/注入、认证、其它专项门全部不传给构建或应用。 */
export function keywordCurrentEnvironment(parent) {
  const allowed = /^(PATH|Path|TMPDIR|TMP|TEMP|HOME|USER|LOGNAME|LANG|LC_ALL|LC_CTYPE|TZ|CI|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|__CF_USER_TEXT_ENCODING)$/;
  return Object.fromEntries(Object.entries(parent).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
}

/** 只运行原两例；原spec内部保留120秒、5秒断言及关闭全部录制的原门。 */
export function keywordCurrentArguments(project, output) {
  return [join(project, 'node_modules/@playwright/test/cli.js'), 'test', keywordCurrentSpec, '--workers=1', '--retries=0', '--timeout=120000', '--trace=off', '--reporter=list,json', '--output=' + join(output, 'attachments')];
}

/** 不设外层进程超时或kill；stdout/stderr直接写独占文件，避免缓冲上限截断原日志或杀掉原进程。 */
export function recordedKeywordCurrentCommand(directory, name, executable, args, options, execute = executeOnce) {
  const stdoutPath = join(directory, name + '.stdout.log'), stderrPath = join(directory, name + '.stderr.log');
  const stdout = openSync(stdoutPath, 'wx'), stderr = openSync(stderrPath, 'wx'); let result;
  try { result = execute(executable, args, { ...options, stdio: ['ignore', stdout, stderr] }); }
  catch (error) { result = { status: null, signal: null, error }; }
  finally { closeSync(stdout); closeSync(stderr); }
  writeOnce(join(directory, name + '.process.json'), { status: result.status ?? null, signal: result.signal ?? null, errorCode: result.error?.code ?? null, automaticRetry: false, automaticForceStop: false });
  return { ...result, stdout: readFileSync(stdoutPath, 'utf8'), stderr: readFileSync(stderrPath, 'utf8') };
}

/** 子进程失败或未知状态不能被成功报告覆盖；原文件和失败报告保持首轮原样。 */
function requireSuccess(result) { if (result.error || result.status !== 0) throw result.error ?? Error('关键字源码专项子进程失败，退出码：' + result.status); }

/** 原进程退出和原两例完整终态缺一不可，绝不靠绿色报告覆盖未知/失败进程。 */
export function assertKeywordCurrentRun(result, report) { requireSuccess(result); return assertKeywordReport(report); }

/** 全链只签本次源码新清单，不调用旧专项run、安装、下载、显示模式调整或失败清理。 */
export function runCurrentKeywordSource(parentEnv = process.env, execute = executeOnce) {
  requireKeywordCurrentCI(process.argv.slice(2), process.platform, process.arch, parentEnv);
  const project = realpathSync.native(fileURLToPath(new URL('../', import.meta.url))), output = join(project, 'test-results/sql-keyword-current');
  if (existsSync(output)) throw Error('本次关键字源码证据目录已存在，拒绝重跑或覆盖原失败');
  mkdirSync(output, { recursive: true });
  const env = keywordCurrentEnvironment(parentEnv);
  const currentContext = () => { requireKeywordCurrentCI(process.argv.slice(2), process.platform, process.arch, parentEnv); return ciContext(project, parentEnv, (executable, args, options) => execute(executable, args, { ...options, env })); };
  try {
    const context = currentContext();
    writeOnce(join(output, 'started.json'), { context, ref: parentEnv.GITHUB_REF, workflow: parentEnv.GITHUB_WORKFLOW_REF, event: parentEnv.GITHUB_EVENT_NAME, runnerEnvironment: parentEnv.KEYWORD_CURRENT_RUNNER_ENVIRONMENT, platform: platform(), arch: arch(), osRelease: release(), osVersion: version(), imageOS: parentEnv.ImageOS ?? null, imageVersion: parentEnv.ImageVersion ?? null, automaticRetry: false, automaticForceStop: false, scope: '当前源码原关键词两例，无安装/发布/系统保存/剪贴板/实库' });
    const os = recordedKeywordCurrentCommand(output, 'macos-version', '/usr/bin/sw_vers', [], { cwd: project, env }, execute); requireSuccess(os);
    const machine = recordedKeywordCurrentCommand(output, 'macos-architecture', '/usr/bin/uname', ['-m'], { cwd: project, env }, execute); requireSuccess(machine); assert.equal(machine.stdout.trim(), 'arm64');
    const trees = recordedKeywordCurrentCommand(output, 'product-trees', 'git', ['rev-parse', 'HEAD:src', 'HEAD:package.json', 'HEAD:pnpm-lock.yaml'], { cwd: project, env }, execute); requireSuccess(trees);
    const objects = trees.stdout.trim().split(/\r?\n/); assert.equal(objects.length, 3); for (const value of objects) assert.match(value, /^[a-f0-9]{40}$/);
    writeOnce(join(output, 'product-identity.json'), { testHead: context.commit, srcTree: objects[0], packageBlob: objects[1], lockBlob: objects[2], objectHashAlgorithm: 'git-sha1', context, originalSpecSha256: sha256(readFileSync(join(project, keywordCurrentSpec))) });
    // 原固定回环拒连预检先于type/build批准；它本身不运行任何其它原生专项。
    const offline = recordedKeywordCurrentCommand(output, 'offline-port', process.execPath, [join(project, 'scripts/check-offline-query-port.mjs')], { cwd: project, env }, execute); requireSuccess(offline);
    const require = createRequire(join(project, 'package.json')), executable = realpathSync.native(require('electron'));
    const resources = realpathSync.native(resolve(dirname(executable), '../Resources')); let buildIndex = 0;
    const approval = buildSourceApproval({ project, output, context, executable, resources, currentContext }, (binary, args, options) => recordedKeywordCurrentCommand(output, ['raw-typecheck', 'raw-build'][buildIndex++], binary, args, { ...options, env }, execute));
    readApproval(approval.path, approval.sha256, currentContext()); assert.equal(approval.value.phase, 'source');
    const directory = join(output, 'keyword'); mkdirSync(directory);
    const approved = approval.value.manifests.indent, manifest = join(directory, 'keyword-manifest.json');
    copyFileSync(approved.path, manifest, constants.COPYFILE_EXCL); const manifestSha256 = sha256(readFileSync(manifest)); assert.equal(manifestSha256, approved.sha256);
    const report = join(directory, 'report.json');
    const keywordEnv = { ...env, DBARK_INTEGRATION_ENABLED: '0', DBARK_SQL_KEYWORD_CASE_NATIVE_TEST: '1', DBARK_SQL_KEYWORD_CASE_MANIFEST: manifest, DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256: manifestSha256, PLAYWRIGHT_JSON_OUTPUT_FILE: report };
    writeOnce(join(directory, 'started.json'), { spec: keywordCurrentSpec, context, approvalSha256: approval.sha256, manifestSha256, workers: 1, retries: 0, timeout: 120000, trace: 'off', screenshot: 'off', video: 'off', automaticRetry: false, automaticForceStop: false });
    const result = recordedKeywordCurrentCommand(directory, 'playwright', process.execPath, keywordCurrentArguments(project, directory), { cwd: project, env: keywordEnv }, execute);
    requireSuccess(result);
    const reportBytes = readFileSync(report), proofs = assertKeywordCurrentRun(result, JSON.parse(reportBytes.toString('utf8')));
    readApproval(approval.path, approval.sha256, currentContext()); assert.equal(sha256(readFileSync(manifest)), manifestSha256);
    const manifestFileCount = JSON.parse(readFileSync(manifest, 'utf8')).files.length;
    const receipt = { accepted: true, phase: 'source', context, spec: keywordCurrentSpec, approvalSha256: approval.sha256, manifestSha256, manifestFileCount, reportSha256: sha256(reportBytes), proofs, automaticRetry: false, automaticForceStop: false, installed: false };
    writeOnce(join(directory, 'accepted.json'), receipt); console.log('DBARK_CURRENT_KEYWORD_ACCEPTED:' + JSON.stringify(receipt)); return receipt;
  } catch (error) {
    writeOnce(join(output, 'failure.json'), { message: String(error), automaticRetry: false, automaticForceStop: false, cleanupAllowed: false }); throw error;
  }
}

// 导入只提供纯校验与入口；无参数/list/旧模式均在任何路径、批准或子进程访问前被拒绝。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runCurrentKeywordSource(); } catch (error) { console.error(error); process.exitCode = 1; }
}
