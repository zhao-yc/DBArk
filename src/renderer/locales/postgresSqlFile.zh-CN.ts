import { postgresSqlFileTitle, type PostgresSqlFileResult } from '../../shared/postgresSqlFile';

const reason: Record<NonNullable<PostgresSqlFileResult['failure']>['reason'], string> = {
  connection: '未能建立或确认专用数据库连接。',
  file: '文件读取失败，或原文件在选择后发生变化。',
  encoding: '文件需为有效 UTF-8，且不能包含空字符。',
  syntax: '无法读取完整的 PostgreSQL 语句或 COPY 数据段。每段 COPY 数据需以独占一行的 \\. 结束。',
  budget: '文件中的语句数量或单条语句大小超出预算。',
  command: '文件含不支持的指令、位置参数或不完整的事务或备份外壳。',
  server: 'PostgreSQL 拒绝了本条语句。',
  transaction: 'PostgreSQL 未返回可确认的事务状态。',
  cancelled: '收到取消请求。',
};
export const postgresSqlFileZh = {
  title: postgresSqlFileTitle, connection: '目标连接', database: '目标数据库',
  choose: '选择 SQL 文件', execute: '确认并执行文件', cancel: '取消执行', close: '关闭',
  running: '正在流式执行 SQL 文件', cancelling: '正在等待原执行任务结束',
  scope: '按 UTF-8 流式读取并在目标库的独立事务中执行。支持回放 tabrelio 的 PostgreSQL 备份和含内联 COPY FROM STDIN 的 pg_dump 纯文本 SQL。请确认文件可信、目标库正确且依赖已准备。',
  limits: '文件最多 10 GiB，单条 SQL 最多 64 MiB。支持外层 BEGIN / COMMIT、pg_dump 的成对限制标记，以及文本或 CSV 的内联 COPY。含换库、外部文件、二进制 COPY 或其他 psql 指令的备份需用 PostgreSQL 原生客户端。',
  warning: '事务回滚覆盖事务内变更。脚本调用的已有序列、外部系统或自定义函数可能产生事务之外的副作用。',
  outcome: {
    'not-started': '文件执行未开始。', committed: '文件事务已确认提交。',
    'rolled-back': '文件事务已确认回滚。', unknown: '文件执行结果未知，请先核对目标库。',
  },
  completed: (count: number) => `服务器完成 ${count} 条语句。`,
  failedAt: (statement: number) => `第 ${statement} 条语句`,
  cleanup: '专用连接的收尾尚未确认。',
  reason,
} as const;
