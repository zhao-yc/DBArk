/** 恢复与提交分开确认，完整原始数据只写入用户明确选择的本地文件。 */
export const sqliteTableDraftZh = {
  save: '保存 SQLite 草稿文件', restore: '恢复 SQLite 草稿文件',
  saveTitle: '保存 SQLite 草稿文件', restoreTitle: '恢复 SQLite 草稿文件',
  warning: '草稿文件未加密，包含完整原始行、可靠定位及待提交值。请仅保存在受信任的位置。',
  scope: '保存全部保留页已暂存的新增、修改与删除，不保存未暂存输入和撤销历史，也不提交数据库。',
  restoreScope: '选择文件后只读核验原文件、表结构和完整原行，恢复为独立草稿视图；仍须预览后明确提交。',
  saveAck: '我已知晓草稿文件未加密且含完整原始数据', restoreAck: '仅核验并恢复草稿，不自动写入数据库；我已核对此前提交状态',
  choose: '选择 SQLite 草稿文件', chooseAgain: '重新选择 SQLite 草稿文件', noFile: '尚未选择草稿文件',
  counts: (insert: number, update: number, remove: number) => `新增 ${insert} · 修改 ${update} · 删除 ${remove}`,
  saveAction: '选择位置并保存 SQLite 草稿', restoreAction: '只读核验并恢复 SQLite 草稿', close: '关闭', cancel: '取消原恢复核验',
  busy: '正在等待原文件操作或只读核验完成', cancelling: '已请求取消，等待原核验任务及取消回执结束。', cancelled: '本轮恢复已取消，未恢复任何修改。请重新选择文件。',
  saved: 'SQLite草稿文件已保存，数据库修改仍未提交。', savedStale: '草稿文件已保存，但原页已失效。请核对文件；不会自动重试。',
  stale: '原标签、草稿或连接已经变化，未恢复任何修改。', existing: '当前已有草稿或撤销记录，请先保存、提交或明确放弃，再恢复文件。', invalid: 'SQLite草稿或恢复回执无效，未恢复任何修改。',
  restored: '当前显示已核验的恢复草稿，不是服务器分页；仍须预览后明确提交。', leave: '返回服务器数据',
} as const;
