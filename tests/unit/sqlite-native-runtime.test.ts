import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveSqliteNativeResource, sqliteNativeDirectory } from '../../src/engine/sqlite/nativeRuntime';

describe('SQLite固定原生资源边界', () => {
  it('源码默认入口定位真实构建资源，asar路径只映射到对应unpacked', () => {
    expect(readFileSync(resolveSqliteNativeResource()).length).toBeGreaterThan(0);
    const base = join(tmpdir(), 'dbark-app', 'resources', 'app.asar', 'dist', 'main');
    expect(sqliteNativeDirectory(base)).toBe(join(tmpdir(), 'dbark-app', 'resources', 'app.asar.unpacked', 'dist', 'main', 'sqlite-native'));
  });
  it('错误摘要、平台、架构、逃逸文件名与大小均在加载前拒绝', () => {
    // macOS的/var别名及Windows短路径先固定真实根，仍精确比较最终文件路径。
    const parent = realpathSync.native(tmpdir()), directory = mkdtempSync(join(parent, 'dbark-sqlite-native-resource-')), bytes = Buffer.from('只验证资源元数据，不加载本例伪二进制'), sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so', file = 'dbark-sqlite-' + sha256 + '.' + extension;
    const valid = { version: 1, platform: process.platform, architectures: [process.arch], file, bytes: bytes.length, sha256, sourceHash: 'a'.repeat(64) };
    let success = false;
    try {
      writeFileSync(join(directory, file), bytes);
      for (const patch of [{ sha256: '0'.repeat(64) }, { platform: '其它平台' }, { architectures: [] }, { file: '../' + file }, { bytes: bytes.length + 1 }, { version: 2 }]) {
        writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ ...valid, ...patch })); expect(() => resolveSqliteNativeResource(directory)).toThrow();
      }
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify(valid)); expect(resolveSqliteNativeResource(directory)).toBe(join(directory, file)); success = true;
    } finally { if (success) { expect(dirname(directory)).toBe(parent); expect(realpathSync.native(directory)).toBe(directory); expect(basename(directory).startsWith('dbark-sqlite-native-resource-')).toBe(true); rmSync(directory, { recursive: true }); } }
  });
});
