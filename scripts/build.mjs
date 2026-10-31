import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir } from 'node:fs/promises';
import {copyCompletionLicenses} from './completion-licenses.mjs';

/** 主进程、沙箱 preload 与数据库进程分别打包，原生及运行时依赖由包管理器提供。 */
export async function buildMain() {
  await mkdir('dist/main', { recursive: true });
  await build({ entryPoints: { index: 'src/main/index.ts', worker: 'src/main/worker.ts',savedQuerySearchWorker:'src/main/savedQuerySearchWorker.ts',sqliteWorker:'src/engine/sqlite/worker.ts' }, outdir: 'dist/main', bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, packages: 'external', sourcemap: true, target: 'node22' });
  await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
}
if (process.argv[1]?.endsWith('build.mjs')) { await buildMain(); await viteBuild(); await copyCompletionLicenses(); }
