export const postgresDraftFilesZh = {
  save: '保存 PostgreSQL 草稿', restore: '恢复 PostgreSQL 草稿',
  chooseSave: '选择保存位置', chooseRestore: '选择文件并核验',
  saveHelp: '保存当前表页所有已暂存的变更及原页归属。文件未加密，包含暂存值、筛选条件和原记录校验信息。请选择受保护的位置保存。',
  restoreHelp: '选择原连接、数据库和表的草稿文件。程序会只读核对表结构及全部原记录，核对通过后一次恢复。请预览 SQL 并明确确认后再写入数据库。',
  saved: (name: string) => `已保存 PostgreSQL 草稿文件「${name}」。`,
  restored: (name: string, count: number) => `已从「${name}」恢复 ${count} 项草稿，请核对后预览 SQL。`,
} as const;
