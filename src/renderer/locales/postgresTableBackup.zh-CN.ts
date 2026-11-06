import { postgresBackupSetTitle } from '../../shared/postgresTable';

export const postgresTableBackupZh = {
  title: postgresBackupSetTitle,
  connection: '来源连接',
  database: '来源数据库',
  tables: '备份表',
  search: '搜索 schema 或表名',
  visible: '勾选当前搜索结果',
  clear: '清空勾选',
  choose: '选择保存位置',
  start: '开始备份',
  close: '关闭',
  cancel: '取消备份',
  cancelling: '正在等待原备份任务结束',
  saving: '正在从同一快照读取所选表',
  loading: '正在读取可备份的普通表',
  noTables: '没有符合条件的普通表。',
  selected: (count: number, limit: number) => `已选 ${count} / ${limit} 张表`,
  done: (tables: number, rows: number) => `已保存 ${tables} 张表，共 ${rows} 行。`,
  scope: '将所选普通持久表的结构、全部记录和所属序列保存到一份 SQL。恢复前请准备同名 schema 及未选中的依赖对象。',
} as const;
