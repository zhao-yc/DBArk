import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { nativeSpecialties, assertSpecialtyResult } from './native-editor-ci.mjs';
import { assertFileFirstModelResult } from './native-file-first-model-ci.mjs';

/** 只读原源码六项与新legacy的批准和完整文件集合，不重新运行任一测试。 */
assert.equal(process.argv.length, 2); assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
const root = '.cache/macos-source-identity-readback-39258588418';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** 数据全部来自已安全解包的固定原ZIP；没有调用归档脚本的入口。 */
function original(kind, name) {
  const bytes = readFileSync(join(root, kind, kind === 'native' ? 'test-results' : '', name));
  return { sha256: hash(bytes), value: JSON.parse(bytes.toString('utf8')) };
}
const native = original('native', 'native-editor-ci/source-approval.json');
const legacy = original('legacy', 'native-editor-ci/source-approval.json');
assert.equal(native.sha256, '7fa47612c9b3601943e391eba0872cda43f2829d433a036fa601640a90caeeb2');
assert.equal(legacy.sha256, 'd9d754105d243d7abd209c8f6aa5bc0b43ff7ccfacb1f6bd5d571e718c1c5cdf');
assert.equal(native.value.context.commit, '689b35247a3a5c3345f5c0e754c5ae0742e1a33c');
assert.equal(legacy.value.context.commit, '0f39cf69b149a1466fa097deec554f4ff0e2f59d');
assert.equal(String(legacy.value.context.runId), '39258588418'); assert.equal(legacy.value.context.job, 'arm64-source-legacy');
for (const value of [native.value, legacy.value]) {
  assert.equal(value.phase, 'source'); assert.equal(value.context.platform, 'darwin'); assert.equal(value.context.arch, 'arm64'); assert.equal(value.context.version, '0.28.0');
}
const identities = [];
for (const [kind, approval] of [['native', native], ['legacy', legacy]]) {
  const manifests = nativeSpecialties.map(specialty => {
    const value = original(kind, `native-editor-ci/source-${specialty.name}-manifest.json`);
    assert.equal(value.sha256, approval.value.manifests[specialty.name].sha256); assert.equal(value.value.kind, 'source');
    return value;
  });
  assert.equal(manifests[0].sha256, manifests[1].sha256); identities.push(manifests[0]);
}
/** 根路径可以属于不同job，但相对路径集合与每份原运行字节必须完全相同。 */
const relativeFiles = identity => identity.files.map(file => ({ path: posix.relative(identity.root, file.path), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
assert.deepEqual(relativeFiles(identities[0].value), relativeFiles(identities[1].value));
const originalReports = [];
for (const specialty of nativeSpecialties) {
  const report = original('native', `native-editor-ci/source-${specialty.name}/report.json`);
  const accepted = original('native', `native-editor-ci/source-${specialty.name}/accepted.json`);
  assert.equal(accepted.value.approvalSha256, native.sha256); assert.equal(accepted.value.reportSha256, report.sha256);
  assert.deepEqual(accepted.value.proof, assertSpecialtyResult(report.value, specialty));
  originalReports.push({ specialty: specialty.name, reportSha256: report.sha256 });
}
const files = original('native', 'native-file-first-model-ci/source/report.json');
assert.equal(files.sha256, '87565d1f13503513b96d45aa76a8f8c0d0d1434f45ab0308219a1986e5d183f5');
assert.equal(assertFileFirstModelResult(files.value).length, 4);
const result = { accepted: true, nativeRun: 39240838841, legacyRun: 39258588418, legacyJob: 118080052594,
  nativeApprovalSha256: native.sha256, legacyApprovalSha256: legacy.sha256, legacyContext: legacy.value.context,
  nativeManifestSha256: identities[0].sha256, legacyManifestSha256: identities[1].sha256, identicalRelativeRuntimeFiles: identities[0].value.files.length,
  originalReports, fileFirstModelReportSha256: files.sha256, sourceSixReplayed: false, oldVmAccessed: false, rootLocalZipValidated: false };
writeFileSync(join(root, 'identity-receipt.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log('DBARK_MAC_SOURCE_IDENTITY:' + JSON.stringify(result));
