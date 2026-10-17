import { test } from '@playwright/test';
// 真正--list先短路，默认关闭不导入live或读取认证/输出路径配置。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_QUERY_RESULT_COLUMNS_UI==='1'){
 const {bindQueryResultColumnsUiTarget,queryResultColumnsUiKeys}=require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
 const helper=Object.fromEntries(queryResultColumnsUiKeys.filter(key=>Object.hasOwn(process.env,key)).map(key=>[key,process.env[key]]));
 const binding=bindQueryResultColumnsUiTarget(()=>process.env,helper);
 require('./query-result-columns-live').registerQueryResultColumnsUi(binding);
}else test.skip('结果列真实App显隐排序与所选行CSV／JSON验收默认关闭（未执行）',()=>{});
