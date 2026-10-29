import { clickSidebarAction } from './sidebar-menu';
import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page } from './desktop-fixture';
import { enabled, isolatedDatabase, modifier } from './live-helpers';

test.use({ trace: 'off' });

/** 结构保存会刷新连接树；每次都从实际可见节点重新进入目标数据库。 */
async function databaseRow(database: string) {
  const button = page.locator('.database-row').getByRole('button', { name: database, exact: true });
  if (!await button.isVisible()) await page.locator('.connection-row .tree-label').click();
  await expect(button).toBeVisible();
  return page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
}

/** 对话框编辑使用 Monaco 键盘输入，保留真实编辑器、预览及 IPC 执行链路。 */
async function replaceSql(modal: Locator, sql: string) {
  await modal.locator('.monaco-editor').getByRole('textbox').focus();
  await page.keyboard.press(modifier + '+A');
  await page.keyboard.insertText(sql);
}

/** 创建字段草稿，不绕过设计器直接发送建表请求。 */
async function addColumn(modal: Locator, number: number, name: string, type: string, nullable: boolean, defaultValue?: string) {
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '添加字段', exact: true })).click();
  await modal.getByLabel('字段名 ' + number, { exact: true }).fill(name);
  await modal.getByLabel('字段类型 ' + number, { exact: true }).fill(type);
  await modal.getByLabel('允许空 ' + number, { exact: true }).setChecked(nullable);
  if (defaultValue !== undefined) await modal.getByLabel('默认值 ' + number, { exact: true }).fill(defaultValue);
}

/** 对象树进入建表入口，字段、索引和外键都由可见表单填写。 */
async function newTable(database: string, table: string) {
  const row = await databaseRow(database);
  await row.hover();
  await clickSidebarAction(row, { name: '新建表', exact: true });
  const modal = page.getByRole('dialog', { name: '创建表 · ' + database, exact: true });
  await modal.getByLabel('表名称', { exact: true }).fill(table);
  return modal;
}

/** 从数据库实际返回的对象定义进入编辑器，避免把测试生成的 SQL 当成读取证据。 */
async function editObject(database: string, name: string) {
  const row = await databaseRow(database);
  await (await (await import('./navigation-menu')).navigationMenuItem(row, { name: database, exact: true })).click();
  const object = page.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) });
  await expect(object).toBeVisible();
  await object.hover();
  await clickSidebarAction(object, { name: '设计 ' + name, exact: true });
  return page.getByRole('dialog').last();
}

test.describe('远程真实数据库对象设计与定义', () => {
  test.skip(!enabled, '需要显式启用实库验收，并使用已核对的远程测试服务器');
  test.describe.configure({ timeout: 240000 });

  test('设计器组合字段主键唯一索引外键，并读取编辑五类对象定义', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      // 库名来自隔离夹具且只含安全字符；其余对象名是本测试固定字面量。
      const q = (name: string) => database + '.' + name;
      let design = await newTable(database, 'parents');
      await addColumn(design, 2, 'code', 'varchar(80)', false);
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '预览 SQL', exact: true })).click();
      await expect(design.locator('.monaco-editor .view-lines')).toContainText('PRIMARY KEY');
      const [beforeCreate] = await observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'parents']);
      expect(beforeCreate).toHaveLength(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '确认执行', exact: true })).click();
      await expect(design).toBeHidden({ timeout: 20000 });

      design = await newTable(database, 'children');
      await addColumn(design, 2, 'parent_id', 'bigint unsigned', false);
      await addColumn(design, 3, 'code', 'varchar(80)', false);
      await addColumn(design, 4, 'note', 'varchar(100)', true);
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: /^索引/ })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '添加索引', exact: true })).click();
      await design.getByLabel('索引名 2', { exact: true }).fill('uq_children_code');
      await design.getByLabel('唯一索引 2', { exact: true }).check();
      await design.getByLabel('索引字段 2', { exact: true }).fill('code');
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: /^外键/ })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '添加外键', exact: true })).click();
      await design.getByLabel('外键名称', { exact: true }).fill('fk_children_parent');
      await design.getByLabel('本表字段（逗号分隔）', { exact: true }).fill('parent_id');
      await design.getByLabel('引用表', { exact: true }).fill('parents');
      await design.getByLabel('引用字段（逗号分隔）', { exact: true }).fill('id');
      await design.getByRole('combobox', { name: /^更新时/ }).selectOption('CASCADE');
      await design.getByRole('combobox', { name: /^删除时/ }).selectOption('CASCADE');
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '预览 SQL', exact: true })).click();
      for (const fragment of ['PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CASCADE']) await expect(design.locator('.monaco-editor .view-lines')).toContainText(fragment);
      await page.screenshot({ path: testInfo.outputPath('live-table-design-preview.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '确认执行', exact: true })).click();
      await expect(design).toBeHidden({ timeout: 20000 });
      const [indexes] = await observer.query<RowDataPacket[]>('SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'children']);
      expect(indexes.some(row => row.INDEX_NAME === 'PRIMARY' && row.COLUMN_NAME === 'id')).toBe(true);
      expect(indexes.some(row => row.INDEX_NAME === 'uq_children_code' && Number(row.NON_UNIQUE) === 0 && row.COLUMN_NAME === 'code')).toBe(true);
      const [foreign] = await observer.query<RowDataPacket[]>('SELECT CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=?', [database, 'children']);
      expect(foreign).toMatchObject([{ CONSTRAINT_NAME: 'fk_children_parent', UPDATE_RULE: 'CASCADE', DELETE_RULE: 'CASCADE' }]);
      await observer.query('INSERT INTO ' + q('parents') + " (id,code) VALUES (1,'父级中文🚀')");
      await observer.query('INSERT INTO ' + q('children') + " (id,parent_id,code,note) VALUES (1,1,'唯一值','待改列')");
      await expect(observer.query('INSERT INTO ' + q('children') + " (id,parent_id,code) VALUES (2,1,'唯一值')")).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
      await expect(observer.query('INSERT INTO ' + q('children') + " (id,parent_id,code) VALUES (1,1,'其他值')")).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
      await expect(observer.query('INSERT INTO ' + q('children') + " (id,parent_id,code) VALUES (2,99,'无父级')")).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2' });

      design = await editObject(database, 'children');
      await expect(design.getByLabel('字段名 4', { exact: true })).toHaveValue('note');
      await design.getByLabel('字段名 4', { exact: true }).fill('note_edited');
      await design.getByLabel('字段类型 4', { exact: true }).fill('varchar(200)');
      await addColumn(design, 5, 'flag', 'int', false, '7');
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '预览 SQL', exact: true })).click();
      await expect(design.locator('.monaco-editor .view-lines')).toContainText('ALTER TABLE');
      await (await (await import('./navigation-menu')).navigationMenuItem(design, { name: '确认执行', exact: true })).click();
      await expect(design).toBeHidden({ timeout: 20000 });
      const [modified] = await observer.query<RowDataPacket[]>('SELECT note_edited,flag FROM ' + q('children') + ' WHERE id=1');
      expect(modified).toMatchObject([{ note_edited: '待改列', flag: 7 }]);
      const [columns] = await observer.query<RowDataPacket[]>('SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [database, 'children', 'note_edited']);
      expect(columns[0].COLUMN_TYPE).toBe('varchar(200)');
      await observer.query('CREATE TABLE ' + q('event_log') + ' (id INT AUTO_INCREMENT PRIMARY KEY, message VARCHAR(100)) ENGINE=InnoDB');

      const definitions = [
        { kind: 'view', name: 'ui_view', initial: '初始视图', changed: '已编辑视图',
          sql: (value: string) => 'CREATE OR REPLACE VIEW ' + q('ui_view') + " AS SELECT id, '" + value + "' AS marker FROM " + q('parents') },
        { kind: 'procedure', name: 'ui_procedure', initial: '初始过程', changed: '已编辑过程',
          sql: (value: string) => 'DELIMITER $$\nCREATE PROCEDURE ' + q('ui_procedure') + "()\nBEGIN\nSELECT '" + value + "' AS marker;\nEND$$\nDELIMITER ;" },
        { kind: 'function', name: 'ui_function', initial: 'RETURN input_value + 1', changed: 'RETURN input_value + 2',
          sql: (value: string) => 'DELIMITER $$\nCREATE FUNCTION ' + q('ui_function') + '(input_value INT) RETURNS INT DETERMINISTIC NO SQL\nBEGIN\n' + value + ';\nEND$$\nDELIMITER ;' },
        { kind: 'trigger', name: 'ui_trigger', initial: '初始触发器', changed: '已编辑触发器',
          sql: (value: string) => 'CREATE TRIGGER ' + q('ui_trigger') + ' BEFORE INSERT ON ' + q('children') + " FOR EACH ROW SET NEW.note_edited = '" + value + "'" },
        { kind: 'event', name: 'ui_event', initial: '初始事件', changed: '已编辑事件',
          sql: (value: string) => 'CREATE EVENT ' + q('ui_event') + ' ON SCHEDULE EVERY 1 SECOND ' + (value === '初始事件' ? 'DISABLE' : 'ENABLE') + ' DO INSERT INTO ' + q('event_log') + " (message) VALUES ('" + value + "')" }
      ];
      for (const definition of definitions) {
        const row = await databaseRow(database);
        await row.hover(); await clickSidebarAction(row, { name: '创建数据库对象', exact: true });
        let modal = page.getByRole('dialog', { name: '创建数据库对象', exact: true });
        await modal.getByRole('combobox', { name: /^对象类型/ }).selectOption(definition.kind);
        await modal.getByLabel('对象名称', { exact: true }).fill(definition.name);
        await replaceSql(modal, definition.sql(definition.initial));
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '执行 SQL', exact: true })).click();
        await expect(modal).toBeHidden({ timeout: 20000 });
        modal = await editObject(database, definition.name);
        await expect(modal.locator('.monaco-editor .view-lines')).toContainText(definition.initial, { timeout: 15000 });
        if (definition.kind === 'function') await page.screenshot({ path: testInfo.outputPath('live-function-definition.png') });
        const replacement = (definition.kind === 'view' ? '' : 'DROP ' + definition.kind.toUpperCase() + ' IF EXISTS ' + q(definition.name) + ';\n') + definition.sql(definition.changed);
        await replaceSql(modal, replacement);
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '执行 SQL', exact: true })).click();
        await expect(modal).toBeHidden({ timeout: 20000 });

        if (definition.kind === 'view') {
          const [rows] = await observer.query<RowDataPacket[]>('SELECT marker FROM ' + q(definition.name));
          expect(rows[0].marker).toBe(definition.changed);
        } else if (definition.kind === 'procedure') {
          const [rows] = await observer.query<any[]>('CALL ' + q(definition.name) + '()');
          expect(rows[0][0].marker).toBe(definition.changed);
        } else if (definition.kind === 'function') {
          const [rows] = await observer.query<RowDataPacket[]>('SELECT ' + q(definition.name) + '(40) AS answer');
          expect(rows[0].answer).toBe(42);
        } else if (definition.kind === 'trigger') {
          await observer.query('INSERT INTO ' + q('children') + " (id,parent_id,code) VALUES (3,1,'触发器验证')");
          const [rows] = await observer.query<RowDataPacket[]>('SELECT note_edited FROM ' + q('children') + ' WHERE id=3');
          expect(rows[0].note_edited).toBe(definition.changed);
        } else {
          await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ' + q('event_log') + ' WHERE message=?', [definition.changed]); return Number(rows[0].total); }, { timeout: 20000 }).toBeGreaterThan(0);
        }
      }
      // 外键真实级联结果必须与设计器选择一致，不仅检查 SHOW CREATE 的文本。
      await observer.query('DELETE FROM ' + q('parents') + ' WHERE id=1');
      const [remaining] = await observer.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ' + q('children'));
      expect(Number(remaining[0].total)).toBe(0);
      const row = await databaseRow(database);
      await (await (await import('./navigation-menu')).navigationMenuItem(row, { name: database, exact: true })).click();
      for (const item of definitions) await expect(page.locator('.object-row').getByText(item.name, { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('live-objects.png') });
    }, testInfo);
  });
});
