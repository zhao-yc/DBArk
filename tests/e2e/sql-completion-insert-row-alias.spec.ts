import {test} from '@playwright/test';

// 列表先短路：不加载桌面、私网配置、凭据回退、数据库驱动或原生输入帮助器。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_INSERT_ROW_ALIAS_UI==='1'){
  const {registerInsertRowAliasUiTest}=require('./sql-completion-insert-row-alias-ui');registerInsertRowAliasUiTest();
}else test.skip('UPSERT新行别名真实UI默认关闭：仅接Root预建专属空表',()=>{});
