import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 原生组件仅继承运行时必要环境；CI继承的NODE_PATH及原数据库认证值不能进入Electron子进程。 */
export function foreignKeyJoinOfflineEnvironment(parent) {
  const env = {}, dropped = [];
  for (const [key, value] of Object.entries(parent)) {
    if (/^(?:DBARK_|MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PLAYWRIGHT_)/i.test(key)) { dropped.push(key); continue; }
    if (value !== undefined) env[key] = value;
  }
  env.DBARK_JOIN_ORDER_NATIVE = '1';
  env.DBARK_INTEGRATION_ENABLED = '0';
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(root, 'test-results', 'foreign-key-join', 'report.json');
  return { env, dropped: dropped.sort() };
}

/** 固定原spec、输出与原生门槛，不接受其它文件、目标库、执行路径或超时覆盖。 */
export function foreignKeyJoinOfflineCommand() {
  return [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'tests/e2e/table-foreign-key-join-order-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/foreign-key-join'];
}

/** 只运行一次并等待原子进程终态；失败原件交给原spec及CI附件保留，不重试或强停窗口。 */
export function runForeignKeyJoinOffline(argv = [], execute = spawnSync, parent = process.env) {
  if (argv.length) throw Error('JOIN源码专项不接受参数；请运行 node scripts/foreign-key-join-ci.mjs。');
  const { env, dropped } = foreignKeyJoinOfflineEnvironment(parent);
  console.log('JOIN离线组件子进程已移除环境字段：' + (dropped.join('、') || '无'));
  const result = execute(process.execPath, foreignKeyJoinOfflineCommand(), { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status)) throw Error('JOIN源码专项未取得原命令终态，保留现场，不自动重启。');
  return result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runForeignKeyJoinOffline(process.argv.slice(2));
