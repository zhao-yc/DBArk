import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectIdentity, readApproval, sealApproval, sha256, writeOnce } from './native-editor-ci-identity.mjs';

export const nativeSpecialties = Object.freeze([
  { name: 'indent', spec: 'tests/e2e/editor-indentation-native.spec.ts', gate: 'DBARK_EDITOR_INDENT_NATIVE_TEST', manifest: 'DBARK_EDITOR_INDENT_MANIFEST', attachment: '缩进原生终态' },
  { name: 'layout', spec: 'tests/e2e/query-layout-native.spec.ts', gate: 'DBARK_QUERY_LAYOUT_NATIVE_TEST', manifest: 'DBARK_QUERY_LAYOUT_MANIFEST', attachment: '分栏原生终态' },
]);
/** 子进程一次运行，保留原stdout/stderr和非零状态；不经shell，不重试或强停应用。 */
export function executeOnce(executable, args, options) { return spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options }); }
/** 非零或未知退出都终止调用链，不能以报告覆盖进程失败。 */
function success(result) { if (result.error || result.status !== 0) throw result.error ?? Error('原生专项子进程失败，退出码：' + result.status); }
/** 原始日志只写一次，手动重复调用也不能覆盖首个失败。 */
function saveCommand(directory, name, result) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.stdout.log'), result.stdout ?? '', { flag: 'wx' }); writeFileSync(join(directory, name + '.stderr.log'), result.stderr ?? '', { flag: 'wx' });
}
/** CI批准由审核后的工作流绑定有效checkout和同一runner/job；本地任意hash不冒充Root批准。 */
export function ciContext(project, env = process.env, execute = executeOnce) {
  if (env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !['win32', 'darwin'].includes(process.platform)) throw Error('原生专项CI批准需要原生GitHub job与固定SHA');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB']) if (!env[key]) throw Error('缺少同job身份：' + key);
  const revision = execute('git', ['rev-parse', 'HEAD'], { cwd: project }); success(revision);
  const dirty = execute('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: project }); success(dirty);
  if (revision.stdout.trim() !== env.GITHUB_SHA || dirty.stdout.trim()) throw Error('checkout不匹配批准SHA或源码已修改');
  const require = createRequire(join(project, 'package.json'));
  return { commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB, platform: process.platform, arch: process.arch, node: process.version, version: JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).version, lockSha256: sha256(readFileSync(join(project, 'pnpm-lock.yaml'))), electron: require('electron/package.json').version, playwright: require('@playwright/test/package.json').version };
}
/** 只继承启动桌面所需环境；其它原生门、路径和认证变量不会泄入专项。危险输入明确拒绝。 */
export function specialtyEnvironment(parent, specialty, approval, report) {
  for (const key of Object.keys(parent)) {
    const upper = key.toUpperCase();
    if ((/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(upper) && upper !== key) || ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key) || /^DBARK_(TEST_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|SECRET|CERT|CA_PATH|PRIVATE_KEY)/.test(key)) throw Error('专项拒绝危险或别名环境键：' + key);
  }
  const allowed = /^(PATH|Path|SystemRoot|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|CI|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY)$/;
  const env = Object.fromEntries(Object.entries(parent).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
  env.DBARK_INTEGRATION_ENABLED = '0'; env.DBARK_EDITOR_INDENT_NATIVE_TEST = '0'; env.DBARK_QUERY_LAYOUT_NATIVE_TEST = '0'; env[specialty.gate] = '1';
  env[specialty.manifest] = approval.value.manifests[specialty.name].path; env[specialty.manifest + '_SHA256'] = approval.value.manifests[specialty.name].sha256;
  if (approval.value.phase === 'installed') env.DBARK_EXECUTABLE_PATH = JSON.parse(readFileSync(env[specialty.manifest], 'utf8')).executable;
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = report;
  return env;
}
/** 只消费原用例在原期限内生成的终态，不在用例结束后调用SDK或补造PID证明。 */
export function assertSpecialtyResult(report, specialty) {
  const specs = [];
  const visit = suite => { specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child); };
  for (const suite of report.suites ?? []) visit(suite);
  if (report.errors?.length || specs.length !== 1) throw Error('专项报告缺失或含额外用例');
  const spec = specs[0], tests = spec.tests ?? [], results = tests[0]?.results ?? [];
  // Playwright原JSON的file相对testDir；允许其正式短路径及完整仓库相对路径，不接受任意同名绝对路径。
  if (![specialty.spec, specialty.spec.split('/').at(-1)].includes(String(spec.file).replaceAll('\\', '/')) || !spec.ok || tests.length !== 1 || tests[0].expectedStatus !== 'passed' || tests[0].status !== 'expected' || results.length !== 1 || results[0].status !== 'passed' || results[0].retry !== 0 || results[0].errors?.length) throw Error('专项未单次真实通过，拒绝清理');
  const attachments = (results[0].attachments ?? []).filter(value => value.name === specialty.attachment && value.contentType === 'application/json');
  if (attachments.length !== 1 || typeof attachments[0].body !== 'string' || attachments[0].body.length > 8 * 1024 * 1024) throw Error('专项原退出附件缺失');
  const proof = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString('utf8'));
  if (proof.accepted !== true || proof.directoryRemoved !== true || proof.systemClipboard !== 0 || proof.sqlExecution !== 0 || proof.normalOwners?.length !== 2 || proof.normalOwners.some(owner => owner.confirmed !== true || owner.willQuit !== true || owner.closed !== true || !Number.isSafeInteger(owner.recordedPids) || owner.recordedPids < 1) || (specialty.name === 'indent' ? proof.sqliteChecked !== true : proof.schema !== 8)) throw Error('专项原owner/SQLite/退出证明不完整');
  return proof;
}
/** 两项各开一个进程、各消费固定批准；首个失败停链，原现场始终保留。 */
export function runNativeEditorSpecialties({ approval, output, parentEnv = process.env }, execute = executeOnce) {
  // 后续参数只取批准原字节，不使用调用者可修改的value副本选择项目或清单。
  approval = readApproval(approval.path, approval.sha256, approval.value.context);
  if (resolve(output) !== dirname(approval.path)) throw Error('专项输出不属于原批准目录');
  mkdirSync(output, { recursive: true });
  const proofs = [];
  for (const specialty of nativeSpecialties) {
    const directory = join(output, approval.value.phase + '-' + specialty.name); mkdirSync(directory);
    const report = join(directory, 'report.json');
    writeOnce(join(directory, 'started.json'), { phase: approval.value.phase, specialty: specialty.name, spec: specialty.spec, approvalSha256: approval.sha256, automaticRetry: false, automaticForceStop: false, cleanupAllowed: false });
    try {
      readApproval(approval.path, approval.sha256, approval.value.context);
      const env = specialtyEnvironment(parentEnv, specialty, approval, report);
      const result = execute(process.execPath, [join(approval.value.project, 'node_modules/@playwright/test/cli.js'), 'test', specialty.spec, '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=' + join(directory, 'attachments')], { cwd: approval.value.project, env });
      saveCommand(directory, 'playwright', result); success(result);
      const proof = assertSpecialtyResult(JSON.parse(readFileSync(report, 'utf8')), specialty);
      readApproval(approval.path, approval.sha256, approval.value.context);
      writeOnce(join(directory, 'accepted.json'), { phase: approval.value.phase, specialty: specialty.name, proof }); proofs.push(proof);
    } catch (error) {
      writeOnce(join(directory, 'failure.json'), { phase: approval.value.phase, specialty: specialty.name, message: String(error), automaticRetry: false, automaticForceStop: false, cleanupAllowed: false });
      throw error;
    }
  }
  const result = { phase: approval.value.phase, cleanupAllowed: true, automaticRetry: false, proofs };
  writeOnce(join(output, approval.value.phase + '-completed.json'), result); return result;
}
/** 同次成功编译之后才签源码清单，编译失败绝不签名或启动专项。 */
export function buildSourceApproval({ project, output, context, executable, resources, currentContext = () => context }, execute = executeOnce) {
  mkdirSync(output, { recursive: true });
  if (['typecheck.stdout.log', 'source-approval.json', 'source-indent-manifest.json', 'source-layout-manifest.json'].some(name => existsSync(join(output, name)))) throw Error('原构建/批准现场已存在，拒绝重复构建或重签');
  for (const [name, args] of [['typecheck', [join(project, 'node_modules/typescript/bin/tsc'), '--noEmit']], ['build', [join(project, 'scripts/build.mjs')]]]) {
    const result = execute(process.execPath, args, { cwd: project }); saveCommand(output, name, result); success(result);
  }
  if (JSON.stringify(currentContext()) !== JSON.stringify(context)) throw Error('build期间源码或job身份漂移');
  const identity = collectIdentity({ project, kind: 'source', root: project, executable, resources });
  return sealApproval({ identity, project, output, phase: 'source', context, provenance: { build: '同次typecheck及scripts/build.mjs成功', distSha256: sha256(Buffer.from(JSON.stringify(identity.files.filter(file => file.path.startsWith(join(project, 'dist') + sep)).map(file => file.sha256)))) } });
}
/** 安装外层只在全部测试及两个原owner证明闭合后清理；失败/未知均保留安装根。 */
export function packageCleanupAllowed(enabled, nativeResult, failure) { return !enabled || !failure && nativeResult?.cleanupAllowed === true && nativeResult.proofs?.length === 2; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'source') throw Error('仅接受source模式，安装模式由真实安装脚本调用');
    const project = realpathSync(fileURLToPath(new URL('../', import.meta.url))), context = ciContext(project);
    const require = createRequire(join(project, 'package.json')), executable = realpathSync(require('electron'));
    const resources = realpathSync(process.platform === 'win32' ? join(dirname(executable), 'resources') : resolve(dirname(executable), '../Resources'));
    const output = join(project, 'test-results/native-editor-ci');
    const approval = buildSourceApproval({ project, output, context, executable, resources, currentContext: () => ciContext(project) });
    runNativeEditorSpecialties({ approval, output });
    if (!process.env.GITHUB_OUTPUT) throw Error('同job批准输出路径缺失');
    appendFileSync(process.env.GITHUB_OUTPUT, 'source_approval=' + approval.path + '\nsource_approval_sha256=' + approval.sha256 + '\n');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
