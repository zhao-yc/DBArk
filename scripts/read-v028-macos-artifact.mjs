import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';

/** 只读固定原归档JSON，不加载归档代码、连接旧VM或补取SDK/SQLite/PID。 */
function readOriginalReports() {
  assert.equal(process.argv.length, 2);
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
  const root = realpathSync(fileURLToPath(new URL('../.cache/macos-artifact-readback-39240838841/', import.meta.url)));
  /** 文件只能来自归档根内的普通单链接JSON；大小有界并按原字节计算摘要。 */
  function original(name) {
    const path = join(root, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 16 * 1024 * 1024);
    assert.ok(realpathSync(path).startsWith(root + sep));
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size);
    const value = JSON.parse(bytes.toString('utf8'));
    return { value, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  const approval = original('test-results/native-editor-ci/source-approval.json');
  assert.equal(approval.value.context.commit, '689b35247a3a5c3345f5c0e754c5ae0742e1a33c');
  assert.equal(String(approval.value.context.runId), '39240838841');
  assert.equal(approval.value.context.arch, 'arm64'); assert.equal(approval.value.context.platform, 'darwin');
  console.log('DBARK_ARCHIVED_SOURCE:' + JSON.stringify({ sha256: approval.sha256, context: approval.value.context }));
  const completed = original('test-results/native-editor-ci/source-completed.json');
  console.log('DBARK_ARCHIVED_COMPLETED:' + JSON.stringify(completed));
  for (const specialty of ['indent', 'layout']) {
    const report = original(`test-results/native-editor-ci/source-${specialty}/report.json`);
    const accepted = original(`test-results/native-editor-ci/source-${specialty}/accepted.json`);
    assert.equal(accepted.value.reportSha256, report.sha256);
    assert.equal(accepted.value.approvalSha256, approval.sha256);
    const specs = [];
    /** 只遍历原报告中的用例记录；附件只解码固定几何JSON，正文不执行。 */
    function visit(suite) { specs.push(...suite.specs ?? []); for (const child of suite.suites ?? []) visit(child); }
    for (const suite of report.value.suites ?? []) visit(suite);
    assert.equal(specs.length, 1);
    const result = specs[0].tests[0].results[0];
    const geometry = (result.attachments ?? []).filter(item => item.name === '分栏原生窗口尺寸').map(item => {
      assert.equal(item.contentType, 'application/json'); assert.equal(typeof item.body, 'string'); assert.ok(!item.path && item.body.length <= 1024 * 1024);
      return JSON.parse(Buffer.from(item.body, 'base64').toString('utf8'));
    }).filter(value => value.stable === true);
    if (specialty === 'layout') assert.equal(geometry.length, 4);
    console.log('DBARK_ARCHIVED_REPORT:' + JSON.stringify({ specialty, reportSha256: report.sha256, reportBytes: report.bytes, status: result.status, retry: result.retry, stats: report.value.stats, accepted: accepted.value, geometry }));
  }
  const files = original('test-results/native-file-first-model-ci/source/report.json');
  const fileAccepted = original('test-results/native-file-first-model-ci/source/accepted.json');
  const proofs = assertFileFirstModelResult(files.value);
  assert.equal(fileAccepted.value.phase, 'source'); assert.equal(fileAccepted.value.approvalSha256, approval.sha256);
  assert.deepEqual(fileAccepted.value.context, approval.value.context);
  assert.equal(fileAccepted.value.reportSha256, files.sha256);
  assert.equal(fileAccepted.value.cleanupAllowed, true); assert.equal(fileAccepted.value.automaticRetry, false);
  assert.deepEqual(fileAccepted.value.proofs, proofs);
  console.log('DBARK_ARCHIVED_FILES:' + JSON.stringify({ reportSha256: files.sha256, reportBytes: files.bytes, acceptedSha256: fileAccepted.sha256, stats: files.value.stats, proofs: proofs.map(proof => ({
    caseKey: proof.caseKey, entry: proof.entry, sourceEol: proof.sourceEol, accepted: proof.accepted,
    ordinarySingleUndo: proof.ordinarySingleUndo, formatSingleUndo: proof.formatSingleUndo, sqliteSchema: proof.sqliteSchema,
    directoryRemoved: proof.directoryRemoved, normalOwners: proof.normalOwners, identity: proof.identity,
  })) }));
  console.log('DBARK_ARCHIVED_BOUNDARY:' + JSON.stringify({ oldRunReplayed: false, originalVMAccessed: false, applicationProbed: false, cleanupRequested: false, rootLocalZipValidated: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) readOriginalReports();
