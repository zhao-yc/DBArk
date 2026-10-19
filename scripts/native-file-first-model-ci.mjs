import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readApproval, sha256, writeOnce } from './native-editor-ci-identity.mjs';
import { ciContext, executeOnce } from './native-editor-ci.mjs';

// CLI选择声明spec，原报告则由require的正式live登记；两个路径合同分别保留。
export const fileFirstModelSpec = 'tests/e2e/query-file-first-model-native.spec.ts';
export const fileFirstModelLive = 'tests/e2e/query-file-first-model-native-live.ts';
export const fileFirstModelCases = Object.freeze([
  { key: 'lf-button', title: 'LF首次文件模型：普通编辑Undo、格式化按钮UndoRedo及独立重启', entry: 'button', eol: '\n' },
  { key: 'lf-shortcut', title: 'LF首次文件模型：普通编辑Undo、格式化快捷键UndoRedo及独立重启', entry: 'shortcut', eol: '\n' },
  { key: 'crlf-button', title: 'CRLF首次文件模型：普通编辑Undo、格式化按钮UndoRedo及独立重启', entry: 'button', eol: '\r\n' },
  { key: 'crlf-shortcut', title: 'CRLF首次文件模型：普通编辑Undo、格式化快捷键UndoRedo及独立重启', entry: 'shortcut', eol: '\r\n' },
].map(value => Object.freeze(value)));
const attachmentName = '文件首次模型原生终态';
const stages = ['首次模型且尚无用户编辑', '普通字符编辑', '普通字符一次Undo且clean', '首次格式化', '格式化一次Undo且clean', '格式化Redo', '最终Undo且clean', '独立重启且clean'];
const fileStages = ['paths-planned', 'directory-captured', 'write-planned', 'original-handle-captured', 'created'];
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw Error('文件首次模型CI拒绝：' + message); };

/** 完整消费原footer，不在报告之外读取窗口/PID/文件或补签退出证明。 */
export function assertFileFirstModelProof(proof, expected) {
  if (!object(proof) || proof.caseKey !== expected.key || proof.entry !== expected.entry || proof.sourceEol !== expected.eol || proof.accepted !== true || proof.ordinarySingleUndo !== true || proof.formatSingleUndo !== true || proof.sqliteSchema !== 9 || proof.directoryRemoved !== true || proof.sqlExecution !== 0 || proof.queryLibraryWrites !== 0 || proof.systemClipboard !== 0 || proof.dirtyAnswerInstalled !== false) fail('原footer的case/SQLite/行为终态不完整');
  if (!Array.isArray(proof.normalOwners) || proof.normalOwners.length !== 2 || proof.normalOwners.some(owner => !object(owner) || owner.confirmed !== true || owner.willQuit !== true || owner.closed !== true || !positive(owner.recordedPids))) fail('每例须两个正常退出的原owner');
  const identity = proof.identity;
  if (!object(identity) || !/^\d+$/.test(identity.dev ?? '') || typeof identity.dev !== 'string' || !/^\d+$/.test(identity.ino ?? '') || typeof identity.ino !== 'string' || !positive(identity.size) || identity.size > 4096 || !/^[a-f0-9]{64}$/.test(identity.hash ?? '')) fail('原文件身份缺失');
  if (!Array.isArray(proof.witnesses) || proof.witnesses.length !== stages.length || proof.witnesses.some((value, index) => !object(value) || value.stage !== stages[index])) fail('八项原行为见证缺失或重复');
  const initial = proof.witnesses[0];
  if (!object(initial.initial) || initial.initial.caseKey !== expected.key || initial.initial.eol !== expected.eol || initial.initial.bytes !== identity.size || initial.initial.userEditsBeforeInitial !== 0 || !positive(initial.initial.version) || !positive(initial.initial.alternative) || !object(initial.identity) || ['dev', 'ino', 'size', 'hash'].some(key => initial.identity[key] !== identity[key])) fail('首次未编辑的原文件/模型见证缺失');
  for (const witness of proof.witnesses.slice(1)) {
    const model = witness.model;
    if (!object(model) || !positive(model.editorId) || !positive(model.modelId) || !positive(model.version) || !positive(model.alternative) || typeof model.value !== 'string' || model.eol !== expected.eol || typeof model.focused !== 'boolean' || model.overflow !== 0 || !Array.isArray(model.events) || !object(model.options) || !Array.isArray(model.selections)) fail('原模型见证字段不完整');
    if (!positive(model.options.tabSize) || !positive(model.options.indentSize) || typeof model.options.insertSpaces !== 'boolean' || typeof model.options.readOnly !== 'boolean' || !model.selections.length || model.selections.some(selection => !object(selection) || ['start', 'end', 'anchor', 'position'].some(key => !Number.isSafeInteger(selection[key]) || selection[key] < 0 || selection[key] > model.value.length)) || model.events.some(event => !object(event) || !positive(event.version) || event.eol !== expected.eol || ['undo', 'redo', 'eolChange', 'flush'].some(key => typeof event[key] !== 'boolean'))) fail('原模型选项/选区/事件字段缺失');
  }
  // 原文件与三次clean观察逐字绑定，不把换行归一化后的逻辑同文当原字节。
  for (const index of [2, 6, 7]) if (Buffer.byteLength(proof.witnesses[index].model.value) !== identity.size || sha256(Buffer.from(proof.witnesses[index].model.value)) !== identity.hash) fail('原文件与clean模型字节不一致');
  if (!Array.isArray(proof.files) || proof.files.length !== fileStages.length || proof.files.some((record, index) => !object(record) || record.stage !== fileStages[index])) fail('原文件创建链缺失或重复');
  if (!object(proof.files[0].paths) || ['source', 'missing', 'replacement'].some(key => typeof proof.files[0].paths[key] !== 'string' || !proof.files[0].paths[key]) || typeof proof.files[1].dev !== 'string' || typeof proof.files[1].ino !== 'string') fail('原文件路径/目录身份缺失');
  for (const record of proof.files.slice(2)) if (record.path !== proof.files[0].paths.source) fail('原创建路径不一致');
  for (const record of [proof.files[3], proof.files[4]]) if (!object(record.identity) || ['dev', 'ino', 'size', 'hash'].some(key => record.identity[key] !== identity[key])) fail('原创建句柄/路径身份不一致');
  if (proof.files[2].size !== identity.size || proof.files[2].hash !== identity.hash) fail('原文件计划字节身份不一致');
  return proof;
}

/** 只接受四个正式live标题各一次；绝对同名路径、错spec、skip/retry/额外结果一律拒绝。 */
export function assertFileFirstModelResult(report) {
  const specs = [];
  const visit = suite => { if (!object(suite)) fail('报告suite无效'); specs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) visit(child); };
  if (!object(report) || !Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.suites) || !object(report.stats) || report.stats.expected !== 4 || report.stats.skipped !== 0 || report.stats.unexpected !== 0 || report.stats.flaky !== 0) fail('报告错误或计数不是四例零skip');
  for (const suite of report.suites) visit(suite);
  if (specs.length !== 4) fail('报告不是四例');
  const proofs = new Map();
  for (const spec of specs) {
    const expected = fileFirstModelCases.find(value => value.title === spec.title), tests = spec.tests, result = tests?.[0]?.results?.[0];
    if (!expected || proofs.has(expected.key) || ![fileFirstModelLive, fileFirstModelLive.split('/').at(-1)].includes(String(spec.file).replaceAll('\\', '/')) || spec.ok !== true || !Array.isArray(tests) || tests.length !== 1 || tests[0].expectedStatus !== 'passed' || tests[0].status !== 'expected' || !Array.isArray(tests[0].results) || tests[0].results.length !== 1 || result.status !== 'passed' || result.retry !== 0 || !Array.isArray(result.errors) || result.errors.length || result.error) fail('文件/标题或原单次结果不匹配');
    const attachments = result.attachments;
    if (!Array.isArray(attachments) || attachments.some(value => value.name === '文件首次模型保留现场')) fail('成功报告含失败或未知附录');
    const footers = attachments.filter(value => value.name === attachmentName && value.contentType === 'application/json');
    if (footers.length !== 1 || typeof footers[0].body !== 'string' || footers[0].body.length > 8 * 1024 * 1024) fail('原footer附件缺失或重复');
    const bytes = Buffer.from(footers[0].body, 'base64');
    if (bytes.toString('base64') !== footers[0].body) fail('原footer编码无效');
    proofs.set(expected.key, assertFileFirstModelProof(JSON.parse(bytes.toString('utf8')), expected));
  }
  return fileFirstModelCases.map(value => proofs.get(value.key));
}

/** 只保留桌面启动环境；父级CI控制不泄入子专项，新门及清单只能来自当前原批准。 */
export function fileFirstModelEnvironment(parent, approval, report) {
  const ciKeys = new Set(['DBARK_INTEGRATION_ENABLED', 'DBARK_NATIVE_EDITOR_CI', 'DBARK_NATIVE_EDITOR_SOURCE_APPROVAL', 'DBARK_NATIVE_EDITOR_SOURCE_APPROVAL_SHA256', 'DBARK_NATIVE_EDITOR_REFERENCE_EXECUTABLE', 'DBARK_W03_SAVED_QUERY_NAVIGATION_TEST', 'DBARK_EDITOR_FONT_NATIVE_TEST', 'DBARK_QUERY_DUPLICATE_NATIVE_TEST', 'DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST', 'DBARK_SNIPPETS_NATIVE_DIAGNOSTICS']);
  const desktop = /^(PATH|Path|SystemRoot|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|CI|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY)$/;
  const env = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(parent))) {
    if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PLAYWRIGHT_|PWDEBUG$)/i.test(key) && (key !== key.toUpperCase() || !ciKeys.has(key) || !('value' in descriptor) || typeof descriptor.value !== 'string')) fail('父环境含未许可的资源/认证/录制或别名键：' + key);
    if (key === 'DBARK_INTEGRATION_ENABLED' && descriptor.value !== '0') fail('父环境integration必须关闭');
    if (desktop.test(key) && 'value' in descriptor && typeof descriptor.value === 'string') env[key] = descriptor.value;
  }
  const manifest = approval.value.manifests.indent;
  env.DBARK_INTEGRATION_ENABLED = '0'; env.DBARK_FILE_FIRST_MODEL_NATIVE_TEST = '1'; env.DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED = '1';
  env.DBARK_FILE_FIRST_MODEL_MANIFEST = manifest.path; env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256 = manifest.sha256;
  if (approval.value.phase === 'installed') env.DBARK_EXECUTABLE_PATH = JSON.parse(readFileSync(manifest.path, 'utf8')).executable;
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = report;
  return env;
}

/** 新四例还未完成或后续失败时，不授予实际安装根的清理资格。 */
export function fileFirstModelCleanupAllowed(result) {
  try {
    if (result?.phase !== 'installed' || result.cleanupAllowed !== true || !Array.isArray(result.proofs) || result.proofs.length !== 4) return false;
    result.proofs.forEach((proof, index) => assertFileFirstModelProof(proof, fileFirstModelCases[index])); return true;
  } catch { return false; }
}

/** 每阶段一个原进程运行四例；不build、不下载、不重签原批准、不重试或清理失败现场。 */
export function runNativeFileFirstModel({ project, approval, phase, output, parentEnv = process.env, currentContext = () => ciContext(project, parentEnv) }, execute = executeOnce) {
  if (!['source', 'installed'].includes(phase)) fail('阶段未知');
  const descriptor = { path: approval.path, sha256: approval.sha256 };
  const checkpoint = () => {
    const frozen = readApproval(descriptor.path, descriptor.sha256, currentContext());
    if (frozen.value.phase !== phase || frozen.value.project !== realpathSync.native(project) || frozen.value.manifests.indent.sha256 !== frozen.value.manifests.layout.sha256) fail('阶段/项目/完整运行树不匹配');
    return frozen;
  };
  let frozen = checkpoint();
  if (resolve(output) !== join(frozen.value.project, 'test-results/native-file-first-model-ci')) fail('输出不属于独立专项目录');
  if (realpathSync.native(dirname(output)) !== dirname(resolve(output))) fail('输出父目录身份变化');
  mkdirSync(output, { recursive: true });
  if (realpathSync.native(output) !== resolve(output)) fail('输出目录为链接或别名');
  const directory = join(output, phase); mkdirSync(directory);
  const report = join(directory, 'report.json');
  writeOnce(join(directory, 'started.json'), { phase, spec: fileFirstModelSpec, reportFile: fileFirstModelLive, cases: fileFirstModelCases.map(({ key, title }) => ({ key, title })), approvalSha256: descriptor.sha256, manifest: frozen.value.manifests.indent, automaticRetry: false, automaticForceStop: false, cleanupAllowed: false });
  try {
    frozen = checkpoint();
    const env = fileFirstModelEnvironment(parentEnv, frozen, report);
    const result = execute(process.execPath, [join(frozen.value.project, 'node_modules/@playwright/test/cli.js'), 'test', fileFirstModelSpec, '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=' + join(directory, 'attachments')], { cwd: frozen.value.project, env });
    const failure = result.error || (result.status !== 0 ? Error('文件首次模型原进程非零或未知退出：' + result.status) : undefined);
    try { for (const name of ['stdout', 'stderr']) writeFileSync(join(directory, 'playwright.' + name + '.log'), result[name] ?? '', { flag: 'wx' }); }
    catch (diagnostic) { if (failure) throw new AggregateError([failure, diagnostic], '原进程失败且日志记录失败', { cause: failure }); throw diagnostic; }
    if (failure) throw failure;
    const bytes = readFileSync(report), proofs = assertFileFirstModelResult(JSON.parse(bytes.toString('utf8'))); frozen = checkpoint();
    const accepted = { phase, spec: fileFirstModelSpec, reportFile: fileFirstModelLive, approvalSha256: descriptor.sha256, manifest: frozen.value.manifests.indent, context: frozen.value.context, reportSha256: sha256(bytes), cleanupAllowed: true, automaticRetry: false, proofs };
    writeOnce(join(directory, 'accepted.json'), accepted); return accepted;
  } catch (error) {
    try { writeOnce(join(directory, 'failure.json'), { phase, spec: fileFirstModelSpec, message: String(error), automaticRetry: false, automaticForceStop: false, cleanupAllowed: false }); }
    catch (diagnostic) { throw new AggregateError([error, diagnostic], '文件首次模型原失败及诊断失败', { cause: error }); }
    throw error;
  }
}

// 导入仅定义函数；默认/list在任何批准读取、CI核对或执行端口之前拒绝。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'source') throw Error('仅接受source模式，实际安装由原安装脚本调用');
    const project = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)));
    runNativeFileFirstModel({ project, phase: 'source', approval: { path: process.env.DBARK_NATIVE_EDITOR_SOURCE_APPROVAL, sha256: process.env.DBARK_NATIVE_EDITOR_SOURCE_APPROVAL_SHA256 }, output: join(project, 'test-results/native-file-first-model-ci') });
  } catch (error) { console.error(error); process.exitCode = 1; }
}
