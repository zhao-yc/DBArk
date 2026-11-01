import { build, type BuildOptions } from 'esbuild';
import { copyFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

/** 沿用原编译选项，向本例独占worker目录复制准确构建资源，不保留旧驱动测试旁路。 */
export async function buildSqliteWorker(options: BuildOptions): Promise<void> {
  if (!options.outfile) throw Error('SQLite测试worker缺少准确输出文件');
  await build(options);
  const source = resolve('src/engine/sqlite/sqlite-native'), target = join(dirname(options.outfile), 'sqlite-native');
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as { file: string };
  if (!/^dbark-sqlite-[a-f0-9]{64}\.(?:dll|dylib|so)$/.test(manifest.file)) throw Error('SQLite测试原生资源名称无效');
  mkdirSync(target, { recursive: true }); copyFileSync(join(source, manifest.file), join(target, manifest.file)); copyFileSync(join(source, 'manifest.json'), join(target, 'manifest.json'));
}
