import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const progress: any = await import(new URL('../../scripts/native-editor-progress.mjs', import.meta.url).href);
const source = readFileSync(new URL('./native-editor-progress.test.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
const fixtureNode = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fixture');
if (!fixtureNode) throw Error('固定提交的原RAM端口缺失');
const program = ts.transpileModule(fixtureNode.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 只提取作者RAM端口，执行原生产协议；所有“文件”和FD都在内存Map中。 */
const fixture = runInNewContext(program + '\nfixture', { progress, Buffer, resolve, dirname, join, hash: (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex') }) as () => any;
const state = { owners: 1, registeredPids: 1, pids: [101], confirmedOwners: 0, readyOwners: 0, closedOwners: 0, retained: false, removed: false };

describe('独立窄核：阶段日志打开/追加之间的边界', () => {
  it('健康对照：固定writer正常追加一次并关闭所有FD', () => {
    const f = fixture(), writer = f.open(f.prepare()); writer.record('scan.begin', state);
    expect(f.nodes.get(f.path).bytes.toString('utf8')).toContain('scan.begin'); expect(f.handles.size).toBe(0);
  });
  it('manifest在lstat后同inode长到超过8MiB，应在读取正文前拒绝', () => {
    const f = fixture(), descriptor = f.prepare(), originalOpen = f.io.open, originalRead = f.io.bytes;
    const readSizes: number[] = [];
    f.io.open = (path: string, mode: string) => {
      const fd = originalOpen(path, mode);
      if (path === f.options.manifestPath && mode === 'read') f.nodes.get(path).bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 120);
      return fd;
    };
    f.io.bytes = (fd: number) => { const bytes = originalRead(fd); readSizes.push(bytes.length); return bytes; };
    expect(() => f.open(descriptor)).toThrow(); expect(f.handles.size).toBe(0);
    expect(readSizes, '不能先无界readFile再以hash不匹配拒绝').toEqual([]);
  });
  it('append打开前祖先目录被移走并以链接回指同inode，应拒绝跟随追加', () => {
    const f = fixture(), writer = f.open(f.prepare()), originalOpen = f.io.open, before = Buffer.from(f.nodes.get(f.path).bytes);
    f.io.open = (path: string, mode: string) => {
      if (mode === 'append') { const directory = f.nodes.get(f.directory); directory.link = true; directory.real = resolve('RAM-移走的原目录'); }
      // 最后一个路径组件仍是原普通文件、FD也仍同inode，模拟O_NOFOLLOW未覆盖的祖先链接。
      return originalOpen(path, mode);
    };
    expect(() => writer.record('launch.begin', state)).toThrow(); expect(f.nodes.get(f.path).bytes).toEqual(before);
  });
  it('append后路径替换为另一inode，应报告失败并永久停止writer', () => {
    const f = fixture(), writer = f.open(f.prepare()), originalAppend = f.io.append;
    const append = vi.fn((fd: number, bytes: Buffer) => {
      const result = originalAppend(fd, bytes), node = f.nodes.get(f.path);
      f.nodes.set(f.path, { ...node, ino: '替换后的inode', bytes: Buffer.from(node.bytes) }); return result;
    });
    f.io.append = append;
    expect(() => writer.record('launch.begin', state)).toThrow();
    expect(() => writer.record('scan.begin', state)).toThrow(); expect(append).toHaveBeenCalledTimes(1);
  });
});
