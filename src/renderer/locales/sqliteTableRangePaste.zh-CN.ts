import { sqliteTableClipboardZh } from './sqliteTableClipboard.zh-CN';

/** 区域粘贴只改变本地已有草稿区域，位置和类型均明确，不借来源列名重新排序。 */
export const sqliteTableRangePasteZh = {
  entry: '覆盖当前单元格区域…',
  title: '粘贴到 SQLite 当前选区', paste: '粘贴到当前单元格', stage: '暂存区域修改', cancel: '取消',
  source: '剪贴板内容', sourceColumn: '选择来源列', conversion: '写入类型', mapping: '按位置写入的目标字段',
  positionHint: '从当前单元格按位置覆盖完整矩形，不按来源列名重排，不跳过生成列；越界、待删除行或生成列会整组拒绝。',
  bindingHint: '保留的是来源绑定类型，最终存储仍受目标字段亲和性及约束影响；例如文本 001 写入 INTEGER 字段可能变为 1。',
  previewRows: 'SQLite 区域粘贴前十行预览', preview: '预览区域修改', previewHint: '仅展示前 10 行；暂存仍保留完整批次。这里不执行 SQL，修改需预览并明确集中提交。',
  oldValue: '原草稿值', newValue: '粘贴后值', defaultValue: 'DEFAULT（省略）', noChanges: '该区域没有实际值变化。',
  anchorRequired: '请先选中准确的 SQLite 数据单元格作为粘贴起点。', stale: '原 SQLite 页、草稿行或粘贴起点已变化，此区域计划已失效。',
  readonly: '当前 SQLite 页为只读，不能暂存区域修改。', invalid: 'SQLite 区域粘贴来源或原草稿格式无效。', outOfBounds: '粘贴矩形超出当前草稿页的行列范围；不会部分写入或自动扩行。',
  deleted: '粘贴区域含本地待删除记录；不会跳过该行或部分写入。', generated: '粘贴区域含生成列；不会跳列或部分写入。',
  defaultExisting: '已有记录不能粘贴 DEFAULT；只有本地新增草稿可以省略字段，DEFAULT 与 NULL 不同。',
  kindsInvalid: '每个来源列必须有一个明确的转换类型。', rowLimit: '每次区域粘贴最多 500 行。',
  kindLabels: sqliteTableClipboardZh.kindLabels, column: sqliteTableClipboardZh.column,
  changedCounts: (rows: number, width: number, cells: number) => rows + ' 行 × ' + width + ' 列，' + cells + ' 格变化',
  targetRange: (startRow: number, endRow: number, startColumn: number, endColumn: number) => '当前草稿页第 ' + startRow + '～' + endRow + ' 行，第 ' + startColumn + '～' + endColumn + ' 列',
} as const;
