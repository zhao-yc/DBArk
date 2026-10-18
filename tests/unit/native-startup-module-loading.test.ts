import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, expect, it } from 'vitest';
import { nativeStartupSdkCollector } from '../fixtures/native-startup-sdk-collector';

const project = fileURLToPath(new URL('../..', import.meta.url));
const wirePath = join(project, 'tests/e2e/editor-native-startup-wire.ts');
const source = readFileSync(wirePath, 'utf8').replaceAll('\r\n', '\n');
const cache = join(project, '.cache/r5-playwright-module/module-tests');
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // 只删除本用例创建且确实位于本clone缓存内的目录。
    if (!resolve(directory).startsWith(resolve(cache) + sep)) throw Error('模块测试缓存路径越界');
    await rm(directory, { recursive: true, force: true });
  }
});

it('新package锚点与R5旧文件URL解析同一真实SDK，仍固定1.64.0且runner固定批准cwd', () => {
  const oldRequire = createRequire(pathToFileURL(wirePath)), currentRequire = createRequire(join(project, 'package.json'));
  const metadata = (loader: NodeJS.Require) => loader.resolve('playwright-core/package.json', { paths: [dirname(loader.resolve('@playwright/test'))] });
  expect(currentRequire.resolve('@playwright/test')).toBe(oldRequire.resolve('@playwright/test'));
  expect(metadata(currentRequire)).toBe(metadata(oldRequire));
  expect(currentRequire(metadata(currentRequire)).version).toBe('1.64.0');
  expect(readFileSync(join(project, 'scripts/native-editor-ci.mjs'), 'utf8')).toContain('{ cwd: approval.value.project, env }');
});

it('R5观察实现原文保持，SDK版本门/collector指纹及原事件、预算、附件均未改写', () => {
  const body = source.slice(source.indexOf('/** 只认固定'));
  expect(createHash('sha256').update(body).digest('hex')).toBe('82429ac364e1c8ba419e741ae0ab1e3c44125ce887bc287e8a140849ae8bb867');
});

// 子进程只加载模块和RAM日志端口；将进程/网络/原生入口显式封死，不能借测试启动资源。
const childScript = String.raw`
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { EventEmitter } = require('node:events'), { pathToFileURL } = require('node:url');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let forbidden = 0;
function deny() { forbidden++; throw Error('模块加载验证禁止原生/进程/网络入口'); }
for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) require('node:child_process')[key] = deny;
for (const key of ['connect','createConnection','createServer']) require('node:net')[key] = deny;
require('node:tls').connect = deny;
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, ...args) { if (name === 'electron') return deny(); return originalLoad.call(this, name, ...args); };
(async () => {
  const sdkRequire = createRequire(require.resolve('@playwright/test'));
  sdkRequire('@playwright/test')._electron.launch = deny;
  let wire;
  if (input.mode === 'cjs') {
    const transform = sdkRequire('playwright/lib/common').transform;
    // 与正式Playwright runner使用同一个转换器；直接加载runtime以补足--list刻意跳过的路径。
    await transform.requireOrImport(path.join(input.project, 'tests/e2e/editor-indentation-native-runtime.ts'));
    await transform.requireOrImport(path.join(input.project, 'tests/e2e/editor-native-startup-diagnostics.ts'));
    wire = await transform.requireOrImport(path.join(input.project, 'tests/e2e/editor-native-startup-wire.ts'));
  } else wire = await import(pathToFileURL(input.esmPath).href);
  const Collector = vm.runInNewContext('(' + input.collector + ')', { kLogCount: 150 });
  const collector = new Collector(), child = { pid: 101, stdout: new EventEmitter(), stderr: new EventEmitter() };
  collector.log('[pid=101][out] DBARK_STARTUP_V1:30');
  const implementation = { _process: child, _browserContext: { _browser: { options: { name: 'electron', browserLogsCollector: collector } } } };
  let mappings = 0;
  const application = { _connection: { toImpl(value) { assert.equal(value, application); mappings++; return implementation; } } };
  // 不传load替身，必须真的走修复后的fixedSdk、版本门及collector指纹。
  const observation = wire.observeNativeStartupWire(application, child, () => true);
  assert.equal(mappings, 1); assert.equal(observation.data.failed, false); assert.equal(observation.data.earlyCoverage, 1);
  assert.deepEqual(observation.data.events, [[1,30]]);
  child.stderr.emit('data', Buffer.from('DBARK_STARTUP_V1:31\n')); observation.console('DBARK_STARTUP_V1:32');
  assert.deepEqual(observation.data.events, [[1,30],[4,31],[5,32]]);
  observation.stop(); assert.equal(child.stdout.listenerCount('data'), 0); assert.equal(child.stderr.listenerCount('error'), 0);
  assert.equal(forbidden, 0);
  console.log(JSON.stringify({ mode: input.mode, mappings, earlyCoverage: observation.data.earlyCoverage, events: observation.data.events, stopped: observation.data.stopped, forbidden }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
`;

it.each(['cjs', 'esm'] as const)('%s真实模块加载并消费原SDK元数据与RAM标记，无原生或网络调用', async mode => {
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, mode + '-')); directories.push(directory);
  const esmPath = join(directory, 'wire.mjs');
  if (mode === 'esm') await writeFile(esmPath, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PWTEST_CACHE_DIR$|TEMP$|TMP$)/i.test(key)));
  Object.assign(env, { DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_NATIVE_TEST: '0', DBARK_QUERY_LAYOUT_NATIVE_TEST: '0', PWTEST_CACHE_DIR: directory, TEMP: directory, TMP: directory });
  const result = spawnSync(process.execPath, ['-e', childScript], { cwd: project, env, encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 128 * 1024, input: JSON.stringify({ mode, project, esmPath, collector: nativeStartupSdkCollector().toString() }) });
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.stderr).toBe(''); expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ mode, mappings: 1, earlyCoverage: 1, events: [[1,30],[4,31],[5,32]], stopped: true, forbidden: 0 });
}, 25000);
