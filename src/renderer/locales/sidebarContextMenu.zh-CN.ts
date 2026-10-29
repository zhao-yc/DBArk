/** 对象树菜单仅改变渲染层入口，节点名称保持原始大小写和字符。 */
export const sidebarContextMenuZh = {
  title: (name: string) => `对象树操作：${name}`,
  hint: '右键或按 Shift+F10 打开操作菜单',
  open: '打开对象', openObject: (name: string) => `打开对象 ${name}`,
  copyLink: '复制对象链接', copyObjectLink: (name: string) => `复制对象链接 ${name}`,
  refreshObject: (name: string) => `刷新对象列表 ${name}`,
  groups: { open: '打开与浏览', create: '创建', structure: '设计与结构', transfer: '数据传输', favorite: '收藏与链接', refresh: '刷新', danger: '危险操作' }
};
