/** SQLite复制与新增草稿映射的集中中文文案。 */
export const sqliteTableClipboardZh = {
  title: '粘贴为 SQLite 新增草稿', paste: '粘贴为新增草稿', copyCell: '复制 SQLite 单元格', copyRow: '复制 SQLite 当前行', copyRange: '复制 SQLite 选区', copyAll: '复制 SQLite 当前页',
  preview: '预览新增草稿', previewRows: 'SQLite 粘贴前十行预览', previewHint: '仅展示前10行；暂存会保留完整映射批次，不执行SQL。', defaultValue: 'DEFAULT（省略）', generatedValue: '生成列（省略）',
  sourceColumn: '选择粘贴来源列',
  source: '剪贴板内容', mapping: '来源列映射', skip: '跳过此来源列', target: '目标字段', conversion: '写入类型', stage: '暂存新增草稿', cancel: '取消', read: '读取剪贴板', clear: '清空输入',
  plainHint: '普通文本始终先作为文本；不会自动识别数字、NULL 或默认值。请明确选择目标字段和写入类型。',
  typedHint: '保留来源的绑定类型；最终存储仍受目标字段亲和性及约束影响，例如文本 001 写入 INTEGER 字段可能变为 1。这里只暂存新增草稿，预览并明确提交后才会写入数据库。',
  mappingHint: '按来源列映射；跳过字段使用 DEFAULT，生成列不能写入。自增字段不会自动跳过，请明确调整。',
  kindLabels: { preserve: '保留来源类型', text: '文本', integer: '整数（64 位）', real: '实数（有限）', blob: '二进制（十六进制）', null: 'NULL', default: 'DEFAULT（省略）' },
  column: (index: number) => '来源第 ' + (index + 1) + ' 列', counts: (rows: number, width: number) => rows + ' 行，' + width + ' 列',
  invalid: 'SQLite 剪贴板内容或映射格式无效。', nativeInvalid: 'SQLite 原生剪贴板格式损坏或版本不支持；不会降级猜测为普通文本。',
  tooLarge: 'SQLite 剪贴板单种格式或整组内容超过 2 MiB 预算。', rowLimit: '每次最多粘贴 500 行新增草稿。', copyRowLimit: '每次最多复制当前页的 1000 行。', cellLimit: '每次最多处理 10000 个来源单元格。',
  valueLimit: 'SQLite 单元格超过 65536 字符预算。', ragged: '剪贴板必须是列数一致的完整矩形。', unicode: '剪贴板包含无法完整保留的 Unicode 字符。',
  readonly: '当前 SQLite 页为只读，不能暂存新增草稿。', mappingInvalid: '来源列数、字段映射或转换类型无效。', mappingDuplicate: '同一目标字段不能被重复映射。', generated: '生成列不能接收粘贴值。',
  stale: '原 SQLite 页或编辑快照已变化，此粘贴计划已失效。', noMapping: '请至少明确映射一个可写目标字段。', nonfinite: '复制的非有限 REAL 可以查看，但新增草稿只接受有限实数。',
  defaultConversion: '来源 DEFAULT 只能保留为 DEFAULT，或明确选择 NULL/DEFAULT。', conversionInvalid: '单元格不能按所选类型无损解释；请调整映射或原文。',
} as const;
