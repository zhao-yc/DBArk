import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { sealEditorIndentLaunchIdentity } from '../e2e/editor-indentation-native-identity';

const script = readFileSync(new URL('../../scripts/test-packaged.mjs', import.meta.url), 'utf8');
const scriptTree = ts.createSourceFile('test-packaged.mjs', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const temporary = scriptTree.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(scriptTree) === 'temporaryParent');
if (!temporary?.initializer) throw Error('实际安装临时根表达式缺失');
const publisher = readFileSync(new URL('../../scripts/native-editor-ci-identity.mjs', import.meta.url), 'utf8');
const publisherTree = ts.createSourceFile('publisher.mjs', publisher, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const canonical = publisherTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'canonical');
const failure = publisherTree.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(publisherTree) === 'fail'));
if (!canonical || !failure) throw Error('实际发布者规范路径门缺失');
const canonicalProgram = ts.transpileModule(failure.getText(publisherTree) + '\n' + canonical.getText(publisherTree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ownership = ['contained', 'assertOwnedPath'].map(name => scriptTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
if (ownership.some(value => !value)) throw Error('实际安装归属门缺失');
const ownershipProgram = ts.transpileModule(ownership.map(node => node!.getText(scriptTree)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const short = resolve('RAM-Windows/RUNNER~1/Temp'), long = resolve('RAM-Windows/runneradmin/Temp');
const native = (path: string) => path === short || path.startsWith(short + sep) ? long + path.slice(short.length) : path;
const sync = Object.assign(vi.fn((path: string) => path), { native: vi.fn(native) });

/** 只对合成别名做RAM建模；实际生产seal/regular/hash逻辑不修改或替代。 */
function fixture(parent: string) {
  const project = resolve('RAM-project'), root = join(parent, 'dbark-package-e2e-RAM/Applications'), executable = join(root, 'DBArk.exe'), resources = join(root, 'resources'), appPath = join(resources, 'app.asar');
  const path = resolve('RAM-project/installed-approved.json'), data = new Map<string, Buffer>(), links = new Set<string>();
  const files = [executable, join(project, 'scripts/check-offline-query-port.mjs'), appPath];
  for (const file of files) data.set(native(file), Buffer.from('公开合成字节：' + basename(file)));
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const manifest = { version: 1, kind: 'installed', root, executable, resources, appPath, files: files.map(path => ({ path, sha256: digest(data.get(native(path))!) })) };
  const raw = Buffer.from(JSON.stringify(manifest)); data.set(path, raw);
  const directories = new Set<string>();
  for (let file of data.keys()) while (dirname(file) !== file) { file = dirname(file); directories.add(file); }
  const port = {
    stat: async (path: string) => ({ file: data.has(native(path)), directory: directories.has(native(path)), link: links.has(native(path)) }),
    real: async (path: string) => native(path), bytes: async (path: string) => data.get(native(path))!,
    list: async (path: string) => [...new Set([...data.keys()].filter(value => value.startsWith(native(path) + sep)).map(value => value.slice(native(path).length + 1).split(sep)[0]))],
  };
  return { data, links, root, executable, resources, appPath, seal: () => sealEditorIndentLaunchIdentity(path, digest(raw), project, port, () => {}) };
}

describe('Windows安装路径原生规范化及原身份门（纯RAM）', () => {
  it('原安装临时根表达式使用native长路径，再创建本次独立目录', () => {
    sync.mockClear(); sync.native.mockClear();
    const parent = runInNewContext(temporary.initializer!.getText(scriptTree), { realpathSync: sync, tmpdir: () => short });
    expect(parent).toBe(long); expect(sync).not.toHaveBeenCalled(); expect(sync.native).toHaveBeenCalledWith(short);
  });
  it('原RUNNER~1清单在未改的strict regular门仍被拒绝', async () => {
    await expect(fixture(short).seal()).rejects.toThrow('Root批准');
  });
  it('从原生临时根生成完整长路径后通过原seal及实际来源绑定', async () => {
    const parent = runInNewContext(temporary.initializer!.getText(scriptTree), { realpathSync: sync, tmpdir: () => short });
    const f = fixture(parent), sealed = await f.seal(); expect(sealed.manifest.root).toBe(f.root);
    await sealed.assertActual({ executable: f.executable, appPath: f.appPath, resources: f.resources, packaged: true, pid: 101 });
    await expect(sealed.assertActual({ executable: resolve('RAM-foreign/DBArk.exe'), appPath: f.appPath, resources: f.resources, packaged: true, pid: 101 })).rejects.toThrow('Root批准');
  });
  it('发布者也使用原生规范门：短别名拒绝，准确长路径通过', () => {
    const check = runInNewContext(canonicalProgram + '\ncanonical', { resolve, isAbsolute, realpathSync: sync, lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }), Error });
    expect(() => check(short, true)).toThrow('路径或类型变化'); expect(check(long, true)).toBe(long);
  });
  it('规范根后的原归属门仍拒绝外部、链接及短别名逃逸，不扩大清理范围', () => {
    const temporary = join(long, 'dbark-package-e2e-RAM'), target = join(temporary, 'Applications/DBArk.exe'), changes = new Map<string, string>(); let linked = false;
    const real = Object.assign((path: string) => path, { native: (path: string) => changes.get(path) ?? native(path) });
    const check = runInNewContext(ownershipProgram + '\nassertOwnedPath', { relative, dirname, basename, isAbsolute, resolve, sep, temporary, temporaryParent: long, temporaryPrefix: 'dbark-package-e2e-', existsSync: () => true, lstatSync: () => ({ isSymbolicLink: () => linked }), realpathSync: real, Error });
    expect(() => check(target)).not.toThrow(); expect(() => check(resolve('RAM-foreign/DBArk.exe'))).toThrow('超出');
    expect(() => check(join(short, 'dbark-package-e2e-RAM/Applications/DBArk.exe'))).toThrow('超出');
    changes.set(target, resolve('RAM-foreign/DBArk.exe')); expect(() => check(target)).toThrow('超出'); changes.clear();
    linked = true; expect(() => check(target)).toThrow('临时根目录已改变');
  });
  it.each(['link', 'bytes'])('规范根不放行%s漂移', async mode => {
    const f = fixture(long); if (mode === 'link') f.links.add(f.executable); else f.data.set(f.appPath, Buffer.from('后来改动'));
    await expect(f.seal()).rejects.toThrow('Root批准');
  });
});
