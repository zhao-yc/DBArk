export const importNewTableUiKeys=['DBARK_INTEGRATION_ENABLED','DBARK_IMPORT_NEW_TABLE_UI_TEST','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_TLS','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_DATABASE','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_IMPORT_NEW_TABLE_UI_OWNER','DBARK_IMPORT_NEW_TABLE_UI_MANIFEST','DBARK_IMPORT_NEW_TABLE_UI_MANIFEST_SHA256','DBARK_IMPORT_NEW_TABLE_UI_OUTPUT','DBARK_IMPORT_NEW_TABLE_UI_CSV_GOOD','DBARK_IMPORT_NEW_TABLE_UI_CSV_GOOD_SHA256','DBARK_IMPORT_NEW_TABLE_UI_CSV_BAD','DBARK_IMPORT_NEW_TABLE_UI_CSV_BAD_SHA256'] as const;

/** list/default只读双开关，不载桌面、认证、文件、Engine或数据库驱动。 */
export function importNewTableUiActive(env:NodeJS.ProcessEnv,args:readonly string[]):boolean{return !args.some(value=>value==='list'||value==='--list'||value.startsWith('--list='))&&env.DBARK_INTEGRATION_ENABLED==='1'&&env.DBARK_IMPORT_NEW_TABLE_UI_TEST==='1';}
/** 验证Root本轮原随机库与两份合成文件计划；不探测文件、服务器，也不分配授权。 */
export function assertImportNewTableUiEnvironment(env:NodeJS.ProcessEnv,args:readonly string[],platform:string):void{
  if(platform!=='win32'||!importNewTableUiActive(env,args))throw Error('新表导入窗口专项须Windows及双门1');
  const nonce=/^dbark_importnewui_([a-f0-9]{12})$/.exec(env.DBARK_TEST_DATABASE??'');
  if(!nonce||env.DBARK_IMPORT_NEW_TABLE_UI_OWNER!=='dbark-import-new-table-ui:'+nonce[1]||env.DBARK_TEST_HOST!=='192.168.31.200'||env.DBARK_TEST_PORT!=='13384'||env.DBARK_TEST_TLS!=='0'||!env.DBARK_TEST_USER||typeof env.DBARK_TEST_PASSWORD!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID??''))throw Error('新表导入原200/13384、UUID、随机库或owner无效');
  const absolute=(value:string|undefined)=>typeof value==='string'&&/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value);
  if(!absolute(env.DBARK_IMPORT_NEW_TABLE_UI_MANIFEST)||!/^[a-f0-9]{64}$/.test(env.DBARK_IMPORT_NEW_TABLE_UI_MANIFEST_SHA256??'')||!absolute(env.DBARK_IMPORT_NEW_TABLE_UI_OUTPUT))throw Error('新表导入缺少本轮源码清单及独占输出');
  for(const name of ['GOOD','BAD'])if(!absolute(env['DBARK_IMPORT_NEW_TABLE_UI_CSV_'+name])||!/\.csv$/i.test(env['DBARK_IMPORT_NEW_TABLE_UI_CSV_'+name]??'')||!/^[a-f0-9]{64}$/.test(env['DBARK_IMPORT_NEW_TABLE_UI_CSV_'+name+'_SHA256']??''))throw Error('新表导入缺少原CSV路径与SHA256');
  if(env.DBARK_IMPORT_NEW_TABLE_UI_CSV_GOOD===env.DBARK_IMPORT_NEW_TABLE_UI_CSV_BAD)throw Error('新表导入两份CSV不得共用路径');
  for(const key of Object.keys(env))if(/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)&&key!==key.toUpperCase())throw Error('新表导入拒绝环境大小写别名');
  for(const key of ['DBARK_DEV_URL','DBARK_USER_DATA','DBARK_EXECUTABLE_PATH','DBARK_TEST_SSH','DBARK_TEST_CA','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'])if(Object.hasOwn(env,key))throw Error('新表导入拒绝替代环境或目标');
  if(args.some(value=>/^(?:--(?:ui|debug|config)(?:=|$)|-c)/.test(value)))throw Error('新表导入拒绝替代配置/交互执行');
  for(const[index,value]of args.entries())if(value==='--trace'&&args[index+1]!=='off'||value.startsWith('--trace=')&&value!=='--trace=off')throw Error('新表导入禁止trace');
}
/** 首次漂移永久封闭，恢复原环境或argv不能复活原来源；只捕获RAM值。 */
export function bindImportNewTableUiEnvironment(read:()=>{env:NodeJS.ProcessEnv;args:readonly string[];platform:string}){
  const signature=()=>{const value=read();assertImportNewTableUiEnvironment(value.env,value.args,value.platform);return JSON.stringify([value.platform,value.args,Object.keys(value.env).filter(key=>/^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key=>[key,value.env[key]])]);};
  const original=signature(),values=Object.freeze(Object.fromEntries(importNewTableUiKeys.map(key=>[key,read().env[key]!])) as Record<typeof importNewTableUiKeys[number],string>);let invalid=false;
  return{values,assertCurrent(){if(invalid)throw Error('新表导入原环境已失效，保留现场');try{if(signature()!==original)throw Error('新表导入原环境漂移');}catch(reason){invalid=true;throw reason;}}};
}
/** 独立手写CSV协议及数学期望；本函数不调用产品解析器、SQL生成器或数据库。 */
export function importNewTableUiFixture(database:string,marker:string){
  const nonce=/^dbark_importnewui_([a-f0-9]{12})$/.exec(database);if(!nonce||marker!=='dbark-import-new-table-ui:'+nonce[1])throw Error('新表导入资源必须属于同一本轮nonce');
  const columns=['record_no','note'],tables=['csv_text','csv_bad21'] as const;
  const quote=(value:string|null)=>{if(value===null)return '\\N';const raw=value.startsWith('\\')?'\\'+value:value;return /[,"\r\n]/.test(raw)?'"'+raw.replace(/"/g,'""')+'"':raw;};
  const happy=Array.from({length:31},(_,index)=>[String(9007199254740992n+BigInt(index+1)),index%7===6?null:index===0?'合成"首条",逗号\r\n下一行':index===30?'\\样本外末条':'合成-'+(index+1)] as const);
  const bad=Array.from({length:31},(_,index)=>[index===20?'not-an-integer':String(index+1),'合成-'+(index+1)] as const);
  const text=(rows:readonly (readonly(string|null)[])[])=>columns.join(',')+'\r\n'+rows.map(row=>row.map(quote).join(',')+'\r\n').join('');
  const expected=happy.map(([record_no,note])=>({record_no,noteHex:note===null?null:Buffer.from(note,'utf8').toString('hex').toUpperCase()}));
  const qualified=(table:typeof tables[number])=>{if(!tables.includes(table))throw Error('新表导入表不在本例计划');return '`'+database+'`.`'+table+'`';};
  return{database,marker,columns,tables,qualified,files:{happy:{name:'new-table-good.csv',text:text(happy)},blocked:{name:'new-table-bad21.csv',text:text(bad)}},expected,
    creates:['CREATE DATABASE `'+database+'` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin','CREATE TABLE `'+database+'`.`__owner` (marker VARCHAR(80) NOT NULL PRIMARY KEY) ENGINE=InnoDB'],
    seeds:['INSERT INTO `'+database+'`.`__owner` VALUES (\''+marker+'\')'],drop:'DROP DATABASE `'+database+'`',unverified:['JSON正式窗口','主键编辑','默认LONGTEXT之外的精度类型成功导入','断线或COMMIT未知故障']};
}

interface PickerDialog{showOpenDialog(...args:any[]):Promise<any>;}
interface PickerWindow{isDestroyed():boolean;webContents:{id:number};}
interface PickerState{owner:string;original:PickerDialog['showOpenDialog'];window:PickerWindow;path:string;consumed:boolean;failed:boolean;}
/** 仅一次回答准确CSV原生选择，真实Main随后签发文件令牌；不操作系统输入/剪贴板。 */
export function installImportNewTableUiChoice({dialog,BrowserWindow}:{dialog:PickerDialog;BrowserWindow:{getAllWindows():PickerWindow[]}},input:{owner:string;senderId:number;path:string}):void{
  const root=globalThis as typeof globalThis&{__importNewTableUiPicker?:PickerState};if(root.__importNewTableUiPicker||!/^dbark-import-new-table-ui:[a-f0-9]{12}$/.test(input.owner)||!/^(?:[a-z]:[\\/]|\\\\)/i.test(input.path)||!/\.csv$/i.test(input.path))throw Error('新表导入本次原文件选择身份无效');
  const windows=BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed());if(windows.length!==1||windows[0].webContents.id!==input.senderId)throw Error('新表导入原窗口不唯一');
  const state:PickerState={owner:input.owner,original:dialog.showOpenDialog,window:windows[0],path:input.path,consumed:false,failed:false};root.__importNewTableUiPicker=state;
  const wrapped:PickerDialog['showOpenDialog']=async(...args:any[])=>{if(root.__importNewTableUiPicker!==state||state.consumed||state.failed||dialog.showOpenDialog!==wrapped){state.failed=true;throw Error('新表导入旧文件选择不能重放');}dialog.showOpenDialog=state.original;
    try{const expected={title:'选择文件',properties:['openFile'],filters:[{name:'CSV 文件',extensions:['csv']},{name:'所有文件',extensions:['*']}]};if(args.length!==2||args[0]!==state.window||state.window.isDestroyed()||JSON.stringify(args[1])!==JSON.stringify(expected))throw Error('新表导入原CSV选择选项变化');state.consumed=true;return{canceled:false,filePaths:[state.path]};}catch(reason){state.failed=true;throw reason;}};
  dialog.showOpenDialog=wrapped;
}
/** 只接受真实消费并恢复原函数的证据，不把已安装回答器当选择成功。 */
export function readImportNewTableUiChoice({dialog}:{dialog:PickerDialog},input:{owner:string}){const state=(globalThis as typeof globalThis&{__importNewTableUiPicker?:PickerState}).__importNewTableUiPicker;if(!state||state.owner!==input.owner||!state.consumed||state.failed||dialog.showOpenDialog!==state.original)throw Error('新表导入原文件选择未闭合');return{path:state.path,consumed:1,originalRestored:true,systemInput:0};}
