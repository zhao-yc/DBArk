import { test } from '@playwright/test';
// 仅未来ROOT明确开启时导入原生定义；--list优先短路，不读实跑配置、不加载desktop。
const listing=process.argv.some(value=>value==='--list'||value.startsWith('--list='));
if(!listing&&process.env.DBARK_HISTORY_TIME_FILTER_TEST==='1'){
 const { registerHistoryTimeFilterTests }=require('./history-time-filter-live');registerHistoryTimeFilterTests();
}else test.skip('历史时间范围原生定义默认关闭（员工3实际0）',()=>{});
