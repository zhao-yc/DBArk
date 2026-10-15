import type{RowDataPacket}from'mysql2/promise';
import{test,expect,page,desktop,pageErrors}from'./desktop-fixture';
import{enabled,isolatedDatabase,openDatabaseQuery,modifier}from'./live-helpers';

test.use({trace:'off'});
const query=()=>page.locator('.query-tab:visible');
/** 核对保存草稿里的完整SQL，避免只比较Monaco当前视口。 */
async function expectSql(source:string){await expect.poll(()=>page.evaluate(async()=>{const settings=await window.dbark.invoke('settings.get',{});return settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql?.replaceAll('\r\n','\n');})).toBe(source);}
/** 通过真实剪贴板和键盘设置光标，并恢复用户原剪贴板。 */
async function atCaret(marked:string){const offset=marked.indexOf('|');if(offset<0)throw Error('缺少光标标记');const source=marked.replace('|',''),previous=await desktop.evaluate(({clipboard})=>clipboard.readText());try{await page.keyboard.press('Escape');await desktop.evaluate(({clipboard},value)=>clipboard.writeText(value),source);await query().locator('.monaco-editor').getByRole('textbox').focus();await page.keyboard.press(`${modifier}+A`);await page.keyboard.press(`${modifier}+V`);await expectSql(source);await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowLeft':'Control+Home');for(let index=0;index<offset;index++)await page.keyboard.press('ArrowRight');}finally{await desktop.evaluate(({clipboard},value)=>clipboard.writeText(value),previous);}return source;}
/** 等待真实Worker及Monaco候选后按Enter接受，不直接调用编辑器模型。 */
async function choose(label:string){await page.keyboard.press('Control+Space');const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText(label,{timeout:13000});await page.keyboard.press('Enter');await expect(widget).toHaveCount(0);}
/** 离线连接固定使用不可连接端口；本地CTE投影不依赖数据库目录。 */
async function offlineQuery(){await page.locator('.app-commandbar').getByRole('button',{name:'新建连接',exact:true}).click();const modal=page.getByRole('dialog',{name:'新建连接',exact:true});await modal.getByLabel('连接名称',{exact:true}).fill('窗口补全离线验收');await modal.getByLabel('主机地址',{exact:true}).fill('127.0.0.1');await modal.getByLabel('端口',{exact:true}).fill('1');await modal.getByLabel('用户名',{exact:true}).fill('offline');await modal.getByRole('button',{name:'保存连接',exact:true}).click();await page.locator('.app-commandbar').getByRole('button',{name:'新建查询',exact:true}).click();await page.getByRole('dialog',{name:'新建查询',exact:true}).getByRole('button',{name:'打开查询',exact:true}).click();await expect(query().locator('.monaco-editor')).toBeVisible();}

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
  await page.keyboard.press('Control+Space');const widget=page.locator('.suggest-widget.visible');await expect(widget.locator('.monaco-list-row.focused')).toContainText('value_column',{timeout:13000});await expect(widget).not.toContainText('value_illegal');await page.keyboard.press('Enter');await expectSql(marked.replace('val|suffix','`q`.`value_column`'));await page.keyboard.press(`${modifier}+Z`);await expectSql(original);
  await atCaret('WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY value_o|suffix');await choose('value_output');await expectSql('WITH q AS(SELECT 1 AS value_column) SELECT q.value_column AS value_output,ROW_NUMBER() OVER w FROM q WINDOW w AS(ORDER BY q.value_column) ORDER BY `value_output`');
  expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual({tasks:[],history:[]});expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('offline-window-alias-isolation.png')});
});

test.describe('200隔离实库：窗口字段接受后执行',()=>{
  test.skip(!enabled,'需要统筹显式启用200隔离数据库');
  test('按服务器能力验证OVER和命名WINDOW，MySQL5.7明确跳过',async({},info)=>{
    test.setTimeout(150000);await isolatedDatabase(async({observer,database})=>{
      const[rows]=await observer.query<RowDataPacket[]>('SELECT VERSION() AS version'),version=String(rows[0].version),maria=/MariaDB/i.test(version),parts=(maria?version.replace(/^5\.5\.5-/,''):version).match(/^(\d+)\.(\d+)/);
      test.skip(!parts||!(maria?Number(parts[1])>10||Number(parts[1])===10&&Number(parts[2])>=2:Number(parts[1])>=8),'服务器版本不支持本窗口切片；MySQL5.7保留无窗口能力边界');
      await observer.query(`CREATE TABLE \`${database}\`.window_subject(id INT,category INT,amount INT)`);await observer.query(`INSERT INTO \`${database}\`.window_subject VALUES(1,1,20),(2,1,10),(3,2,30)`);await openDatabaseQuery(database);
      for(const[marked,label,expected,column,values]of[
        ['SELECT s.id,ROW_NUMBER() OVER(PARTITION BY s.cat|suffix ORDER BY s.id) AS ranking FROM window_subject s ORDER BY s.id','category','SELECT s.id,ROW_NUMBER() OVER(PARTITION BY s.`category` ORDER BY s.id) AS ranking FROM window_subject s ORDER BY s.id',3,['1','2','1']],
        ['SELECT s.id,ROW_NUMBER() OVER(ORDER BY amo|suffix) AS ranking FROM window_subject s ORDER BY s.id','amount','SELECT s.id,ROW_NUMBER() OVER(ORDER BY `s`.`amount`) AS ranking FROM window_subject s ORDER BY s.id',3,['2','1','3']],
        ['SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(PARTITION BY cat|suffix ORDER BY s.id) ORDER BY s.id','category','SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(PARTITION BY `s`.`category` ORDER BY s.id) ORDER BY s.id',3,['1','2','1']],
        ['SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(ORDER BY s.amo|suffix) ORDER BY s.id','amount','SELECT s.id,ROW_NUMBER() OVER w AS ranking FROM window_subject s WINDOW w AS(ORDER BY s.`amount`) ORDER BY s.id',3,['2','1','3']],
        ['SELECT s.id,s.amount AS amount_output FROM window_subject s ORDER BY SUM(s.amount) OVER(ORDER BY amo|suffix)','amount','SELECT s.id,s.amount AS amount_output FROM window_subject s ORDER BY SUM(s.amount) OVER(ORDER BY `s`.`amount`)',2,['2','1','3']],
      ]as const){
        const before=await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}));await atCaret(marked);await choose(label);await expectSql(expected);expect(await page.evaluate(async()=>({tasks:await window.dbark.invoke('tasks.list',{}),history:await window.dbark.invoke('history.list',{})}))).toEqual(before);
        // 执行补全后保留的真实模型，不能重新填入预期SQL替代产品结果。
        await query().getByRole('button',{name:'执行全部',exact:true}).click();await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled({timeout:20000});await expect(query().locator('.error-box')).toHaveCount(0);await expect(query().locator(`.result-body [role="gridcell"][aria-colindex="${column}"]`)).toHaveText([...values]);
      }
      expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('live-window-completion.png')});
    },info);
  });
});
