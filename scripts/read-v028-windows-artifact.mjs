import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// 固定旧归档只读诊断；不执行归档代码、不连接原VM、不读取活进程或原资料目录。
assert.equal(process.argv.length, 2);
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
const root = realpathSync(fileURLToPath(new URL('../.cache/windows-artifact-readback-39242374243/', import.meta.url)));
const prefixes = ['native-editor-ci', 'test-results/native-editor-ci'].filter(name => existsSync(join(root, name)));
assert.equal(prefixes.length, 1, '原生归档根不唯一');
const prefix = prefixes[0];
/** 文件必须属于原归档；只输出有界JSON与原摘要，不猜测缺失报告的终态。 */
function original(name) {
  const path = join(root, prefix, name);
  if (!existsSync(path)) { console.log('DBARK_WIN_MISSING:' + JSON.stringify({ file: name })); return; }
  const stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 16 * 1024 * 1024);
  assert.ok(realpathSync(path).startsWith(root + sep));
  const bytes = readFileSync(path); assert.equal(bytes.length, stat.size);
  return { file: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), value: JSON.parse(bytes.toString('utf8')) };
}
const approval = original('source-approval.json');
if (approval) {
  assert.equal(approval.value.context.commit, 'df03281ec7e61021bd1ed57c16c5562aeb88bdcf');
  assert.equal(String(approval.value.context.runId), '39242374243');
  assert.equal(approval.value.context.platform, 'win32'); assert.equal(approval.value.context.arch, 'x64');
  console.log('DBARK_WIN_SOURCE:' + JSON.stringify({ sha256: approval.sha256, context: approval.value.context }));
}
for (const specialty of ['indent', 'layout']) {
  const failure = original(`source-${specialty}/failure.json`); if (failure) console.log('DBARK_WIN_FAILURE:' + JSON.stringify(failure));
  const report = original(`source-${specialty}/report.json`); if (!report) continue;
  const tests = [];
  /** 只读取原report的错误和父进程已经收到的内存附录，不能由读取动作补写应用证明。 */
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
      const attachments = (result.attachments ?? []).filter(item => item.contentType === 'application/json' && typeof item.body === 'string').map(item => {
        assert.ok(item.body.length <= 2 * 1024 * 1024);
        const bytes = Buffer.from(item.body, 'base64'), decoded = bytes.toString('utf8');
        return { name: item.name, sha256: createHash('sha256').update(bytes).digest('hex'), truncated: decoded.length > 32768, json: decoded.length <= 32768 ? JSON.parse(decoded) : decoded.slice(0, 16384) + '\n【附录显示截短】\n' + decoded.slice(-16384) };
      });
      tests.push({ title: spec.title, status: result.status, retry: result.retry, errors: result.errors, attachments });
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.value.suites ?? []) visit(suite);
  console.log('DBARK_WIN_REPORT:' + JSON.stringify({ specialty, file: report.file, bytes: report.bytes, sha256: report.sha256, stats: report.value.stats, errors: report.value.errors, tests }));
}
console.log('DBARK_WIN_BOUNDARY:' + JSON.stringify({ originalRun: 39242374243, originalVMAccessed: false, lateSDKRead: false, sceneCleanupRequested: false, rootLocalZipValidated: false }));
