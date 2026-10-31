import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = Object.freeze({ workspace: ['sqlite-workspace-native.spec.ts', 'sqlite-workspace', 'DBARK_SQLITE_WORKSPACE_NATIVE_TEST'], table: ['sqlite-table-browse-native.spec.ts', 'sqlite-table-browse', 'DBARK_SQLITE_TABLE_BROWSE_NATIVE_TEST'], export: ['sqlite-table-export-native.spec.ts', 'sqlite-table-export', 'DBARK_SQLITE_TABLE_EXPORT_NATIVE_TEST'], edit: ['sqlite-table-edit-native.spec.ts', 'sqlite-table-edit', 'DBARK_SQLITE_TABLE_EDIT_NATIVE_TEST'], 'schema-export': ['sqlite-schema-export-native.spec.ts', 'sqlite-schema-export', 'DBARK_SQLITE_SCHEMA_EXPORT_NATIVE_TEST'] });

/** 离线子进程不继承runner预装数据库/SSH认证，也不继承用户数据路径、可执行文件或模块注入。 */
export function sqliteOfflineEnvironment(parent, kind) {
  if (!Object.hasOwn(cases, kind)) throw Error('SQLite源码专项类型无效');
  const dropped = [], env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(?:DBARK_|MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$|PLAYWRIGHT_)/i.test(key)) { dropped.push(key); continue; }
    if (value !== undefined) env[key] = value;
  }
  env.DBARK_INTEGRATION_ENABLED = '0';
  env[cases[kind][2]] = '1';
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(root, 'test-results', cases[kind][1], 'report.json');
  return { env, dropped: dropped.sort() };
}

/** 命令、spec及输出均为固定项目路径，不接受额外参数、可执行文件、目标数据库或超时覆盖。 */
export function sqliteOfflineCommand(kind) {
  if (!Object.hasOwn(cases, kind)) throw Error('SQLite源码专项类型无效');
  return [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'tests/e2e/' + cases[kind][0], '--workers=1', '--retries=0', '--trace=off', '--reporter=list,json', '--output=test-results/' + cases[kind][1]];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !Object.hasOwn(cases, args[0])) throw Error('用法：node scripts/sqlite-workspace-ci.mjs workspace|table|export|edit|schema-export');
  const { env, dropped } = sqliteOfflineEnvironment(process.env, args[0]);
  // 只记录字段名；runner认证值、路径值和口令从不输出。
  console.log('SQLite离线源码子进程已移除环境字段：' + (dropped.join('、') || '无'));
  const result = spawnSync(process.execPath, sqliteOfflineCommand(args[0]), { cwd: root, env, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.signal || !Number.isInteger(result.status)) throw Error('SQLite源码专项未取得正常命令终态，保留原现场');
  process.exitCode = result.status;
}
