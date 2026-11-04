export const sqliteRelatedTableZh = {
  open: '在独立表页打开关联子记录', title: (table: string) => table + ' · 关联记录',
  scope: (parent: string, columns: readonly string[]) => '固定关联：' + parent + ' → ' + columns.join(', ') + '。普通筛选与排序仅作用于这组关联；编辑仍须预览并明确提交。',
  expired: '关联表页的会话来源已失效或未恢复，未读取无条件全表。请保留所需草稿，关闭后从原父记录重新打开。',
  keys: (columns: readonly string[], values: readonly import('../../shared/sqliteTableBrowse').SqliteFilterSelection[]) => '父键原值：' + columns.map((name, index) => { const value = values[index]; if (value.kind === 'null') return name + ' = NULL'; const text = Array.from(value.value); return name + ' = ' + value.kind + ' ' + JSON.stringify(text.slice(0, 80).join('') + (text.length > 80 ? '…' : '')); }).join('，'),
  hint: '关联值只保留在当前会话；重启后须重新从父记录打开。已有普通表标签和草稿保持。',
};
