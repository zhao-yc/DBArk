export const postgresNoticesZh = {
  title: 'PostgreSQL 服务端消息', count: (count: number) => `服务端消息（${count}）`,
  retained: (received: number, retained: number) => `本次执行收到 ${received} 条消息，保留 ${retained} 条。`,
  truncated: '部分消息或字段已达到保留上限。', fieldTruncated: '此条消息有字段已截断。',
  redacted: '位置参数执行仅显示消息级别及 SQLSTATE，消息正文、详情、提示与上下文已隐藏。',
  search: '搜索服务端消息', empty: '没有符合条件的消息。', emptyMessage: '（空消息）',
  ordinal: (ordinal: number) => `第 ${ordinal} 条语句执行期间`,
  locate: (ordinal: number) => `定位消息所属第${ordinal}条语句`,
  unavailable: '原编辑器或消息对应的语句范围未确认。',
  detail: '详情', hint: '提示', context: '上下文',
  previous: '上一页消息', next: '下一页消息', page: (index: number, total: number) => `第 ${index} / ${total} 页`,
} as const;
