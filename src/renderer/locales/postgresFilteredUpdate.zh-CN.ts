import { postgresFilteredUpdateMaxRows } from '../../shared/postgresTable';

export const postgresFilteredUpdateZh = {
  entry: '按当前筛选更新', title: '按筛选批量更新 PostgreSQL', preview: '读取匹配行并预览',
  scope: `使用当前已应用的筛选，包含其他页的匹配记录。最多 ${postgresFilteredUpdateMaxRows} 行，超限时请缩小范围。`,
  confirmation: '输入预览更新行数', affected: (count: number) => `预览更新 ${count} 行`,
  conditions: '已应用条件', parameters: '筛选参数（按顺序）',
  verify: '提交会在锁内再次核对完整匹配集合和行版本。任一变化都会拒绝整批更新。',
  edit: '返回修改赋值', retry: '可修改赋值后重新预览。', stale: '原表页或筛选已变化，请重新打开按筛选更新。',
};
