/** 粘贴新增只暂存本地草稿，全部提示统一维护。 */
export const pasteInsertZh = {
  action: '粘贴为新增记录', input: '粘贴或输入表格文本', hint: '在下面粘贴或输入制表符分隔数据。先核对字段映射和有界预览，再一次暂存新增草稿；不会连接数据库或执行SQL。',
  limits: '每批最多1000行、50000单元格、1000万字符。外部文字NULL仍是文字；仅DBArk类型数据保留实际NULL、二进制和DEFAULT。',
  mapping: '字段映射', source: '源列', destination: '目标字段', skip: '忽略此源列', auto: '自增（显式映射）', generated: '生成列',
  defaults: '未映射字段省略，使用DEFAULT；生成列不接受映射。', autoHint: '自增列默认省略；明确映射后保留输入键值，仍受原主键/唯一键冲突和集中提交保护。',
  preview: '预览新增草稿', stage: '暂存全部新增草稿', close: '关闭', previous: '上一组', next: '下一组',
  rows: '新增行数', columns: '源列数', previewHint: '预览仅展示前10行，每组10个目标字段；全部数据通过校验后才生成草稿。',
  changed: '目标、字段目录、页面或草稿已变化，请关闭后重新打开。没有新增记录。', noData: '请先粘贴或输入至少一行数据。',
  rowLimit: '每批新增不能超过1000行，请拆分数据；没有生成任何草稿。', shape: '每行的源列数量必须一致，不能暂存不完整矩阵。',
  mappingInvalid: '字段映射无效：目标字段须存在、可写且不能重复，请重新选择。', mappingEmpty: '请至少映射一个可写字段。',
  typedInvalid: '无法识别DBArk类型化剪贴板数据，未退回普通文本；可明确编辑文本后重新预览。',
  prepared: '预览已就绪，尚未暂存或写入数据库。', staged: '已一次性暂存新增草稿。请核对DEFAULT及键值，再从原入口集中预览和确认提交。',
  defaultValue: 'DEFAULT（省略字段）', textValue: '文本',
  already: '本次预览已消费或关闭，请重新预览，不能重复暂存。', invalidId: '新增草稿身份冲突，整批未暂存，请重新打开。'
} as const;
