import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { fileImportConflictZh as conflict } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 用明确的复合唯一键处理 CSV、JSON 和 XML 并按事务回执汇总', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.import_keys (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant text NOT NULL, code bigint NOT NULL, payload text NOT NULL UNIQUE, amount numeric(30,12), raw bytea, note text DEFAULT '默认值');
      CREATE UNIQUE INDEX import_match ON public.import_keys (tenant, code) INCLUDE (note);
      CREATE UNIQUE INDEX import_partial ON public.import_keys (code) WHERE code > 0;
      CREATE UNIQUE INDEX import_expression ON public.import_keys (lower(tenant), code);
      CREATE UNIQUE INDEX import_nullable ON public.import_keys (amount);
      INSERT INTO public.import_keys(tenant, code, payload, note) VALUES ('华东', 7, '原数据', '已保存');`);
    const snapshot = async () => (await observer.query(`SELECT id::text, tenant, code::text, payload, amount::text,
      encode(raw, 'hex') AS raw, note FROM public.import_keys AS item ORDER BY item.code`)).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL 按键导入', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({connectionId, database}) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'import_keys', tabs: [
        { id: 'import_keys', title: 'import_keys', kind: 'table', connectionId, database, table: '"public"."import_keys"' },
      ] });
    }, {connectionId: profile, database});
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    await expect(tab.getByRole('grid')).toBeVisible();
    const exact = '9007199254740993.123456789012';
    const cases = [
      { name: '跳过已有.csv', format: 'csv', mode: 'skip-existing', data: 'tenant,code,payload\n华东,7,不覆盖\n华东,8,新增八\n', result: '新增 1 行，匹配更新 0 行，跳过已有 1 行，跳过未匹配 0 行' },
      { name: '新增或更新.json', format: 'json', mode: 'upsert', data: `[{"tenant":"华东","code":7,"payload":"更新七","amount":${exact},"raw":{"type":"binary","base64":"AP8="}},{"tenant":"华东","code":9223372036854775807,"payload":"新增大键","amount":0,"raw":{"type":"binary","base64":""}}]`, result: '新增 1 行，匹配更新 1 行，跳过已有 0 行，跳过未匹配 0 行' },
      { name: '仅更新已有.xml', format: 'xml', mode: 'update-existing', data: '<RECORDS><RECORD tenant="华东" code="8" id="999" payload="更新八"/><RECORD tenant="华东" code="9" id="1000" payload="不新增"/></RECORDS>', result: '新增 0 行，匹配更新 1 行，跳过已有 0 行，跳过未匹配 1 行' },
      { name: '源键重复.json', format: 'json', mode: 'upsert', data: '[{"tenant":"华东","code":"7","payload":"甲"},{"tenant":"华东","code":"0007","payload":"乙"}]', result: '整批已回滚' },
      { name: '空键.json', format: 'json', mode: 'skip-existing', data: '[{"tenant":"华东","code":null,"payload":"空键"}]', result: '整批已回滚' },
      { name: '其它唯一键冲突.json', format: 'json', mode: 'upsert', data: '[{"tenant":"华东","code":7,"payload":"应回滚"},{"tenant":"华东","code":9,"payload":"更新八"}]', result: '整批已回滚' },
      { name: '等待并发提交.json', format: 'json', mode: 'skip-existing', data: '[{"tenant":"华东","code":9,"payload":"不得覆盖并发写入"}]', result: '新增 0 行，匹配更新 0 行，跳过已有 1 行，跳过未匹配 0 行' },
      { name: '索引变化.json', format: 'json', mode: 'update-existing', data: '[{"tenant":"华东","code":7,"payload":"不写入"}]', result: '原匹配键已变化' },
    ] as const;
    await mkdir(info.outputDir, {recursive: true});
    const paths = cases.map(item => info.outputPath(item.name));
    for (const [index, path] of paths.entries()) await writeFile(path, cases[index].data);
    await desktop.evaluate(({dialog, BrowserWindow}, files) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const path = files[count], options = args[1] as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !path || !path.endsWith('.' + options.filters?.[0]?.extensions[0]))
          throw Error('仅允许本例文件选择');
        count++;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
      Object.assign(globalThis, {restorePgConflictPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, paths);
    const modal = page.getByRole('dialog', {name: text.title, exact: true});
    let committed: Awaited<ReturnType<typeof snapshot>> = [];
    for (const [index, item] of cases.entries()) {
      await (await navigationMenuItem(tab, {name: text.open, exact: true})).click();
      await modal.getByLabel(text.format, {exact: true}).selectOption(item.format);
      const pick = item.format === 'csv' ? text.choose : item.format === 'json' ? text.chooseJson : text.chooseXml;
      await modal.getByRole('button', {name: pick, exact: true}).click();
      await expect(modal).toContainText(basename(paths[index]));
      await expect(modal.getByLabel(conflict.mode, {exact: true})).toHaveValue('insert');
      await modal.getByLabel(conflict.mode, {exact: true}).selectOption(item.mode);
      const apply = modal.getByRole('button', {name: text.confirmConflict, exact: true});
      await expect(apply).toBeDisabled();
      const key = modal.getByLabel(conflict.key, {exact: true});
      await expect(key.getByRole('option', {name: 'import_partial (code)', exact: true})).toHaveCount(0);
      await expect(key.getByRole('option', {name: /^import_expression|^import_nullable/})).toHaveCount(0);
      await key.selectOption({label: 'import_match (tenant, code)'});
      if (index === 1) await modal.screenshot({path: info.outputPath('PostgreSQL 匹配键导入.png')});
      if (item.name === '索引变化.json') await observer.query('DROP INDEX public.import_match');
      if (item.name === '等待并发提交.json') {
        await observer.query('BEGIN');
        try {
          await observer.query("INSERT INTO public.import_keys(tenant, code, payload) VALUES ('华东', 9, '并发写入')");
          await apply.click();
          // 确认原导入真的在等目标写锁，再提交另一个会话，验证匹配使用锁后的快照。
          await expect.poll(async () => {
            await observer.query('SELECT pg_stat_clear_snapshot()');
            return (await observer.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE '%IN SHARE ROW EXCLUSIVE MODE') AS waiting`)).rows[0].waiting;
          }, {timeout: 3500}).toBe(true);
          await observer.query('COMMIT');
        } catch (reason) { await observer.query('ROLLBACK'); throw reason; }
      } else await apply.click();
      await expect(modal).toBeHidden();
      await expect(tab).toContainText(item.result);
      const actual = await snapshot();
      if (index === 0) expect(actual.map(row => [row.code, row.payload, row.note])).toEqual([['7', '原数据', '已保存'], ['8', '新增八', '默认值']]);
      if (index === 1) expect(actual).toEqual([
        {id: '1', tenant: '华东', code: '7', payload: '更新七', amount: exact, raw: '00ff', note: '已保存'},
        {id: '2', tenant: '华东', code: '8', payload: '新增八', amount: null, raw: null, note: '默认值'},
        {id: '3', tenant: '华东', code: '9223372036854775807', payload: '新增大键', amount: '0.000000000000', raw: '', note: '默认值'},
      ]);
      if (index === 2) {
        expect(actual).toEqual([committed[0], {...committed[1], payload: '更新八'}, committed[2]]);
      }
      if (index < 3) committed = actual;
      else if (item.name === '等待并发提交.json') {
        expect(actual.filter(row => row.code !== '9')).toEqual(committed);
        expect(actual.find(row => row.code === '9')).toMatchObject({payload: '并发写入', note: '默认值'});
        committed = actual;
      }
      else {
        expect(actual).toEqual(committed);
        await tab.getByRole('button', {name: postgresTableZh.refresh, exact: true}).click();
      }
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgConflictPicker(): number}).restorePgConflictPicker())).toBe(cases.length);
  } finally { await observer.end(); }
});
