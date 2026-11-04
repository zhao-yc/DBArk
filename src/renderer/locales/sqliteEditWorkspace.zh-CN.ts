/** 多页草稿只在当前表标签内存中保留，不把记录值保存到本机配置。 */
export const sqliteEditWorkspaceZh = {
  region: 'SQLite 多页草稿', summary: (pages: number, changes: number) => `保留 ${pages} 页 · 共 ${changes} 条本地修改`,
  hint: '切页保留各页输入与撤销记录；统一预览后再明确提交。草稿仅在当前标签内存中，关闭或重启不会恢复。',
  page: (offset: number, limit: number) => `返回保留页 ${Math.floor(offset / limit) + 1}`,
  active: '当前页', stalePage: '来源已失效', stale: '保留页的原来源、条件或结构已变化。草稿保持，请核对后放弃全部并重新读取。',
  limit: '最多保留16页有修改或撤销记录的草稿，请先统一提交或明确放弃，再打开其它页。',
  unknown: '多页修改结果未知，整组草稿已锁定。请核对原数据库，禁止重复提交。',
  preview: '本次预览包含全部有修改的保留页；任一记录冲突将整批回滚。',
  previewPages: (count: number) => `统一预览 ${count} 个原页的修改`,
  confirmDiscard: '当前表标签有保留页草稿或撤销记录。放弃全部保留页并重新读取？选择取消会保持全部输入。',
};
