/** 对象浏览只保存目录定位，不持有查询正文、来源授权或数据库会话。 */
export const objectCategories = ['table', 'view', 'routine', 'trigger', 'event'] as const;
export type ObjectCategory = typeof objectCategories[number];

/** 原输入先核自有属性，避免解析器把继承的对象分类或数据库提升为有效定位。 */
export function assertObjectBrowserTabs(settings: { tabs?: unknown }): void {
  if (!Array.isArray(settings.tabs)) throw Error('工作区标签列表必须是数组');
  for (const tab of settings.tabs) {
    if (!tab || typeof tab !== 'object') throw Error('工作区标签必须是对象');
    if (tab.kind !== 'objects') {
      if ('objectCategory' in tab) throw Error('只有对象浏览标签可以保存对象分类');
      continue;
    }
    for (const field of ['kind', 'connectionId', 'database', 'objectCategory']) {
      const descriptor = Object.getOwnPropertyDescriptor(tab, field);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('对象浏览定位必须使用自有数据属性');
    }
    const value = tab as Record<string, unknown>;
    if (typeof value.connectionId !== 'string' || !value.connectionId || value.connectionId.length > 200 || value.connectionId.includes('\0')) throw Error('对象浏览连接无效');
    if (typeof value.database !== 'string' || !value.database || value.database.length > 64 || value.database.includes('\0')) throw Error('对象浏览必须指定有效数据库');
    if (!objectCategories.includes(value.objectCategory as ObjectCategory)) throw Error('对象浏览分类无效');
    for (const field of ['sql', 'table', 'databaseContext', 'sourceBinding', 'fileSourceBinding', 'queryEditorHeight']) {
      if (field in tab) throw Error('对象浏览标签不能持有查询或数据编辑字段');
    }
    const fields = ['id', 'kind', 'title', 'connectionId', 'database', 'objectCategory'];
    if (Reflect.ownKeys(tab).some(field => typeof field !== 'string' || !fields.includes(field))) throw Error('对象浏览标签不能保存其它字段');
  }
}

/** 读取时仅丢弃损坏的对象浏览定位，原查询和表格标签逐项保留，且不隐式写盘。 */
export function readObjectBrowserTabs<T extends { kind: string }>(tabs: T[]): T[] {
  return tabs.filter(tab => {
    if (!tab || typeof tab !== 'object' || tab.kind !== 'objects') return true;
    try { assertObjectBrowserTabs({ tabs: [tab] }); return true; } catch { return false; }
  });
}
