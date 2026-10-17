/** 查询标签独立保存编辑区像素高度，不改变SQL、结果数据或全局编辑器偏好。 */
export const queryLayoutLimits = { minEditorHeight: 130, maxEditorHeight: 8192, defaultEditorHeight: 300 } as const;
/** 只接受有限范围内原始整数；字符串、小数与无穷值不得强转或截断。 */
function isQueryEditorHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= queryLayoutLimits.minEditorHeight && value <= queryLayoutLimits.maxEditorHeight;
}
/** 缺项及坏值只在读取时回退300，不触发任何持久化写入。 */
export function readQueryEditorHeight(value: unknown): number {
  return isQueryEditorHeight(value) ? value : queryLayoutLimits.defaultEditorHeight;
}
/** IPC及直接存储共用：缺项兼容旧标签，显式undefined和非查询标签字段均拒绝。 */
export function assertQueryLayoutWrite(settings: { tabs?: unknown }): void {
  if (!Array.isArray(settings.tabs)) throw Error('查询布局的标签列表必须是数组');
  for (const tab of settings.tabs) {
    if (!tab || typeof tab !== 'object') throw Error('查询布局的标签必须是对象');
    if (!('queryEditorHeight' in tab)) continue;
    if (!Object.hasOwn(tab, 'queryEditorHeight')) throw Error('查询编辑区高度必须是标签的自有字段');
    if (tab.kind !== 'query') throw Error('只有查询标签可以保存编辑区高度');
    if (!isQueryEditorHeight(tab.queryEditorHeight)) throw Error('查询编辑区高度必须是130–8192之间的整数');
  }
}
