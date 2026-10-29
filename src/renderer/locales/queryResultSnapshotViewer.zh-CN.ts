export const queryResultSnapshotViewerZh = {
  entry: '查看结果快照', title: '离线结果快照', choose: '选择结果快照', save: '另存完整快照', close: '关闭',
  notice: '文件含原始数据和 SQL，可能包含敏感内容，请妥善保管。',
  scope: '离线只读查看，不执行来源 SQL。文件只含原查询已返回范围，最多 16 MiB；另存保留文件的全部原始列、行和来源 SQL，不按网格选中范围裁剪。',
  truncated: '原结果已截断：文件不代表完整查询或数据库全表。',
  sourceShow: '显示来源 SQL', sourceHide: '隐藏来源 SQL', sourceTitle: '来源 SQL（只读，不执行）',
  empty: '请选择结果快照文件', opening: '正在选择并读取文件…', saving: '正在另存完整快照…',
  waiting: '原文件操作尚未结束，请等待文件选择、读写和清理完成后再关闭。', cancelled: '本次文件选择已取消，当前内容保持不变。',
  opened: (name: string) => `已打开：${name}`, saved: (name: string) => `已另存：${name}`,
  count: (rows: number, columns: number) => `${rows} 行 · ${columns} 列 · 只读`,
  stale: '原查看窗口或显示来源已变化，本次回包未接纳。',
  lateSave: '快照文件可能已保存，但原查看窗口已失效，请核对目标文件；不会自动重试。',
} as const;
