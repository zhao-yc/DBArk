import {test,expect,_electron as electron} from '@playwright/test';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {tableValueOptionsZh as text} from '../../src/renderer/locales/tableValueOptions.zh-CN';

const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list=')),active=!listing&&process.env.DBARK_VALUE_FREQUENCY_NATIVE==='1';
test.skip(!active,'服务器不同值次数排序离线组件专项默认关闭');
test.use({trace:'off',screenshot:'off',video:'off'});
test.describe.configure({timeout:120000,retries:0});
let server:Awaited<ReturnType<typeof createServer>>,address:string;
test.beforeAll(async()=>{
  if(!active)return;
  const forbidden=Object.keys(process.env).filter(key=>/^(?:DBARK_TEST_|MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_PATH$|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(key)||['DBARK_EXECUTABLE_PATH','DBARK_DEV_URL','DBARK_USER_DATA'].includes(key));
  if(process.env.DBARK_INTEGRATION_ENABLED!=='0'||forbidden.length)throw Error('次数排序组件拒绝认证和外部配置；字段名：'+forbidden.join('、'));
  for(const[index,value]of process.argv.entries())if(value==='--trace'&&process.argv[index+1]!=='off'||value.startsWith('--trace=')&&value!=='--trace=off')throw Error('次数排序组件禁止自动trace');
  server=await createServer({configFile:false,root:process.cwd(),plugins:[react()],server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});await server.listen();const value=server.httpServer!.address();if(!value||typeof value==='string')throw Error('组件服务地址未知');address='http://127.0.0.1:'+value.port;
});
test.afterAll(async()=>{if(server)await server.close();});

test('次数排序真实控件、重读确认与明暗主题，原草稿和筛选保持',async({},info)=>{
  const directory=await mkdtemp(join(tmpdir(),'dbark-value-frequency-native-')),app=await electron.launch({args:['tests/fixtures/value-frequency/electron.cjs'],env:{...process.env,DBARK_VALUE_FREQUENCY_FIXTURE_DATA:directory,DBARK_VALUE_FREQUENCY_FIXTURE_URL:address+'/tests/fixtures/value-frequency/index.html'},chromiumSandbox:true});
  const processOwner=app.process(),pid=processOwner.pid,exit=new Promise((yes)=>processOwner.once('exit',(code,signal)=>yes({code,signal}))),page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',reason=>errors.push(reason.message));let closed=false,accepted=false;
  const check=()=>{if(info.timeout!==120000||info.retry!==0||info.repeatEachIndex!==0||info.config.workers!==1||app.process()!==processOwner||closed||page.isClosed())throw Error('次数排序原窗口或期限变化');};
  const step=async<T,>(action:()=>Promise<T>)=>{check();const result=await action();check();return result;};
  const evidence=()=>step(()=>page.evaluate(()=>{
    const port=(window as Window&{__valueFrequencyEvidence?:()=>{reads:{order?:string}[];proposals:{filters:unknown[]}[];denied:string[];cleanup:string[];activity:number;draft:{value:string};conditionsUnchanged:boolean}}).__valueFrequencyEvidence;
    if(!port)throw Error('次数排序原只读观察端口不存在');return port();
  }));
  const dialog=()=>page.getByRole('dialog',{name:text.title,exact:true});
  await info.attach('次数排序原窗口身份',{body:JSON.stringify({pid,directory}),contentType:'application/json'});
  try{
    await step(()=>page.getByRole('button',{name:text.open,exact:true}).click());await step(()=>expect(dialog()).toBeVisible());expect((await evidence()).reads).toHaveLength(0);
    await step(()=>dialog().getByRole('button',{name:text.read,exact:true}).click());await step(()=>expect(dialog().getByLabel(text.value('z_hot'),{exact:true})).toBeVisible());
    await step(()=>dialog().getByLabel(text.value('z_hot'),{exact:true}).check());await step(()=>dialog().getByLabel(text.order,{exact:true}).selectOption('count-desc'));expect((await evidence()).reads).toHaveLength(1);await step(()=>expect(dialog().getByRole('button',{name:text.apply,exact:true})).toBeDisabled());
    await step(()=>dialog().getByRole('button',{name:text.refresh,exact:true}).click());await step(()=>expect(dialog().getByRole('button',{name:text.confirmRead,exact:true})).toBeVisible());expect((await evidence()).reads).toHaveLength(1);
    await step(()=>dialog().getByRole('button',{name:text.keep,exact:true}).click());await step(()=>expect(dialog().getByLabel(text.value('z_hot'),{exact:true})).toBeChecked());
    await step(()=>dialog().getByRole('button',{name:text.refresh,exact:true}).click());await step(()=>dialog().getByRole('button',{name:text.confirmRead,exact:true}).click());
    await step(()=>expect.poll(async()=>(await evidence()).reads.length).toBe(2));await step(()=>expect(dialog().getByRole('checkbox').first()).toHaveAttribute('aria-label',text.value('z_hot')));await step(()=>expect(dialog()).toContainText('100 行'));
    await info.attach('次数排序深色窗口',{body:await step(()=>page.screenshot()),contentType:'image/png'});
    await step(()=>dialog().getByLabel(text.value('z_hot'),{exact:true}).check());await step(()=>dialog().getByRole('button',{name:text.apply,exact:true}).click());await step(()=>expect(dialog()).toHaveCount(0));
    await step(()=>page.getByRole('button',{name:'切换主题',exact:true}).click());await step(()=>page.getByRole('button',{name:text.open,exact:true}).click());await step(()=>dialog().getByLabel(text.order,{exact:true}).selectOption('count-asc'));expect((await evidence()).reads).toHaveLength(2);
    await step(()=>dialog().getByRole('button',{name:text.read,exact:true}).click());await step(()=>expect(dialog().getByRole('checkbox').first()).toHaveAttribute('aria-label',text.value('a_rare')));await step(()=>expect(dialog()).toContainText('1 行'));
    await info.attach('次数排序浅色窗口',{body:await step(()=>page.screenshot()),contentType:'image/png'});
    await step(()=>dialog().getByLabel(text.value('a_rare'),{exact:true}).check());await step(()=>dialog().getByRole('button',{name:text.apply,exact:true}).click());await step(()=>expect(dialog()).toHaveCount(0));
    const final=await evidence();expect(final.reads.map(value=>value.order)).toEqual([undefined,'count-desc','count-asc']);expect(final.proposals.map(value=>value.filters.at(-1))).toEqual([{column:'status',operator:'IN',values:['z_hot']},{column:'status',operator:'IN',values:['a_rare']}]);expect(final.denied).toEqual([]);expect(final.cleanup).toEqual([]);expect(final.activity).toBe(0);expect(final.draft).toEqual({value:'DO_NOT_CHANGE_LOCAL_DRAFT'});expect(final.conditionsUnchanged).toBe(true);expect(errors).toEqual([]);
    await info.attach('次数排序组件实际原件',{body:JSON.stringify(final),contentType:'application/json'});check();await app.close();closed=true;expect(await exit).toEqual({code:0,signal:null});expect(processOwner.killed).toBe(false);accepted=true;
  }finally{
    if(!closed&&processOwner.exitCode===null&&processOwner.signalCode===null){await app.close();closed=true;expect(await exit).toEqual({code:0,signal:null});}
    await info.attach('次数排序原窗口收尾',{body:JSON.stringify({pid,directory,accepted,exitCode:processOwner.exitCode,signal:processOwner.signalCode,forced:processOwner.killed,directoryRetained:!accepted}),contentType:'application/json'});
    if(accepted){if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('dbark-value-frequency-native-'))throw Error('次数排序临时目录越界');await rm(directory,{recursive:true});}
  }
});
