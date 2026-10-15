import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { q05IsolatedPorts, requireQ05IsolatedPort } from './q05-isolated-port.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), counts = { 白名单正例: 0, 纯函数拒绝: 0, 夹具前置门: 0, CLI只读预检: 0, CLI连接前拒绝: 0 };
assert.deepEqual(q05IsolatedPorts, ['13357', '13380', '13384', '13310', '13311', '13484']);
const invalid = ['3306', '13306', '65535', '0', '', undefined, null, 13357, '013357', ' 13357', '13357 '];
for (const port of q05IsolatedPorts) { assert.equal(requireQ05IsolatedPort(port, port), Number(port)); counts.白名单正例++; }
for (const port of invalid) { assert.throws(() => requireQ05IsolatedPort(port, port), /Q05只允许专用端口/); counts.纯函数拒绝++; }
for (const port of q05IsolatedPorts) for (const other of [undefined, '', '3306', ...q05IsolatedPorts.filter(item => item !== port)]) { assert.throws(() => requireQ05IsolatedPort(port, other), /与env逐字匹配/); counts.纯函数拒绝++; }

// 提取真实手动夹具的首条执行语句；只运行纯端口门，不导入或模拟Engine/驱动。
const path = join(root, 'tests/manual/query-csv-million.manual.ts'), tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const prefixes = [];
/** 首语句必须仍是targetPort校验，避免后续调整无意把文件/网络操作挪到门前。 */
function visit(node) { if (ts.isArrowFunction(node) && ts.isBlock(node.body)) { const first = node.body.statements[0]; if (first && ts.isVariableStatement(first) && first.declarationList.declarations.some(item => item.name.getText(tree) === 'targetPort')) prefixes.push(first.getText(tree)); } node.forEachChild(visit); }
visit(tree); assert.equal(prefixes.length, 1); assert.match(prefixes[0], /requireQ05IsolatedPort\(process\.env\.DBARK_TEST_PORT, process\.env\.DBARK_TEST_PORT\)/);
const prefix = ts.transpileModule(prefixes[0] + '\ntargetPort;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const port of [...q05IsolatedPorts, ...invalid]) {
  const action = () => runInNewContext(prefix, { requireQ05IsolatedPort, process: { env: { DBARK_TEST_PORT: port } } });
  if (q05IsolatedPorts.includes(port)) assert.equal(action(), Number(port)); else assert.throws(action, /Q05只允许专用端口/);
  counts.夹具前置门++;
}

/** 真实CLI子进程只走预检或拒绝分支；负例使用不存在的env路径，绝不读取已有凭据。 */
function cli(args, enabled = '0') { const result = spawnSync(process.execPath, [join(root, 'scripts/manual-q05-million-archive.mjs'), ...args], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 128 * 1024, timeout: 10000, env: { ...process.env, DBARK_Q05_MILLION_ARCHIVE_ENABLED: enabled } }); assert.ifError(result.error); return result; }
for (const port of q05IsolatedPorts) {
  const result = cli(['--preflight', '--port', port, '--config-env-file', join(root, '.cache', '此文件不应被读取或创建.env')]); assert.equal(result.status, 0); const report = JSON.parse(result.stdout);
  assert.equal(report.请求端口, port); assert.deepEqual(report.专用隔离端口, q05IsolatedPorts); assert.equal(report.已读凭据, false); assert.equal(report.已执行SSH, false); assert.equal(report.已连接数据库, false); counts.CLI只读预检++;
}
for (const port of ['3306', '13306', '']) { const result = cli(['--preflight', '--port', port]); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); counts.CLI连接前拒绝++; }
for (const args of [['--port', '3306'], ['--port', '13306'], []]) {
  const result = cli(['--run', ...args, '--config-env-file', join(root, '.cache', '此文件不应被读取或创建.env')], '1');
  assert.equal(result.status, 1); assert.match(result.stderr, /Q05只允许专用端口/); assert.equal(result.stdout, ''); counts.CLI连接前拒绝++;
}
console.log(JSON.stringify({ 模式: '仅本地纯端口预检', ...counts, 合计: Object.values(counts).reduce((sum, value) => sum + value, 0), 已读取凭据文件: false, 已执行SSH: false, 已连接数据库: false }, null, 2));
