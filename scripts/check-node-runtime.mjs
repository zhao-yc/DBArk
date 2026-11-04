import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

/** 主版本相同不代表原生API齐全；SQLite预算与授权器不能在旧Node上降级跳过。 */
export function assertDevelopmentNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) !== 24 || Number(match[2]) < 17) {
    throw Error(`当前 Node.js ${version} 不满足开发要求，请使用 24.17.0 或更高的 24.x。SQLite 原生读取预算需要 DatabaseSync.limits；项目 .nvmrc 提供固定版本。`);
  }
}

/** 只打开并关闭内存库，在编译与收集测试前核对真实API，避免成百套件连锁失败。 */
export function assertNodeSqliteRuntime() {
  assertDevelopmentNodeVersion();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    if (typeof db.setAuthorizer !== 'function' || typeof db.enableDefensive !== 'function' || typeof db.isTransaction !== 'boolean'
      || !db.limits || !['length', 'sqlLength', 'column', 'variableNumber'].every(key => Number.isSafeInteger(db.limits[key]) && db.limits[key] > 0)) {
      throw Error('当前 Node.js 缺少 SQLite 原生授权器、防御模式、事务状态或读取预算 API；请使用官方 Node.js 24.17.0 或更高的 24.x。');
    }
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertNodeSqliteRuntime(); console.log('Node.js 与 SQLite 原生运行时检查通过。'); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
