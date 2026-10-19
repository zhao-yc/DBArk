import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = '用法：pnpm check:local -- [--build] tests/unit/文件.test.ts [其它明确文件]\n默认只做一次类型检查和指定单元测试；--build 追加普通构建，不启动客户端。';

/** 只接受实际存在的单元测试文件，防止漏参数变成全量或实库验收。 */
export function parseLocalCheckArguments(argv, project = projectRoot) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 1 && args[0] === '--help') return { help: true };
  let build = false;
  const files = [];
  for (const arg of args) {
    if (arg === '--build' && !build) {
      build = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`不支持的参数：${arg}。${usage}`);
    } else {
      files.push(arg);
    }
  }
  if (!files.length) throw new Error(`必须明确指定至少一个单元测试文件。${usage}`);
  const unitRoot = realpathSync(resolve(project, 'tests/unit'));
  const tests = files.map(file => {
    if (!/\.test\.tsx?$/.test(file) || /[*?\[\]{}]/.test(file)) {
      throw new Error(`请指定 tests/unit/ 中的完整 .test.ts 或 .test.tsx 文件：${file}`);
    }
    let actual;
    try {
      actual = realpathSync(resolve(project, file));
      if (!statSync(actual).isFile()) throw new Error('不是文件');
    } catch {
      throw new Error(`单元测试文件不存在或不可读：${file}`);
    }
    const withinUnit = relative(unitRoot, actual);
    if (isAbsolute(withinUnit) || withinUnit === '..' || withinUnit.startsWith(`..${sep}`)) {
      throw new Error(`只允许 tests/unit/ 内的文件：${file}`);
    }
    return relative(project, actual).split(sep).join('/');
  });
  return { build, tests: [...new Set(tests)] };
}

/** 顺序复用现有工具；失败即停止，普通构建不再次执行 tsc。 */
export function runLocalCheck(argv, project = projectRoot) {
  const started = performance.now();
  try {
    const options = parseLocalCheckArguments(argv, project);
    if (options.help) {
      console.log(usage);
      return 0;
    }
    const stages = [
      { name: '类型检查', file: 'node_modules/typescript/bin/tsc', args: ['--noEmit'] },
      { name: '指定单元测试', file: 'node_modules/vitest/vitest.mjs', args: ['run', ...options.tests] },
      ...(options.build ? [{ name: '普通构建', file: 'scripts/build.mjs', args: [] }] : [])
    ];
    for (const stage of stages) {
      try {
        if (!statSync(resolve(project, stage.file)).isFile()) throw new Error('不是文件');
      } catch {
        throw new Error(`缺少本克隆的 ${stage.file}；先执行 pnpm install --frozen-lockfile。`);
      }
    }
    console.log(`本地检查：${options.tests.length} 个明确文件；构建${options.build ? '开启' : '关闭'}。`);
    for (const [index, stage] of stages.entries()) {
      console.log(`[${index + 1}/${stages.length}] ${stage.name}`);
      const stageStarted = performance.now();
      const result = spawnSync(process.execPath, [resolve(project, stage.file), ...stage.args], {
        cwd: project, stdio: 'inherit', shell: false, windowsHide: true
      });
      const seconds = ((performance.now() - stageStarted) / 1000).toFixed(2);
      if (result.error || result.status !== 0) {
        console.error(`${stage.name}失败，耗时 ${seconds} 秒；后续阶段未执行。`);
        if (result.error) console.error(`启动失败：${result.error.message}`);
        return result.status && result.status > 0 ? result.status : 1;
      }
      console.log(`${stage.name}通过，耗时 ${seconds} 秒。`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    console.log(`本地入口总耗时：${((performance.now() - started) / 1000).toFixed(2)} 秒。`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runLocalCheck(process.argv.slice(2));
}
