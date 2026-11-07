/** Monaco 查找条常驻编辑器，使用 dialog 角色但不接管工作区。 */
export const appDialogSelector = '[role="dialog"]:not(.editor-widget.find-widget)';
export const appModalSelector = `${appDialogSelector}, [role="alertdialog"]`;

/** 变更记录可能包含已脱离文档的节点，仍按该节点的角色撤销旧操作。 */
export function isAppModalNode(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  const role = element.getAttribute('role');
  return role === 'alertdialog' || role === 'dialog' &&
    !(element.classList.contains('editor-widget') && element.classList.contains('find-widget'));
}
