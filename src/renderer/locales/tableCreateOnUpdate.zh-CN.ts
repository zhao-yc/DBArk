export const tableCreateOnUpdateZh = {
  title: '自动更新时间', legacy: '未指定（保持原创建行为）', none: '明确不自动更新', current: 'CURRENT_TIMESTAMP', precision: '自动更新时间精度',
  label: (position: number) => `第${position}列自动更新时间`, precisionLabel: (position: number) => `第${position}列自动更新时间精度`,
  hint: '仅普通DATETIME/TIMESTAMP，DEFAULT为SQL NULL或CURRENT_TIMESTAMP且精度一致；服务器版本在预览时核对。',
} as const;
