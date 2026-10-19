import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { nativeSpecialties, assertSpecialtyResult } from './native-editor-ci.mjs';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';

/** 只消费固定已归档 JSON；不启动应用、不调用旧 SDK/SQLite/PID，也不补清理。 */
function readArchivedSuccess() {
  assert.equal(process.argv.length, 2);
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
  const root = realpathSync('.cache/windows-success-readback-39244695054');
  const evidence = join(root, 'evidence');
  const prefixes = ['', 'test-results'].filter(prefix => existsSync(join(evidence, prefix, 'native-editor-ci/source-approval.json')));
  assert.equal(prefixes.length, 1, '归档证据根必须唯一');
  const prefix = join(evidence, prefixes[0]);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  /** 原 JSON 文件单独核字节，不能由当前磁盘扫描重签批准。 */
  function original(name) {
    const path = join(prefix, name), info = lstatSync(path);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 16 * 1024 * 1024);
    assert.equal(realpathSync(path), path);
    const bytes = readFileSync(path);
    assert.equal(bytes.length, info.size);
    return { path: name, bytes: bytes.length, sha256: digest(bytes), value: JSON.parse(bytes.toString('utf8')) };
  }
  const archives = JSON.parse(readFileSync(join(root, 'archive-receipt.json'), 'utf8'));
  const packageInput = original('native-editor-ci/package-input.json');
  const source = original('native-editor-ci/source-approval.json');
  assert.equal(source.sha256, '76f18838b0269daf103e9d3d40f718575f029bc751c23ed413082c2de6dc9385');
  const context = source.value.context;
  assert.equal(context.commit, '4a2bcd423a26f5fe6fe094ee30656a58fb7d3035');
  assert.equal(String(context.runId), '39244695054');
  assert.equal(String(context.attempt), '1');
  assert.equal(context.job, 'windows');
  assert.equal(context.platform, 'win32'); assert.equal(context.arch, 'x64'); assert.equal(context.version, '0.28.0');
  assert.deepEqual(packageInput.value.context, context);
  assert.equal(packageInput.value.sourceHash, source.sha256);
  assert.equal(packageInput.value.sourcePath, win32.join(source.value.project, 'test-results/native-editor-ci/source-approval.json'));
  const exe = archives.archives.find(value => value.kind === 'candidate').members.filter(value => value.path === 'DBArk-0.28.0-win-x64-unsigned.exe');
  assert.equal(exe.length, 1);
  assert.equal(packageInput.value.artifactHash, exe[0].sha256);
  assert.equal(win32.basename(packageInput.value.artifact), exe[0].path);
  const phases = [];
  for (const phase of ['source', 'installed']) {
    const approval = original(`native-editor-ci/${phase}-approval.json`);
    assert.equal(approval.value.version, 1); assert.equal(approval.value.phase, phase);
    assert.deepEqual(approval.value.context, context); assert.equal(approval.value.project, source.value.project);
    const manifests = [];
    for (const specialty of nativeSpecialties) {
      const manifest = original(`native-editor-ci/${phase}-${specialty.name}-manifest.json`);
      assert.equal(manifest.sha256, approval.value.manifests[specialty.name].sha256);
      assert.equal(approval.value.manifests[specialty.name].path, win32.join(approval.value.project, 'test-results', manifest.path));
      assert.equal(manifest.value.kind, phase);
      assert.equal(new Set(manifest.value.files.map(value => value.path)).size, manifest.value.files.length);
      assert.ok(manifest.value.files.every(value => /^[a-f0-9]{64}$/.test(value.sha256)));
      manifests.push(manifest);
    }
    assert.equal(manifests[0].sha256, manifests[1].sha256);
    if (phase === 'installed') {
      assert.equal(approval.value.provenance.sourceApproval, source.sha256);
      assert.equal(approval.value.provenance.artifactSha256, exe[0].sha256);
      assert.deepEqual(approval.value.provenance.reference, packageInput.value.reference);
      assert.equal(manifests[0].value.executable, win32.join(manifests[0].value.root, 'DBArk.exe'));
      // 实际安装和同次未安装参考按相对路径逐字节比较；原绝对路径原样保留。
      const relativeFiles = identity => identity.files.map(file => ({
        path: file.path === win32.join(source.value.project, 'scripts/check-offline-query-port.mjs') ? '@port-script' : win32.relative(identity.root, file.path), sha256: file.sha256,
      })).sort((a, b) => a.path.localeCompare(b.path));
      assert.deepEqual(relativeFiles(manifests[0].value), relativeFiles(packageInput.value.reference));
    }
    const completed = original(`native-editor-ci/${phase}-completed.json`);
    assert.equal(completed.value.phase, phase); assert.equal(completed.value.cleanupAllowed, true); assert.equal(completed.value.automaticRetry, false);
    const specialties = [];
    for (const specialty of nativeSpecialties) {
      const report = original(`native-editor-ci/${phase}-${specialty.name}/report.json`);
      const accepted = original(`native-editor-ci/${phase}-${specialty.name}/accepted.json`);
      const proof = assertSpecialtyResult(report.value, specialty);
      assert.deepEqual(accepted.value, { phase, specialty: specialty.name, spec: specialty.spec, approvalSha256: approval.sha256, reportSha256: report.sha256, proof });
      assert.deepEqual(completed.value.proofs[specialties.length], proof);
      assert.equal(report.value.stats.expected, 1); assert.equal(report.value.stats.skipped, 0);
      assert.equal(report.value.stats.unexpected, 0); assert.equal(report.value.stats.flaky, 0);
      specialties.push({ specialty: specialty.name, reportSha256: report.sha256, reportBytes: report.bytes, acceptedSha256: accepted.sha256, stats: report.value.stats, proof });
    }
    assert.equal(completed.value.proofs.length, 2);
    const files = original(`native-file-first-model-ci/${phase}/report.json`);
    const acceptedFiles = original(`native-file-first-model-ci/${phase}/accepted.json`);
    const fileProofs = assertFileFirstModelResult(files.value);
    assert.equal(acceptedFiles.value.phase, phase); assert.equal(acceptedFiles.value.approvalSha256, approval.sha256);
    assert.equal(acceptedFiles.value.reportSha256, files.sha256); assert.deepEqual(acceptedFiles.value.context, context);
    assert.deepEqual(acceptedFiles.value.proofs, fileProofs); assert.deepEqual(acceptedFiles.value.manifest, approval.value.manifests.indent);
    assert.equal(acceptedFiles.value.cleanupAllowed, true); assert.equal(acceptedFiles.value.automaticRetry, false);
    phases.push({ phase, approvalSha256: approval.sha256, manifestSha256: manifests[0].sha256, manifestFiles: manifests[0].value.files.length,
      executable: manifests[0].value.executable, specialties, files: { reportSha256: files.sha256, reportBytes: files.bytes, acceptedSha256: acceptedFiles.sha256, stats: files.value.stats,
        proofs: fileProofs.map(value => ({ caseKey: value.caseKey, accepted: value.accepted, sourceEol: value.sourceEol, entry: value.entry, ordinarySingleUndo: value.ordinarySingleUndo, formatSingleUndo: value.formatSingleUndo, sqliteSchema: value.sqliteSchema, normalOwners: value.normalOwners, directoryRemoved: value.directoryRemoved, identity: value.identity })) } });
  }
  const result = { accepted: true, context, originalRun: 39244695054, originalJob: 118033672863, packageInputSha256: packageInput.sha256,
    candidate: exe[0], phases, archives: archives.archives.map(({ members, ...record }) => record),
    validationHost: 'GitHub-hosted Ubuntu', originalVmAccessed: false, archiveProgramsExecuted: false, oldSceneCleanupRequested: false, rootLocalZipValidated: false };
  writeFileSync(join(root, 'reports-receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('DBARK_SUCCESS_REPORTS:' + JSON.stringify(result));
}

readArchivedSuccess();
