/** 原页草稿只留在当前标签内存；所有页统一预览并明确提交。 */
export const tableEditWorkspaceZh = {
  region: '多页草稿',
  summary: (pages: number, changes: number) => `保留 ${pages} 页 · 共 ${changes} 条本地修改`,
  hint: '切页保留原页草稿与撤销记录，返回缓存页不重新读取。全部保留页统一预览、一次提交；各页不是同一数据库快照。关闭或重启不会自动恢复，请先保存草稿文件。',
  restoredHint: '已按保存时的原页号恢复变更分组，切换分组不读取数据库。这里只显示草稿记录，页号不是当前服务器分页；各组可独立编辑、撤销和放弃，全部修改统一预览提交。',
  page: (index: number) => `返回保留页 ${index}`,
  discard: (index: number) => `放弃保留页 ${index}`,
  confirmPage: (index: number, changes: number, current: boolean, others: boolean) => `放弃保留页 ${index} 的 ${changes} 条修改及撤销／重做记录？其它保留页保持。${current ? others ? '放弃后返回另一个保留页，不读取数据库。' : '当前页会重新读取。' : '此操作不读取数据库。'}`,
  confirmAll: '当前表有保留页草稿或撤销／重做记录。放弃全部保留页并重新读取？取消将保持全部草稿。',
  limit: '最多保留16页，整组原值与当前值最多64 MiB／100000格。请先保存、提交或明确放弃部分页，再继续翻页。',
  stale: '保留页的目标、连接、条件或结构已变化，原草稿保持。请核对后明确放弃全部并重新读取。',
  input: '请先暂存当前记录输入，再切换保留页；非法输入会保留在当前页。',
  overlap: '多个保留页修改了同一条原记录，请先修正或放弃重复页，不能重复提交同一原值定位。',
  preview: (pages: number) => `本次统一预览 ${pages} 个原页的修改；任一记录冲突将整批回滚。`,
  stagePrevious: '暂存并查看上一页末条', stageNext: '暂存并查看下一页首条',
};
