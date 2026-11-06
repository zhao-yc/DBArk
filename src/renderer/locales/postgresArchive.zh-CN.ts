import { postgresArchiveOpenTitle, postgresArchiveSaveTitle, postgresArchiveTitle, postgresArchiveToolTitle } from '../../shared/postgresArchive';

export const postgresArchiveZh = {
  title: postgresArchiveTitle, chooseSource: postgresArchiveOpenTitle, chooseTool: postgresArchiveToolTitle, export: postgresArchiveSaveTitle,
  list: '读取归档目录', directory: '归档目录', close: '关闭', cancel: '取消操作',
  running: '正在离线读取 PostgreSQL 归档', cancelling: '正在等待 pg_restore 退出',
  scope: '选择 PGDMP 自定义归档和本机安装的 pg_restore。可以离线查看归档目录，或导出 UTF-8 SQL 后通过「执行 PostgreSQL SQL 文件」恢复。',
  content: '导出内容', all: '结构和数据', schema: '仅结构', data: '仅数据',
  portable: '省略所有者和授权', warnings: 'pg_restore 提示',
  done: (name: string, bytes: number) => '已导出 ' + name + ' · ' + bytes.toLocaleString('zh-CN') + ' B',
} as const;
