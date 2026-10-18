import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const progress: any = await import(new URL('../../scripts/native-editor-progress.mjs', import.meta.url).href);
const source = readFileSync(new URL('./native-editor-progress.test.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
const fixtureNode = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fixture');
if (!fixtureNode) throw Error('原RAM端口缺失');
const program = ts.transpileModule(fixtureNode.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const fixture = runInNewContext(program + '\nfixture', { progress, Buffer, resolve, dirname, join, hash: (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex') }) as () => any;
const state = { owners: 1, registeredPids: 1, pids: [101], confirmedOwners: 0, readyOwners: 0, closedOwners: 0, retained: false, removed: false };
const nativeSource = readFileSync(new URL('../../scripts/native-editor-progress.mjs', import.meta.url), 'utf8');
const nativeTree = ts.createSourceFile('native-editor-progress.mjs', nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const nativeVariable = nativeTree.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(nativeTree) === 'nativeProgressIO');
if (!nativeVariable?.initializer || !ts.isObjectLiteralExpression(nativeVariable.initializer)) throw Error('原生适配器对象缺失');
const nativeBytes = nativeVariable.initializer.properties.find(node => ts.isMethodDeclaration(node) && node.name.getText(nativeTree) === 'bytes');
if (!nativeBytes) throw Error('原生有界读取方法缺失');

describe('本轮有界FD读取与最终路径大小复核（纯RAM）', () => {
  it('原生bytes方法本体只对FD请求批准上限，不调用无界readFileSync', () => {
    const maximum = 8 * 1024 * 1024, data = Buffer.alloc(maximum + 1, 120), reads: number[] = [];
    const fs = { readSync(_fd: number, target: Buffer, offset: number, length: number, position: number) { reads.push(length); return data.copy(target, offset, position, position + length); } };
    // 执行生产原生适配器原方法，只有fs.readSync为内存端口，真实文件IO为零。
    const bytes = runInNewContext('({' + nativeBytes.getText(nativeTree) + '})', { fs, Buffer }).bytes(1, maximum);
    expect(bytes.length).toBe(maximum); expect(reads).toEqual([maximum]);
  });
  it('同inode在正文读取期间继续增长，也只读取原有界长度并拒绝增长', () => {
    const f = fixture(), descriptor = f.prepare(), original = f.io.bytes, sizes: number[] = [], expected = f.nodes.get(f.options.manifestPath).bytes.length;
    f.io.bytes = (fd: number, maximum: number) => { f.handles.get(fd).node.bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 120); const bytes = original(fd, maximum); sizes.push(bytes.length); return bytes; };
    expect(() => f.open(descriptor)).toThrow(); expect(sizes).toEqual([expected]); expect(f.handles.size).toBe(0);
  });
  it('append返回完整字节但并发多出一个字节时仍拒绝，不能只信返回值', () => {
    const f = fixture(), writer = f.open(f.prepare()), original = f.io.append;
    const append = vi.fn((fd: number, bytes: Buffer) => { const count = original(fd, bytes), node = f.handles.get(fd).node; node.bytes = Buffer.concat([node.bytes, Buffer.from('x')]); return count; }); f.io.append = append;
    expect(() => writer.record('launch.begin', state)).toThrow(); expect(() => writer.record('scan.begin', state)).toThrow(); expect(append).toHaveBeenCalledTimes(1); expect(f.handles.size).toBe(0);
  });
  it('append的FD关闭后路径才换inode，最终路径检查仍失败且永久停止', () => {
    const f = fixture(), writer = f.open(f.prepare()), original = f.io.close;
    f.io.close = (fd: number) => { const mode = f.handles.get(fd).mode; original(fd); if (mode === 'append') { const node = f.nodes.get(f.path); f.nodes.set(f.path, { ...node, ino: '关闭后替换', bytes: Buffer.from(node.bytes) }); } };
    expect(() => writer.record('launch.begin', state)).toThrow(); expect(() => writer.record('scan.begin', state)).toThrow(); expect(f.handles.size).toBe(0);
  });
});
