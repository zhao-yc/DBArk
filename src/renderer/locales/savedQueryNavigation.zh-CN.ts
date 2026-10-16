/** 保存查询命中仅用于当前原文的只读导航，不借用SQL执行入口。 */
export const savedQueryNavigationZh={title:'保存查询正文命中',previous:'上一处命中',next:'下一处命中',close:'关闭命中高亮',invalid:'正文、来源或位置校验已失效；请重新搜索打开。',unlocatable:'当前结果包含编辑器无法精确定位的位置，已关闭本次高亮与导航；原SQL和命中未改，请调整条件重新搜索。',count:(index:number,count:number)=>`第 ${index+1} / ${count} 处`,capped:(limit:number)=>`仅显示前 ${limit} 处，仍有命中未列出；导航只在已显示范围内循环。`,complete:'已列出该SQL全文的全部非重叠命中。'};
