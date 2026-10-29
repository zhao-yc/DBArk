import { test } from '@playwright/test';

// 列表先于全部环境读取；默认不加载认证、live、桌面、Engine或mysql。
const listing=process.argv.some(value=>value==='list'||value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_IMPORT_NEW_TABLE_UI_TEST==='1'){
  const{bindImportNewTableUiEnvironment}=require('../helpers/importNewTableUi') as typeof import('../helpers/importNewTableUi');
  const environment=bindImportNewTableUiEnvironment(()=>({env:process.env,args:process.argv,platform:process.platform}));
  require('./import-new-table-live').registerImportNewTableUiTests(environment);
}else test.skip('新表导入正式窗口专项默认关闭（未执行）',()=>{});
