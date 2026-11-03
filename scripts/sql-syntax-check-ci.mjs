import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 离线语法检查窗口不继承数据库认证、用户配置、模块注入及其它测试开关。 */
export function sqlSyntaxCheckEnvironment(parent) {
  const env = {}, dropped = [];
  for (const [key, value] of Object.entries(parent)) {
    if (/^(?:DBARK_|MYSQL_|MARIADB_|POSTGRES_|PG|DB_|DATABASE_|SSH_|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PLAYWRIGHT_)/i.test(key)) { dropped.push(key); continue; }
    if (value !== undefined) env[key] = value;
  }
  env.DBARK_SQL_SYNTAX_NATIVE = '1'; env.DBARK_INTEGRATION_ENABLED = '0'; env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(root, 'test-results', 'sql-syntax-check', 'report.json');
  return { env, dropped: dropped.sort() };
}
/** 固定原整例、单worker、零重试、trace关闭；不接受目标、路径或期限覆盖参数。 */
export function sqlSyntaxCheckCommand() {
  return [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'tests/e2e/sql-syntax-check-native.spec.ts', '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/sql-syntax-check'];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('用法：node scripts/sql-syntax-check-ci.mjs（不接受额外参数）');
  const { env, dropped } = sqlSyntaxCheckEnvironment(process.env); console.log('语法检查离线窗口已移除环境字段：' + (dropped.join('、') || '无'));
  const result = spawnSync(process.execPath, sqlSyntaxCheckCommand(), { cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status)) throw Error('语法检查窗口未取得原命令终态，保留现场');
  process.exitCode = result.status;
}
