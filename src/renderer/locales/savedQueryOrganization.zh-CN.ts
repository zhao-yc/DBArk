/** 分组只整理本地查询身份，不执行或回显完整SQL。 */
export const savedQueryOrganizationZh = {
  title: '保存查询分组', all: '全部查询', unfiled: '未分组', includeDescendants: '包含子分组', tree: '保存查询分组树', toggle: '显示或折叠分组树',
  create: '新建分组', rename: '重命名分组', moveGroup: '移动分组', dissolve: '解散分组', moveQueries: '移动选中查询', clear: '清空选择',
  groupName: '分组名称', parent: '父分组', destination: '目标分组', root: '顶层', choose: '请选择分组', preview: '预览分组变更', confirm: '确认分组变更', back: '返回修改', cancel: '取消分组变更',
  previewTitle: '分组变更预览', metadataOnly: '仅修改本地分组，不执行SQL，不修改查询正文、来源连接或默认库，也不影响已打开的查询草稿。',
  dissolveWarning: '将解散此分组及全部子分组，所有成员退回未分组；不会删除任何保存查询。',
  selected: (count: number, hidden: number) => `已选${count}条，其中${hidden}条不在当前页；最多100条。`,
  select: (name: string) => `选择保存查询：${name}`, direct: (count: number, total: number) => `直接${count}条，含子组${total}条`,
  selectGroup: (path: string) => `选择分组：${path}`,
  selectPage: '选择当前页查询',
  selectionLimit: '最多选择100条，请先处理或清空选择。', snapshotInvalid: '保存查询分组回包无效，请刷新后重试。', stale: '分组或预览已变化，请刷新后重新预览；未自动重试。',
  refreshRequired: '本次未自动重放，请点击“刷新到第一页”核对最新分组后再操作。', saved: '分组变更已保存。', scopeRemoved: '原分组已不存在，现显示未分组。',
  source: '原分组', target: '变更后位置', members: (groups: number, count: number) => `受影响分组${groups}个，查询${count}条。`,
  queries: (count: number) => `移动${count}条已选查询（包括隐藏选择）。`, noChange: '没有分组变更可预览。',
};
