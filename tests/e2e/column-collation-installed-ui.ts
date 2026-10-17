import { expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { zh } from '../../src/renderer/locales/zh-CN';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import type { ColumnCollationInstalledBinding } from '../helpers/columnCollationInstalledUi';
import type * as Desktop from './desktop-fixture';

/** 名称可能带Field说明；所有select按角色前缀核唯一数量，不借相邻label定位。 */
const prefix = (value: string) => new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'));

/** 只有入口双门和本轮准确配置通过才加载原strict owner；不导入driver或清库帮助器。 */
export function registerColumnCollationInstalledUi(binding: ColumnCollationInstalledBinding) {
  binding.assertCurrent();
  const runtime = require('./desktop-fixture') as typeof Desktop, test = runtime.test;
  let completed: { directory: string; kind: 'char'|'varchar'; normalExitConfirmed: true; applicationDefinitionVerified: true } | undefined;
  test.use({ preserveOnUnconfirmedExit:true, trace:'off', screenshot:'off', video:'off' });
  test.describe.configure({ mode:'serial', timeout:120000, retries:0 });

  test(`Windows安装产物单身份${binding.target.kind.toUpperCase()}列排序规则四风险确认、单次执行和定义后核`,async({trace,screenshot,video},info)=>{
    const captured=runtime.ownedDesktopResources(info),page=captured.page,directory=runtime.dataDir,target=binding.target;
    let stopped=false;
    /** 每步核原TestInfo、原App/页面和固定身份；失败后绝不转向另一类型或下一实例。 */
    function check(allowClosed=false){
      try{binding.assertCurrent();const current=runtime.ownedDesktopResources(info);if(stopped||info.status!=='passed'||info.timeout!==120000||info.retry!==0||info.repeatEachIndex!==0||current.page!==page||current.application!==captured.application||!allowClosed&&current.closed)throw Error('列排序规则安装验收原owner已失效或执行策略变化');}
      catch(reason){stopped=true;runtime.retainOwnedDesktopResources(info);throw reason;}
    }
    /** 只保留原错误与现场，不在finally退出、清库、强停或重启。 */
    async function step<T>(action:()=>Promise<T>):Promise<T>{check();try{const value=await action();check();return value;}catch(reason){stopped=true;runtime.retainOwnedDesktopResources(info);throw reason;}}
    // 只读合法IPC仅核目标归属、history和任务；业务修改全部由真实UI发起。
    const settings=()=>step(()=>page.evaluate(()=>window.dbark.invoke('settings.get',{})));
    const history=()=>step(()=>page.evaluate(()=>window.dbark.invoke('history.list',{})));
    const tasks=()=>step(()=>page.evaluate(()=>window.dbark.invoke('tasks.list',{})));
    const dialog=()=>page.getByRole('dialog',{name:text.title,exact:true});
    const payload=()=>dialog().getByRole('button',{name:new RegExp('^payload · '+target.kind.toUpperCase()+'\\([1-9][0-9]*\\)$','i')});
    try{
      check();expect(trace).toBe('off');expect(screenshot).toBe('off');expect(video).toBe('off');
      const name=`列排序规则-${target.kind}-${target.marker}`;
      expect(await history()).toEqual([]);await step(()=>expect(page.locator('.tab-strip .tab-select')).toHaveCount(0));
      await step(()=>page.locator('.app-commandbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click());
      const connection=page.getByRole('dialog',{name:zh.common.newConnection,exact:true}),dialect=connection.getByRole('combobox',{name:prefix(zh.connections.text008)});
      await step(()=>expect(dialect).toHaveCount(1));await step(()=>dialect.selectOption('mysql'));await step(()=>expect(dialect).toHaveValue('mysql'));
      await step(()=>connection.getByLabel(zh.connections.text006,{exact:true}).fill(name));
      await step(()=>connection.getByLabel(zh.connections.text009,{exact:true}).fill(target.host));
      await step(()=>connection.getByLabel(zh.connections.text010,{exact:true}).fill(String(target.port)));
      await step(()=>connection.getByLabel(zh.common.user,{exact:true}).fill(target.user));
      await step(()=>connection.getByLabel(zh.connections.text011,{exact:true}).fill(target.password));
      await step(()=>connection.getByLabel(zh.connections.text012,{exact:true}).fill(target.database));
      const remember=connection.getByRole('checkbox',{name:zh.connections.text016,exact:true});await step(()=>remember.uncheck());await step(()=>expect(remember).not.toBeChecked());
      // 不点测试连接，不导入SSH或证书；密码只供本轮内存使用，明确不保存密码。
      await step(()=>connection.getByRole('button',{name:zh.connections.text036,exact:true}).click());await step(()=>expect(connection).toBeHidden());
      const profiles=await step(()=>page.evaluate(()=>window.dbark.invoke('connections.list',{})));expect(profiles).toHaveLength(1);const profile=profiles[0];
      expect(profile).toMatchObject({name,host:target.host,port:target.port,dialect:'mysql',user:target.user,database:target.database,rememberPassword:false});expect(profile.id).toBeTruthy();expect(profile.ssh?.enabled??false).toBe(false);expect(profile.tls?.enabled??false).toBe(false);

      // 真实对象树进入实际表页，再从表页工具栏进入字段差异，不直接请求schema.columns.apply。
      const node=page.locator('.connection-node').filter({has:page.locator('.connection-row').getByRole('button',{name,exact:true})});await step(()=>expect(node).toHaveCount(1));
      await step(()=>node.locator('.connection-row').getByRole('button',{name,exact:true}).click());
      await step(()=>node.locator('.database-row').getByRole('button',{name:target.database,exact:true}).click());
      const object=node.locator('.object-row').getByRole('button',{name:target.table,exact:true});await step(()=>expect(object).toHaveCount(1));await step(()=>object.click());
      await step(()=>expect(page.locator('.table-tab:visible .loading-overlay')).toHaveCount(0));
      await step(()=>expect.poll(async()=>{const value=await settings();const tab=value.tabs.find(item=>item.id===value.activeTabId);return tab?{kind:tab.kind,connectionId:tab.connectionId,database:tab.database,table:tab.table}:undefined;}).toEqual({kind:'table',connectionId:profile.id,database:target.database,table:target.table}));
      const table=page.locator('.table-tab:visible');await step(()=>table.getByRole('button',{name:text.title,exact:true}).click());
      await step(()=>expect(payload()).toHaveCount(1));await step(()=>expect(payload()).toBeEnabled());await step(()=>expect(dialog()).toContainText(/mysql\s+8\.4\.11\b(?:[-+][^\s]+)?/i));
      const typeLabel=await step(()=>payload().textContent());expect(typeLabel).toBeTruthy();await step(()=>payload().click());
      await step(()=>expect(dialog().getByText(`${text.collationCurrent}：${target.before.charset} / ${target.before.collation}`,{exact:true})).toBeVisible());
      const original=dialog().getByLabel(text.original,{exact:true}),originalDefinition=await step(()=>original.textContent());expect(originalDefinition).toBeTruthy();
      const modify=dialog().getByRole('checkbox',{name:text.modify+' '+text.collation,exact:true});await step(()=>expect(modify).toBeEnabled());await step(()=>modify.check());
      const select=dialog().getByRole('combobox',{name:prefix(text.collationChoose)});await step(()=>expect(select).toHaveCount(1));await step(()=>expect(select).toBeEnabled());
      await step(()=>expect(select.getByRole('option',{name:target.after.collation,exact:true})).toHaveCount(1));await step(()=>select.selectOption(target.after.collation));await step(()=>expect(select).toHaveValue(target.after.collation));
      for(const label of [text.name,text.type,text.nullable,text.default,text.comment,text.position,text.onUpdate]){const other=dialog().getByRole('checkbox',{name:text.modify+' '+label,exact:true});await step(()=>expect(other).not.toBeChecked());await step(()=>expect(other).toBeDisabled());}
      await step(()=>dialog().getByRole('button',{name:text.rowSave,exact:true}).click());
      expect((await tasks()).filter(task=>task.kind==='schema.columns.apply')).toHaveLength(0);
      await step(()=>dialog().getByRole('button',{name:text.preview,exact:true}).click());
      const sql=dialog().locator('.monaco-editor .view-lines');await step(()=>expect(sql).toContainText('ALTER TABLE'));await step(()=>expect(sql).toContainText('MODIFY COLUMN'));await step(()=>expect(sql).toContainText('`'+target.database+'`'));await step(()=>expect(sql).toContainText('`'+target.table+'`'));await step(()=>expect(sql).toContainText('`payload`'));await step(()=>expect(sql).toContainText(target.after.collation));
      // 只核真实展示的计划形状，不把DOM文本当作完整SQL字节或数据库后核证明。
      const shown=(await step(()=>sql.textContent()))??'';expect(shown).toMatch(new RegExp('\\b'+target.kind.toUpperCase()+'\\s*\\(','i'));expect((shown.match(/MODIFY\s+COLUMN/gi)??[])).toHaveLength(1);
      const acks=dialog().getByLabel(text.confirmation,{exact:true});await step(()=>expect(acks.getByRole('checkbox')).toHaveCount(4));
      const apply=dialog().getByRole('button',{name:text.apply,exact:true});await step(()=>expect(apply).toBeDisabled());
      for(const label of [text.ackImplicit,text.ackWindow,text.ackCollationSemantics])await step(()=>acks.getByRole('checkbox',{name:label,exact:true}).check());
      await step(()=>expect(apply).toBeDisabled());expect((await tasks()).filter(task=>task.kind==='schema.columns.apply')).toHaveLength(0);
      await step(()=>acks.getByRole('checkbox',{name:text.ackCollationAlgorithm,exact:true}).check());await step(()=>expect(apply).toBeEnabled());
      await step(()=>apply.click()); // 本身份唯一一次apply真实点击，不重放、不试第三路径。
      await step(()=>expect(dialog().getByRole('status')).toHaveText(text.succeeded,{timeout:30000}));
      await step(()=>expect.poll(async()=>{const values=(await tasks()).filter(task=>task.kind==='schema.columns.apply');return values.map(task=>task.status);}).toEqual(['completed']));
      await step(()=>expect(apply).toBeDisabled());await step(()=>expect(dialog()).toContainText(text.consumed));
      await step(()=>dialog().getByRole('button',{name:text.read,exact:true}).click());await step(()=>expect(payload()).toBeEnabled());expect(await step(()=>payload().textContent())).toBe(typeLabel);await step(()=>payload().click());
      await step(()=>expect(dialog().getByText(`${text.collationCurrent}：${target.after.charset} / ${target.after.collation}`,{exact:true})).toBeVisible());
      await step(()=>expect(dialog().getByLabel(text.original,{exact:true})).toContainText(target.after.collation));await step(()=>expect(dialog().getByRole('checkbox',{name:text.modify+' '+text.collation,exact:true})).not.toBeChecked());
      await step(()=>dialog().getByRole('button',{name:text.rowSave,exact:true}).click());await step(()=>expect(dialog().getByRole('button',{name:text.preview,exact:true})).toBeDisabled());
      await step(()=>dialog().getByRole('button',{name:text.close,exact:true}).click());await step(()=>expect(dialog()).toHaveCount(0));
      const finalTasks=await tasks();expect(finalTasks.filter(task=>task.kind==='schema.columns.apply')).toHaveLength(1);expect(finalTasks.filter(task=>task.kind==='schema.columns.preview')).toHaveLength(1);expect(finalTasks.filter(task=>task.kind.startsWith('schema.columns.')).every(task=>task.status==='completed')).toBe(true);expect(finalTasks.some(task=>task.status==='running')).toBe(false);expect(await history()).toEqual([]);expect(runtime.pageErrors).toEqual([]);
      check();await runtime.confirmOwnedDesktopExit(info);check(true);expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      completed={directory,kind:target.kind,normalExitConfirmed:true,applicationDefinitionVerified:true};
    }catch(reason){stopped=true;runtime.retainOwnedDesktopResources(info);await info.attach('列排序规则安装保留现场',{body:Buffer.from(JSON.stringify({directory,kind:target.kind,automaticRetry:false,automaticNextIdentity:false,automaticRestart:false,automaticForceStop:false,databaseCleanupBySpec:false,directoryRemoved:false})),contentType:'application/json'});throw reason;}
  });

  /** 原strict owner已确认正常退出与所属PID消失，之后只读确认其临时配置目录清除。 */
  test.afterAll(async({},info)=>{
    if(!completed)return;let missing=false;try{await stat(completed.directory);}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw reason;}
    expect(missing,'strict owner收尾后临时配置目录应已由原夹具清除').toBe(true);
    await info.attach('列排序规则安装UI终态',{body:Buffer.from(JSON.stringify({...completed,directoryRemoved:true,launches:1,explicitApplyClicks:1,userSqlHistory:0,rootOwnsExactDatabaseBeforeAfterCleanup:true,systemClipboard:0,databaseCleanupBySpec:false,fullDatabaseAcceptance:false})),contentType:'application/json'});
  });
}
