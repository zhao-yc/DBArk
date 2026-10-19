import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceApproval, ciContext, executeOnce } from './native-editor-ci.mjs';
import { installedIdentity, readApproval, sealApproval, sha256, writeOnce } from './native-editor-ci-identity.mjs';

const spec = 'tests/e2e/sql-keyword-case-native.spec.ts';
/** 只消费原两例、原附件和四个正常owner；不由绿色step或补查进程推断通过。 */
export function assertKeywordReport(report) {
  const specs = [], visit = suite => { specs.push(...(suite.specs ?? [])); (suite.suites ?? []).forEach(visit); };
  (report.suites ?? []).forEach(visit);
  assert.equal(report.errors?.length ?? 0, 0); assert.equal(specs.length, 2);
  const proofs = specs.map((entry, index) => {
    assert.ok([spec, basename(spec)].includes(String(entry.file).replaceAll('\\', '/')));
    assert.equal(entry.ok, true); assert.equal(entry.tests.length, 1);
    const test = entry.tests[0]; assert.equal(test.expectedStatus, 'passed'); assert.equal(test.status, 'expected'); assert.equal(test.results.length, 1);
    const result = test.results[0]; assert.equal(result.status, 'passed'); assert.equal(result.retry, 0); assert.equal(result.errors?.length ?? 0, 0);
    const attachments = result.attachments.filter(item => item.name === '关键字原生终态' && item.contentType === 'application/json');
    assert.equal(attachments.length, 1); assert.equal(typeof attachments[0].body, 'string');
    assert.ok(attachments[0].body.length < 1024 * 1024);
    const proof = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString('utf8'));
    assert.equal(proof.accepted, true); assert.equal(proof.restoredCase, ['upper', 'lower'][index]); assert.equal(proof.schema, 9);
    assert.equal(proof.directoryRemoved, true); assert.equal(proof.systemClipboard, 0); assert.equal(proof.sqlExecution, 0);
    assert.equal(proof.owners.length, 2);
    for (const owner of proof.owners) { assert.equal(owner.confirmed, true); assert.equal(owner.willQuit, true); assert.equal(owner.closed, true); assert.ok(Number.isSafeInteger(owner.recordedPids) && owner.recordedPids > 0); }
    assert.ok(proof.restart.activeTabId); assert.equal(proof.restart.paneIndex, 0); assert.ok(proof.restart.editor > 0 && proof.restart.model > 0);
    assert.deepEqual(proof.lateModule, { held: 1, delivered: 1, detached: true, failed: false, contextRoundTrip: true });
    return proof;
  });
  return proofs;
}
/** 老清单只作相对文件/摘要参照；其绝对路径和批准上下文绝不移植为新批准。 */
export function normalizedFiles(identity, project, platform) {
  const path = platform === 'win32' ? win32 : posix;
  return identity.files.map(file => ({ path: file.path === identity.executable ? '@executable' : file.path === path.join(identity.resources, 'default_app.asar') ? '@default-app' : file.path === path.join(project, 'scripts/check-offline-query-port.mjs') ? '@port-script' : path.relative(identity.root, file.path).replaceAll('\\', '/'), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
}
/** 一个独立子进程，只运行原关键字spec；环境不继承秘密、别的门或外部renderer。 */
function keyword(approval, output, context) {
  approval = readApproval(approval.path, approval.sha256, context);
  const phase = approval.value.phase, directory = join(output, phase + '-keyword'); mkdirSync(directory);
  const original = approval.value.manifests.indent, manifest = join(directory, 'keyword-manifest.json');
  const manifestSha256 = writeOnce(manifest, JSON.parse(readFileSync(original.path, 'utf8')));
  assert.equal(manifestSha256, original.sha256);
  const report = join(directory, 'report.json');
  const allowed = /^(PATH|Path|SystemRoot|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|CI|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY)$/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
  Object.assign(env, { DBARK_INTEGRATION_ENABLED: '0', DBARK_SQL_KEYWORD_CASE_NATIVE_TEST: '1', DBARK_SQL_KEYWORD_CASE_MANIFEST: manifest, DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256: manifestSha256, PLAYWRIGHT_JSON_OUTPUT_FILE: report });
  if (phase === 'installed') env.DBARK_EXECUTABLE_PATH = JSON.parse(readFileSync(manifest, 'utf8')).executable;
  const result = executeOnce(process.execPath, [join(approval.value.project, 'node_modules/@playwright/test/cli.js'), 'test', spec, '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=' + join(directory, 'attachments')], { cwd: approval.value.project, env });
  writeOnce(join(directory, 'process.json'), { status: result.status, error: String(result.error ?? ''), stdout: result.stdout, stderr: result.stderr, automaticRetry: false, automaticForceStop: false });
  console.log(result.stdout ?? ''); console.error(result.stderr ?? '');
  if (result.error || result.status !== 0) throw result.error ?? Error('关键字原用例失败，保留现场');
  const bytes = readFileSync(report), proofs = assertKeywordReport(JSON.parse(bytes));
  readApproval(approval.path, approval.sha256, context);
  const receipt = { accepted: true, phase, context, approvalSha256: approval.sha256, manifestSha256, reportSha256: sha256(bytes), proofs, automaticRetry: false, automaticForceStop: false };
  writeOnce(join(directory, 'accepted.json'), receipt); console.log('DBARK_KEYWORD_ACCEPTED:' + JSON.stringify(receipt));
}
/** 固定工具独立参数，不经shell；未知失败不补强停。 */
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw result.error ?? Error('固定工具失败：' + basename(executable) + ':' + result.stderr);
  return (result.stdout ?? '').replace(/^\uFEFF/, '').trim();
}
/** NSIS标识相同可升级用户安装；仅干净CI运行并在卸载后重新核注册。 */
function windowsInstallations() {
  return JSON.parse(command(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $entries=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'DBArk*' }); ConvertTo-Json -InputObject $entries -Compress"]));
}
/** 只补源码与真实安装的关键字两例；不重跑已闭合六项或普通legacy。 */
function run() {
  assert.ok(process.argv.length === 3 && ['source', 'installed'].includes(process.argv[2]));
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_JOB, 'keyword-native');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
  assert.equal(process.env.KEYWORD_RUNNER_ENVIRONMENT, 'github-hosted');
  assert.ok(process.platform === 'win32' && process.arch === 'x64' || process.platform === 'darwin' && process.arch === 'arm64');
  for (const key of Object.keys(process.env)) assert.ok(!/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|DYLD_|LD_PRELOAD$)/i.test(key));
  const project = realpathSync.native(fileURLToPath(new URL('../', import.meta.url))), context = ciContext(project);
  for (const [name, hash] of [['src', '20ff372f4cbc5c466e79d847afda2cb57f55426e'], ['package.json', '3ff5c4d3b652bb0cc8de0e2584c26119869792da'], ['pnpm-lock.yaml', 'f4e286fab9eb730c5f4880d6cb08fead0bf8e608']]) assert.equal(command('git', ['rev-parse', 'HEAD:' + name]), hash);
  const output = join(project, 'test-results/v028-keyword'), input = join(project, '.cache/v028-keyword-input');
  const prefixes = ['', 'test-results'].map(prefix => join(input, 'evidence', prefix, 'native-editor-ci')).filter(path => existsSync(join(path, 'source-approval.json')));
  assert.equal(prefixes.length, 1); const oldRoot = prefixes[0];
  const oldSource = JSON.parse(readFileSync(join(oldRoot, 'source-approval.json'), 'utf8'));
  const sourcePath = join(output, 'source-approval.json');
  if (process.argv[2] === 'source') {
    command(process.execPath, [join(project, 'scripts/check-offline-query-port.mjs')]);
    const require = createRequire(join(project, 'package.json')), executable = realpathSync.native(require('electron'));
    const approval = buildSourceApproval({ project, output, context, executable, resources: realpathSync.native(process.platform === 'win32' ? join(dirname(executable), 'resources') : resolve(dirname(executable), '../Resources')), currentContext: () => ciContext(project) });
    const current = JSON.parse(readFileSync(approval.value.manifests.indent.path, 'utf8')), previous = JSON.parse(readFileSync(join(oldRoot, 'source-indent-manifest.json'), 'utf8'));
    assert.equal(sha256(readFileSync(join(oldRoot, 'source-indent-manifest.json'))), oldSource.manifests.indent.sha256);
    assert.deepEqual(normalizedFiles(current, project, process.platform), normalizedFiles(previous, oldSource.project, process.platform));
    keyword(approval, output, context); return;
  }
  const source = readApproval(sourcePath, sha256(readFileSync(sourcePath)), context);
  const sourceReceipt = JSON.parse(readFileSync(join(output, 'source-keyword/accepted.json'), 'utf8'));
  assert.equal(sourceReceipt.approvalSha256, source.sha256); assert.equal(sourceReceipt.accepted, true);
  const artifact = join(input, 'candidate', process.platform === 'win32' ? 'DBArk-0.28.0-win-x64-unsigned.exe' : 'DBArk-0.28.0-mac-arm64-unsigned.dmg');
  const artifactHash = process.platform === 'win32' ? '9b98642db34cee99453e671e23f78af11821ae6314e51fbd39ffc718754d62fe' : 'd415a686d0a9d1d001dd57b45380007b27beb362b6f91de0cdb84e6fe5ad6c99';
  assert.equal(sha256(readFileSync(artifact)), artifactHash);
  const oldInstalledBytes = readFileSync(join(oldRoot, 'installed-indent-manifest.json')), oldInstalled = JSON.parse(oldInstalledBytes);
  const oldApproval = JSON.parse(readFileSync(join(oldRoot, 'installed-approval.json'), 'utf8'));
  assert.equal(sha256(oldInstalledBytes), oldApproval.manifests.indent.sha256);
  // 必须在安装前固定旧完整参照与候选字节；安装后绝不选择新的参照补签。
  const packageInput = { context, artifactSha256: artifactHash, originalManifestSha256: sha256(oldInstalledBytes), reference: normalizedFiles(oldInstalled, oldSource.project, process.platform), sourceApprovalSha256: source.sha256 };
  writeOnce(join(output, 'installed-input.json'), packageInput);
  if (process.platform === 'win32') assert.equal(windowsInstallations().length, 0);
  const parent = realpathSync.native(tmpdir()), temporary = mkdtempSync(join(parent, 'dbark-keyword-install-'));
  const applications = join(temporary, 'Applications'), mount = join(temporary, 'mount');
  /** 删除/卸载前验证本任务根及真实目标；失败时整个安装现场保留。 */
  const owned = path => { assert.equal(dirname(temporary), parent); assert.equal(realpathSync.native(temporary), temporary); assert.equal(lstatSync(temporary).isSymbolicLink(), false); const child = relative(temporary, path); assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)); if (existsSync(path)) assert.equal(realpathSync.native(path), path); };
  try {
    let executable;
    if (process.platform === 'win32') { owned(applications); command(artifact, ['/S', '/currentuser', '/D=' + applications], { windowsVerbatimArguments: true }); executable = join(applications, 'DBArk.exe'); }
    else { mkdirSync(applications); mkdirSync(mount); command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, artifact]); command('/usr/bin/ditto', [join(mount, 'DBArk.app'), join(applications, 'DBArk.app')]); executable = join(applications, 'DBArk.app/Contents/MacOS/DBArk'); }
    owned(executable);
    const identity = installedIdentity(project, executable, process.platform);
    assert.deepEqual(normalizedFiles(identity, project, process.platform), packageInput.reference);
    assert.equal(sha256(readFileSync(artifact)), artifactHash); readApproval(source.path, source.sha256, context);
    const approval = sealApproval({ identity, project, context, output, phase: 'installed', provenance: packageInput });
    keyword(approval, output, context);
    // 仅原两例/四owner全部正常且输入未漂移后，执行本次新安装的规范收尾。
    readApproval(approval.path, approval.sha256, context); owned(applications);
    if (process.platform === 'win32') {
      const uninstaller = join(applications, 'Uninstall DBArk.exe'), copied = join(temporary, 'uninstall-test.exe'); owned(uninstaller); owned(copied); copyFileSync(uninstaller, copied);
      command(copied, ['/S', '/currentuser', '/KEEP_APP_DATA', '_?=' + applications], { windowsVerbatimArguments: true });
      assert.equal(existsSync(join(applications, 'DBArk.exe')), false); assert.equal(windowsInstallations().length, 0);
    } else { owned(mount); command('/usr/bin/hdiutil', ['detach', mount]); assert.equal(statSync(mount).dev, statSync(temporary).dev); }
    owned(applications); rmSync(temporary, { recursive: true });
    writeOnce(join(output, 'installed-cleanup.json'), { completed: true, temporary, originalSixReplayed: false, legacyReplayed: false, systemSaveKeyPressed: false });
    console.log('DBARK_KEYWORD_INSTALL_CLEANED:' + JSON.stringify({ temporary, originalSixReplayed: false, legacyReplayed: false }));
  } catch (error) { console.error('关键字新安装现场保留：' + temporary); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { run(); } catch (error) { console.error(error); process.exitCode = 1; } }
