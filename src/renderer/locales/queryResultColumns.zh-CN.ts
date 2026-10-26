/** SQL结果显示列布局；序号始终指向原始返回列，重复别名不会混淆身份。 */
export const queryResultColumnsZh = {
  open:'管理结果列',title:'结果列管理',search:'搜索结果列',searchHint:'按列名、类型或原列序号搜索',
  hint:'仅调整当前结果显示。复制和已返回结果导出使用相同可见列；至少保留一列。',
  restore:'恢复原顺序',restoreHint:'保留当前显隐和冻结目标，只恢复原始列顺序；冻结范围随新顺序重算。',apply:'应用列布局',
  freezeButton:'冻结到此列',freezeThrough:(position:number)=>`冻结到原第${position}列`,unfreeze:'取消冻结',boundary:'冻结边界',
  frozenThrough:(position:number)=>`当前冻结边界：原第${position}列`,freezeStatus:'结果列冻结状态',notFrozen:'当前未冻结结果列',
  freezeHint:'冻结当前可见列从左侧到所选边界，选择框不计入。隐藏边界会取消冻结；移动或恢复顺序后按同一边界列重算。仅属于当前准确结果，切换结果或固定快照后重置。',
  empty:'没有匹配的结果列',stale:'结果或操作上下文已变化，请关闭后重新打开列管理。',
  ordinal:(position:number)=>`原第${position}列`, visible:(position:number)=>`显示原第${position}列`,
  up:(position:number)=>`上移原第${position}列`,down:(position:number)=>`下移原第${position}列`,
};
