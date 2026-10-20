import { test } from '@playwright/test';

// 默认或列表仅登记，不读取认证与输出目录；本例须明确开启三个门。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_QUERY_RESULT_COLUMNS_UI==='1'&&process.env.DBARK_QUERY_RESULT_SORT_CASE_UI==='1'){
  const{bindQueryResultColumnsUiTarget,queryResultColumnsUiKeys}=require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper=Object.fromEntries(queryResultColumnsUiKeys.filter(key=>Object.hasOwn(process.env,key)).map(key=>[key,process.env[key]]));
  const original=bindQueryResultColumnsUiTarget(()=>process.env,helper);let revoked=false;
  const binding={target:original.target,assertCurrent(){original.assertCurrent();if(process.env.DBARK_QUERY_RESULT_SORT_CASE_UI!=='1')revoked=true;if(revoked)throw Error('大小写排序验收开关变化，永久停链');}};
  require('./query-result-sort-case-live').registerQueryResultSortCaseUi(binding);
}else test.skip('文本大小写排序真实客户端验收默认关闭（未执行）',()=>{});
