import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 离线原生子进程只保留运行环境，不继承数据库、SSH、模块注入或旧Playwright开关。 */
export function relationshipDiagramOfflineEnvironment(parent) {
  const env = {}, dropped = [];
  for (const [key, value] of Object.entries(parent)) {
    if (/^(?:DBARK_|MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PLAYWRIGHT_)/i.test(key)) { dropped.push(key); continue; }
    if (value !== undefined) env[key] = value;
  }
  env.DBARK_RELATIONSHIP_NATIVE = '1'; env.DBARK_INTEGRATION_ENABLED = '0';
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(root, 'test-results', 'relationship-diagram', 'report.json');
  return { env, dropped: dropped.sort() };
}
/** 固定两例原生组件与原门槛，不接收文件、认证、执行路径或超时覆盖参数。 */
export function relationshipDiagramOfflineCommand() {
  return [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'tests/e2e/relationship-diagram-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/relationship-diagram'];
}
/** 只执行一次并等原进程终态，失败或未知不重试、不杀窗口。 */
export function runRelationshipDiagramOffline(argv = [], execute = spawnSync, parent = process.env) {
  if (argv.length) throw Error('关系图专项不接受参数。');
  const { env, dropped } = relationshipDiagramOfflineEnvironment(parent);
  console.log('关系图离线子进程移除环境字段：' + (dropped.join('、') || '无'));
  const result = execute(process.execPath, relationshipDiagramOfflineCommand(), { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status)) throw Error('关系图专项未取得原进程终态，保留现场，不自动重启。');
  return result.status;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runRelationshipDiagramOffline(process.argv.slice(2));
