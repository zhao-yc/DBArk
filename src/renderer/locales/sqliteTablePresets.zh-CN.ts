/** 本机方案与数据库读取分离，载入后仍须明确应用。 */
export const sqliteTablePresetsZh = {
  entry: 'SQLite 筛选方案', title: 'SQLite 本机筛选／排序方案', name: 'SQLite 方案名称', selection: 'SQLite 已保存方案',
  reload: '刷新 SQLite 方案', save: '保存新的 SQLite 方案', replace: '覆盖所选 SQLite 方案', remove: '删除所选 SQLite 方案', load: '载入 SQLite 方案条件',
  placeholder: '选择方案', scope: '按当前连接和表保存；包含条件原值，仅保存在本机。载入只填写表单，点击“应用”后才查询数据库。',
  saved: '本机方案已保存，当前条件和数据草稿未改变。', removed: '本机方案已删除，当前条件和数据草稿未改变。', loaded: '方案已载入条件草稿，请检查后点击“应用”。',
  changed: '原表页、连接或条件表单已变化，未覆盖当前内容；请刷新或重新载入。', stale: '来源已失效，请刷新方案。', busy: '正在处理本机方案…',
  missing: '请先选择一个已保存方案。', staleEntry: '（连接来源已变化）', empty: '当前表还没有本机方案。',
  confirmReplace: (name: string) => '覆盖本机方案“' + name + '”的条件和排序？名称保持不变，不修改数据库。',
  confirmRemove: (name: string) => '删除本机方案“' + name + '”？不会删除表或改变数据。',
};
