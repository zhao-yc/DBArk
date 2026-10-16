import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { test, expect, page, dataDir, pageErrors, launchDesktop, quitDesktop } from './desktop-fixture';
import type { TablePreferenceTarget, TablePreferences } from '../../src/shared/tablePreferences';

/** 从模块依赖定位 WASM，公开归档可在独立工作目录执行同一测试。 */
const sqlWasmFile = createRequire(__filename).resolve('sql.js/dist/sql-wasm.wasm');

const preferences: TablePreferences = { version: 1, columns: [{ name: 'constructor', hidden: true, width: 64 }, { name: '__proto__', hidden: false, width: 320 }, { name: '主键', hidden: true, width: 2000 }] };
/** 创建不可连接的本地配置；布局 IPC 不得尝试查询这个端口或生成 SQL 任务。 */
async function offlineConnection() {
  return page.evaluate(() => window.dbark.invoke('connections.save', { id: '', name: '离线表偏好', group: '验收', color: '#40bb99', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false }));
}
/** 所有保存和读取经过真实 preload、主进程校验和 SQLite，不替换 IPC。 */
async function save(target: TablePreferenceTarget, value = preferences) { return page.evaluate(input => window.dbark.invoke('table.preferences.save', input), { ...target, preferences: value }); }
async function get(target: TablePreferenceTarget) { return page.evaluate(input => window.dbark.invoke('table.preferences.get', input), target); }
/** 本地配置操作没有 SQL 历史或任务；这里只验证离线持久化，不假称已测试真实表格。 */
async function expectOfflineOnly() {
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
}

test('离线 IPC 跨重启保持顺序显隐宽度和原型列名，目标隔离且设置快照不覆盖', async () => {
  const first = await offlineConnection(), second = await offlineConnection();
  const target = { connectionId: first.id, database: '库.一', table: 'Case' };
  const other = { ...target, connectionId: second.id };
  expect(await get(target)).toBeNull(); await save(target); await save(other, { version: 1, columns: [{ name: '另一列', hidden: false, width: 99 }] });
  await save({ ...target, table: 'case' }, { version: 1, columns: [] });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await quitDesktop(); await launchDesktop();
  expect(await get(target)).toEqual(preferences); expect((await get(other))?.columns[0].name).toBe('另一列'); expect(await get({ ...target, table: 'case' })).toEqual({ version: 1, columns: [] });
  const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); expect(settings.theme).toBe('light'); expect(settings).not.toHaveProperty('tablePreferences');
  await page.evaluate(input => window.dbark.invoke('table.preferences.reset', input), target);
  expect(await get(target)).toBeNull(); expect(await get(other)).not.toBeNull(); await expectOfflineOnly();
});

test('非法偏好跨 IPC 被拒绝且不落盘，认证外观保留而改目标和删除连接清理', async () => {
  const connection = await offlineConnection(), target = { connectionId: connection.id, database: '库', table: '表' };
  await save(target);
  const rejected = await page.evaluate(async ({ target, preferences }) => {
    const failures: string[] = [];
    for (const input of [
      { ...target, preferences, filters: [{ value: '不应落盘的筛选秘密' }] },
      { ...target, preferences: { version: 1, columns: [{ name: '值', hidden: false, value: '不应落盘的单元格秘密' }] } },
      { ...target, preferences: { version: 1, columns: [{ name: '值', hidden: false, width: 63 }] } },
    ]) { try { await window.dbark.invoke('table.preferences.save', input as never); failures.push('未拒绝'); } catch (error) { failures.push((error as Error).message); } }
    return failures;
  }, { target, preferences });
  expect(rejected).toHaveLength(3); expect(rejected.every(message => message.includes('参数无效'))).toBe(true); expect(await get(target)).toEqual(preferences);
  const bytes = await readFile(join(dataDir, 'dbark.sqlite')); for (const forbidden of ['不应落盘的筛选秘密', '不应落盘的单元格秘密']) expect(bytes.includes(Buffer.from(forbidden))).toBe(false);
  const renamed = await page.evaluate(input => window.dbark.invoke('connections.save', { ...input, name: '已重命名', password: '仅会话轮换密码', rememberPassword: false }), connection); expect(await get(target)).toEqual(preferences);
  await page.evaluate(input => window.dbark.invoke('connections.save', { ...input, host: 'localhost' }), renamed); expect(await get(target)).toBeNull();
  await save(target); await page.evaluate(id => window.dbark.invoke('connections.delete', { id }), connection.id);
  await expect(get(target)).rejects.toThrow('连接不存在'); await expect(save(target)).rejects.toThrow('连接不存在');
  await expectOfflineOnly();
});

test('真实写盘失败不会丢失布局，修复后保存设置及重启不偷偷提交失败改动', async () => {
  const connection = await offlineConnection(), target = { connectionId: connection.id, database: '库', table: '表' }; await save(target);
  const blocker = join(dataDir, 'dbark.sqlite.tmp'); await mkdir(blocker);
  try {
    await expect(save(target, { version: 1, columns: [] })).rejects.toThrow('修改未保存');
    await expect(page.evaluate(input => window.dbark.invoke('table.preferences.reset', input), target)).rejects.toThrow('修改未保存');
    await expect(page.evaluate(input => window.dbark.invoke('connections.save', { ...input, host: '另一目标' }), connection)).rejects.toThrow('修改未保存');
    expect(await get(target)).toEqual(preferences);
  } finally { await rmdir(blocker); }
  await page.getByRole('button', { name: '切换主题', exact: true }).click(); await quitDesktop(); await launchDesktop();
  expect(await get(target)).toEqual(preferences);
  expect((await page.evaluate(() => window.dbark.invoke('connections.list', {})))[0].host).toBe(connection.host); await expectOfflineOnly();
});

test('真实 schema2 配置启动迁移至 schema6，既有查询片段设置原样保留并创建空回执表', async () => {
  const connection = await offlineConnection();
  await page.evaluate(async id => {
    await window.dbark.invoke('queries.save', { id: '旧查询', name: '旧查询', connectionId: id, sql: 'SELECT 7', updatedAt: '' });
    await window.dbark.invoke('snippets.save', { id: '旧片段', name: '旧片段', group: '分组', description: '说明', sql: 'SELECT 8', updatedAt: '' });
  }, connection.id);
  await page.getByRole('button', { name: '切换主题', exact: true }).click(); await quitDesktop();
  const file = join(dataDir, 'dbark.sqlite'), SQL = await initSqlJs({ locateFile: () => sqlWasmFile });
  // 仅降级本例临时库：移除两张后续新增表，确保启动真正执行创建迁移。
  const old = new SQL.Database(await readFile(file)); old.run('DROP TABLE table_preferences; DROP TABLE table_apply_receipts; PRAGMA user_version=2');
  expect(old.exec('PRAGMA user_version')[0].values[0][0]).toBe(2);
  expect(old.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('table_preferences','table_apply_receipts')")).toEqual([]);
  const before = old.exec('SELECT * FROM connections; SELECT * FROM queries; SELECT * FROM sql_snippets; SELECT * FROM settings'); await writeFile(file, old.export()); old.close();
  await launchDesktop();
  const migrated = new SQL.Database(await readFile(file));
  expect(migrated.exec('PRAGMA user_version')[0].values[0][0]).toBe(6);
  expect(migrated.exec('SELECT * FROM connections; SELECT * FROM queries; SELECT * FROM sql_snippets; SELECT * FROM settings')).toEqual(before);
  // 校验列名、类型、非空和主键约束，不能仅靠版本号声称迁移成功。
  expect(migrated.exec('PRAGMA table_info(table_apply_receipts)')[0].values).toEqual([
    [0, 'id', 'TEXT', 0, null, 1], [1, 'data', 'TEXT', 1, null, 0], [2, 'started_at', 'TEXT', 1, null, 0],
  ]);
  expect(migrated.exec('SELECT id, data, started_at FROM table_apply_receipts')).toEqual([]); migrated.close();
  expect(await get({ connectionId: connection.id, database: '库', table: '表' })).toBeNull(); await expectOfflineOnly();
});
