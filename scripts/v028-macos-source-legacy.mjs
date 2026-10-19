import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceApproval, ciContext } from './native-editor-ci.mjs';
import { readApproval, sha256 } from './native-editor-ci-identity.mjs';

/** 仅本次独立arm64源码legacy job；构建/复核本身不执行原生专项或显示操作。 */
function run() {
  assert.ok(process.argv.length === 3 && ['build', 'verify'].includes(process.argv[2]));
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/v028-serial-closeout-20261019');
  assert.equal(process.env.GITHUB_JOB, 'arm64-source-legacy');
  assert.equal(process.env.SOURCE_LEGACY_RUNNER_ENVIRONMENT, 'github-hosted');
  for (const key of Object.keys(process.env)) assert.ok(!/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|DYLD_|LD_PRELOAD$)/i.test(key));
  const project = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
  const context = ciContext(project), output = join(project, 'test-results/native-editor-ci');
  const path = join(output, 'source-approval.json');
  if (process.argv[2] === 'build') {
    assert.ok(process.env.GITHUB_OUTPUT);
    const require = createRequire(join(project, 'package.json')), executable = realpathSync.native(require('electron'));
    const approval = buildSourceApproval({ project, output, context, executable,
      resources: realpathSync.native(resolve(dirname(executable), '../Resources')), currentContext: () => ciContext(project) });
    appendFileSync(process.env.GITHUB_OUTPUT, 'approval_sha256=' + approval.sha256 + '\n');
    console.log('DBARK_MAC_SOURCE_LEGACY_BUILD:' + JSON.stringify({ approvalSha256: approval.sha256, context, sourceSixReplayed: false }));
  } else {
    const hash = process.env.SOURCE_LEGACY_APPROVAL_SHA256;
    assert.match(hash ?? '', /^[a-f0-9]{64}$/);
    const approval = readApproval(path, hash, context); assert.equal(approval.value.phase, 'source');
    console.log('DBARK_MAC_SOURCE_LEGACY_FROZEN:' + JSON.stringify({ approvalSha256: sha256(readFileSync(path)), context, sourceSixReplayed: false }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
