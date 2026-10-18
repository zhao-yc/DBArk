import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 摘要只取原字节；后续复核不能用漂移后的文件重新批准。 */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** 身份不完整即停链，不猜测路径或恢复未知资源。 */
const fail = message => { throw Error('原生专项身份拒绝：' + message); };
/** 清单与旁证只写一次；已有文件不能被漂移后的字节重新批准。 */
export function writeOnce(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); return sha256(readFileSync(path)); }
/** 只认真实普通文件/目录，父级的链接也不能改变批准路径。 */
function canonical(path, directory = false) {
  if (!isAbsolute(path)) fail('路径必须为绝对路径');
  const value = resolve(path), stat = lstatSync(value);
  // 与runtime的fs.promises.realpath使用同一原生语义，不批准Windows短路径别名。
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || realpathSync.native(value) !== value) fail('路径或类型变化');
  return value;
}
/** 保留根本身与跨盘/父目录拒绝语义。 */
function inside(root, path) { const part = relative(root, path); return !!part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); }
/** 集合与原identity合同相同；不把未批准的新文件、链接或遗漏当成通过。 */
function walk(path, files) {
  canonical(path, true);
  for (const name of readdirSync(path).sort()) {
    const child = join(path, name), stat = lstatSync(child);
    if (stat.isSymbolicLink()) fail('资源包含链接');
    if (stat.isDirectory()) walk(child, files);
    else if (stat.isFile()) files.push(canonical(child));
    else fail('未知资源类型');
    if (files.length > 20000) fail('资源数量超限');
  }
}
/** source只覆盖合同列明的运行字节；installed完整覆盖实际resources，不以安装器作app。 */
export function collectIdentity({ project, kind, root, executable, resources }) {
  project = canonical(project, true); root = canonical(root, true); executable = canonical(executable); resources = canonical(resources, true);
  if (!['source', 'installed'].includes(kind)) fail('未知阶段');
  const appPath = kind === 'source' ? root : join(resources, 'app.asar');
  if (kind === 'source' ? root !== project : !inside(root, executable) || !inside(root, resources) || !['DBArk.exe', 'DBArk'].includes(basename(executable))) fail('应用根与入口不匹配');
  const files = [executable, canonical(join(project, 'scripts/check-offline-query-port.mjs'))];
  if (kind === 'source') {
    files.push(canonical(join(root, 'package.json')), canonical(join(resources, 'default_app.asar'))); walk(join(root, 'dist'), files);
    if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).main !== 'dist/main/index.cjs' || !files.includes(join(root, 'dist/main/index.cjs')) || !files.includes(join(root, 'dist/renderer/index.html'))) fail('源码入口缺失');
  } else { walk(resources, files); if (!files.includes(appPath)) fail('安装应用缺少app.asar'); }
  if (new Set(files).size !== files.length || files.length > 20000) fail('清单重复或超限');
  return { version: 1, kind, root, executable, appPath, resources, files: files.sort().map(path => ({ path, sha256: sha256(readFileSync(path)) })) };
}
/** 复核固定清单；只比较原批准值，绝不把新扫描结果写回批准文件。 */
export function assertFrozenIdentity(manifest, project) {
  const current = collectIdentity({ ...manifest, project });
  if (JSON.stringify(current) !== JSON.stringify(manifest)) fail('批准字节或文件集合漂移');
}
/** 两个门使用独立命名文件；旁证承载同job来源，不扩展严格v1合同的键。 */
export function sealApproval({ identity, project, context, output, phase, provenance }) {
  if (!['source', 'installed'].includes(phase) || identity.kind !== phase) fail('批准阶段不匹配');
  mkdirSync(output, { recursive: true }); output = canonical(resolve(output), true);
  assertFrozenIdentity(identity, project);
  const manifests = {};
  for (const specialty of ['indent', 'layout']) {
    const path = join(output, phase + '-' + specialty + '-manifest.json');
    manifests[specialty] = { path, sha256: writeOnce(path, identity) };
  }
  const path = join(output, phase + '-approval.json');
  const approval = { version: 1, phase, project: canonical(project, true), context, provenance, manifests };
  const hash = writeOnce(path, approval);
  return { path, sha256: hash, value: approval };
}
/** 批准hash来自producer输出；消费者同时核同job上下文与两个原始清单。 */
export function readApproval(path, hash, context) {
  canonical(path);
  const raw = readFileSync(path);
  if (!/^[a-f0-9]{64}$/.test(hash ?? '') || sha256(raw) !== hash) fail('批准旁证hash不匹配');
  const value = JSON.parse(raw);
  if (value.version !== 1 || JSON.stringify(value.context) !== JSON.stringify(context)) fail('批准不属于同一job/源码');
  for (const specialty of ['indent', 'layout']) {
    const approved = value.manifests[specialty]; canonical(approved.path);
    const bytes = readFileSync(approved.path);
    if (sha256(bytes) !== approved.sha256) fail('清单hash漂移');
    const identity = JSON.parse(bytes); if (identity.kind !== value.phase) fail('清单阶段漂移');
    assertFrozenIdentity(identity, value.project);
  }
  return { path, sha256: hash, value };
}
/** 只由安装后准确app路径推导资源；NSIS名和缺少资源的路径会被拒绝。 */
export function installedIdentity(project, executable, platform) {
  executable = canonical(executable);
  if (!['win32', 'darwin'].includes(platform)) fail('平台不支持');
  const root = platform === 'win32' ? dirname(executable) : resolve(dirname(executable), '../..');
  const resources = platform === 'win32' ? join(root, 'resources') : join(root, 'Contents/Resources');
  return collectIdentity({ project, kind: 'installed', root, executable, resources });
}
/** 安装前后根不同，只按同一app内部相对位置核全部字节，端口脚本独立标识。 */
function relativeFiles(identity, project) {
  return identity.files.map(file => ({ path: file.path === join(project, 'scripts/check-offline-query-port.mjs') ? '@port-script' : relative(identity.root, file.path), sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
}
/** 在安装之前固定同job安装输入与未安装app；安装后不能再选择另一个参考产物。 */
export function preparePackageIdentity({ sourcePath, sourceHash, context, artifact, referenceExecutable, project, platform }) {
  const source = readApproval(sourcePath, sourceHash, context);
  if (source.value.phase !== 'source') fail('安装必须引用同次源码build批准');
  artifact = canonical(artifact); referenceExecutable = canonical(referenceExecutable);
  const release = canonical(join(project, 'release'), true);
  if (!inside(release, artifact) || !inside(release, referenceExecutable) || artifact === referenceExecutable) fail('安装参考超出本次release或把安装器作为app');
  const reference = installedIdentity(project, referenceExecutable, platform);
  const record = { sourcePath, sourceHash, context, project, artifact, artifactHash: sha256(readFileSync(artifact)), reference, platform };
  const path = join(dirname(sourcePath), 'package-input.json');
  return Object.freeze({ path, sha256: writeOnce(path, record) });
}
/** 安装成功后核输入未变及真实app字节与打包参考一致，再批准installed清单。 */
export function approveInstalled(proof, executable, output) {
  canonical(proof.path); const original = readFileSync(proof.path);
  if (sha256(original) !== proof.sha256) fail('安装前封存的批准记录变化');
  proof = JSON.parse(original);
  readApproval(proof.sourcePath, proof.sourceHash, proof.context);
  if (sha256(readFileSync(canonical(proof.artifact))) !== proof.artifactHash) fail('安装输入漂移');
  assertFrozenIdentity(proof.reference, proof.project);
  const identity = installedIdentity(proof.project, executable, proof.platform);
  if (JSON.stringify(relativeFiles(identity, proof.project)) !== JSON.stringify(relativeFiles(proof.reference, proof.project))) fail('安装app与同job打包字节不一致');
  return sealApproval({ identity, project: proof.project, context: proof.context, output, phase: 'installed', provenance: { sourceApproval: proof.sourceHash, artifact: proof.artifact, artifactSha256: proof.artifactHash, reference: proof.reference } });
}
