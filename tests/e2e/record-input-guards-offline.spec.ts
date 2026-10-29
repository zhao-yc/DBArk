import { test, expect, _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type {} from '../fixtures/record-input-guards/main';

// 原生剪贴板需要统筹协调桌面使用权；默认跳过早于Electron启动。
test.skip(process.env.DBARK_RECORD_INPUT_NATIVE_ENABLED !== '1', '需要统筹明确分配原生GUI及系统剪贴板使用权');
test.use({ trace: 'off' });
type SavedClipboard = typeof globalThis & { __recordInputClipboard?: Electron.ClipboardItem[]; __recordInputOriginalText?: string; __recordInputRawItemCount?: number };
let server: ViteDevServer, app: ElectronApplication, page: Page, directory: string, url: string, clipboardSaved = false;
const errors: string[] = [];
const panel = () => page.getByRole('complementary', { name: '记录表单', exact: true });
const stage = () => panel().getByRole('button', { name: '暂存本行', exact: true });
const budget = (route: 'document' | 'node') => route === 'document' ? 2097152 : 262144;
const audit = () => page.evaluate(() => window.__recordInputGuardAudit);

test.beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], cacheDir: resolve('.cache/record-input-guards-vite'), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('未取得组件验收端口'); url = `http://127.0.0.1:${address.port}/tests/fixtures/record-input-guards/index.html`;
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async () => {
  errors.length = 0; clipboardSaved = false; directory = await mkdtemp(join(tmpdir(), 'dbark-record-input-guards-'));
  const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_RECORD_INPUT_FIXTURE_DATA: directory, DBARK_RECORD_INPUT_FIXTURE_URL: url }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['tests/fixtures/record-input-guards/electron.cjs'], env, chromiumSandbox: true }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: '打开夹具记录', exact: true })).toBeVisible({ timeout: 30000 });
  // 覆盖前完整读取每种格式，原内容只保存在本次独立主进程内存，不写报告或轨迹。
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const original = await clipboard.read(), readable = original.filter(item => item.types.length > 0), saved = await Promise.all(readable.map(async item => Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))));
    const root = globalThis as SavedClipboard; root.__recordInputClipboard = saved.filter(item => Object.keys(item).length).map(item => new ClipboardItem(item)); root.__recordInputOriginalText = await clipboard.readText(); root.__recordInputRawItemCount = original.length;
  }); clipboardSaved = true;
});
test.afterEach(async ({}, info) => {
  let restored = false; let diagnostic: Record<string, boolean | number> = { snapshotSaved: false };
  try {
    if (page) await info.attach('合成输入事件', { body: JSON.stringify((await audit()).events), contentType: 'application/json' });
    if (clipboardSaved) {
      const result = await app.evaluate(async ({ clipboard }) => {
        const root = globalThis as SavedClipboard, saved = root.__recordInputClipboard!, capturedRawItems = root.__recordInputRawItemCount!;
        if (!Number.isSafeInteger(capturedRawItems) || capturedRawItems < saved.length) throw Error('原剪贴板快照计数缺失');
        if (saved.length) await clipboard.write(saved); else clipboard.clear();
        // 两端仅忽略无可读类型空壳；有类型零字节、多item及全部格式仍逐一核对。
        const raw = await clipboard.read(), actual = raw.filter(item => item.types.length > 0);
        let missingTypes = 0, additionalTypes = 0, payloadMismatches = 0, typeSetsMatch = true;
        for (let index = 0; index < Math.max(saved.length, actual.length); index++) {
          const before = saved[index], after = actual[index];
          if (!before || !after || before.types.length !== after.types.length) typeSetsMatch = false;
          for (const type of before?.types ?? []) if (!after?.types.includes(type)) missingTypes++;
          for (const type of after?.types ?? []) if (!before?.types.includes(type)) additionalTypes++;
          if (!before || !after) continue;
          for (const type of before.types) {
            if (!after.types.includes(type)) continue;
            const a = await before.getType(type), b = await after.getType(type);
            const same = 'arrayBuffer' in a && 'arrayBuffer' in b ? Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer())) : JSON.stringify(a) === JSON.stringify(b);
            if (!same) payloadMismatches++;
          }
        }
        const textMatches = await clipboard.readText() === root.__recordInputOriginalText, itemCountMatches = actual.length === saved.length;
        const diagnostic = { snapshotSaved: true, capturedRawItems, capturedReadableItems: saved.length, capturedEmptyTypeItems: capturedRawItems - saved.length, restoredRawItems: raw.length, restoredReadableItems: actual.length, restoredEmptyTypeItems: raw.length - actual.length, savedTypeCount: saved.reduce((count, item) => count + item.types.length, 0), actualTypeCount: actual.reduce((count, item) => count + item.types.length, 0), itemCountMatches, typeSetsMatch, textMatches, missingTypes, additionalTypes, payloadMismatches };
        const restored = itemCountMatches && typeSetsMatch && textMatches && !missingTypes && !additionalTypes && !payloadMismatches;
        delete root.__recordInputClipboard; delete root.__recordInputOriginalText; delete root.__recordInputRawItemCount;
        return { restored, diagnostic };
      });
      restored = result.restored; diagnostic = result.diagnostic;
    }
    await info.attach('原剪贴板恢复结果', { body: JSON.stringify({ restored, ...diagnostic }), contentType: 'application/json' });
  } finally {
    await app?.close(); if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-record-input-guards-')) throw Error('拒绝清理组件测试目录以外的路径'); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (clipboardSaved) expect(restored).toBe(true); expect(errors).toEqual([]);
});
/** 两个入口始终点击原组件按钮；节点选择只由夹具提供当前精确路径。 */
async function open(route: 'document' | 'node') {
  await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: '打开夹具记录', exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: route === 'document' ? '整行编辑' : '记录树', exact: true })).click();
  if (route === 'node') await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: '选择夹具JSON根节点', exact: true })).click();
  const input = panel().getByRole('textbox', { name: route === 'document' ? '整行 JSON 输入' : 'JSON 节点输入', exact: true }); await expect(input).toBeVisible(); await expect(input).not.toHaveAttribute('maxlength'); return input;
}
/** 选区只设置偏移；内容经真实系统剪贴板及webContents.paste进入Chromium。 */
async function paste(input: Locator, value: string, start = 0, end?: number) {
  end ??= (await input.inputValue()).length;
  await input.evaluate((node: HTMLTextAreaElement, selection) => { node.focus(); node.setSelectionRange(selection.start, selection.end); window.__recordInputGuardAudit.events.length = 0; }, { start, end });
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), value); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
  await expect.poll(async () => (await audit()).events.filter(event => event.type === 'paste' && event.trusted).length).toBe(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
/** 仅查看生产控制器；错误及dirty不由测试代写。 */
async function unchanged(route: 'document' | 'node', expected: string) {
  const snapshot = await audit(); expect(snapshot.buffer).toBe(expected); expect(snapshot.note).toBe('OLD'); expect(snapshot.doc).toBe('"old"');
  await expect(panel().getByRole('alert')).toContainText(route === 'document' ? '2 MiB' : '预算');
}

for (const route of ['document', 'node'] as const) {
  test(`${route}全量超限原生粘贴整次拒绝，不能暂存合法前缀`, async () => {
    const input = await open(route), initial = await input.inputValue(), attempted = initial.padEnd(budget(route), ' ') + '尾部🙂';
    await paste(input, attempted); await expect(input).toHaveValue(initial); await unchanged(route, initial); expect((await audit()).dirty).toBe(false); await expect(stage()).toBeDisabled(); expect((await audit()).events.filter(event => event.type === 'input')).toEqual([]);
  });
  test(`${route}满预算合法dirty输入的选区替换拒绝后，仅暂存旧完整值`, async ({}, info) => {
    const input = await open(route), initial = await input.inputValue(), previous = (route === 'document' ? initial.replace('OLD', 'KEP') : '"keep"').padEnd(budget(route), ' ');
    await paste(input, previous); await expect(input).toHaveValue(previous); expect((await audit()).dirty).toBe(true);
    const start = route === 'document' ? previous.indexOf('KEP') : 1, end = start + (route === 'document' ? 3 : 4);
    await paste(input, 'NEW尾部汉🙂', start, end); await expect(input).toHaveValue(previous); await unchanged(route, previous); expect((await audit()).events.filter(event => event.type === 'input')).toEqual([]);
    await info.attach('超限拒绝仍保留完整旧编辑', { body: await page.screenshot(), contentType: 'image/png' });
    await stage().click(); const snapshot = await audit(); expect(snapshot.error).toBe(''); expect(snapshot.dirty).toBe(false); expect(snapshot.note).toBe(route === 'document' ? 'KEP' : 'OLD'); expect(snapshot.doc).toBe(route === 'node' ? previous : '"old"');
  });
  test(`${route}非法旧缓冲遇到超限粘贴仍不可暂存，修正后完整恢复`, async () => {
    const input = await open(route), initial = await input.inputValue(); await paste(input, '{'); await stage().click(); expect((await audit()).error).not.toBe('');
    await paste(input, ' '.repeat(budget(route) + 1)); await expect(input).toHaveValue('{'); expect((await audit()).buffer).toBe('{'); await stage().click(); expect((await audit()).dirty).toBe(true); expect((await audit()).note).toBe('OLD'); expect((await audit()).doc).toBe('"old"');
    const fixed = route === 'document' ? initial.replace('OLD', '新🙂值') : '"新🙂值"'; await paste(input, fixed); await stage().click(); const snapshot = await audit(); expect(snapshot.error).toBe(''); expect(snapshot.dirty).toBe(false); expect(route === 'document' ? snapshot.note : snapshot.doc).toBe(route === 'document' ? '新🙂值' : '"新🙂值"');
  });
  test(`${route}CRLF沿用原生选区语义，Unicode完整替换且UTF8超限不接收前缀`, async () => {
    const input = await open(route), initial = await input.inputValue(), previous = initial.replace(/\n/g, '\r\n') + '\r\n'; await paste(input, previous); const normalized = await input.inputValue(); expect((await audit()).buffer).toBe(normalized);
    await paste(input, '汉'.repeat(Math.floor(budget(route) / 3) + 1)); await expect(input).toHaveValue(normalized); await unchanged(route, normalized);
    const word = route === 'document' ? 'OLD' : 'old', start = normalized.indexOf(word); await paste(input, '👩‍💻新🙂值', start, start + word.length); await stage().click(); const snapshot = await audit(); expect(snapshot.error).toBe(''); expect(snapshot.dirty).toBe(false); expect(route === 'document' ? snapshot.note : snapshot.doc).toBe(route === 'document' ? '👩‍💻新🙂值' : '"👩‍💻新🙂值"\n');
  });
  test(`${route}可信普通输入与组合提交的完整值也经预算兜底，旧缓冲不变`, async () => {
    const input = await open(route), initial = await input.inputValue(), attempted = initial.padEnd(budget(route), ' ') + 'X', modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await input.focus(); await input.press(`${modifier}+A`); await page.keyboard.insertText(attempted); await expect(input).toHaveValue(initial); await unchanged(route, initial);
    await input.press(`${modifier}+A`); const cdp = await page.context().newCDPSession(page);
    // Chromium协议产生可信组合事件，不派发模拟input，不冒充特定Windows输入法验收。
    try { await cdp.send('Input.imeSetComposition', { text: attempted, selectionStart: attempted.length, selectionEnd: attempted.length }); await cdp.send('Input.insertText', { text: attempted }); } finally { await cdp.detach(); }
    await expect(input).toHaveValue(initial); await unchanged(route, initial); expect((await audit()).dirty).toBe(false); await expect(stage()).toBeDisabled();
    // 多行插入可分成多个input.data片段；完整DOM值和beforeinput才是候选全文证据。
    const events = (await audit()).events; expect(events.some(event => event.type === 'beforeinput' && event.trusted && event.dataUnits === attempted.length)).toBe(true); expect(events.some(event => event.type === 'input' && event.trusted && event.valueUnits === attempted.length)).toBe(true); expect(events.some(event => event.type === 'compositionupdate' && event.trusted && event.dataUnits === attempted.length)).toBe(true);
  });
}
