import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import type { OfflineCompletionDiagnostic } from './monaco-caret-diagnostics';
import { isDeepStrictEqual } from 'node:util';

// --list先短路：只读取两道进程布尔门，不加载desktop/live、私网配置或原生输入帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_Q01_CALL_ROUTINES_UI === '1';
const test = (active ? (require('./desktop-fixture') as typeof import('./desktop-fixture')).test : baseTest) as typeof baseTest;
test.skip(!active, '默认关闭：须Root另行确定200实例、窗口及本轮系统剪贴板读取范围');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 150000, retries: 0 });

type Desktop = typeof import('./desktop-fixture');
type Caret = typeof import('./monaco-caret');
type LiveContext = import('./live-helpers').LiveContext;
let pending: { testId: string; desktop: Desktop; context: OfflineCompletionDiagnostic } | undefined;

/** 原失败先交回runner，afterEach才使用已完成duration及既有500ms预算；不重放输入。 */
test.afterEach(async ({}, info) => {
  const failure = pending; pending = undefined;
  if (!failure || failure.testId !== info.testId) return;
  try {
    const diagnostic = await import('./monaco-caret-diagnostics');
    await diagnostic.attachMonacoCaretDiagnostic(failure.desktop.page, info, failure.context);
  } catch { /* 诊断失败不能覆盖原准备/补全断言；已关闭页面必须保留unknown。 */ }
});

/** 仅读取本例标记行及产品任务/历史，独立于编辑器显示和建议内容。 */
async function snapshot(desktop: Desktop, context: LiveContext) {
  const records = await desktop.page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
  const [rows] = await context.observer.query<RowDataPacket[]>({ sql: 'SELECT id,hits FROM `' + context.database + '`.q01_call_marker ORDER BY id LIMIT 2', timeout: 15000 });
  return { ...records, marker: rows.map(row => ({ id: row.id, hits: row.hits })) };
}

/** 沿用原补全余量，全文必须等于独立给出的期望，不以模型内容推导期望。 */
async function savedSql(desktop: Desktop, caret: Caret, source: string) {
  await expect.poll(() => desktop.page.evaluate(async expected => {
    const settings = await window.dbark.invoke('settings.get', {});
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n') === expected;
  }, source), { timeout: caret.remainingCompletionTimeout(5000), message: 'CALL补全后的完整正文必须与独立期望一致' }).toBe(true);
}

/** 完整快照只在RAM严格深比较；匹配器只见布尔，不序列化意外执行产生的任务/历史SQL。 */
function assertSnapshotUnchanged(actual: Awaited<ReturnType<typeof snapshot>>, before: Awaited<ReturnType<typeof snapshot>>) {
  expect(isDeepStrictEqual(actual, before), 'CALL补全不得改变标记行、任务或历史').toBe(true);
}

/** 两例共享真实UI步骤；旁观连接仅准备本例对象与读标记，不执行CALL或伪造目录。 */
async function verifyCall(info: TestInfo, qualified: boolean) {
  // CommonJS动态命名空间会缓存旧page；每例使用已注册fixture的live导出对象。
  const desktop = require('./desktop-fixture') as Desktop, caret = await import('./monaco-caret'), live = await import('./live-helpers');
  const { assertDefaultEncodingLiveTarget } = await import('../helpers/tableDefaultEncodingTarget');
  // 复用已有六组合纯准备门：13484必须严格TLS，实际目标与凭据由Root本轮明确提供。
  const env = live.environment;
  const target = { host: env.DBARK_TEST_HOST, port: env.DBARK_TEST_PORT, tlsFlag: env.DBARK_TEST_TLS, caPath: env.DBARK_TEST_CA };
  assertDefaultEncodingLiveTarget(target);
  await caret.observeMonacoCaret();
  await live.isolatedDatabase(async context => {
    const db = '`' + context.database + '`';
    const name = qualified ? 'q01.re$build`quoted' : 'q01_rebuild_current';
    const quotedName = qualified ? '`q01.re$build``quoted`' : '`q01_rebuild_current`';
    await context.observer.query({ sql: 'CREATE TABLE ' + db + '.q01_call_marker(id INT PRIMARY KEY,hits INT NOT NULL) ENGINE=InnoDB', timeout: 15000 });
    await context.observer.query({ sql: 'INSERT INTO ' + db + '.q01_call_marker(id,hits) VALUES(1,0)', timeout: 15000 });
    const parameters = qualified ? 'IN marker_id INT,IN delta_value INT' : '';
    const update = qualified ? 'hits=hits+delta_value WHERE id=marker_id' : 'hits=hits+1 WHERE id=1';
    await context.observer.query({ sql: 'CREATE PROCEDURE ' + db + '.' + quotedName + '(' + parameters + ') SQL SECURITY INVOKER UPDATE ' + db + '.q01_call_marker SET ' + update, timeout: 15000 });
    await live.openDatabaseQuery(context.database);
    // 再核产品保存的连接目标，不能将观察连接正确冒充实际UI连接正确。
    const profile = await desktop.page.evaluate(async id => (await window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))).find(item => item.id === id), context.connectionId);
    expect(profile).toBeDefined(); if (!profile) throw Error('缺少本例连接'); assertDefaultEncodingLiveTarget(target, profile);
    const marked = qualified ? 'CALL ' + db + '.`q01.re|suffix`(1, 7)' : 'CALL q01_re|suffix';
    const expected = qualified ? 'CALL ' + db + '.`q01.re$build``quoted`(1, 7)' : 'CALL `q01_rebuild_current`';
    const before = await snapshot(desktop, context); expect(before.marker).toEqual([{ id: 1, hits: 0 }]);
    let phase: OfflineCompletionDiagnostic['phase'] = 'prepare';
    try {
      await caret.positionMonacoCaret(marked, { redactSqlAssertion: true }); phase = 'completion';
      await caret.triggerMonacoCompletion(marked);
      const widget = desktop.page.locator('.suggest-widget.visible');
      await expect(widget.locator('.monaco-list-row.focused')).toContainText(name, { timeout: caret.remainingCompletionTimeout() });
      await desktop.page.keyboard.press('Enter');
      await expect(widget).toHaveCount(0, { timeout: caret.remainingCompletionTimeout() });
      await savedSql(desktop, caret, expected);
      assertSnapshotUnchanged(await snapshot(desktop, context), before);
      await desktop.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await savedSql(desktop, caret, marked.replace('|', ''));
      assertSnapshotUnchanged(await snapshot(desktop, context), before); expect(desktop.pageErrors).toEqual([]);
    } catch (reason) {
      pending = { testId: info.testId, desktop, context: { cold: 0, phase, marked, pageErrorCount: desktop.pageErrors.length } }; throw reason;
    }
  }, info, { captureFailureScreenshot: false });
}

test('CALL当前库过程：完整suffix替换、真实接受撤销且标记行与任务历史不变', async ({}, info) => {
  await verifyCall(info, false);
});

test('CALL显式限定库及引用过程名：保留已有参数、真实接受撤销且零过程执行', async ({}, info) => {
  await verifyCall(info, true);
});
