import { test, expect, page, pageErrors } from './desktop-fixture';
import type { RowDataPacket } from 'mysql2/promise';

test.skip(process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_Q01_NAMED_WINDOW_UI !== '1', '默认关闭：需Root同时授权实库与Q01窗口名称正式UI');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 150000 });
type Caret = typeof import('./monaco-caret');
interface Probe { generation: number; expected?: { source: string; offset: number }; key: boolean; replies: Array<{ generation: number; status: string; reason?: string; names?: string[]; capability: boolean }>; }
type ProbeWindow = Window & { __q01NamedWindow?: Probe };

/** 只读观察同次真实按键后的Worker请求与结果；所有postMessage保持原样投递。 */
async function observe(caret: Caret) {
  await caret.observeMonacoCaret();
  await page.addInitScript(() => {
    const root = window as ProbeWindow, probe: Probe = { generation: 0, key: false, replies: [] }; root.__q01NamedWindow = probe;
    const pending = new WeakMap<Worker, Map<number, { generation: number; capability: boolean }>>(), original = Worker.prototype.postMessage;
    document.addEventListener('keydown', event => { if (probe.expected && event.isTrusted && !event.repeat && event.code === 'Space' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) probe.key = true; }, true);
    Worker.prototype.postMessage = function(this: Worker, value: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      let requests = pending.get(this); if (!requests) { requests = new Map(); pending.set(this, requests); this.addEventListener('message', event => {
        if (!event.data || typeof event.data !== 'object') return;
        const data = event.data as { id?: number; result?: { status?: string; reason?: string; windowNames?: string[] } }, request = data.id === undefined ? undefined : requests!.get(data.id);
        if (!request || request.generation !== probe.generation || typeof data.result?.status !== 'string') return;
        requests!.delete(data.id!); probe.replies.push({ ...request, status: data.result.status, reason: data.result.reason, names: Array.isArray(data.result.windowNames) ? data.result.windowNames.slice(0, 256) : undefined }); if (probe.replies.length > 32) probe.replies.shift();
      }); }
      const message = value as { id?: number; source?: string; offset?: number; capabilities?: { windowFunctions?: boolean } };
      if (probe.key && probe.expected && Number.isSafeInteger(message?.id) && message.source === probe.expected.source && message.offset === probe.expected.offset) { if (requests.size >= 32) requests.delete(requests.keys().next().value!); requests.set(message.id!, { generation: probe.generation, capability: message.capabilities?.windowFunctions === true }); }
      return Reflect.apply(original, this, options === undefined ? [value] : [value, options]);
    };
  });
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
}
/** 同正文/光标/世代的Worker事实才算本次响应，不能用空面板代替否定证据。 */
async function trigger(caret: Caret, marked: string, supported: boolean, names?: string[]) {
  await caret.positionMonacoCaret(marked);
  await page.evaluate(expected => { const probe = (window as ProbeWindow).__q01NamedWindow!; probe.generation++; probe.expected = expected; probe.key = false; probe.replies = []; }, { source: marked.replace('|', ''), offset: marked.indexOf('|') });
  await caret.triggerMonacoCompletion(marked);
  await expect.poll(() => page.evaluate(({ supported, names }) => { const probe = (window as ProbeWindow).__q01NamedWindow; return !!probe?.key && probe.replies.some(reply => reply.generation === probe.generation && reply.capability === supported && (names && supported ? reply.status === 'ready' && JSON.stringify(reply.names) === JSON.stringify(names) : reply.status === 'blocked' && ['syntax', 'capability'].includes(reply.reason ?? ''))); }, { supported, names }), { timeout: caret.remainingCompletionTimeout() }).toBe(true);
}
async function sql(caret: Caret, source: string) { await expect.poll(() => page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }), { timeout: caret.remainingCompletionTimeout(5000) }).toBe(source); }
async function records() { return page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })); }
/** 本正式准备仅针对Root六组合；未知组合不能被默认为通过或跳过。 */
async function supportedVersion(observer: { query<T extends RowDataPacket[]>(source: string): Promise<[T, unknown]> }) {
  const [rows] = await observer.query<RowDataPacket[]>('SELECT VERSION() AS server_version'), value = String(rows[0].server_version);
  if (/^5\.7\.\d+/.test(value)) return false;
  const mysql = /^8\.(0|4)\.(\d+)(?:-(?:log|commercial|debug))?$/.exec(value);
  if (mysql && (mysql[1] === '4' || Number(mysql[2]) >= 2)) return true;
  if (/^(?:5\.5\.5-)?(?:10\.11|11\.4)\.\d+-MariaDB/.test(value)) return true;
  throw Error('当前版本不在本切片六组合正式准备范围');
}

test('窗口名称完整插入和撤销零自动执行，MySQL5.7明确能力阻断', async ({}, info) => {
  const caret = await import('./monaco-caret'); await observe(caret); const live = await import('./live-helpers');
  await live.isolatedDatabase(async ({ database, observer }) => {
    const supported = await supportedVersion(observer); await live.openDatabaseQuery(database);
    const marked = 'WITH q AS(SELECT 1 AS id) SELECT ROW_NUMBER() OVER rece|suffix FROM q WINDOW recent AS(PARTITION BY id ORDER BY id)', before = await records();
    await trigger(caret, marked, supported, ['recent']);
    if (supported) { const widget = page.locator('.suggest-widget.visible'); await expect(widget.locator('.monaco-list-row.focused')).toContainText('recent', { timeout: caret.remainingCompletionTimeout() }); await page.keyboard.press('Enter'); await sql(caret, 'WITH q AS(SELECT 1 AS id) SELECT ROW_NUMBER() OVER `recent` FROM q WINDOW recent AS(PARTITION BY id ORDER BY id)'); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z'); }
    else await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0, { timeout: caret.remainingCompletionTimeout(5000) });
    await sql(caret, marked.replace('|', '')); expect(await records()).toEqual(before); expect(pageErrors).toEqual([]);
  }, info);
});
test('内层与UNION不借父或兄弟窗口，重复循环和不完整定义真实阻断', async ({}, info) => {
  const caret = await import('./monaco-caret'); await observe(caret); const live = await import('./live-helpers');
  await live.isolatedDatabase(async ({ database, observer }) => {
    const supported = await supportedVersion(observer); await live.openDatabaseQuery(database);
    for (const marked of [
      'SELECT (SELECT ROW_NUMBER() OVER ou|suffix) WINDOW outer_win AS()',
      'SELECT 1 WINDOW left_win AS() UNION ALL SELECT ROW_NUMBER() OVER le|suffix',
      'SELECT ROW_NUMBER() OVER w|suffix WINDOW win AS(),WIN AS()',
      'SELECT ROW_NUMBER() OVER w|suffix WINDOW win AS(next),next AS(win)',
      'SELECT ROW_NUMBER() OVER w|suffix WINDOW win AS(),',
    ]) { const before = await records(); await trigger(caret, marked, supported); await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0, { timeout: caret.remainingCompletionTimeout(5000) }); await sql(caret, marked.replace('|', '')); expect(await records()).toEqual(before); }
    expect(pageErrors).toEqual([]);
  }, info);
});
