export const postgresRoutineZh = {
  title: 'PostgreSQL 函数和过程定义', open: '查看定义', draft: '打开定义草稿', loading: '正在读取 PostgreSQL 定义…',
  kind: '对象类型', categories: { f: '函数', p: '过程', w: '窗口函数' },
  owner: '所有者', language: '语言', arguments: '参数', returns: '返回类型',
  volatility: '易变性', volatilityValues: { i: '不可变', s: '稳定', v: '易变' },
  security: '执行身份', definer: '定义者', invoker: '调用者', comment: '注释',
} as const;
