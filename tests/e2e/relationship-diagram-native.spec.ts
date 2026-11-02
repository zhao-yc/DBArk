import { test, expect } from '@playwright/test';
import { relationshipDiagramZh as text } from '../../src/renderer/locales/relationshipDiagram.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_RELATIONSHIP_NATIVE === '1';
test.skip(!enabled, '默认关闭：关系图离线原生组件，仅独占合成结构');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
let server: Awaited<ReturnType<typeof import('vite')['createServer']>>, address: string;
test.beforeAll(async () => {
  if (!enabled) return;
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/i.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/i.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('关系图组件拒绝实库认证／用户配置；字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('关系图组件专项禁止自动trace');
  const { createServer } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
  const bound = server.httpServer!.address(); if (!bound || typeof bound === 'string') throw Error('未取得本例回环端口'); address = 'http://127.0.0.1:' + bound.port + '/tests/fixtures/relationship-diagram/index.html';
});
test.afterAll(async () => { await server?.close(); });

for (const theme of ['dark', 'light']) test('真实表菜单、完整关系图、复合键与本地显示：' + theme, async ({}, info) => {
  const { _electron } = await import('@playwright/test'), { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join, dirname, resolve, basename } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'dbark-relationship-native-'));
  const application = await _electron.launch({ args: ['tests/fixtures/relationship-diagram/electron.cjs'], env: { ...process.env, DBARK_RELATIONSHIP_FIXTURE_DATA: directory, DBARK_RELATIONSHIP_FIXTURE_URL: address + '?theme=' + theme }, chromiumSandbox: true });
  const processHandle = application.process(), pid = processHandle.pid, page = await application.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let closed = false, accepted = false;
  const exit = new Promise<number | null>(done => processHandle.once('exit', code => done(code)));
  function check() { if (closed || page.isClosed() || info.timeout !== 120000 || info.retry !== 0 || info.config.workers !== 1 || application.process() !== processHandle) throw Error('关系图原生组件归属或期限变化'); }
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); const result = await action(); check(); return result; }
  const evidence = () => step(() => page.evaluate(() => (window as unknown as Window & { __relationshipEvidence(): { calls: { command: string; input: Record<string, unknown> }[]; denied: string[]; tabs: unknown[]; dirty: Record<string, boolean>; jobs: Record<string, boolean> } }).__relationshipEvidence()));
  await info.attach('关系图原生owner', { body: JSON.stringify({ directory, pid, theme, platform: process.platform }), contentType: 'application/json' });
  try {
    const { navigationMenuItem } = await import('./navigation-menu');
    await step(() => expect(page.getByRole('grid')).toBeVisible({ timeout: 30000 }));
    const before = await evidence();
    await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.entry, exact: true }, check)).click());
    const modal = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(modal).toBeVisible());
    await step(() => expect(modal.locator('.relationship-diagram-node')).toHaveCount(3));
    expect((await evidence()).calls).toEqual(before.calls);
    await step(() => modal.getByRole('button', { name: text.catalog, exact: true }).click()); await step(() => expect(modal.getByRole('checkbox', { name: 'parent', exact: true })).toBeVisible());
    await step(() => expect(modal.getByRole('checkbox', { name: 'some_view', exact: true })).toHaveCount(0));
    await step(() => modal.getByRole('checkbox', { name: 'parent', exact: true }).check());
    const selected = await evidence(); expect(selected.calls.filter(call => call.command === 'metadata.table')).toHaveLength(1);
    await step(() => modal.getByRole('button', { name: text.read, exact: true }).click()); await step(() => expect(modal).toContainText('2 张已读表 · 1 个未读目标 · 3 个外键'));
    await step(() => expect(modal.locator('.relationship-diagram-node.external')).toHaveCount(1));
    await step(() => modal.getByRole('button', { name: 'diagram_db.child', exact: true }).click());
    const composite = modal.locator('details').filter({ hasText: 'fk_composite' });
    await step(() => composite.locator('summary').click()); await step(() => expect(composite.locator('li')).toHaveText(['tenant → tenant', 'parent_id → id']));
    const localBefore = await evidence(); await step(() => modal.getByRole('button', { name: text.zoomOut, exact: true }).click());
    await step(() => expect(modal.locator('.relationship-diagram-controls')).toContainText('75%')); await step(() => modal.getByRole('checkbox', { name: text.fields, exact: true }).uncheck());
    await step(() => expect(modal.locator('.relationship-diagram-column').filter({ hasText: '备注<script>' })).toHaveCount(0));
    await step(() => modal.getByRole('checkbox', { name: text.fields, exact: true }).check()); await step(() => modal.getByRole('button', { name: text.fit, exact: true }).click());
    expect((await evidence()).calls).toEqual(localBefore.calls); await step(() => expect(modal.locator('script')).toHaveCount(0));
    await info.attach('关系图真实组件-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    await step(() => modal.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => expect.poll(async () => (await evidence()).calls.filter(call => call.command === 'metadata.table').length).toBe(5));
    await step(() => modal.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(modal).toHaveCount(0));
    const after = await evidence(); expect(after.denied).toEqual([]); expect(after.tabs).toEqual(before.tabs); expect(after.dirty).toEqual(before.dirty); expect(Object.values(after.jobs).every(value => value === false)).toBe(true); expect(errors).toEqual([]);
    const ids = await step(() => application.evaluate(({ app }) => app.getAppMetrics().map(value => value.pid)));
    const closing = application.waitForEvent('close', { timeout: 12000 }); await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); await closing; closed = true; expect(await exit).toBe(0);
    await expect.poll(() => [...new Set([pid!, ...ids])].filter(id => { try { process.kill(id, 0); return true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ESRCH') return false; throw reason; } }), { timeout: 5000 }).toEqual([]);
    await info.attach('关系图原生原件', { body: JSON.stringify({ directory, pid, theme, platform: process.platform, before, after, originalExitCode: processHandle.exitCode, normalExit: true, clipboard: 0, realDatabase: false }), contentType: 'application/json' }); accepted = true;
  } finally {
    if (accepted && closed) { if (resolve(directory) !== directory || dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-relationship-native-')) throw Error('关系图成功清理路径越界'); await rm(directory, { recursive: true, force: false }); }
    else console.error('关系图组件未完成原正常退出，保留所属目录：' + directory);
  }
});
