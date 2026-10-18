import { test } from '@playwright/test';

// 默认及list先短路，不加载原生/驱动/凭据文件，也不读取任何目标参数。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_QUERY_INSERT_UI==='1'){
  const {bindQueryInsertUiTarget}=require('../helpers/queryInsertUiLive') as typeof import('../helpers/queryInsertUiLive');
  const binding=bindQueryInsertUiTarget(()=>process.env,()=>process.argv);
  const {registerQueryInsertUi}=require('./query-insert-ui-live') as typeof import('./query-insert-ui-live');
  registerQueryInsertUi(binding);
}else{
  test.skip('完整INSERT真实界面：一次新执行、精确样例及准确目标确认后发布原文件',()=>{});
  test.skip('完整INSERT真实界面：等待确认时取消，原目标保持且原会话继续无重放',()=>{});
}
