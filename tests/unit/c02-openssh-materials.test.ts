import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, lstat, writeFile, unlink, rmdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { generateC02OpenSshMaterials, writeC02OpenSshMaterials, readC02OpenSshMaterials, removeC02OpenSshMaterials } from '../integration/helpers/c02-openssh-materials';

describe('本地新临时材料的实际文件边界，不计SSH或OpenSSH互通', () => {
  it('实际加密文件只在本轮目录；不覆盖、不接管额外内容，最后逐文件清理', async () => {
    const root = resolve('.cache', 'c02-openssh', 'own-format-checks'); await mkdir(root, { recursive: true, mode: 0o700 });
    const parent = await mkdtemp(join(root, 'case-')); let directory = '', removed = false;
    try {
      const own = generateC02OpenSshMaterials(22384); directory = await writeC02OpenSshMaterials(parent, own);
      const value = await readC02OpenSshMaterials(directory);
      expect(value.manifest.fingerprint === own.manifest.fingerprint && value.password === own.password && value.passphrase === own.passphrase).toBe(true);
      expect(dirname(value.keyPath) === directory).toBe(true);
      await expect(writeC02OpenSshMaterials(parent, own)).rejects.toThrow();
      const extra = join(directory, '本例额外文本.txt'); await writeFile(extra, '仅为本地清理边界检查，不含密钥');
      await expect(removeC02OpenSshMaterials(directory, own.manifest.run)).rejects.toThrow('额外内容');
      expect((await readdir(directory)).length).toBe(6); await unlink(extra);
      await expect(removeC02OpenSshMaterials(directory, '0'.repeat(32))).rejects.toThrow('其它轮次');
      await removeC02OpenSshMaterials(directory, own.manifest.run); removed = true;
      let absent = false; try { await lstat(directory); } catch (error) { absent = (error as NodeJS.ErrnoException).code === 'ENOENT'; } expect(absent).toBe(true);
    } finally {
      // 不用递归删除掩盖未知内容；失败时保留精确目录供本任务修复和核对。
      if (removed || !directory) await rmdir(parent);
    }
  });
});
