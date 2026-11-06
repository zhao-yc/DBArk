# MySQL 和 MariaDB 监控会话操作

从「工具 → 服务器监控」选择已保存的连接。在有操作按钮的会话行选择「取消查询」或「断开会话」。核对确认区中的连接 ID、账号、来源及数据库，输入目标连接 ID 后发送。

快照能力在原窗口和原连接配置中有效，60 秒内可使用一次。发送前使用独立控制连接复核服务器、账号、连接和对应的语句身份。实例身份包括服务器标识和启动时间。缺少可复核的身份时，相应按钮隐藏，原监控快照仍可读取。服务器按当前账号的权限处理，能看见其他会话的账号仍可能收到拒绝回执。

- MySQL 使用 Performance Schema 的线程 ID 和语句事件号复核。若只有线程身份，界面仅提供断开会话。MySQL 的取消命令按连接 ID 发送，复核与投递之间仍可能切换语句。[MySQL KILL](https://dev.mysql.com/doc/refman/8.4/en/kill.html) · [语句事件](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-events-statements-current-table.html)
- MariaDB 使用服务器提供的原查询 ID 发送 `KILL SOFT QUERY ID`。断开会话还要求 Performance Schema 的线程身份，命令使用 `KILL SOFT CONNECTION`。安全模式让服务器避开可能使存储引擎状态不一致的关键阶段。[MariaDB KILL](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/kill) · [进程列表](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-processlist-table)

断开会话会回滚未提交的事务性更改。窗口分别显示信号回执和随后对原目标的观测结果。看到「原目标已不再可见」表示这次监控读已无法观察到原目标。信号结果未知时，客户端保留该状态供核对，且同一确认只发送一次。

## 2026-11-07 验收

- Windows 测试虚拟机不可达。本轮使用 macOS arm64 源码 Electron，连接 Server-200 上的一次性 MySQL 8.4.11 和 MariaDB 11.4.13。两种实例标识在跨秒读取时保持一致。
- 两库均通过同连接重发完全相同 SQL 的测试。旧确认被拒绝，后续语句仍在运行。重新确认后，MySQL 测试查询返回中断值 `1`，MariaDB 返回 `1317`，两个原连接随后均可执行查询。[MySQL SLEEP](https://dev.mysql.com/doc/refman/8.4/en/miscellaneous-functions.html#function_sleep)
- 两库均由服务器拒绝无管理权限账号断开他人会话。测试账号获得相应权限后，独立管理连接确认目标会话消失，未提交的 InnoDB 行已回滚。撤去线程表读取权限后，MySQL 保持只读监控，MariaDB 仍可按原查询 ID 取消。查询历史未增加，控制连接、SSH 转发及隔离容器均已清理。
- 首轮探针发现 MySQL 在单表授权下拒绝大写表名，改用授权对应的小写表名后通过。首轮 MySQL 窗口用例对 `SLEEP()` 的中断回包预期与服务端不同，改为校验实际中断值后通过。
- 运行时检查、严格类型检查、源码构建及 PostgreSQL 18.6 原生回归通过。Vitest 通过 1,360 个文件及 27,653 项，10 项按环境条件跳过。其它数据库版本、Windows 原生及安装包待验。
