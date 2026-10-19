import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertKeywordReport } from './v028-keyword-native-ci.mjs';
import { sha256, writeOnce } from './native-editor-ci-identity.mjs';

assert.equal(process.env.GITHUB_JOB, 'keyword-readback');
const root = '.cache/v028-keyword-readback', records = [];
/** 按原相对路径读取原字节，仅支持两种明确归档根，不猜测其他同名报告。 */
function directory(platform) {
  const paths = ['test-results/v028-keyword', 'v028-keyword'].map(path => join(root, platform, path)).filter(path => existsSync(join(path, 'source-approval.json')));
  assert.equal(paths.length, 1); return paths[0];
}
for (const phase of ['source', 'installed']) {
  const path = directory('windows'), approvalBytes = readFileSync(join(path, phase + '-approval.json'));
  const approval = JSON.parse(approvalBytes), reportBytes = readFileSync(join(path, phase + '-keyword/report.json'));
  const acceptedBytes = readFileSync(join(path, phase + '-keyword/accepted.json')), accepted = JSON.parse(acceptedBytes);
  const manifestBytes = readFileSync(join(path, phase + '-keyword/keyword-manifest.json'));
  assert.equal(approval.context.commit, 'eb171c2aea239f10ab170cbc8f47318fa12bbe64'); assert.equal(approval.context.runId, '39265643127'); assert.equal(approval.context.platform, 'win32'); assert.equal(approval.phase, phase);
  assert.equal(accepted.approvalSha256, sha256(approvalBytes)); assert.equal(accepted.reportSha256, sha256(reportBytes)); assert.equal(accepted.manifestSha256, sha256(manifestBytes));
  assert.equal(sha256(manifestBytes), approval.manifests.indent.sha256);
  const proofs = assertKeywordReport(JSON.parse(reportBytes)); assert.deepEqual(proofs, accepted.proofs); assert.deepEqual(accepted.context, approval.context);
  if (phase === 'installed') { const input = JSON.parse(readFileSync(join(path, 'installed-input.json'))); assert.deepEqual(input, approval.provenance); assert.equal(input.artifactSha256, '9b98642db34cee99453e671e23f78af11821ae6314e51fbd39ffc718754d62fe'); }
  records.push({ platform: 'windows', phase, accepted: true, approvalSha256: sha256(approvalBytes), manifestSha256: sha256(manifestBytes), manifestFiles: JSON.parse(manifestBytes).files.length, reportSha256: sha256(reportBytes), receiptSha256: sha256(acceptedBytes), proofs });
}
const windows = directory('windows'), cleanup = JSON.parse(readFileSync(join(windows, 'installed-cleanup.json')));
assert.equal(cleanup.completed, true); assert.equal(cleanup.originalSixReplayed, false); assert.equal(cleanup.legacyReplayed, false); assert.equal(cleanup.systemSaveKeyPressed, false);
const macos = directory('macos'), failedBytes = readFileSync(join(macos, 'source-keyword/report.json')), failed = JSON.parse(failedBytes), specs = [];
const visit = suite => { specs.push(...(suite.specs ?? [])); (suite.suites ?? []).forEach(visit); }; failed.suites.forEach(visit);
assert.equal(specs.length, 2); assert.equal(specs[0].ok, false); assert.equal(specs[0].tests[0].results.length, 1); assert.equal(specs[0].tests[0].results[0].retry, 0); assert.equal(specs[0].tests[0].results[0].status, 'failed');
assert.equal(existsSync(join(macos, 'source-keyword/accepted.json')), false); assert.equal(existsSync(join(macos, 'installed-approval.json')), false);
const result = specs[0].tests[0].results[0];
const attachments = result.attachments.filter(a => a.name === '关键字原生保留现场'); assert.equal(attachments.length, 1);
const scene = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString('utf8'));
/** 上下文是原错误快照，只作定位，不当作终态/新产品证据。 */
function contexts(path) { for (const name of readdirSync(path, { withFileTypes: true })) { const child = join(path, name.name); if (name.isDirectory()) contexts(child); else if (name.name === 'error-context.md') console.log('DBARK_KEYWORD_MAC_FAILURE_CONTEXT:' + JSON.stringify(readFileSync(child, 'utf8'))); } }
contexts(join(macos, 'source-keyword/attachments'));
records.push({ platform: 'macos', phase: 'source', accepted: false, reportSha256: sha256(failedBytes), stats: failed.stats, errors: result.errors, scene, installedExecuted: false, oldSceneAccessed: false });
const receipt = { records, windowsCleanup: cleanup, oldVmAccessed: false, testsReplayed: false, systemSaveKeyPressed: false, localZipValidated: false };
writeOnce(join(root, 'receipt.json'), receipt); console.log('DBARK_KEYWORD_READBACK:' + JSON.stringify(receipt));
