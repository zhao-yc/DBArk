import { expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readQueryFileSnapshot, writeBoundQueryFile } from '../../src/main/queryFileSourceFiles';

/** 此例须在fork进程串行运行；Windows的mode映射不能作为POSIX权限保留证据。 */
it.skipIf(process.platform === 'win32').sequential('POSIX真实自有文件在严格umask下关联替换后逐位保留0664', async () => {
  const root = resolve('.cache/sql-file-mode-posix-tests');
  let directory: string | undefined, previousMask: number | undefined;
  const lease = { active: true };
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(root, 'owned-'));
    const canonicalDirectory = await realpath(directory), target = join(directory, 'owned.sql');
    await writeFile(target, Buffer.from('select 1;\n'), { mode: 0o600, flag: 'wx' });
    await chmod(target, 0o664);
    const check = () => { if (!lease.active) throw Error('本例自有文件授权已结束'); };
    const original = await readQueryFileSnapshot(target, check);
    expect(dirname(original.path)).toBe(canonicalDirectory);
    expect(original.mode).toBe(0o664);
    // 先确认原文件为0664，再设置严格umask，保证wx初始mode不能自行保留组权限。
    previousMask = process.umask(0o077);
    const marks: string[] = [], bytes = Buffer.from('select 2;\n');
    const written = await writeBoundQueryFile(original.path, bytes, original, check, state => { marks.push(state); });
    const actual = await stat(original.path, { bigint: true });
    expect(actual.mode & 0o777n).toBe(0o664n);
    expect(written.mode).toBe(original.mode);
    expect(await readFile(original.path)).toEqual(bytes);
    expect(marks).toEqual(['unknown', 'yes']);
  } finally {
    // 无论断言或IO是否失败，都先恢复本fork的原umask，再清理已核归属的测试目录。
    if (previousMask !== undefined) process.umask(previousMask);
    lease.active = false;
    if (directory) {
      if (dirname(directory) !== root) throw Error('拒绝清理本例目录以外的路径');
      await rm(directory, { recursive: true, force: true });
    }
  }
});
