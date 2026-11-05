/** 多页工作区只在标签内存保留；显式草稿文件独立保存，不把记录值放进本机配置。 */
export const sqliteEditWorkspaceZh = {
  region: 'SQLite 多页草稿', summary: (pages: number, changes: number) => `保留 ${pages} 页 · 共 ${changes} 条本地修改`,
  hint: '切页保留各页草稿与撤销记录；统一预览后再明确提交。可手动保存草稿文件，关闭或重启不会自动恢复。',
  page: (offset: number, limit: number) => `返回保留页 ${Math.floor(offset / limit) + 1}`,
  restoredHint: '已按原页号恢复变更分组。切换分组不读数据库，各组可独立撤销或放弃；全部变化统一预览并明确提交。原页号不是当前服务器分页。',
  active: '当前页', stalePage: '来源已失效', stale: '保留页的原来源、条件或结构已变化。草稿保持，请核对后放弃全部并重新读取。',
  discardPage: (offset: number, limit: number) => `放弃保留页 ${Math.floor(offset / limit) + 1}`,
  discardPageShort: '放弃此页',
  confirmPageDiscard: (offset: number, limit: number, changes: number, history: boolean, current: boolean) => `放弃保留页 ${Math.floor(offset / limit) + 1} 的 ${changes} 条本地修改${history ? '及撤销／重做记录' : ''}？其它保留页保持。${current ? '当前页将重新读取数据库。' : '此操作不读取或修改数据库。'}`,
  pageDiscarded: (offset: number, limit: number) => `已放弃保留页 ${Math.floor(offset / limit) + 1}，其它保留页草稿保持。`,
  limit: '最多保留16页有修改或撤销记录的草稿，请先统一提交或明确放弃，再打开其它页。',
  unknown: '多页修改结果未知，整组草稿已锁定。请核对原数据库，禁止重复提交。',
  preview: '本次预览包含全部有修改的保留页；任一记录冲突将整批回滚。',
  previewPages: (count: number) => `统一预览 ${count} 个原页的修改`,
  confirmDiscard: '当前表标签有保留页草稿或撤销记录。放弃全部保留页并重新读取？选择取消会保持全部输入。',
};
