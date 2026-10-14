import { recordJsonStructureInputZh as structureText } from '../../src/renderer/locales/recordJsonStructureInput.zh-CN';
import type { RecordStructureKind } from '../../src/renderer/recordJsonStructureInput';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as treeText } from '../../src/renderer/locales/recordProjections.zh-CN';
import { recordDocumentZh as documentText } from '../../src/renderer/locales/recordDocument.zh-CN';
import { recordJsonNodeInputZh as text } from '../../src/renderer/locales/recordJsonNodeInput.zh-CN';
import { test, expect, page, desktop, closed, answerDialogs, requestQuit } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 只连接200隔离测试实例；认证不进入跟踪或测试附件，不新增权限用户。
test.use({trace:'off'});
const table=()=>page.locator('.table-tab:visible');
const panel=()=>table().getByRole('complementary',{name:formText.title,exact:true});
const tree=()=>panel().getByRole('list',{name:treeText.lexicalTree,exact:true});
const input=()=>panel().getByRole('textbox',{name:text.label,exact:true});
const leave=()=>page.getByRole('dialog',{name:formText.leaveTitle,exact:true});
const preview=()=>page.getByRole('dialog',{name:'确认数据修改',exact:true});
const qualified=(context:LiveContext,name='record_nodes')=>`\`${context.database}\`.\`${name}\``;
type Probe={calls:string[];restore():void};type ProbeGlobal=typeof globalThis&{__recordStructureProbe?:Probe};

/** 只旁观原生产handler命令名，不记录值、认证或SQL，不替换真实返回。 */
async function observe(){await desktop.evaluate(({ipcMain})=>{
  type Handler=(event:Electron.IpcMainInvokeEvent,payload:{command:string})=>Promise<unknown>;
  const handlers=(ipcMain as typeof ipcMain&{_invokeHandlers:Map<string,Handler>})._invokeHandlers,original=handlers.get('dbark:request');if(!original)throw Error('没有真实IPC');
  const state:Probe={calls:[],restore:()=>handlers.set('dbark:request',original)};(globalThis as ProbeGlobal).__recordStructureProbe=state;
  handlers.set('dbark:request',(event,payload)=>{if(/^(?:table\.|metadata\.|query\.)/.test(payload.command))state.calls.push(payload.command);return original(event,payload);});
});}
async function calls(){return desktop.evaluate(()=>(globalThis as ProbeGlobal).__recordStructureProbe?.calls??[]);}
/** 每例结束先恢复生产handler，原实库夹具负责退出及精确清理本例随机库。 */
async function withDatabase(body:(context:LiveContext)=>Promise<void>,info:TestInfo){await isolatedDatabase(async context=>{try{await body(context);}catch(reason){if(!closed)await info.attach('结构操作命令名',{body:JSON.stringify(await calls()),contentType:'application/json'}).catch(()=>undefined);throw reason;}finally{if(!closed)await desktop.evaluate(()=>{const root=globalThis as ProbeGlobal;root.__recordStructureProbe?.restore();delete root.__recordStructureProbe;});}},info);}
/** 所有入口经真实对象树、分页、网格选择及表单按钮。 */
async function openTable(context:LiveContext,name='record_nodes'){
  const connection=page.locator('.connection-node').filter({has:page.getByRole('button',{name:context.connectionName,exact:true})});
  await connection.getByRole('button',{name:context.connectionName,exact:true}).focus();await connection.getByRole('button',{name:'刷新连接',exact:true}).click();
  await connection.locator('.database-row').getByRole('button',{name:context.database,exact:true}).click();await connection.locator('.object-row').getByText(name,{exact:true}).click();
  await expect(table().locator('.context-bar')).toContainText(name);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);
}
async function cell(name='note',row=2):Promise<Locator>{const header=table().getByRole('columnheader',{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});const index=await header.getAttribute('aria-colindex');if(!index)throw Error('缺少列坐标');const result=table().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);await result.scrollIntoViewIfNeeded();return result;}
async function openPanel(row=2){await(await cell('note',row)).click();if(!(await panel().isVisible()))await table().getByRole('button',{name:formText.title,exact:true}).click();await panel().getByRole('button',{name:treeText.tree,exact:true}).click();await expect(panel()).toBeVisible();}
async function parseColumn(name='body',native=false){const field=panel().getByRole('list',{name:treeText.fields,exact:true}).locator(':scope > li').filter({has:page.getByRole('heading',{name:new RegExp('^'+name+'$|^'+name+'\\s')})});await field.getByRole('button',{name:native?treeText.parse:treeText.parseExplicit,exact:true}).click();await expect(tree()).toBeVisible();}
/** 成员按完整序号选择，重复名称始终不能用名称单独定位。 */
function member(index:number,key:string){return tree().locator(':scope > li').filter({has:page.getByText(`成员 #${index} · ${JSON.stringify(key)}`,{exact:true})});}
async function editMember(index=2,key='n'){await member(index,key).getByRole('button',{name:text.edit,exact:true}).click();await expect(input()).toBeVisible();}
async function stage(){await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toHaveCount(0);await expect(panel().getByRole('status')).toHaveText(formText.stagedNotice);await expect(input()).toHaveCount(0);}
async function showPreview(){await table().getByRole('button',{name:'预览并提交',exact:true}).click();await expect(preview()).toBeVisible();await expect(preview().locator('.monaco-editor .view-lines')).toContainText(/UPDATE|INSERT/);}
async function submit(){await preview().getByRole('button',{name:'确认提交',exact:true}).click();await expect(preview()).toBeHidden({timeout:20000});await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(table().locator(':scope > .error-box')).toHaveCount(0);}
const original=' {"n":9007199254740993,"n":-0,"__proto__":1e999,"list":[1,{"x.y":2}]}\n';
/** 已有两行及原生JSON，用服务器实际返还的表示验证，不猜测Maria别名类型。 */
async function fixture(context:LiveContext){
  await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,note TEXT,body LONGTEXT,native_json JSON,\`generated\` LONGTEXT GENERATED ALWAYS AS(body) STORED) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context)}(id,note,body,native_json) VALUES(1,'原第一',?,'{"n":9007199254740993,"text":"中文"}'),(2,'原第二','{"n":2}','null')`,[original]);await openTable(context);
}
async function read(context:LiveContext){return(await context.observer.query<RowDataPacket[]>(`SELECT note,body FROM ${qualified(context)} ORDER BY id`))[0];}

const structure=()=>panel().getByRole('region',{name:structureText.title,exact:true});
const root=()=>tree().locator(':scope > li').filter({has:page.getByText(treeText.root,{exact:true})});
/** 操作菜单、输入和暂存均走真实可见控件，不调用渲染器内部控制器。 */
async function operation(node:Locator,kind:RecordStructureKind){await node.getByRole('button',{name:structureText.more,exact:true}).click();const group=panel().getByRole('group',{name:structureText.more,exact:true});await group.getByRole('button',{name:structureText.actions[kind],exact:true}).click();await expect(structure()).toBeVisible();}
async function stageStructure(){await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toHaveCount(0);await expect(structure()).toHaveCount(0);await expect(panel().getByRole('status')).toHaveText(formText.stagedNotice);}
/** 整个根token仅用于精确断言；根外空白在真实数据库完整字段断言中验证。 */
async function localToken(){if(!await tree().count())await parseColumn();await root().getByRole('button',{name:treeText.inspect,exact:true}).click();return panel().getByRole('textbox',{name:treeText.token,exact:true}).inputValue();}
async function rename(node:Locator,keyToken:string){await operation(node,'rename');await structure().getByRole('textbox',{name:structureText.keyLabel,exact:true}).fill(keyToken);await stageStructure();}
async function remove(node:Locator){await operation(node,'remove');await expect(panel().locator('.record-display-modes')).toContainText(treeText.tree);await expect(panel()).toContainText(formText.inputDirty);await stageStructure();}
/** 下标保留原始文本，非法位置不能先被数字控件归一化。 */
async function insert(index:string,value:string){await operation(root(),'insert-element');await structure().getByRole('textbox',{name:structureText.indexLabel,exact:true}).fill(index);await structure().getByRole('textbox',{name:structureText.valueLabel,exact:true}).fill(value);await stageStructure();}
async function move(from:string,to:string){await operation(root(),'move-element');await structure().getByRole('textbox',{name:structureText.fromLabel,exact:true}).fill(from);await structure().getByRole('textbox',{name:structureText.toLabel,exact:true}).fill(to);await stageStructure();}
/** 服务器夹具只写本例已创建随机库中的固定测试表，应用读写仍通过原工作台。 */
async function fixtureBody(context:LiveContext,body:string){await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,note TEXT,body LONGTEXT) ENGINE=InnoDB`);await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,'原第一',?),(2,'原第二','{"n":2}')`,[body]);await openTable(context);await openPanel();await observe();await parseColumn();}

test.describe('JSON结构操作：同页草稿与精确原文',()=>{
  test.skip(!enabled,'需要明确启用200隔离实库');test.setTimeout(120000);
  test.beforeEach(()=>{if(environment.DBARK_TEST_HOST!=='192.168.31.200')throw Error('只允许200');const port=process.env.DBARK_RECORD_VIEWS_TEST_PORT??process.env.DBARK_TEST_PORT??'13384';if(!['13357','13380','13384','13310','13311'].includes(port))throw Error('未授权端口');environment.DBARK_TEST_PORT=port;});

  test('第二个同名成员改名保留网格草稿及所有精确值，仅确认后写入一次',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await(await cell()).dblclick();await table().getByRole('textbox',{name:'编辑 note',exact:true}).fill('已有网格草稿');await table().getByRole('textbox',{name:'编辑 note',exact:true}).press('Enter');await openPanel();await observe();await parseColumn();
    await root().getByRole('button',{name:structureText.more,exact:true}).click();const group=panel().getByRole('group',{name:structureText.more,exact:true});await expect(group.getByRole('button',{name:structureText.actions.rename,exact:true})).toHaveCount(0);await expect(group.getByRole('button',{name:structureText.actions.remove,exact:true})).toHaveCount(0);
    await operation(member(2,'n'),'rename');const key=structure().getByRole('textbox',{name:structureText.keyLabel,exact:true});await expect(key).toHaveValue('"n"');await key.fill('"__proto__"');
    const bounds=await panel().getByRole('button',{name:formText.stage,exact:true}).boundingBox(),panelBounds=await panel().boundingBox();expect(bounds).not.toBeNull();expect(panelBounds).not.toBeNull();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(panelBounds!.y+panelBounds!.height);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(await page.evaluate(()=>innerHeight));await info.attach('结构改名实际输入',{body:await page.screenshot(),contentType:'image/png'});
    await key.press(modifier+'+Enter');await expect(structure()).toHaveCount(0);const changed=original.replace('"n":-0','"__proto__":-0');expect(await localToken()).toBe(changed.slice(1,-1));expect(await calls()).toEqual([]);expect((await read(context))[0]).toMatchObject({note:'原第一',body:original});await showPreview();expect(await calls()).toEqual(['table.preview']);expect((await read(context))[0].body).toBe(original);await submit();expect((await read(context))[0]).toMatchObject({note:'已有网格草稿',body:changed});expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);
  },info);});

  test('对象首中末及唯一成员删除只移除可信分隔符，根外空白保留',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,original);await remove(member(1,'n'));expect(await localToken()).toBe('{"n":-0,"__proto__":1e999,"list":[1,{"x.y":2}]}');
    await remove(member(2,'__proto__'));expect(await localToken()).toBe('{"n":-0,"list":[1,{"x.y":2}]}');await remove(member(2,'list'));expect(await localToken()).toBe('{"n":-0}');await remove(member(1,'n'));expect(await localToken()).toBe('{}');expect(await calls()).toEqual([]);expect((await read(context))[0].body).toBe(original);await showPreview();await submit();expect((await read(context))[0].body).toBe(' {}\n');
  },info);});

  test('空对象和已有对象追加重复及转义名称，字符串内容不能当作结构分隔符',async({},info)=>{await withDatabase(async context=>{
    const source=' { \n}\n';await fixtureBody(context,source);await operation(root(),'append-member');await expect(panel()).toContainText(formText.inputDirty);await structure().getByRole('textbox',{name:structureText.keyLabel,exact:true}).fill('"__proto__"');await structure().getByRole('textbox',{name:structureText.valueLabel,exact:true}).fill('9007199254740993');await stageStructure();expect(await localToken()).toBe('{"__proto__":9007199254740993 \n}');
    await operation(root(),'append-member');await structure().getByRole('textbox',{name:structureText.keyLabel,exact:true}).fill('"__proto__"');await structure().getByRole('textbox',{name:structureText.valueLabel,exact:true}).fill('"逗号,冒号:引号\\\""');await stageStructure();const expected=' {"__proto__":9007199254740993,"__proto__":"逗号,冒号:引号\\\"" \n}\n';expect(await localToken()).toBe(expected.slice(1,-1));expect(await calls()).toEqual([]);await showPreview();await submit();expect((await read(context))[0].body).toBe(expected);
  },info);});

  test('数组头中尾插入与前后移动保留精确值和空白槽位，删除最终得到空数组',async({},info)=>{await withDatabase(async context=>{
    const source=' [9007199254740993, -0, 1e999]\n';await fixtureBody(context,source);await insert('0','"头,部"');expect(await localToken()).toBe('["头,部",9007199254740993, -0, 1e999]');await insert('2','{"x.y":null}');expect(await localToken()).toBe('["头,部",9007199254740993, {"x.y":null},-0, 1e999]');await insert('5','true');expect(await localToken()).toBe('["头,部",9007199254740993, {"x.y":null},-0, 1e999,true]');
    await move('0','5');expect(await localToken()).toBe('[9007199254740993,{"x.y":null}, -0,1e999, true,"头,部"]');await move('5','0');expect(await localToken()).toBe('["头,部",9007199254740993, {"x.y":null},-0, 1e999,true]');
    for(let count=6;count>0;count--){const index=count===6?2:count-1;await remove(tree().locator(':scope > li').filter({has:page.getByText(`元素 [${index}]`,{exact:true})}));await localToken();}expect(await localToken()).toBe('[]');expect(await calls()).toEqual([]);await showPreview();await submit();expect((await read(context))[0].body).toBe(' []\n');
  },info);});

  test('非法名称与完整合并预算失败零暂存，三选失败保留原文且不切换模式',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,original);await operation(member(2,'n'),'rename');const key=structure().getByRole('textbox',{name:structureText.keyLabel,exact:true});await key.fill('未加引号');await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toBeVisible();await expect(key).toHaveValue('未加引号');await panel().getByRole('button',{name:documentText.input,exact:true}).click();await leave().getByRole('button',{name:formText.stageContinue,exact:true}).click();await expect(leave().locator('.error-box')).toBeVisible();await leave().getByRole('button',{name:formText.stay,exact:true}).click();await expect(key).toHaveValue('未加引号');
    await panel().getByRole('button',{name:documentText.input,exact:true}).click();await leave().getByRole('button',{name:formText.discardContinue,exact:true}).click();const whole=JSON.parse(await panel().getByRole('textbox',{name:documentText.label,exact:true}).inputValue());expect(whole.fields.find((f:{name:string})=>f.name==='body').text).toBe(original);await panel().getByRole('button',{name:treeText.tree,exact:true}).click();await parseColumn();await operation(root(),'append-member');await structure().getByRole('textbox',{name:structureText.keyLabel,exact:true}).fill('"budget"');const value=structure().getByRole('textbox',{name:structureText.valueLabel,exact:true});for(const invalid of ['{','['+'0,'.repeat(2048)+'0]','['.repeat(63)+'0'+']'.repeat(63)]){await value.fill(invalid);await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toBeVisible();await expect(value).toHaveValue(invalid);}expect(await calls()).toEqual([]);expect((await read(context))[0].body).toBe(original);
  },info);});

  test('数组下标原文不隐式归一化，空数组可插入且同位置移动不创建新草稿',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,' []\n');await root().getByRole('button',{name:structureText.more,exact:true}).click();await expect(panel().getByRole('group',{name:structureText.more,exact:true}).getByRole('button',{name:structureText.actions['move-element'],exact:true})).toHaveCount(0);await operation(root(),'insert-element');const index=structure().getByRole('textbox',{name:structureText.indexLabel,exact:true});for(const invalid of ['01','-0','1e0','0.0',' 0','9007199254740993','1']){await index.fill(invalid);await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toBeVisible();await expect(index).toHaveValue(invalid);}await index.fill('0');await structure().getByRole('textbox',{name:structureText.valueLabel,exact:true}).fill('-0');await stageStructure();expect(await localToken()).toBe('[-0]');await operation(root(),'move-element');await expect(panel().getByRole('button',{name:formText.stage,exact:true})).toBeDisabled();await structure().getByRole('textbox',{name:structureText.fromLabel,exact:true}).fill('00');await panel().getByRole('button',{name:formText.stage,exact:true}).click();await expect(panel().locator('.error-box')).toBeVisible();await structure().getByRole('textbox',{name:structureText.fromLabel,exact:true}).fill('0');await structure().getByRole('button',{name:structureText.close,exact:true}).click();expect(await calls()).toEqual([]);await showPreview();await submit();expect((await read(context))[0].body).toBe(' [-0]\n');
  },info);});

  test('删除意图和新增默认输入也受导航关闭三选保护，结构与节点值编辑保持同页',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,original);await operation(member(2,'n'),'remove');await panel().getByRole('button',{name:formText.next,exact:true}).click();await leave().getByRole('button',{name:formText.stay,exact:true}).click();await expect(structure()).toBeVisible();await panel().getByRole('button',{name:formText.next,exact:true}).click();await leave().getByRole('button',{name:formText.stageContinue,exact:true}).click();await panel().getByRole('button',{name:formText.previous,exact:true}).click();await parseColumn();await expect(member(2,'__proto__')).toBeVisible();await editMember(1,'n');await input().fill('9007199254740995');await stage();await parseColumn();await operation(root(),'append-member');await structure().getByRole('button',{name:structureText.close,exact:true}).click();await leave().getByRole('button',{name:formText.discardContinue,exact:true}).click();await expect(structure()).toHaveCount(0);await expect(panel().getByRole('button',{name:formText.stage,exact:true})).toHaveCount(0);expect(await localToken()).toBe('{"n":9007199254740995,"__proto__":1e999,"list":[1,{"x.y":2}]}');expect(await calls()).toEqual([]);expect((await read(context))[0].body).toBe(original);
  },info);});

  test('隐藏标签及退出取消保留非法结构输入，刷新仅在确认放弃后清除',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,original);await context.observer.query(`CREATE TABLE ${qualified(context,'other')}(id INT PRIMARY KEY) ENGINE=InnoDB`);await operation(member(2,'n'),'rename');const key=structure().getByRole('textbox',{name:structureText.keyLabel,exact:true});await key.fill('非法名称');await openTable(context,'other');await page.locator('.tab-select').filter({hasText:/^record_nodes$/}).click();await expect(key).toHaveValue('非法名称');await answerDialogs([0]);await requestQuit('window');await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);expect(closed).toBe(false);await expect(key).toHaveValue('非法名称');
    /** 仅提供原生确认的用户答案，刷新和真实查询仍由产品完成。 */
    async function answer(response:0|1){await answerDialogs([response]);await desktop.evaluate(({dialog},fallback)=>{dialog.showMessageBoxSync=((...args:unknown[])=>{const options=args.at(-1) as Electron.MessageBoxSyncOptions;const response=globalThis.__dbarkE2EDialogs.answers.shift()??fallback;globalThis.__dbarkE2EDialogs.calls.push({title:options.title,message:options.message,buttons:options.buttons,response});return response;}) as typeof dialog.showMessageBoxSync;},response);}
    await answer(1);const before=(await calls()).length;await table().getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>desktop.evaluate(()=>globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);await expect(key).toHaveValue('非法名称');expect((await calls()).length).toBe(before);await answer(0);await table().getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(async()=>(await calls()).filter(name=>name==='table.page').length).toBe(2);await expect(table().locator('.loading-overlay')).toHaveCount(0);await expect(structure()).toHaveCount(0);expect((await calls()).filter(name=>name==='table.apply'||name==='table.preview')).toEqual([]);expect((await read(context))[0].body).toBe(original);
  },info);});

  test('两行结构草稿遇到并发修改整批回滚，失败预览不能重复提交',async({},info)=>{await withDatabase(async context=>{
    await fixtureBody(context,original);await rename(member(2,'n'),'"renamed"');await panel().getByRole('button',{name:formText.next,exact:true}).click();await parseColumn();await operation(root(),'append-member');await structure().getByRole('textbox',{name:structureText.keyLabel,exact:true}).fill('"added"');await structure().getByRole('textbox',{name:structureText.valueLabel,exact:true}).fill('9007199254740995');await stageStructure();await showPreview();await context.observer.query(`UPDATE ${qualified(context)} SET note='并发第二' WHERE id=2`);await preview().getByRole('button',{name:'确认提交',exact:true}).click();await expect(preview().locator('.error-box')).toContainText(/并发|已被其他/);await expect(preview().getByRole('button',{name:'确认提交',exact:true})).toBeDisabled();await preview().getByRole('button',{name:'确认提交',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());expect((await calls()).filter(name=>name==='table.apply')).toHaveLength(1);expect((await read(context)).map(row=>[row.note,row.body])).toEqual([['原第一',original],['并发第二','{"n":2}']]);await preview().getByRole('button',{name:'返回编辑',exact:true}).click();await expect(await cell('body')).toContainText('"renamed":-0');await expect(await cell('body',3)).toContainText('"added":9007199254740995');
  },info);});

  test('视图无键非事务表生成列禁用结构操作，删除撤销使旧选择失效，原生JSON精确提交',async({},info)=>{await withDatabase(async context=>{
    await fixture(context);await context.observer.query(`CREATE VIEW ${qualified(context,'readonly_view')} AS SELECT id,note,body FROM ${qualified(context)}`);await context.observer.query(`CREATE TABLE ${qualified(context,'no_key')}(note TEXT,body LONGTEXT) ENGINE=InnoDB`);await context.observer.query(`INSERT INTO ${qualified(context,'no_key')} VALUES('无键','{"n":1}')`);await context.observer.query(`CREATE TABLE ${qualified(context,'nontransaction')}(id INT PRIMARY KEY,note TEXT,body LONGTEXT) ENGINE=MyISAM`);await context.observer.query(`INSERT INTO ${qualified(context,'nontransaction')} VALUES(1,'非事务','{"n":1}')`);
    for(const name of ['readonly_view','no_key','nontransaction']){await openTable(context,name);await openPanel();await parseColumn();const buttons=tree().getByRole('button',{name:structureText.more,exact:true});expect(await buttons.count()).toBeGreaterThan(0);for(const button of await buttons.all())await expect(button).toBeDisabled();await expect(structure()).toHaveCount(0);}
    await openTable(context);await openPanel();await observe();await parseColumn('generated');for(const button of await tree().getByRole('button',{name:structureText.more,exact:true}).all())await expect(button).toBeDisabled();await parseColumn();await operation(member(2,'n'),'rename');await table().getByRole('button',{name:'删除',exact:true}).click();await expect(structure()).toHaveCount(0);await expect(tree()).toHaveCount(0);await table().getByRole('button',{name:'删除',exact:true}).click();const [metadata]=await context.observer.query<RowDataPacket[]>('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[context.database,'record_nodes','native_json']);await parseColumn('native_json',String(metadata[0].DATA_TYPE).toLowerCase()==='json');await rename(member(1,'n'),'"renamed"');expect(await calls()).toEqual([]);await showPreview();await submit();const [rows]=await context.observer.query<RowDataPacket[]>(`SELECT CAST(native_json AS CHAR) AS raw FROM ${qualified(context)} WHERE id=1`);expect(rows[0].raw).toContain('"renamed"');expect(rows[0].raw).toContain('9007199254740993');expect(rows[0].raw).not.toContain('9007199254740992');
  },info);});
});
