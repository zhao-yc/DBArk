import { lstat, realpath } from 'node:fs/promises';
import { C02FixtureError, c02Failure } from './c02-mtls-policy';
import { c02SshAssertSeparatePaths, type C02SshConfig } from './c02-ssh-policy';

/** 首次建连前只查已有文件元数据；解析任意祖先别名后，用实际身份父目录检查临时目录边界。 */
export async function c02SshCanonicalPaths(config: Pick<C02SshConfig, 'keyPath' | 'tempParent'>): Promise<{ keyPath: string; tempParent: string }> {
  try {
    const key = await lstat(config.keyPath), parent = await lstat(config.tempParent);
    if (!key.isFile() || key.isSymbolicLink()) throw new C02FixtureError('C02 SSH 显式身份路径不是普通文件');
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new C02FixtureError('C02 SSH 显式临时父路径不是普通目录');
    const keyPath = await realpath(config.keyPath), tempParent = await realpath(config.tempParent);
    c02SshAssertSeparatePaths(keyPath, tempParent);
    // 解析前后必须仍是同一普通对象；不以realpath替代末级非链接与对象身份检查。
    const actualKey = await lstat(keyPath), actualParent = await lstat(tempParent);
    if (!actualKey.isFile() || actualKey.isSymbolicLink() || actualKey.ino !== key.ino || actualKey.dev !== key.dev || !actualParent.isDirectory() || actualParent.isSymbolicLink() || actualParent.ino !== parent.ino || actualParent.dev !== parent.dev) throw new C02FixtureError('C02 SSH 路径解析期间对象身份发生变化');
    return { keyPath, tempParent };
  } catch (error) {
    if (error instanceof C02FixtureError) throw error;
    throw c02Failure('C02 SSH 路径元数据核对失败', error);
  }
}
