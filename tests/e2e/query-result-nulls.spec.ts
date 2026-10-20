import { test } from '@playwright/test';

// 列表或关闭态不读取凭据、不加载实库；本例必须显式开启三个独立门。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_QUERY_RESULT_COLUMNS_UI==='1'&&process.env.DBARK_QUERY_RESULT_NULLS_UI==='1'){
  const{bindQueryResultColumnsUiTarget,queryResultColumnsUiKeys}=require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper=Object.fromEntries(queryResultColumnsUiKeys.filter(key=>Object.hasOwn(process.env,key)).map(key=>[key,process.env[key]]));
  const original=bindQueryResultColumnsUiTarget(()=>process.env,helper);let revoked=false;
  const binding={target:original.target,assertCurrent(){original.assertCurrent();if(process.env.DBARK_QUERY_RESULT_NULLS_UI!=='1')revoked=true;if(revoked)throw Error('NULL排序验收开关变化，永久停链');}};
  require('./query-result-nulls-live').registerQueryResultNullsUi(binding);
}else test.skip('NULL排序位置真实客户端验收默认关闭（未执行）',()=>{});
