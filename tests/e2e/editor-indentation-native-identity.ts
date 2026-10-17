import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface IndentIdentityPort {
  stat(path: string): Promise<{ file: boolean; directory: boolean; link: boolean }>;
  real(path: string): Promise<string>; list(path: string): Promise<string[]>; bytes(path: string): Promise<Uint8Array>;
}
export interface IndentLaunchManifest { version: 1; kind: 'source' | 'installed'; root: string; executable: string; appPath: string; resources: string; files: readonly Readonly<{ path: string; sha256: string }>[]; }
export interface IndentActualSource { executable: string; appPath: string; resources: string; packaged: boolean; pid: number; }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const failed = (): never => { throw Error('Root批准的缩进运行身份未知或已变化，保留资源'); };
/** 路径只由批准清单提供，不以当时cwd、环境EXE或新目录扫描重签批准。 */
function absolute(value: unknown): string { if (typeof value !== 'string' || !isAbsolute(value)) return failed(); return resolve(value); }
function inside(root: string, child: string) { const part = relative(root, child); return !!part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); }
/** 所有文件操作都经过同一完整授权；端口由原生适配器或纯RAM测试明确注入。 */
export async function sealEditorIndentLaunchIdentity(path: string, approvedHash: string, projectRoot: string, port: IndentIdentityPort, guard: () => void) {
  async function checked<T>(read: () => Promise<T>): Promise<T> { guard(); const value = await read(); guard(); return value; }
  async function regular(path: string, directory = false) {
    const stat = await checked(() => port.stat(path)); if (stat.link || !(directory ? stat.directory : stat.file) || await checked(() => port.real(path)) !== path) failed();
  }
  const manifestPath = absolute(path); await regular(manifestPath); const raw = await checked(() => port.bytes(manifestPath));
  if (!/^[a-f0-9]{64}$/.test(approvedHash) || digest(raw) !== approvedHash || raw.length > 8 * 1024 * 1024) failed();
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!input || typeof input !== 'object' || Object.keys(input).sort().join() !== ['appPath', 'executable', 'files', 'kind', 'resources', 'root', 'version'].sort().join() || input.version !== 1 || !['source', 'installed'].includes(input.kind) || !Array.isArray(input.files) || !input.files.length || input.files.length > 20000) failed();
  const files = (input.files as unknown[]).map((file: unknown) => {
    if (!file || typeof file !== 'object' || Object.keys(file).sort().join() !== 'path,sha256') return failed();
    const value = file as { path: unknown; sha256: unknown }; if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return failed();
    return Object.freeze({ path: absolute(value.path), sha256: value.sha256 });
  });
  const manifest: Readonly<IndentLaunchManifest> = Object.freeze({ version: 1, kind: input.kind, root: absolute(input.root), executable: absolute(input.executable), appPath: absolute(input.appPath), resources: absolute(input.resources), files: Object.freeze(files) });
  const expected = new Map(manifest.files.map(file => [file.path, file.sha256])); if (expected.size !== files.length) failed();
  if (manifest.kind === 'installed' && !expected.has(manifest.appPath)) failed();
  if (manifest.kind === 'source' ? manifest.root !== resolve(projectRoot) || manifest.appPath !== manifest.root : !inside(manifest.root, manifest.executable) || !inside(manifest.root, manifest.resources) || manifest.appPath !== join(manifest.resources, 'app.asar')) failed();
  /** 完整目录集合也被批准；缺文件、多文件、链接替换或仅路径相同都不能通过。 */
  async function walk(path: string, output: string[]) {
    await regular(path, true); const names = await checked(() => port.list(path));
    if (new Set(names).size !== names.length || names.some(name => !name || name === '.' || name === '..' || basename(name) !== name)) failed();
    for (const name of names.sort()) {
      const child = join(path, name), stat = await checked(() => port.stat(child)); if (stat.link) failed();
      if (stat.directory) await walk(child, output); else if (stat.file) output.push(child); else failed();
      guard(); if (output.length > 20000) failed();
    }
  }
  async function assertCurrent() {
    guard(); await regular(manifestPath); if (digest(await checked(() => port.bytes(manifestPath))) !== approvedHash) failed();
    await regular(manifest.root, true); await regular(manifest.resources, true);
    const actual: string[] = [manifest.executable, join(resolve(projectRoot), 'scripts/check-offline-query-port.mjs')];
    if (manifest.kind === 'source') { actual.push(join(manifest.root, 'package.json'), join(manifest.resources, 'default_app.asar')); await walk(join(manifest.root, 'dist'), actual); }
    else await walk(manifest.resources, actual);
    guard(); if (new Set(actual).size !== actual.length || actual.length !== expected.size || actual.some(path => !expected.has(path))) failed();
    if (manifest.kind === 'source' && (!expected.has(join(manifest.root, 'dist/main/index.cjs')) || !expected.has(join(manifest.root, 'dist/renderer/index.html')))) failed();
    for (const path of actual.sort()) {
      await regular(path); const bytes = await checked(() => port.bytes(path)); if (digest(bytes) !== expected.get(path)) failed(); await regular(path);
    }
    if (manifest.kind === 'source') { const json = JSON.parse(new TextDecoder().decode(await checked(() => port.bytes(join(manifest.root, 'package.json'))))); if (json.main !== 'dist/main/index.cjs') failed(); }
    guard();
  }
  /** 启动返回后核实际主进程来源，不能只相信传给launch的路径参数。 */
  async function assertActual(actual: IndentActualSource) {
    guard(); if (!Number.isSafeInteger(actual.pid) || actual.pid <= 0 || actual.packaged !== (manifest.kind === 'installed')) failed();
    for (const [reported, approved] of [[actual.executable, manifest.executable], [actual.appPath, manifest.appPath], [actual.resources, manifest.resources]]) if (await checked(() => port.real(absolute(reported))) !== approved) failed();
    guard();
  }
  await assertCurrent(); return Object.freeze({ manifest, assertCurrent, assertActual });
}
