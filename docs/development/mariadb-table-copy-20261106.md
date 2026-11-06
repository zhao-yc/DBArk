# MariaDB 同连接整表复制

在 MariaDB 11.4.13 的普通 InnoDB 表页或对象菜单，打开「复制表结构」或「复制表结构及数据」。选择同一连接内的目标库，填写新表名并预览。跨库可以沿用原表名。同库需要新表名。输入准确的 `目标库.新表名` 并勾选确认后执行，成功后刷新目标库对象树。

仅对已核的 Linux、非分区 InnoDB 表及 ASCII 标识符开放。复制前检查原生 `TABLE_ID`、`server_uid`、权限、目录可见性和运行状态。自增列使用 `SHOW TABLE STATUS` 前后复核原生计数，新的空表从 1 开始。外键、触发器、视图依赖、生成列和特殊索引等不在当前范围内。其它 MariaDB 补丁版本仍保留版本门槛。[MariaDB 服务器变量](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables) · [MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table)

建表使用 `CREATE TABLE … LIKE`。数据模式随后用 `READ COMMITTED` 事务执行 `INSERT … SELECT`，直接传递自增零值、定点数、NULL 和字节。已有同名对象会拦截。建表和数据分别提交，数据失败或取消时可能留下空表。MariaDB 的自增计数可以在回滚后继续变化，遇到未确认结果应核对目标表及其实际计数。[MariaDB 自增规则](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/auto_increment-handling-in-innodb)

## 验收

2026-11-06 在 macOS arm64 使用 Node.js 24.17.0 完成类型检查、构建和单元测试。定向 412 项通过，完整单测 27,559 项通过、10 项跳过。

在 `Server-200` 的隔离 Linux 实库 `11.4.13-MariaDB-ubu2404`，验证跨库复制结构后目标无行且自增初值为 1，预览及目录冲突不创建目标。跨库同名复制和同库异名复制各独立读回 3 行，包含自增零值、大于 JavaScript 安全整数范围的无符号整数、高精度定点数、NULL 和原始字节。前两轮触及原有 60 秒集成用例时限，延长 MariaDB 集成用例时限后用相同断言通过，耗时约 104 秒。已停止前两轮容器并保留数据卷，成功轮次的隔离资源已清理。

`WIN11-TEST` 连接不可用，本轮在 macOS arm64 的源码 Electron 窗口验证了跨库空表和同名数据复制。两种预览均未写入，错误的库名确认无法提交，完成后目标目录自动刷新，独立连接读回的数据与来源一致。原生专项 1 项通过，耗时约 41 秒，窗口正常退出。Windows、安装包和跨连接整表复制未纳入本轮验收。
