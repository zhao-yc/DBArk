export const importMappingZh = {
  actions: '批量字段映射',
  name: '按同名字段匹配',
  position: '按目标列顺序映射',
  clear: '清空映射',
  replace: '批量操作会替换当前映射。顺序映射使用可写目标列的顺序，请核对字段对应关系。',
  limit: (maximum: number) => `批量匹配超过 ${maximum} 个字段，请改用手动映射。`,
} as const;
