import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { nativeSpecialties, assertSpecialtyResult } from './native-editor-ci.mjs';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';
import { requireOriginalLayoutGeometry } from './macos-mode-keeper-ci.mjs';

/** 固定原成功归档的报告消费者；只读原字节，不复活旧进程或补签退出。 */
assert.equal(process.argv.length, 2);
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
const root = '.cache/macos-installed-success-readback-39256090941', prefix = join(root, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** 固定安全解包根内的原普通JSON文件，各自保留字节摘要。 */
function original(name) {
  const path = join(prefix, name), stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size < 16 * 1024 * 1024);
  const bytes = readFileSync(path);
  return { sha256: hash(bytes), bytes: bytes.length, value: JSON.parse(bytes.toString('utf8')) };
}
const source = original('test-results/native-editor-ci/source-approval.json');
const installed = original('test-results/native-editor-ci/installed-approval.json');
const input = original('test-results/native-editor-ci/package-input.json');
const archives = JSON.parse(readFileSync(join(root, 'archive-receipt.json'), 'utf8'));
const candidate = archives.archives.find(value => value.kind === 'candidate').members;
const dmg = candidate.filter(value => value.path === 'DBArk-0.28.0-mac-arm64-unsigned.dmg');
assert.equal(dmg.length, 1); assert.equal(dmg[0].sha256, input.value.artifactHash);
assert.equal(posix.basename(input.value.artifact), dmg[0].path);
const context = source.value.context;
assert.equal(context.commit, '3fd87bb98555ba042f303762ee7a314582cb18d1');
assert.equal(String(context.runId), '39256090941'); assert.equal(context.platform, 'darwin'); assert.equal(context.arch, 'arm64');
assert.equal(context.job, 'arm64-installed'); assert.equal(context.version, '0.28.0');
assert.deepEqual(installed.value.context, context); assert.deepEqual(input.value.context, context);
assert.equal(installed.value.phase, 'installed'); assert.equal(input.value.sourceHash, source.sha256);
assert.equal(installed.value.provenance.sourceApproval, source.sha256);
assert.equal(installed.value.provenance.artifactSha256, dmg[0].sha256);
assert.deepEqual(installed.value.provenance.reference, input.value.reference);
const manifests = [];
for (const phase of ['source', 'installed']) for (const specialty of nativeSpecialties) {
  const manifest = original(`test-results/native-editor-ci/${phase}-${specialty.name}-manifest.json`);
  const approval = phase === 'source' ? source : installed;
  assert.equal(manifest.sha256, approval.value.manifests[specialty.name].sha256); assert.equal(manifest.value.kind, phase);
  manifests.push({ phase, specialty: specialty.name, sha256: manifest.sha256, value: manifest.value });
}
assert.equal(manifests[0].sha256, manifests[1].sha256); assert.equal(manifests[2].sha256, manifests[3].sha256);
/** 只按原合同比较安装app与打包参考的相对资源字节，不重新读取已删除的旧安装。 */
const relativeFiles = identity => identity.files.map(file => ({ path: file.path === posix.join(source.value.project, 'scripts/check-offline-query-port.mjs') ? '@port-script' : posix.relative(identity.root, file.path), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
assert.deepEqual(relativeFiles(manifests[2].value), relativeFiles(input.value.reference));
const plan = original('.cache/macos-mode-keeper/plan.json');
const completed = original('test-results/native-editor-ci/installed-completed.json');
assert.equal(completed.value.cleanupAllowed, true); assert.equal(completed.value.automaticRetry, false);
const reports = [];
for (const specialty of nativeSpecialties) {
  const report = original(`test-results/native-editor-ci/installed-${specialty.name}/report.json`);
  const accepted = original(`test-results/native-editor-ci/installed-${specialty.name}/accepted.json`);
  const proof = assertSpecialtyResult(report.value, specialty);
  assert.equal(accepted.value.phase, 'installed'); assert.equal(accepted.value.approvalSha256, installed.sha256);
  assert.equal(accepted.value.reportSha256, report.sha256); assert.deepEqual(accepted.value.proof, proof);
  assert.deepEqual(completed.value.proofs[reports.length], proof);
  assert.equal(report.value.stats.expected, 1); assert.equal(report.value.stats.skipped, 0);
  if (specialty.name === 'layout') requireOriginalLayoutGeometry(report.value, plan.value.plan);
  reports.push({ specialty: specialty.name, reportSha256: report.sha256, reportBytes: report.bytes, acceptedSha256: accepted.sha256, stats: report.value.stats, proof });
}
const files = original('test-results/native-file-first-model-ci/installed/report.json');
const acceptedFiles = original('test-results/native-file-first-model-ci/installed/accepted.json');
const proofs = assertFileFirstModelResult(files.value);
assert.equal(acceptedFiles.value.phase, 'installed'); assert.equal(acceptedFiles.value.approvalSha256, installed.sha256);
assert.equal(acceptedFiles.value.reportSha256, files.sha256); assert.deepEqual(acceptedFiles.value.context, context);
assert.equal(acceptedFiles.value.cleanupAllowed, true); assert.deepEqual(acceptedFiles.value.proofs, proofs);
const receipt = original('.cache/macos-mode-keeper/receipt.json');
assert.equal(receipt.value.accepted, true); assert.equal(receipt.value.normalRestoreObservedBeforeKeeperExit, true);
assert.deepEqual(receipt.value.keeper, { code: 0, signal: null }); assert.deepEqual(receipt.value.originalNativeCLIResult, { code: 0, signal: null });
assert.equal(receipt.value.originalProofsConsumed, true); assert.equal(receipt.value.fileProofsConsumed, true);
const frames = readFileSync(join(prefix, '.cache/macos-mode-keeper/keeper.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
assert.ok(frames.every((value, index) => value.seq === index + 1 && value.type !== 'failed'));
assert.equal(frames[0].type, 'inventory'); assert.equal(frames.at(-1).type, 'restored');
assert.deepEqual(frames.at(-1).snapshot.displays[0].currentMode, frames[0].snapshot.displays[0].currentMode);
const result = { accepted: true, originalRun: 39256090941, originalJob: 118071627233, context, sourceApprovalSha256: source.sha256, installedApprovalSha256: installed.sha256,
  packageInputSha256: input.sha256, manifests: manifests.map(({ value, ...record }) => ({ ...record, files: value.files.length })), candidate,
  reports, files: { reportSha256: files.sha256, reportBytes: files.bytes, acceptedSha256: acceptedFiles.sha256, stats: files.value.stats, proofs: proofs.map(({ caseKey, normalOwners, sqliteSchema, directoryRemoved }) => ({ caseKey, normalOwners, sqliteSchema, directoryRemoved })) },
  modeReceiptSha256: receipt.sha256, normalRestoreObserved: true, keeperFrames: frames.length,
  archives: archives.archives.map(({ members, ...record }) => record), validationHost: 'GitHub-hosted Ubuntu', rootLocalZipValidated: false, oldVmAccessed: false, lateSdkRead: false, sceneCleanupRequested: false };
writeFileSync(join(root, 'reports-receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log('DBARK_MAC_SUCCESS_REPORTS:' + JSON.stringify(result));
