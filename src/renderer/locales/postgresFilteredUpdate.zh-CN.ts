import { postgresFilteredWriteMaxRows } from '../../shared/postgresTable';

export const postgresFilteredUpdateZh = {
  entry: '按当前筛选更新', title: '按筛选批量更新 PostgreSQL', preview: '读取匹配行并预览',
  scope: `使用当前已应用的筛选，包含其他页的匹配记录。最多 ${postgresFilteredWriteMaxRows} 行，超限时请缩小范围。`,
  confirmation: '输入预览更新行数', affected: (count: number) => `预览更新 ${count} 行`,
  conditions: '已应用条件', parameters: '筛选参数（按顺序）',
  verify: '提交会在锁内再次核对完整匹配集合和行版本。任一变化都会拒绝整批操作。',
  edit: '返回修改赋值', retry: '可修改赋值后重新预览。', stale: '原表页或筛选已变化，请重新打开按筛选更新。',
};

export const postgresFilteredDeleteZh = {
  entry: '按当前筛选删除', title: '预览按筛选删除',
  confirmation: '输入预览删除行数',
  affected: (table: string, count: number) => `将从 ${table} 删除 ${count} 行，包含其他页的匹配记录。`,
  sideEffects: '外键动作和触发器可能影响其他记录，行数只统计当前表直接匹配的记录。',
  apply: '确认删除全部匹配记录', retry: '请排除数据库拒绝原因，再重新预览。',
};
