import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 各入口直接运行同一个编译器；显式堆预算仅属于tsc，不读取环境或附加调用者参数。 */
export function typecheckArguments(project) {
  return ['--max-old-space-size=4096', resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'];
}

/** 标准命令固定本项目、一次执行并继承原输出；未知退出或启动错误不能当作通过。 */
export function runTypecheck(argv = [], execute = spawnSync) {
  try {
    if (argv.length) throw Error('类型检查入口不接受额外参数；请使用 pnpm typecheck。');
    const result = execute(process.execPath, typecheckArguments(projectRoot), { cwd: projectRoot, stdio: 'inherit', shell: false, windowsHide: true });
    if (result.error || result.status !== 0) {
      console.error(result.error ? '类型检查启动失败：' + result.error.message : '类型检查未成功退出，原退出码：' + result.status);
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTypecheck(process.argv.slice(2));
}
