import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeSpecialties, assertSpecialtyResult } from './native-editor-ci.mjs';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';
import { requireOriginalLayoutGeometry } from './macos-mode-keeper-ci.mjs';

/** 只消费失败归档中原期限内的报告；六项局部通过不改变租约/恢复失败。 */
assert.equal(process.argv.length, 2);
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
const root = '.cache/macos-installed-failure-readback-39253421880';
const prefix = join(root, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** 文件从本次安全解包根读取，保留原字节摘要与原JSON。 */
function original(name) {
  const path = join(prefix, name), stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size < 16 * 1024 * 1024);
  const bytes = readFileSync(path);
  return { sha256: hash(bytes), bytes: bytes.length, value: JSON.parse(bytes.toString('utf8')) };
}
const source = original('test-results/native-editor-ci/source-approval.json');
const installed = original('test-results/native-editor-ci/installed-approval.json');
const context = source.value.context;
assert.equal(context.commit, '5a4ca1b83fa26d43a91600202ab00fac174bc3f3');
assert.equal(String(context.runId), '39253421880'); assert.equal(context.platform, 'darwin'); assert.equal(context.arch, 'arm64');
assert.equal(context.job, 'arm64-installed'); assert.equal(context.version, '0.28.0');
assert.deepEqual(installed.value.context, context); assert.equal(installed.value.phase, 'installed');
assert.equal(installed.value.provenance.sourceApproval, source.sha256);
const plan = original('.cache/macos-mode-keeper/plan.json');
const reports = [];
for (const specialty of nativeSpecialties) {
  const report = original(`test-results/native-editor-ci/installed-${specialty.name}/report.json`);
  const accepted = original(`test-results/native-editor-ci/installed-${specialty.name}/accepted.json`);
  const proof = assertSpecialtyResult(report.value, specialty);
  assert.equal(accepted.value.phase, 'installed'); assert.equal(accepted.value.approvalSha256, installed.sha256);
  assert.equal(accepted.value.reportSha256, report.sha256); assert.deepEqual(accepted.value.proof, proof);
  assert.equal(report.value.stats.expected, 1); assert.equal(report.value.stats.skipped, 0);
  if (specialty.name === 'layout') requireOriginalLayoutGeometry(report.value, plan.value.plan);
  reports.push({ specialty: specialty.name, reportSha256: report.sha256, acceptedSha256: accepted.sha256, stats: report.value.stats, proof });
}
const files = original('test-results/native-file-first-model-ci/installed/report.json');
const acceptedFiles = original('test-results/native-file-first-model-ci/installed/accepted.json');
const proofs = assertFileFirstModelResult(files.value);
assert.equal(acceptedFiles.value.phase, 'installed'); assert.equal(acceptedFiles.value.approvalSha256, installed.sha256);
assert.equal(acceptedFiles.value.reportSha256, files.sha256); assert.deepEqual(acceptedFiles.value.proofs, proofs);
const receipt = original('.cache/macos-mode-keeper/receipt.json');
assert.equal(receipt.value.accepted, false); assert.equal(receipt.value.normalRestoreObservedBeforeKeeperExit, false);
const frames = readFileSync(join(prefix, '.cache/macos-mode-keeper/keeper.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
assert.ok(frames.every((value, index) => value.seq === index + 1 && value.type !== 'restored'));
assert.equal(frames.at(-1).type, 'failed'); assert.equal(frames.at(-1).reason, '原600秒租约届满');
const result = { originalRun: 39253421880, originalJob: 118062601826, context, sourceApprovalSha256: source.sha256, installedApprovalSha256: installed.sha256,
  originalSixSpecialtiesPassed: true, overallAccepted: false, normalRestoreObserved: false, installedSceneCleanupConfirmed: false,
  reports, files: { reportSha256: files.sha256, acceptedSha256: acceptedFiles.sha256, stats: files.value.stats, proofs: proofs.map(({ caseKey, normalOwners, sqliteSchema, directoryRemoved }) => ({ caseKey, normalOwners, sqliteSchema, directoryRemoved })) },
  modeReceiptSha256: receipt.sha256, modeFailure: frames.at(-1).reason, candidateArchiveAvailable: false, rootLocalZipValidated: false, oldVmAccessed: false, lateSdkRead: false, sceneCleanupRequested: false };
writeFileSync(join(root, 'reports-receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log('DBARK_MAC_FAILED_REPORTS:' + JSON.stringify(result));
