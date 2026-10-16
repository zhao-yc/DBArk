import {positionMonacoCaret,observeMonacoCaret,triggerMonacoCompletion,remainingCompletionTimeout} from './monaco-caret';
import type{RowDataPacket}from'mysql2/promise';
import{test,expect,page,desktop,pageErrors}from'./desktop-fixture';
import{enabled,isolatedDatabase,openDatabaseQuery,modifier}from'./live-helpers';

test.use({trace:'off'});
// 空工作台启用官方公开API，捕获真实按键时的当前编辑器位置。
test.beforeEach(observeMonacoCaret);
const query=()=>page.locator('.query-tab:visible');
/** 核对保存草稿里的完整SQL，避免只比较Monaco当前视口。 */
async function expectSql(source:string){await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');})).toBe(source);}
/** 通过原生输入和键盘移动定位，剪贴板只读核对。 */
let expectedCaret='';
/** 原marked保留为独立断言输入，不使用帮助器返回值推导实际光标期望。 */
async function atCaret(marked:string){expectedCaret=marked;return positionMonacoCaret(marked);}
/** 只触发一次，在原生按键捕获阶段核对当前全文和UTF16光标位置。 */
async function triggerCompletion(){await triggerMonacoCompletion(expectedCaret);}
/** 等待真实Worker及Monaco候选后按Enter接受，不直接调用编辑器模型。 */
async function choose(label:string){await triggerCompletion();const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText(label,{timeout:remainingCompletionTimeout()});await page.keyboard.press('Enter');await expect(widget).toHaveCount(0);}
/** 离线连接固定使用不可连接端口；本地CTE投影不依赖数据库目录。 */
async function offlineQuery(){await page.locator('.app-commandbar').getByRole('button',{name:'新建连接',exact:true}).click();const modal=page.getByRole('dialog',{name:'新建连接',exact:true});await modal.getByLabel('连接名称',{exact:true}).fill('窗口补全离线验收');await modal.getByLabel('主机地址',{exact:true}).fill('127.0.0.1');await modal.getByLabel('端口',{exact:true}).fill('1');await modal.getByLabel('用户名',{exact:true}).fill('offline');await modal.getByRole('button',{name:'保存连接',exact:true}).click();await page.locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();await page.getByRole('dialog',{name:'新建查询',exact:true}).getByRole('button',{name:'打开查询',exact:true}).click();await expect(query().locator('.monaco-editor')).toBeVisible();}
/** 实际执行可能使物理来源进入待核对；只通过真实会话读取入口确认本例表。 */
async function confirmWindowSource(database:string){await query().getByRole('button',{name:'会话临时对象',exact:true}).click();const modal=page.getByRole('dialog',{name:'当前查询会话的临时对象',exact:true});await modal.getByLabel('数据库名称',{exact:true}).fill(database);await modal.getByLabel('表或视图名称',{exact:true}).fill('window_subject');await modal.getByRole('button',{name:'读取会话结构',exact:true}).click();await expect(modal.locator('.success-box')).toContainText('该名称当前不是临时表',{timeout:20000});await modal.getByRole('button',{name:'关闭',exact:true}).click();}

test('离线窗口字段：OVER与命名WINDOW通过真实Monaco接受和撤销',async({},info)=>{
  test.setTimeout(90000);await offlineQuery();
  for(const[marked,expected]of[
    ['WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(PARTITION BY q.val|suffix) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(PARTITION BY q.`value_column`) FROM q'],
    ['WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY val|suffix) FROM q','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY `q`.`value_column`) FROM q'],
    ['WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(PARTITION BY q.val|suffix)','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(PARTITION BY q.`value_column`)'],
    ['WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY val|suffix)','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY `q`.`value_column`)'],
  ]){const original=await atCaret(marked);await choose('value_column');await expectSql(expected);await page.keyboard.press(`${modifier}+Z`);await expectSql(original);}
  expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual({tasks:[],history:[]});expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('offline-window-fields.png')});
});

test('离线窗口隔离：外层ORDER不泄露输出别名，窗口结束后仍可补全别名',async({},info)=>{
  test.setTimeout(90000);await offlineQuery();
  const marked='WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_illegal FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY val|suffix)',original=await atCaret(marked);
  await triggerCompletion();const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText('value_column',{timeout:remainingCompletionTimeout()});await expect(widget).not.toContainText('value_illegal');await page.keyboard.press('Enter');await expectSql(marked.replace('val|suffix','`q`.`value_column`'));await page.keyboard.press(`${modifier}+Z`);await expectSql(original);
  await atCaret('WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY value_o|suffix');await choose('value_output');await expectSql('WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY `value_output`');
  expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual({tasks:[],history:[]});expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('offline-window-alias-isolation.png')});
});

test('离线集合和帧边界：实际Worker停止，合法分支窗口仍可接受和撤销',async({},info)=>{
  test.setTimeout(120000);
  // 仅旁观真实Worker的有界请求位置及返回状态，不替换解析、超时、取消或返回值。
  await page.evaluate(()=>{
    const observed=window as unknown as{__windowReplies:{length:number;offset:number;status:string}[]};observed.__windowReplies=[];const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);const requests=new Map<number,{length:number;offset:number}>(),post=this.postMessage.bind(this);this.postMessage=(value:any,options?:any)=>{if(Number.isInteger(value?.id)&&typeof value?.source==='string')requests.set(value.id,{length:value.source.length,offset:value.offset});post(value,options);};this.addEventListener('message',event=>{const request=requests.get(event.data?.id);if(request&&event.data?.result?.status){observed.__windowReplies.push({...request,status:event.data.result.status});requests.delete(event.data.id);}});}
    };
  });
  await offlineQuery();
  for(const marked of[
    'WITH a AS(SELECT 1 AS first_value),b AS(SELECT 2 AS later_value) SELECT a.first_value FROM a UNION ALL SELECT b.later_value FROM b ORDER BY SUM(first_value) OVER(ORDER BY lat|suffix)',
    'WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.value_column ROWS BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW) FROM q',
    'WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column RANGE BETWEEN UNBOUNDED PRECEDING AND CUR|RENT ROW)',
  ]){
    const original=await atCaret(marked);await page.evaluate(()=>{(window as unknown as{__windowReplies:unknown[]}).__windowReplies=[];});await triggerCompletion();
    await expect.poll(()=>page.evaluate(({length,offset})=>(window as unknown as{__windowReplies:{length:number;offset:number;status:string}[]}).__windowReplies.some(value=>value.length===length&&value.offset===offset&&value.status==='blocked'),{length:original.length,offset:marked.indexOf('|')}),{timeout:remainingCompletionTimeout()}).toBe(true);
    // Monaco可保留“无建议”空面板；断言实际候选行为，而非强制整个面板消失。
    await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0);await expectSql(original);
  }
  for(const[marked,label,expected]of[
    ['WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY q.val|suffix) FROM q','value_column','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL SELECT ROW_NUMBER() OVER(ORDER BY q.`value_column`) FROM q'],
    ['WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL (SELECT q.value_column FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY q.val|suffix) LIMIT 1)','value_column','WITH q AS(SELECT 1 AS value_column) SELECT 1 UNION ALL (SELECT q.value_column FROM q ORDER BY SUM(q.value_column) OVER(ORDER BY q.`value_column`) LIMIT 1)'],
    ['WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.val|suffix ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM q','value_column','WITH q AS(SELECT 1 AS value_column) SELECT ROW_NUMBER() OVER(ORDER BY q.`value_column` ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM q'],
  ]){const original=await atCaret(marked);await choose(label);await expectSql(expected);await page.keyboard.press(`${modifier}+Z`);await expectSql(original);}
  expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual({tasks:[],history:[]});expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('offline-window-union-frame-boundaries.png')});
});

test.describe('200隔离实库：窗口字段接受后执行',()=>{
  test.skip(!enabled,'需要统筹显式启用200隔离数据库');
  test('按服务器能力验证OVER和命名WINDOW，MySQL5.7明确跳过',async({},info)=>{
    test.setTimeout(150000);await isolatedDatabase(async({observer,database})=>{
      const[rows]=await observer.query<RowDataPacket[]>('SELECT VERSION() AS version'),version=String(rows[0].version),maria=/MariaDB/i.test(version),parts=(maria?version.replace(/^5\.5\.5-/,''):version).match(/^(\d+)\.(\d+)/);
      test.skip(!parts||!(maria?Number(parts[1])>10||Number(parts[1])===10&&Number(parts[2])>=2:Number(parts[1])>=8),'服务器版本不支持本窗口切片；MySQL5.7保留无窗口能力边界');
      await observer.query(`CREATE TABLE \`${database}\`.window_subject(id INT,category INT,amount INT)`);await observer.query(`INSERT INTO \`${database}\`.window_subject VALUES(1,1,20),(2,1,10),(3,2,30)`);await openDatabaseQuery(database);
      let completed=0;
      for(const[marked,label,expected,column,values]of[
        ['SELECT s.id,ROW_NUMBER() OVER(PARTITION BY s.cat|suffix ORDER BY s.id) AS ranking FROM window_subject s ORDER BY s.id','category','SELECT s.id,ROW_NUMBER() OVER(PARTITION BY s.`category` ORDER BY s.id) AS ranking FROM window_subject s ORDER BY s.id',3,['1','2','1']],
        ['SELECT s.id,ROW_NUMBER() OVER(ORDER BY amo|suffix) AS ranking FROM window_subject s ORDER BY s.id','amount','SELECT s.id,ROW_NUMBER() OVER(ORDER BY `s`.`amount`) AS ranking FROM window_subject s ORDER BY s.id',3,['2','1','3']],
        ['SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(PARTITION BY cat|suffix ORDER BY s.id) ORDER BY s.id','category','SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(PARTITION BY `s`.`category` ORDER BY s.id) ORDER BY s.id',3,['1','2','1']],
        ['SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(ORDER BY s.amo|suffix) ORDER BY s.id','amount','SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(ORDER BY s.`amount`) ORDER BY s.id',3,['2','1','3']],
        ['SELECT s.id,s.amount AS amount_output FROM window_subject s ORDER BY SUM(s.amount) OVER(ORDER BY amo|suffix)','amount','SELECT s.id,s.amount AS amount_output FROM window_subject s ORDER BY SUM(s.amount) OVER(ORDER BY `s`.`amount`)',2,['2','1','3']],
      ]as const){
        let phase='会话来源核验';
        try{
          if(completed)await confirmWindowSource(database);
          phase='接受补全';
          const before=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));await atCaret(marked);await choose(label);await expectSql(expected);expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual(before);
          // 执行补全后保留的真实模型，不能重新填入预期SQL替代产品结果。
          phase='执行接受后的SQL';
          await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled({timeout:20000});await expect(query().locator('.error-box')).toHaveCount(0);await expect(query().locator(`.result-body [role="gridcell"][aria-colindex="${column}"]`)).toHaveText([...values]);
          completed++;
        }catch(reason){
          // 仅记录本例公开测试SQL与可见状态，不采集连接配置、凭据或其它标签内容。
          try{const visible=await page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql;});await info.attach('窗口执行步骤-'+(completed+1),{body:JSON.stringify({step:completed+1,phase,label,markedSql:marked,expectedSql:expected,actualSql:visible,database:await query().getByLabel('当前查询默认库',{exact:true}).allTextContents(),completionStatus:await query().getByLabel('SQL 补全状态',{exact:true}).allTextContents()}),contentType:'application/json'});}catch{/* 取证失败不能覆盖原始断言。 */}
          throw reason;
        }
      }
      expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('live-window-completion.png')});
    },info);
  });
});
