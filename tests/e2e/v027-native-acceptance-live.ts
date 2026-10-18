import type { Page } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, v027AfterEach, type V027Context } from './v027-acceptance-fixture';
import { v027CaseNames, v027CsvInput, v027CsvColumns, v027DraftConfirmation } from '../helpers/v027Acceptance';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as createText } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreatePrefixZh as prefixText } from '../../src/renderer/locales/tableCreatePrefix.zh-CN';
import { tableCreateOnUpdateZh as timeText } from '../../src/renderer/locales/tableCreateOnUpdate.zh-CN';

/** 透明委托原Main handler，只记计数/布尔/枚举；不模拟文件令牌、Engine结果或记录输入正文。 */
async function installAudit(ctx: V027Context) {
  await ctx.step(() => ctx.owner.application.evaluate(({ ipcMain }, nonce) => {
    type Handler = (event: { sender: { id: number } }, input: { command: string; input?: any }) => Promise<any>;
    const main = ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> }, original = main._invokeHandlers.get('dbark:request');
    const root = globalThis as typeof globalThis & { __v027Audit?: any }; if (!original || root.__v027Audit) throw Error('0.27原Main审计归属未知');
    const names = ['files.choose', 'files.preview', 'files.import', 'schema.tableCreate.get', 'schema.tableCreate.preview', 'schema.tableCreate.apply'];
    const state = { nonce, original, wrapper: undefined as unknown as Handler, calls: Object.fromEntries(names.map(name => [name, 0])), success: Object.fromEntries(names.map(name => [name, 0])), pending: 0, invalid: false, tokens: new Set<string>(), delimiters: [] as number[] };
    state.wrapper = async (event, input) => {
      const tracked = names.includes(input.command); if (tracked) { state.calls[input.command] = Math.min(64, state.calls[input.command] + 1); if (state.calls[input.command] >= 64) state.invalid = true; state.pending++; }
      try {
        if (['files.preview', 'files.import'].includes(input.command)) {
          if (!state.tokens.has(input.input?.fileToken)) state.invalid = true;
          if (input.input?.format === 'csv') { const value = [',', ';', '\t'].indexOf(input.input.csvDelimiter ?? ','); if (value < 0 || state.delimiters.length >= 32) state.invalid = true; else state.delimiters.push(value); }
        }
        const result = await original(event, input);
        if (tracked && result?.ok === true) state.success[input.command] = Math.min(64, state.success[input.command] + 1);
        if (input.command === 'files.choose' && result?.ok === true) { if (typeof result.result?.token !== 'string' || !result.result.token || state.tokens.size >= 3) state.invalid = true; else state.tokens.add(result.result.token); }
        return result;
      } finally { if (tracked) state.pending--; }
    };
    root.__v027Audit = state; main._invokeHandlers.set('dbark:request', state.wrapper);
  }, ctx.plan.nonce));
}
/** 每次读取先核原wrapper，输出不包含令牌/路径/凭据/SQL。 */
async function audit(ctx: V027Context) {
  return ctx.step(() => ctx.owner.application.evaluate(({ ipcMain }, nonce) => {
    const root = globalThis as typeof globalThis & { __v027Audit?: any }, state = root.__v027Audit;
    if (!state || state.nonce !== nonce || (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, unknown> })._invokeHandlers.get('dbark:request') !== state.wrapper || state.invalid || state.pending) throw Error('0.27审计归属、令牌关系或动作终态未知');
    return { calls: state.calls as Record<string, number>, success: state.success as Record<string, number>, issued: state.tokens.size as number, delimiters: state.delimiters as number[] };
  }, ctx.plan.nonce));
}

/** 登录、对象树和文件菜单只走原控件；密码不进入资源记录，所有录制均关闭。 */
async function connectUi(ctx: V027Context) {
  const page = ctx.owner.page, target = ctx.binding.target, name = 'V027 ' + ctx.plan.nonce;
  await ctx.step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [['连接名称', name], ['主机地址', target.host], ['端口', String(target.port)], ['用户名', target.user], ['数据库密码', target.password]]) await ctx.step(() => form.getByLabel(label, { exact: true }).fill(value));
  await ctx.step(() => form.getByRole('button', { name: '测试连接', exact: true }).click()); await ctx.step(() => expect(form.locator('.success-box')).toContainText('连接成功')); await ctx.step(() => form.getByRole('button', { name: '保存连接', exact: true }).click()); await ctx.step(() => expect(form).toBeHidden());
  const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name, exact: true }) }); await ctx.step(() => node.locator('.connection-row').getByRole('button', { name, exact: true }).click());
  const row = node.locator('.database-row').filter({ has: page.getByRole('button', { name: ctx.plan.schema, exact: true }) }); await ctx.step(() => row.getByRole('button', { name: ctx.plan.schema, exact: true }).click());
  await ctx.step(() => expect(row.getByRole('button', { name: ctx.plan.schema, exact: true })).toHaveAttribute('aria-expanded', 'true'));
  return { node, row };
}

/** 两条串行真实场景仅注册于专门Root门；本任务不调用该入口或任何预检。 */
export function registerV027Acceptance() {
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  // 预算在声明期固定，包含准入/启动/主体/收尾；从不在body或afterEach重置期限。
  test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  test.afterEach(async ({}, info) => { await v027AfterEach(info); });
  test(v027CaseNames[0], async ({ v027Admission: ctx }) => {
    try {
      await ctx.bindDesktop(); await installAudit(ctx); await ctx.createSchema();
      const qualified = '`' + ctx.plan.schema + '`.`csv_target`';
      await ctx.step(() => ctx.connection.query('CREATE TABLE ' + qualified + ' (id BIGINT UNSIGNED PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,nullable_text TEXT NULL,empty_text VARCHAR(8) NOT NULL,payload BLOB,note TEXT) ENGINE=InnoDB'));
      await ctx.step(() => ctx.connection.execute('INSERT INTO ' + qualified + ' VALUES (7,7,NULL,?,?,?)', ['', Buffer.from([0, 255, 16]), '原旁行']));
      const samples = ([',', ';', '\t'] as const).map((delimiter, index) => v027CsvInput(delimiter, index)); await ctx.writeInputs(samples.map(sample => sample.body));
      const tree = await connectUi(ctx); await ctx.step(() => tree.node.locator('.object-row').getByText('csv_target', { exact: true }).click()); await ctx.step(() => expect(ctx.owner.page.locator('.table-tab:visible .loading-overlay')).toHaveCount(0));
      for (const [index, delimiter] of ([',', ';', '\t'] as const).entries()) {
        // 唯一stub只回答本次已登记样本的OS选择路径；Main仍签发真实一次性文件令牌。
        await ctx.step(() => ctx.owner.application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, ctx.files[index]));
        await ctx.step(() => ctx.owner.page.locator('.table-tab:visible').getByRole('button', { name: zh.common.import, exact: true }).click());
        const form = ctx.owner.page.getByRole('dialog', { name: `导入数据 · ${ctx.plan.schema}.csv_target`, exact: true });
        await ctx.step(() => form.getByRole('combobox', { name: zh.transfer.csvDelimiter, exact: true }).selectOption(delimiter)); await ctx.step(() => form.locator('.file-picker').click());
        for (const column of v027CsvColumns) await ctx.step(() => expect(form.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true })).toHaveValue(column));
        const note = () => form.getByRole('combobox', { name: formatText(zh.transfer.text020, 'note'), exact: true });
        await ctx.step(() => note().selectOption(''));
        await ctx.step(() => form.getByRole('combobox', { name: zh.transfer.csvDelimiter, exact: true }).selectOption(delimiter === ',' ? ';' : ','));
        await ctx.step(() => expect(form.locator('.error-box')).toBeVisible()); await ctx.step(() => expect(form.getByRole('button', { name: zh.transfer.text028, exact: true })).toBeDisabled()); await ctx.step(() => expect(note()).toHaveCount(0));
        expect((await audit(ctx)).calls['files.import']).toBe(index);
        await ctx.step(() => form.getByRole('combobox', { name: zh.transfer.csvDelimiter, exact: true }).selectOption(delimiter)); await ctx.step(() => expect(note()).toHaveValue('note'));
        if (index === 0) {
          await ctx.step(() => note().selectOption('')); await ctx.step(() => form.getByRole('combobox', { name: zh.transfer.text009, exact: true }).selectOption('utf16le'));
          // 该UTF-8样本按UTF-16LE读取会得到空字段预览，并不保证CSV解析报错；仍须拒绝沿用旧映射或发起导入。
          await ctx.step(() => expect(form.getByRole('button', { name: zh.transfer.text028, exact: true })).toBeEnabled());
          await ctx.step(() => expect(form.locator('.mapping-grid select')).toHaveCount(0)); await ctx.step(() => expect(note()).toHaveCount(0));
          await ctx.step(() => form.getByRole('button', { name: zh.transfer.text028, exact: true }).click());
          await ctx.step(() => expect(form.locator('.error-box')).toHaveText(zh.transfer.text001)); expect((await audit(ctx)).calls['files.import']).toBe(index);
          await ctx.step(() => form.getByRole('combobox', { name: zh.transfer.text009, exact: true }).selectOption('utf8')); await ctx.step(() => expect(note()).toHaveValue('note'));
        }
        await ctx.step(() => form.getByRole('button', { name: zh.transfer.text028, exact: true }).click()); await ctx.step(() => expect(form.locator('.success-box')).toContainText('2 行')); await ctx.step(() => expect(form.locator('.error-box')).toHaveCount(0)); await ctx.step(() => form.getByRole('button', { name: zh.common.done, exact: true }).click());
      }
      const observed = await audit(ctx); expect(observed.issued).toBe(3); expect(observed.calls['files.import']).toBe(3); expect(observed.success['files.import']).toBe(3); expect(new Set(observed.delimiters)).toEqual(new Set([0, 1, 2]));
      const expected = [{ id: '7', amount: '7.000000000000', nullable_text: null, empty_text: '', payload: '00FF10', note: '原旁行' }, ...samples.flatMap(sample => sample.expected)];
      // 按原整数列排序；未限定的id会绑定CAST输出别名，导致旁行7按文本排到大整数后。
      await ctx.finish(async closed => { const [rows] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,nullable_text,empty_text,HEX(payload) AS payload,note FROM ' + qualified + ' AS source ORDER BY source.id'), closed); expect(rows).toEqual(expected); await ctx.neighbor(closed); }, 3);
    } catch (reason) { ctx.life.stop(); throw reason; }
  });

  test(v027CaseNames[1], async ({ v027Admission: ctx }) => {
    try {
      await ctx.bindDesktop(); await installAudit(ctx); await ctx.createSchema(); const tree = await connectUi(ctx);
      await ctx.step(() => tree.row.getByRole('button', { name: ctx.plan.schema, exact: true }).focus()); await ctx.step(() => tree.row.getByRole('button', { name: zh.sidebar.text017, exact: true }).click());
      const form = ctx.owner.page.getByRole('dialog', { name: `创建表 · ${ctx.plan.schema}`, exact: true }); await ctx.step(() => form.getByLabel(zh.schema.text010, { exact: true }).fill('time_defaults'));
      const field = (key: string, position: number) => form.getByLabel(formatText(key, position), { exact: true });
      for (const [position, name, type, value] of [[2, 'code', 'varchar(64)', undefined], [3, 'created_at', 'datetime(3)', 'CURRENT_TIMESTAMP(3)'], [4, 'updated_at', 'timestamp(6)', 'CURRENT_TIMESTAMP(6)'], [5, 'ordinary_at', 'datetime', 'NULL'], [6, 'note', 'varchar(32)', '旁列默认']] as const) {
        await ctx.step(() => form.getByRole('button', { name: zh.schema.text027, exact: true }).click()); await ctx.step(() => field(zh.schema.text018, position).fill(name)); await ctx.step(() => field(zh.schema.text019, position).fill(type)); if (value !== undefined) await ctx.step(() => field(zh.schema.text022, position).fill(value));
      }
      for (const position of [3, 4]) await ctx.step(() => form.getByRole('combobox', { name: timeText.label(position), exact: true }).selectOption('current'));
      await ctx.step(() => form.getByRole('combobox', { name: timeText.label(5), exact: true }).selectOption('none'));
      const invalid = async () => { await ctx.step(() => form.getByRole('button', { name: zh.schema.text049, exact: true }).click()); await ctx.step(() => expect(form.locator('.error-box')).toContainText(createText.invalidDesign)); expect((await audit(ctx)).calls['schema.tableCreate.get']).toBe(0); };
      await ctx.step(() => form.getByRole('combobox', { name: timeText.precisionLabel(3), exact: true }).selectOption('2')); await invalid(); await ctx.step(() => form.getByRole('combobox', { name: timeText.precisionLabel(3), exact: true }).selectOption('3'));
      await ctx.step(() => field(zh.schema.text022, 3).fill('普通字符串')); await invalid(); await ctx.step(() => field(zh.schema.text022, 3).fill('CURRENT_TIMESTAMP(3)'));
      await ctx.step(() => field(zh.schema.text019, 3).fill('varchar(64)')); await invalid(); await ctx.step(() => field(zh.schema.text019, 3).fill('datetime(3)'));
      const confirmation = ctx.owner.page.getByRole('dialog', { name: createText.title, exact: true });
      const preview = async (prefix: boolean) => {
        await ctx.step(() => form.getByRole('button', { name: zh.schema.text049, exact: true }).click()); await ctx.step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE'));
        const sql = await ctx.step(() => confirmation.locator('.monaco-editor .view-lines').innerText()); expect(sql.replace(/\s+/g, ' ')).toMatch(/`created_at` datetime\(3\).*DEFAULT CURRENT_TIMESTAMP\(3\).*ON UPDATE CURRENT_TIMESTAMP\(3\)/i); expect(sql.replace(/\s+/g, ' ')).toMatch(/`updated_at` timestamp\(6\).*ON UPDATE CURRENT_TIMESTAMP\(6\)/i); if (prefix) expect(sql.replace(/\s+/g, ' ')).toMatch(/KEY `ix_code`\s*\(`code`\(12\)\)/);
        const [tables] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [ctx.plan.schema, 'time_defaults'])); expect(tables).toHaveLength(0); expect((await audit(ctx)).calls['schema.tableCreate.apply']).toBe(0); await ctx.neighbor();
      };
      await preview(false);
      // Electron原生确认不能用CDP二次回答；只替换本次准确提示的回答，不作为系统弹窗验收。
      const answer = await ctx.step(() => ctx.owner.page.evaluateHandle(v027DraftConfirmation, createText.discard));
      await ctx.step(() => confirmation.getByRole('button', { name: createText.back, exact: true }).click());
      await ctx.step(() => answer.evaluate(gate => { if (gate.calls !== 1 || window.confirm !== gate.original) throw Error('0.27返回草稿确认未恰好回答一次并恢复'); }));
      await ctx.step(() => answer.dispose());
      await ctx.step(() => expect(confirmation).toBeHidden());
      await ctx.step(() => form.getByRole('button', { name: /^索引/ }).click()); await ctx.step(() => form.getByRole('button', { name: zh.schema.text036, exact: true }).click()); await ctx.step(() => field(zh.schema.text031, 2).fill('ix_code')); await ctx.step(() => form.getByLabel(prefixText.field(2, 1), { exact: true }).selectOption('code')); await ctx.step(() => form.getByLabel(prefixText.prefix(2, 1), { exact: true }).fill('12')); await preview(true);
      for (const label of [createText.ackDdl, createText.ackCreate]) await ctx.step(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check()); await ctx.step(() => confirmation.getByLabel(createText.confirmation, { exact: true }).fill(ctx.plan.schema + '.time_defaults'));
      await ctx.step(() => confirmation.getByRole('button', { name: createText.apply, exact: true }).click()); await ctx.step(() => expect(confirmation.getByRole('status')).toHaveText(createText.succeeded)); await ctx.step(() => expect(confirmation.getByRole('button', { name: createText.apply, exact: true })).toBeDisabled());
      const observed = await audit(ctx); expect(observed.calls['schema.tableCreate.apply']).toBe(1); expect(observed.success['schema.tableCreate.apply']).toBe(1);
      await ctx.step(() => confirmation.getByRole('button', { name: createText.close, exact: true }).click());
      await ctx.finish(async closed => {
        const [shown] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SHOW CREATE TABLE `' + ctx.plan.schema + '`.`time_defaults`'), closed); expect(shown).toHaveLength(1); const sql = String(shown[0]['Create Table']); expect(sql).toMatch(/`created_at` datetime\(3\).*ON UPDATE CURRENT_TIMESTAMP\(3\)/i); expect(sql).toMatch(/`updated_at` timestamp\(6\).*ON UPDATE CURRENT_TIMESTAMP\(6\)/i); expect(sql).toMatch(/KEY `ix_code` \(`code`\(12\)\)/);
        const [columns] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT COLUMN_NAME,COLUMN_TYPE,COLUMN_DEFAULT,DATETIME_PRECISION,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [ctx.plan.schema, 'time_defaults']), closed);
        expect(columns.map(row => row.COLUMN_NAME)).toEqual(['id', 'code', 'created_at', 'updated_at', 'ordinary_at', 'note']);
        for (const [index, type, precision] of [[2, 'datetime(3)', 3], [3, 'timestamp(6)', 6]] as const) { expect(columns[index].COLUMN_TYPE).toBe(type); expect(Number(columns[index].DATETIME_PRECISION)).toBe(precision); expect(String(columns[index].COLUMN_DEFAULT).toUpperCase()).toBe(`CURRENT_TIMESTAMP(${precision})`); expect(String(columns[index].EXTRA)).toMatch(new RegExp('^(?:DEFAULT_GENERATED\\s+)?on update CURRENT_TIMESTAMP\\(' + precision + '\\)$', 'i')); }
        expect(columns[4]).toMatchObject({ COLUMN_TYPE: 'datetime', COLUMN_DEFAULT: null, DATETIME_PRECISION: 0, EXTRA: '' }); expect(columns[5]).toMatchObject({ COLUMN_TYPE: 'varchar(32)', COLUMN_DEFAULT: '旁列默认', EXTRA: '' });
        // 独立驱动启用了bigNumberStrings；目录中的BIGINT前缀长度须保留字符串，不改驱动精度选项。
        const [indexes] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT INDEX_NAME,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [ctx.plan.schema, 'time_defaults']), closed); expect(indexes).toEqual([{ INDEX_NAME: 'ix_code', COLUMN_NAME: 'code', SUB_PART: '12' }, { INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SUB_PART: null }]);
        const [rows] = await ctx.step(() => ctx.connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM `' + ctx.plan.schema + '`.`time_defaults`'), closed); expect(Number(rows[0].count)).toBe(0); await ctx.neighbor(closed);
      }, 5);
    } catch (reason) { ctx.life.stop(); throw reason; }
  });
}
