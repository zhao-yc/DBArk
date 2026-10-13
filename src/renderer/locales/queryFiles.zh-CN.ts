/** SQL 文件编辑文案集中在语言模块，方便后续与主语言包共同国际化。 */
export const queryFilesZh = {
  open: '打开 SQL 文件',
  saveAs: '另存 SQL 文件',
  encoding: '文件编码',
  utf8: 'UTF-8',
  utf16le: 'UTF-16LE',
  gb18030: 'GB18030',
  openAction: '选择并打开 SQL 文件',
  saveAction: '选择并保存 SQL 文件',
  openHint: '在当前连接和数据库下新建查询标签，保留已有查询、结果及事务。读取文件不会执行 SQL。UTF BOM 优先确定编码；没有 BOM 时按所选编码读取。',
  saveHint: '保存当前编辑器的全部 SQL 正文。文件选择窗口会提示覆盖已有文件；保存失败保留原目标文件。保存文件不会执行 SQL，也不提交事务。',
  limitHint: '编辑文件上限为 20 MiB、2000 万字符；大脚本请使用 SQL 文件导入任务流式执行。',
  saved: 'SQL 文件已保存：{0}',
};
