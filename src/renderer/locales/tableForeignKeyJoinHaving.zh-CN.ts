/** HAVING与WHERE分别编辑，原表达式和指标身份由纯编译器及当前草稿校验。 */
export const tableForeignKeyJoinHavingZh={
  title:'HAVING 聚合后筛选',hint:'仅筛选当前分组字段和聚合输出，发生在聚合之后、排序和LIMIT之前；WHERE仍只筛选聚合前的行。条件只更新预览，不自动执行。',
  mode:'HAVING 条件组合',all:'全部满足（AND）',any:'任一满足（OR）',empty:'尚无 HAVING 条件。',add:'添加 HAVING 条件',clear:'清空 HAVING 条件',groups:'组合 HAVING 条件',flat:'恢复平铺 HAVING',structure:'HAVING 组合结构',
  target:(n:number)=>`第 ${n} 项 HAVING 输出`,operator:(n:number)=>`第 ${n} 项 HAVING 运算符`,value:(n:number)=>`第 ${n} 项 HAVING 值`,upper:(n:number)=>`第 ${n} 项 HAVING 上界`,values:(n:number)=>`第 ${n} 项 HAVING 集合`,enabled:(n:number)=>`启用第 ${n} 项 HAVING`,includeEmpty:(n:number)=>`第 ${n} 项 HAVING 包含空字符串`,remove:(n:number)=>`移除第 ${n} 项 HAVING`,
  grouped:'分组字段',aggregate:'聚合输出',stale:(label:string)=>`${label}（原输出已失效，请明确重选）`,targetMissing:'HAVING 原输出已移除或当前汇总配置无效，请先修正输出或明确重选；未按相同别名自动改绑。',
  invalid:'HAVING 只接受当前输出的有效条件、全部/任一模式及完整有界分组，不接受原始SQL。',budget:'HAVING 展开超过 SQL 预算，未截断或忽略条件。',draftBudget:'WHERE 与 HAVING 保留的值草稿合计超过1000000字符；本次输入未应用，原草稿保持。',requiresSummary:'HAVING 必须属于已明确配置的分组聚合查询，不能退化成 WHERE 或明细筛选。',
  groupHint:'只调整 HAVING 既有条件的括号、AND/OR 和所属组。原输出身份、值及启停保持；应用只更新当前SQL预览，取消保留原组合。',groupStale:'HAVING 来源、条件或窗口已变化，原分组草稿不能应用，请取消后从当前窗口重新打开。',groupDeclined:'未应用 HAVING 分组，原条件和本地草稿保持。',
  grouping:'正在编辑 HAVING 条件组；先应用或取消本地分组草稿，再预览或打开查询。',
} as const;
