/** 查询标签独立保存编辑区像素高度，不改变SQL、结果数据或全局编辑器偏好。 */
export const queryLayoutLimits = { minEditorHeight: 130, maxEditorHeight: 8192, defaultEditorHeight: 300 } as const;
export const queryLayoutWidthLimits = { minEditorWidth: 260, maxEditorWidth: 8192, defaultEditorWidth: 420, minResultWidth: 400, separatorWidth: 22 } as const;
export const queryResultPlacements = ['below', 'beside'] as const;
export type QueryResultPlacement = typeof queryResultPlacements[number];
export const queryResultBesideMinimum = 800;

/** 旧标签及损坏的布局值在读取时回退到下方。 */
export function readQueryResultPlacement(value: unknown): QueryResultPlacement {
  return value === 'beside' ? 'beside' : 'below';
}
/** 只接受有限范围内原始整数；字符串、小数与无穷值不得强转或截断。 */
function isQueryEditorHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= queryLayoutLimits.minEditorHeight && value <= queryLayoutLimits.maxEditorHeight;
}
/** 缺项及坏值只在读取时回退300，不触发任何持久化写入。 */
export function readQueryEditorHeight(value: unknown): number {
  return isQueryEditorHeight(value) ? value : queryLayoutLimits.defaultEditorHeight;
}
/** 只接受已校验的整数像素宽度，旧标签使用默认宽度。 */
export function readQueryEditorWidth(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= queryLayoutWidthLimits.minEditorWidth && value <= queryLayoutWidthLimits.maxEditorWidth ? value : queryLayoutWidthLimits.defaultEditorWidth;
}
/** 按实测工作区给结果和分隔条预留宽度，不能将显示上限写回偏好。 */
export function queryEditorWidthMaximum(available: number): number {
  return Math.max(0, Math.min(queryLayoutWidthLimits.maxEditorWidth, Math.floor(available) - queryLayoutWidthLimits.separatorWidth - queryLayoutWidthLimits.minResultWidth));
}
/** IPC及直接存储共用：缺项兼容旧标签，显式undefined和非查询标签字段均拒绝。 */
export function assertQueryLayoutWrite(settings: { tabs?: unknown }): void {
  if (!Array.isArray(settings.tabs)) throw Error('查询布局的标签列表必须是数组');
  for (const tab of settings.tabs) {
    if (!tab || typeof tab !== 'object') throw Error('查询布局的标签必须是对象');
    if ('queryEditorHeight' in tab) {
      if (!Object.hasOwn(tab, 'queryEditorHeight')) throw Error('查询编辑区高度必须是标签的自有字段');
      if (tab.kind !== 'query') throw Error('只有查询标签可以保存编辑区高度');
      if (!isQueryEditorHeight(tab.queryEditorHeight)) throw Error('查询编辑区高度必须是130–8192之间的整数');
    }
    if ('queryResultPlacement' in tab) {
      if (!Object.hasOwn(tab, 'queryResultPlacement') || tab.kind !== 'query' || !queryResultPlacements.some(value => value === tab.queryResultPlacement)) throw Error('只有查询标签可以保存有效的结果位置');
    }
    if ('queryEditorWidth' in tab) {
      if (!Object.hasOwn(tab, 'queryEditorWidth') || tab.kind !== 'query' || readQueryEditorWidth(tab.queryEditorWidth) !== tab.queryEditorWidth) throw Error('只有查询标签可以保存 260–8192 之间的整数编辑区宽度');
    }
  }
}
