import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { buildSourceApproval, ciContext } from './native-editor-ci.mjs';
import { requireInstalledKeeperCI } from './macos-mode-keeper-ci.mjs';

/** 安装新job仍需同次构建批准；既有源码六项证据复用，不再次执行源码原生测试。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireInstalledKeeperCI(['installed'], process.platform, process.arch, process.env);
  assert.equal(process.argv.length, 2);
  const project = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
  const require = createRequire(join(project, 'package.json'));
  const executable = realpathSync.native(require('electron'));
  const context = ciContext(project);
  buildSourceApproval({ project, output: join(project, 'test-results/native-editor-ci'), context, executable,
    resources: realpathSync.native(resolve(dirname(executable), '../Resources')), currentContext: () => ciContext(project) });
}
