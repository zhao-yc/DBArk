export const queryResultSnapshotZh = {
  invalid: '结果快照格式或字段无效，未恢复任何数据。',
  version: '结果快照类型或版本不受支持。',
  tooLarge: '结果快照超过字节、行列、单值或对象数量预算；不会静默截断数据。',
  encoding: '结果快照必须使用完整、有效的 UTF-8 编码。',
  duplicate: '结果快照包含重复的 JSON 字段，无法无损确认原文，已拒绝整份文件。',
  scope: '快照仅包含已返回的结果及源 SQL，不包含连接配置或活动会话；打开不会建连、恢复会话或执行 SQL。',
  privacy: '快照文件未加密，包含原始数据和源 SQL，请确认保存位置及访问权限。',
} as const;
