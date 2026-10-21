export const queryResultHistoryZh = {
  undo: '撤销结果整理', redo: '重做结果整理',
  hint: '只恢复当前已返回结果的排序和筛选，不执行SQL或撤销数据库修改。最多保留20步；新查询、切换结果或列布局后清空。',
  limited: '本次整理超出历史容量，已清空撤销记录；当前排序和筛选保持。',
  stale: '结果整理历史已变化，请使用当前结果重新操作。',
} as const;
