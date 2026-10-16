/** 保存查询命中仅用于当前原文的只读导航，不借用SQL执行入口。 */
export const savedQueryNavigationZh={title:'保存查询正文命中',previous:'上一处命中',next:'下一处命中',close:'关闭命中高亮',invalid:'正文、来源或位置校验已失效；请重新搜索打开。',count:(index:number,count:number)=>`第 ${index+1} / ${count} 处`,capped:(limit:number)=>`仅显示前 ${limit} 处，仍有命中未列出；导航只在已显示范围内循环。`,complete:'已列出该SQL全文的全部非重叠命中。'};
