/** 监控窗口文案集中维护；变量原名保留用于运维核对。 */
export const serverMonitorZhCN = {
  connection: '数据库连接', open: '打开监控', noConnections: '请先创建数据库连接，再打开服务器监控。',
  title: '服务器监控', close: '关闭', refresh: '刷新快照', cancel: '取消本次读取', cancelled: '已请求取消，等待原读取收尾。', auto: '每 5 秒自动刷新', loading: '正在读取…', empty: '尚无快照', unavailable: '不可用', summary: '服务器概要', status: '全局状态快照', sessions: '会话快照',
  waiting: '等待上一轮读取和取消控制收尾…', closing: '正在取消并等待本次读取收尾…', targetUnavailable: '当前连接不可用，请重新打开监控。', readFailed: '读取快照失败，自动刷新已暂停；请在连接管理中核对资源状态。', cancelUnconfirmed: '取消尚未确认，继续等待原读取收尾。', autoBudget: '自动刷新最多 60 轮，每轮读取完成后至少间隔 5 秒。', sqlDetail: '查看 SQL 摘要', noSessions: '当前账号可见范围内没有返回会话。', rows: '本次会话条数',
  notice: '仅显示当前账号可见信息；各项并非同时读取，完整性未确认。',
  scope: '仅显示当前账号可见的会话，完整性未确认；不据此推断拥有 PROCESS 权限。', snapshot: '各项依次读取，属于非原子快照；累计计数不表示速率。隐藏页面或关闭窗口会停止刷新。', limited: '会话列表已达到条数上限，未展示全部可见会话。', sqlLimited: 'SQL 已截断', null: 'NULL', emptyString: '空字符串', missing: '服务器未返回的变量：',
  fields: { version: '版本', versionComment: '版本说明', hostname: '主机', port: '端口', currentUser: '授权账号', connectionId: '本次监控连接 ID' },
  sessionFields: ['会话 ID', '用户', '来源', '数据库', '命令', '持续秒数', '状态', 'SQL 摘要 / 字符数'],
  postgres: {
    status: '当前数据库统计', database: '当前数据库', reset: '统计重置时间（UTC）', host: '服务器地址',
    scope: '会话按当前账号的可见范围显示。其他角色的状态和 SQL 可能由服务器隐藏。', connectionId: '本次监控进程 PID',
    sessionFields: ['进程 PID', '用户', '客户端地址', '数据库', '后端类型', '持续秒数', '状态', '等待事件', 'SQL 摘要 / 字符数'],
    duration: '运行中的会话按当前查询计时，其余会话按状态持续时间计时。SQL 字符数取自服务器保留的文本。',
    searchPlaceholder: '用户、来源、库、状态、等待事件或 SQL 摘要',
    counters: { numbackends: '当前连接数', xact_commit: '提交事务', xact_rollback: '回滚事务', blks_read: '读取块数',
      blks_hit: '缓冲区命中块数', tup_returned: '扫描返回行', tup_fetched: '获取行', tup_inserted: '插入行', tup_updated: '更新行',
      tup_deleted: '删除行', conflicts: '恢复冲突取消次数', temp_files: '临时文件数', temp_bytes: '临时文件字节', deadlocks: '死锁次数' },
  },
  counters: { Uptime: '运行秒数', Threads_connected: '已连接线程', Threads_running: '运行线程', Connections: '累计连接', Aborted_connects: '失败连接', Questions: '客户端语句', Queries: '执行语句', Slow_queries: '慢查询', Bytes_received: '接收字节', Bytes_sent: '发送字节', Com_select: 'SELECT 次数', Com_insert: 'INSERT 次数', Com_update: 'UPDATE 次数', Com_delete: 'DELETE 次数', Innodb_buffer_pool_read_requests: '缓冲池逻辑读', Innodb_buffer_pool_reads: '缓冲池物理读', Innodb_row_lock_waits: '行锁等待次数', Innodb_row_lock_time: '行锁等待毫秒' },
} as const;
