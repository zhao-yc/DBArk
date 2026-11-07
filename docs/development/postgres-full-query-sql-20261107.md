# PostgreSQL 完整查询导出 INSERT SQL

在查询页打开「执行并导出完整结果」或「导出当前语句的完整结果」，选择「PostgreSQL INSERT SQL」。填写目标 schema 和表名。字段映射留空时采用查询列名。遇到重名、空名或需要改名时，按结果列顺序每行填写一个目标字段。含位置参数的查询可沿原表单绑定类型和值。

独立只读连接按游标批次读取单条 SELECT 或 WITH 的已提交数据，使用 UTF-8 生成多行 INSERT 文件。脚本记录日期、区间、时区等文本解释设置，并在回放事务内应用。目标字段的类型及约束在回放时生效。目标表及字段需事先存在。[PostgreSQL INSERT 说明](https://www.postgresql.org/docs/current/sql-insert.html)

首个真实批次确认列映射后才打开暂存。源查询游标和事务确认结束后才发布目标文件。取消读取会清理本次暂存并保留已有目标。导出状态由独立任务记录。

## 验收范围

- Node.js 24.17.0 运行时检查、严格类型检查、源码构建及 149 项相关测试通过。
- macOS arm64 Electron 连接 Server-200 隔离 PostgreSQL 18.6。按光标导出并回放 4,099 行，逐行核对大整数、精确小数、NULL、Unicode 和 BYTEA，核对带双引号的目标 schema、原会话事务、前后语句哨兵及回放后的会话设置。读取第二批期间取消，原 SQL 文件保留且暂存清理。原 CSV、JSON、Excel 及参数导出通过回归。测试容器、隧道和会话已清理。
- 共享弹窗回归通过 macOS arm64 Electron 的 SQLite 流式 INSERT。Windows 测试会话不可达，Windows、macOS x86_64 与安装包待验。增量暂未正式发布。
