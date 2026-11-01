import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, statSync, utimesSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const { buildSqliteNative } = await import(new URL('../../scripts/build-sqlite-native.mjs', import.meta.url).href);

/** 验证重复构建不覆盖已发布的同内容资源；坏文件原样保留，避免隐藏损坏现场。 */
it('原生构建复用同摘要文件，拒绝覆盖损坏文件', async () => {
  const parent = realpathSync.native(tmpdir()), directory = mkdtempSync(join(parent, 'dbark-native-build-'));
  let accepted = false;
  try {
    const first = await buildSqliteNative(directory), file = join(directory, first.file), marker = new Date('2000-01-01T00:00:00Z');
    utimesSync(file, marker, marker); const before = statSync(file).mtimeMs;
    expect(await buildSqliteNative(directory)).toEqual(first); expect(statSync(file).mtimeMs).toBe(before);
    const damaged = Buffer.from('本例损坏资源'); writeFileSync(file, damaged);
    await expect(buildSqliteNative(directory)).rejects.toThrow('SQLite目标原生资源损坏');
    expect(readFileSync(file)).toEqual(damaged); accepted = true;
  } finally {
    if (accepted) {
      expect(dirname(realpathSync.native(directory))).toBe(parent); expect(basename(directory).startsWith('dbark-native-build-')).toBe(true);
      rmSync(directory, { recursive: true });
    }
  }
});
