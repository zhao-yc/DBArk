import { postgresArchiveOpenTitle, postgresArchiveRestoreTitle, postgresArchiveSaveTitle, postgresArchiveTitle, postgresArchiveToolTitle } from '../../shared/postgresArchive';

export const postgresArchiveZh = {
  title: postgresArchiveTitle, chooseSource: postgresArchiveOpenTitle, chooseTool: postgresArchiveToolTitle, export: postgresArchiveSaveTitle,
  restore: postgresArchiveRestoreTitle,
  list: '读取归档目录', directory: '归档目录', close: '关闭', cancel: '取消操作',
  running: '正在离线读取 PostgreSQL 归档', cancelling: '正在等待 pg_restore 退出',
  scope: '选择 PGDMP 自定义归档和本机安装的 pg_restore。可离线查看归档目录、导出 UTF-8 SQL，或选择目标库直接恢复。',
  content: '处理范围', all: '结构和数据', schema: '仅结构', data: '仅数据',
  portable: '省略所有者和授权', warnings: 'pg_restore 提示',
  done: (name: string, bytes: number) => '已导出 ' + name + ' · ' + bytes.toLocaleString('zh-CN') + ' B',
} as const;
