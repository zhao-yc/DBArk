/** SQL结果显示列布局；序号始终指向原始返回列，重复别名不会混淆身份。 */
export const queryResultColumnsZh = {
  open:'管理结果列',title:'结果列管理',search:'搜索结果列',searchHint:'按列名、类型或原列序号搜索',
  hint:'仅调整当前结果显示。复制和已返回结果导出使用相同可见列；至少保留一列。',
  restore:'恢复原顺序',restoreHint:'保留当前显隐选择，只恢复原始列顺序。',apply:'应用列布局',
  empty:'没有匹配的结果列',stale:'结果或操作上下文已变化，请关闭后重新打开列管理。',
  ordinal:(position:number)=>`原第${position}列`, visible:(position:number)=>`显示原第${position}列`,
  up:(position:number)=>`上移原第${position}列`,down:(position:number)=>`下移原第${position}列`,
};
