import { randomUUID } from 'node:crypto';
import type { QueryOutcome } from '../../src/shared/contracts';
import { test, expect, ownedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { beginDefinitionNavigationCase, finishDefinitionNavigationCase } from './definition-navigation-live';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreateColumnOrderZh as order } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';

/** 仅Root调度后的备用场景；成功留表复核，不建库、建用户、授权或补DROP。 */
export function registerTableCreateColumnOrderTests() {
  test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }); test.setTimeout(90000);
  test.afterEach(({}, info) => { finishDefinitionNavigationCase(info); });
  test('准确MySQL8.4.11新表字段上移下移、默认属性与最终实际列序', async ({ trace }, info) => {
    const activity = beginDefinitionNavigationCase(info), captured = ownedDesktopResources(info); let closed = false;
    /** 原owner及原期限每步复核，失败只保留本例现场，不接管其它原生窗口。 */
    const own = () => { activity.check(); const now = ownedDesktopResources(info); if (now.application !== captured.application || now.page !== captured.page || !closed && now.closed) { activity.retain(); throw Error('字段顺序本例owner变化'); } };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { own(); try { const value = await action(); own(); return value; } catch (reason) { activity.retain(); throw reason; } };
    try {
      if (trace !== 'off' || process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_TABLE_CREATE_COLUMN_ORDER_UI !== '1') throw Error('字段顺序双门未明确');
      assertDefaultEncodingLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
      if (process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS !== '0' || !/^dbark_e2e_column_order_[a-f0-9]{32}$/.test(process.env.DBARK_TEST_DATABASE ?? '')) throw Error('字段顺序目标不准确');
      const page = captured.page, database = process.env.DBARK_TEST_DATABASE!, name = 'column_order_' + randomUUID().replaceAll('-', ''), connectionName = '字段顺序 ' + name;
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click()); const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
      for (const [label,value] of [['连接名称',connectionName],['主机地址',process.env.DBARK_TEST_HOST!],['端口',process.env.DBARK_TEST_PORT!],['用户名',process.env.DBARK_TEST_USER!],['数据库密码',process.env.DBARK_TEST_PASSWORD ?? '']]) await step(() => connection.getByLabel(label,{exact:true}).fill(value));
      await step(() => connection.getByRole('button',{name:'测试连接',exact:true}).click()); await step(() => expect(connection.locator('.success-box')).toContainText('连接成功')); await step(() => connection.getByRole('button',{name:'保存连接',exact:true}).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list',{}))), profile = profiles.find(value => value.name === connectionName); if (!profile) throw Error('本例连接配置未确认');
      const session = await step(() => page.evaluate(value => window.dbark.invoke('sessions.open',value),{connectionId:profile.id,database}));
      /** 实际目录观察只走应用受管会话，不创建裸驱动或读取旧认证文件。 */
      const read = (sql:string):Promise<QueryOutcome> => step(() => page.evaluate(value => window.dbark.invoke('query.execute',value),{sessionId:session.sessionId,sql,taskId:randomUUID(),maxRows:100}));
      const facts = (await read('SELECT @@version AS version,@@server_uuid AS uuid')).results[0]; expect(facts.truncated).toBe(false); expect(facts.rows).toHaveLength(1); expect(String(facts.rows[0].version)).toMatch(/^8\.4\.11(?:[-+][^\s]+)?$/); expect(facts.rows[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const baseline = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list',{}))), known = new Set(baseline.map(value=>value.id));
      const node = page.locator('.connection-node').filter({has:page.getByRole('button',{name:connectionName,exact:true})}); await step(() => node.getByRole('button',{name:connectionName,exact:true}).click()); const row=node.locator('.database-row').filter({has:page.getByRole('button',{name:database,exact:true})}); await step(() => row.getByRole('button',{name:database,exact:true}).click()); await step(() => expect(row.getByRole('button',{name:database,exact:true})).toHaveAttribute('aria-expanded','true')); await step(() => row.getByRole('button',{name:database,exact:true}).focus()); await step(() => row.getByRole('button',{name:zh.sidebar.text017,exact:true}).click());
      const form=page.getByRole('dialog',{name:`创建表 · ${database}`,exact:true}); await step(() => form.getByLabel('表名称',{exact:true}).fill(name));
      for (const [position,column] of [[2,'a'],[3,'b']] as const) { await step(() => form.getByRole('button',{name:zh.schema.text027,exact:true}).click()); await step(() => form.getByLabel(formatText(zh.schema.text018,position),{exact:true}).fill(column)); await step(() => form.getByLabel(formatText(zh.schema.text019,position),{exact:true}).fill('varchar(64)')); }
      await step(() => form.getByLabel(formatText(zh.schema.emptyStringDefaultLabel,2),{exact:true}).check()); await step(() => form.getByLabel(formatText(zh.schema.text024,2),{exact:true}).fill('重排保留空串')); await step(() => form.getByLabel(formatText(zh.schema.text022,3),{exact:true}).fill('NULL'));
      await step(() => expect(form.getByRole('button',{name:order.upLabel(1),exact:true})).toBeDisabled()); await step(() => expect(form.getByRole('button',{name:order.downLabel(3),exact:true})).toBeDisabled());
      await step(() => form.getByRole('button',{name:order.upLabel(3),exact:true}).click()); await step(() => form.getByRole('button',{name:order.downLabel(2),exact:true}).click()); await step(() => form.getByRole('button',{name:order.upLabel(3),exact:true}).click());
      await step(() => expect(form.getByLabel(formatText(zh.schema.text018,2),{exact:true})).toHaveValue('b')); await step(() => expect(form.getByLabel(formatText(zh.schema.text018,3),{exact:true})).toHaveValue('a')); await step(() => form.getByRole('button',{name:zh.schema.text049,exact:true}).click());
      const confirmation=page.getByRole('dialog',{name:text.title,exact:true}), shown=await step(() => confirmation.locator('.monaco-editor .view-lines').innerText()); expect(shown.indexOf('`id`')).toBeLessThan(shown.indexOf('`b`')); expect(shown.indexOf('`b`')).toBeLessThan(shown.indexOf('`a`'));
      const absent=(await read(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}'`)).results[0]; expect(absent.truncated).toBe(false); expect(absent.rows).toHaveLength(0);
      const prepared=await step(() => page.evaluate(() => window.dbark.invoke('tasks.list',{}))); expect(prepared.filter(value=>!known.has(value.id)&&['schema.apply','schema.tableCreate.apply'].includes(value.kind))).toHaveLength(0);
      await step(() => confirmation.getByLabel(text.confirmation,{exact:true}).fill(database+'.'+name)); for(const label of [text.ackDdl,text.ackCreate])await step(() => confirmation.getByRole('checkbox',{name:label,exact:true}).check()); await step(() => confirmation.getByRole('button',{name:text.apply,exact:true}).dblclick()); await step(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded,{timeout:20000}));
      const columns=(await read(`SELECT COLUMN_NAME AS name,COLUMN_DEFAULT AS defaultValue,COLUMN_COMMENT AS comment,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}' ORDER BY ORDINAL_POSITION`)).results[0]; expect(columns.truncated).toBe(false); expect(columns.rows.map(value=>value.name)).toEqual(['id','b','a']); expect(columns.rows[2]).toMatchObject({defaultValue:'',comment:'重排保留空串'}); expect(columns.rows[1].defaultValue).toBeNull(); expect(String(columns.rows[0].extra)).toContain('auto_increment');
      const indexes=(await read(`SELECT INDEX_NAME AS name,COLUMN_NAME AS col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}' ORDER BY INDEX_NAME,SEQ_IN_INDEX`)).results[0]; expect(indexes.truncated).toBe(false); expect(indexes.rows).toEqual([{name:'PRIMARY',col:'id'}]);
      const ddl=await step(() => page.evaluate(value=>window.dbark.invoke('metadata.ddl',value),{connectionId:profile.id,database,name,kind:'table' as const})); expect(ddl.indexOf('`id`')).toBeLessThan(ddl.indexOf('`b`')); expect(ddl.indexOf('`b`')).toBeLessThan(ddl.indexOf('`a`'));
      const completed=await step(() => page.evaluate(() => window.dbark.invoke('tasks.list',{}))), sent=completed.filter(value=>!known.has(value.id)&&value.kind==='schema.tableCreate.apply'); expect(sent).toHaveLength(1); expect(sent[0].status).toBe('completed'); expect(completed.filter(value=>!known.has(value.id)&&value.kind==='schema.apply')).toHaveLength(0);
      await step(() => page.evaluate(value=>window.dbark.invoke('sessions.close',value),{sessionId:session.sessionId})); await step(() => confirmation.getByRole('button',{name:text.close,exact:true}).click()); own(); await confirmOwnedDesktopExit(info); closed=true; own(); console.info(JSON.stringify({字段顺序备用实际:true,database,table:name,保留供Root复核:true}));
    } catch(reason) { activity.retain(); throw reason; } finally { activity.active=false; }
  });
}
