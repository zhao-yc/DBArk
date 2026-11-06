import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { sqliteRecordTransferZh as transferText } from '../../src/renderer/locales/sqliteRecordTransfer.zh-CN';
import { postgresRecordTransferZh } from '../../src/renderer/locales/postgresRecordTransfer.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../../src/renderer/locales/sqliteTableClipboard.zh-CN';
import { sqliteTableCreateZh as copyText } from '../../src/renderer/locales/sqliteTableCreate.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { sidebarMenuItem } from './sidebar-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.some(value => value === '--list' || value.startsWith('--list=')) &&
  process.env.DBARK_SQLITE_RECORD_TRANSFER_NATIVE === '1';
if (enabled && (process.env.DBARK_INTEGRATION_ENABLED !== '0' || !['win32', 'darwin'].includes(process.platform) ||
  ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(name => process.env[name])))
  throw Error('SQLite 跨文件专项只使用 Windows/macOS 源码构建与独占临时文件');
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '需显式启用，仅使用临时 SQLite 文件');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('只读 SQLite 查询逐格保留存储类型并跨文件追加', async ({}, info) => {
  const runtime = require('./desktop-fixture') as Runtime;
  const { DatabaseSync } = await import('node:sqlite');
  const { page, application } = runtime.ownedDesktopResources(info), directory = runtime.dataDir;
  const sourceFile = join(directory, 'transfer-source.sqlite'), targetFile = join(directory, 'transfer-target.sqlite');
  const observations: string[] = [];
  const mark = async (step: string) => {
    observations.push(step);
    await writeFile(info.outputPath('原生验收.json'), JSON.stringify({ platform: process.platform, directory, observations }, null, 2));
  };
  const check = () => {
    const owner = runtime.ownedDesktopResources(info);
    if (owner.page !== page || owner.application !== application || owner.closed ||
        info.config.workers !== 1 || info.timeout !== 120000 || info.retry !== 0) throw Error('原生测试归属或门槛已变化');
  };
  try {
    const source = new DatabaseSync(sourceFile), target = new DatabaseSync(targetFile);
    try {
      source.exec(`CREATE TABLE records(memo TEXT, exact INTEGER, mixed ANY, signed_zero ANY, amount REAL, exceptional ANY, note TEXT) STRICT;
        INSERT INTO records VALUES
          ('源甲', 9223372036854775807, '0007', -0.0, 2.0, 1e999, NULL),
          ('源乙', -9223372036854775808, X'', 0.0, 0.25, NULL, ''),
          ('未选记录', 0, X'00FF', 0.0, 4.0, NULL, '源记录保留')`);
      target.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY, memo TEXT, exact INTEGER, mixed ANY, signed_zero ANY, amount REAL,
        exceptional ANY DEFAULT '目标默认值', note TEXT, lossy_integer INTEGER, lossy_real REAL) STRICT`);
    } finally { source.close(); target.close(); }
    const openConnection = async (title: string, file: string, readonly: boolean) => {
      await application.evaluate(({ dialog }, path) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = (async (...args: unknown[]) => {
          dialog.showOpenDialog = original;
          if (!(args.at(-1) as Electron.OpenDialogOptions).properties?.includes('openFile')) throw Error('拒绝非本例的打开操作');
          return { canceled: false, filePaths: [path] };
        }) as typeof dialog.showOpenDialog;
      }, file);
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(title);
      await form.getByRole('combobox').selectOption('sqlite');
      await form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).setChecked(readonly);
      await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
      await expect(form.locator('input[readonly]')).toHaveValue(file === sourceFile ? 'transfer-source.sqlite' : 'transfer-target.sqlite');
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
      const node = page.locator('.connection-node').filter({ hasText: title });
      await node.locator('.connection-row .tree-label').click();
      await node.locator('.database-row .tree-label').getByText('main', { exact: true }).click();
      return node.locator('.object-row').filter({ has: page.getByText('records', { exact: true }) });
    };
    const sourceTable = await openConnection('跨文件 SQLite 只读源', sourceFile, true);
    await sourceTable.locator('.tree-label').click();
    await (await sidebarMenuItem(sourceTable, { name: sqliteZh.selectQuery + ' records', exact: true }, check)).click();
    const query = page.locator('.query-tab:visible');
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.insertText('SELECT memo, exact, mixed, signed_zero, amount, exceptional, note FROM records ORDER BY rowid');
    await (await navigationMenuItem(query, { name: zh.query.text011, exact: true }, check)).click();
    for (const name of ['源乙', '源甲']) {
      await query.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    await (await navigationMenuItem(query, { name: postgresRecordTransferZh.queryCapture, exact: true }, check)).click();
    const targetTable = await openConnection('跨文件 SQLite 写入目标', targetFile, false);
    await targetTable.locator('.tree-label').dblclick();
    const table = page.locator('.sqlite-table-tab:visible');
    await expect(table.getByRole('grid', { name: editText.grid, exact: true })).toBeVisible();
    await (await navigationMenuItem(table, { name: transferText.entry('SQLite'), exact: true }, check)).click();
    const mapping = page.getByRole('dialog', { name: transferText.title('SQLite'), exact: true });
    await expect(mapping).toContainText('跨文件 SQLite 只读源');
    await expect(mapping).toContainText('跨文件 SQLite 写入目标');
    const sourceColumn = mapping.getByLabel(transferText.sourceColumn, { exact: true });
    const targetColumn = mapping.getByLabel(transferText.targetColumn, { exact: true });
    await sourceColumn.selectOption('2');
    await expect(targetColumn).toHaveValue('mixed');
    await expect(targetColumn.getByRole('option', { name: 'lossy_integer (INTEGER)', exact: true })).toHaveCount(0);
    await sourceColumn.selectOption('3');
    await expect(targetColumn).toHaveValue('signed_zero');
    await expect(targetColumn.getByRole('option', { name: 'lossy_real (REAL)', exact: true })).toHaveCount(0);
    await sourceColumn.selectOption('5');
    await expect(targetColumn).toHaveValue('');
    await expect(targetColumn.getByRole('option')).toHaveCount(1);
    await expect(mapping).toContainText(transferText.nonfinite);
    await page.screenshot({ path: info.outputPath('SQLite跨文件字段映射.png') });
    await mark('只读查询暂存勾选行，按逐格类型映射，拒绝会改变混合类型或负零的目标');

    const readTarget = () => {
      const db = new DatabaseSync(targetFile, { readOnly: true });
      try {
        return db.prepare(`SELECT memo, CAST(exact AS TEXT) AS exact, typeof(exact) AS exact_type, mixed, typeof(mixed) AS mixed_type,
          signed_zero, typeof(signed_zero) AS zero_type, amount, typeof(amount) AS amount_type, exceptional, note
          FROM records ORDER BY id`).all().map(row => ({
          ...row, mixed: row.mixed_type === 'blob' ? Buffer.from(row.mixed as Uint8Array).toString('hex') : row.mixed,
          signed_zero: Object.is(row.signed_zero, -0) ? '-0' : String(row.signed_zero),
        }));
      } finally { db.close(); }
    };
    await mapping.getByRole('button', { name: clipboardText.stage, exact: true }).click();
    await expect(mapping).toBeHidden();
    expect(readTarget()).toEqual([]);
    await table.getByRole('button', { name: editText.preview, exact: true }).click();
    const review = page.getByRole('dialog', { name: editText.previewTitle, exact: true });
    const confirm = review.getByRole('checkbox', { name: editText.confirmation, exact: true });
    await expect(confirm).toBeEnabled();
    expect(readTarget()).toEqual([]);
    await confirm.check();
    await review.getByRole('button', { name: editText.submit, exact: true }).click();
    await expect.poll(readTarget).toEqual([
      { memo: '源甲', exact: '9223372036854775807', exact_type: 'integer', mixed: '0007', mixed_type: 'text',
        signed_zero: '-0', zero_type: 'real', amount: 2, amount_type: 'real', exceptional: '目标默认值', note: null },
      { memo: '源乙', exact: '-9223372036854775808', exact_type: 'integer', mixed: '', mixed_type: 'blob',
        signed_zero: '0', zero_type: 'real', amount: 0.25, amount_type: 'real', exceptional: '目标默认值', note: '' },
    ]);
    await expect(review).toBeHidden();
    await expect(table.getByRole('status').filter({ hasText: editText.counts(0, 0, 0) })).toBeVisible();
    try {
      await expect(table.getByRole('grid', { name: editText.grid, exact: true })).toHaveAttribute('aria-rowcount', '3');
    } finally {
      await writeFile(info.outputPath('提交后表页.txt'), await table.ariaSnapshot());
    }
    const original = new DatabaseSync(sourceFile, { readOnly: true });
    try { expect(original.prepare('SELECT memo FROM records ORDER BY rowid').all().map(row => row.memo)).toEqual(['源甲', '源乙', '未选记录']); }
    finally { original.close(); }
    expect(runtime.pageErrors).toEqual([]);
    await writeFile(info.outputPath('SQLite独立读回.json'), JSON.stringify(readTarget(), null, 2));
    await mark('暂存和预览零写入，提交后逐格独立读回，源文件保持');
    const copy = page.getByRole('dialog', { name: copyText.copyTitle, exact: true });
    const copied = () => {
      const db = new DatabaseSync(targetFile, { readOnly: true });
      try {
        if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='整表副本'").get()) return null;
        return db.prepare(`SELECT id, memo, CAST(exact AS TEXT) AS exact, typeof(mixed) AS kind, hex(mixed) AS bytes,
          signed_zero, note FROM 整表副本 ORDER BY id`).all().map(row => ({ ...row, signed_zero: Object.is(row.signed_zero, -0) ? '-0' : String(row.signed_zero) }));
      } finally { db.close(); }
    };
    await (await navigationMenuItem(table, { name: copyText.copyTitle, exact: true }, check)).click();
    await copy.getByLabel(copyText.name, { exact: true }).fill('整表副本');
    await copy.getByLabel(copyText.copyMode, { exact: true }).selectOption('data');
    await copy.getByRole('button', { name: copyText.copyPreview, exact: true }).click();
    await expect(copy).toContainText('INSERT OR ABORT INTO main."整表副本"');
    expect(copied()).toBeNull();
    await expect(page.locator('.toast')).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: info.outputPath('SQLite整表复制预览.png') });
    await copy.getByLabel(copyText.confirmation, { exact: true }).fill('main.整表副本');
    await copy.getByRole('button', { name: copyText.copyApply, exact: true }).click();
    await expect(copy.getByRole('status')).toContainText('已复制 2 行');
    expect(copied()).toEqual([
      { id: 1, memo: '源甲', exact: '9223372036854775807', kind: 'text', bytes: '30303037', signed_zero: '-0', note: null },
      { id: 2, memo: '源乙', exact: '-9223372036854775808', kind: 'blob', bytes: '', signed_zero: '0', note: '' },
    ]);
    expect(readTarget()).toHaveLength(2);
    await writeFile(info.outputPath('SQLite整表独立读回.json'), JSON.stringify(copied(), null, 2));
    await copy.getByRole('button', { name: copyText.close, exact: true }).click();
    await expect(copy).toBeHidden();
    await expect(page.locator('.tab-select').getByText('整表副本', { exact: true })).toBeVisible();
    await expect(table.getByRole('grid', { name: editText.grid, exact: true })).toHaveAttribute('aria-rowcount', '3');
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => task.status === 'running')).toEqual([]);
    await mark('SQLite 同文件整表复制，预览零写入，确认后独立读回两行并打开副本');
    await sourceTable.locator('.tree-label').dblclick();
    await (await navigationMenuItem(table, { name: copyText.copyTitle, exact: true }, check)).click();
    const destination = copy.getByLabel(copyText.copyDestination, { exact: true });
    const writable = destination.getByRole('option', { name: /跨文件 SQLite 写入目标/ });
    await expect(writable).toHaveCount(1);
    await destination.selectOption({ label: (await writable.textContent())! });
    await expect(copy).toContainText('跨文件 SQLite 只读源');
    await copy.getByLabel(copyText.name, { exact: true }).fill('跨文件整表副本');
    await copy.getByLabel(copyText.copyMode, { exact: true }).selectOption('data');
    await copy.getByRole('button', { name: copyText.copyPreview, exact: true }).click();
    await expect(copy).toContainText('FROM dbark_copy_source."records"');
    const inspectCopy = (file: string, name: 'records' | '跨文件整表副本') => {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (!db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(name)) return null;
        return db.prepare(`SELECT rowid, memo, CAST(exact AS TEXT) AS exact, typeof(mixed) AS kind, hex(mixed) AS bytes,
          signed_zero, exceptional, note FROM "${name}" ORDER BY rowid`).all().map(row => ({ ...row,
          signed_zero: Object.is(row.signed_zero, -0) ? '-0' : String(row.signed_zero),
          exceptional: row.exceptional === null ? null : String(row.exceptional),
        }));
      } finally { db.close(); }
    };
    const originalRows = inspectCopy(sourceFile, 'records');
    expect(originalRows).toHaveLength(3);
    expect(inspectCopy(targetFile, '跨文件整表副本')).toBeNull();
    await expect(page.locator('.toast')).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: info.outputPath('SQLite跨文件整表复制预览.png') });
    await copy.getByLabel(copyText.confirmation, { exact: true }).fill('main.跨文件整表副本');
    await copy.getByRole('button', { name: copyText.copyApply, exact: true }).click();
    await expect(copy.getByRole('status')).toContainText('已复制 3 行');
    const targetRows = inspectCopy(targetFile, '跨文件整表副本');
    expect(targetRows).toEqual(originalRows);
    expect(inspectCopy(sourceFile, 'records')).toEqual(originalRows);
    expect(readTarget()).toHaveLength(2);
    await writeFile(info.outputPath('SQLite跨文件整表独立读回.json'), JSON.stringify(targetRows, null, 2));
    await copy.getByRole('button', { name: copyText.close, exact: true }).click();
    await expect(copy).toBeHidden();
    await expect(page.locator('.tab-select').getByText('跨文件整表副本', { exact: true })).toBeVisible();
    await expect(table.getByRole('grid', { name: editText.grid, exact: true })).toHaveAttribute('aria-rowcount', '4');
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => task.status === 'running')).toEqual([]);
    await mark('SQLite 从只读连接跨文件整表复制，预览零写入，独立读回三行并确认来源保持');
    const quitDialogs: string[] = [];
    const observeDialog = (message: { text(): string }) => {
      if (message.text().startsWith('DBARK_E2E_DIALOG:')) quitDialogs.push(message.text());
    };
    application.on('console', observeDialog);
    try { await runtime.confirmOwnedDesktopExit(info); }
    finally {
      application.off('console', observeDialog);
      await writeFile(info.outputPath('退出对话框.json'), JSON.stringify(quitDialogs, null, 2));
    }
    expect(quitDialogs).toEqual([]);
    await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  }
});
