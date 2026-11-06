# MySQL／MariaDB 整库 SQL 文件恢复

从「工具 → 执行 MySQL／MariaDB SQL 文件」打开。该入口也在桌面应用的工具菜单中。

1. 选择已保存的连接。对于含 `CREATE DATABASE` 与 `USE` 的转储，初始数据库可选「由脚本指定数据库」。对于未指定库名的转储，选已有目标库。
2. 选择 UTF-8、UTF-16 LE 或 GB18030 和本机 `.sql` 文件。核对文件中指定的库名、`DROP`、`DEFINER` 和其他可能改变目标状态的语句。
3. 勾选确认项后执行。脚本使用所选账号权限和独立数据库会话，执行结束后刷新该连接的对象树。原生转储中的 `DELIMITER` 由客户端解析。MariaDB 首行固定的客户端 sandbox 指令保留文本偏移后跳过。
4. 查看回执中的完整响应语句数、失败位置、事务和回滚状态。服务器累计影响行数包含完整响应的计数，实际保留的数据以目标查询为准。

MySQL 和 MariaDB 的 DDL 可隐式提交。取消只请求终止原任务，已确认提交的语句或非事务副作用可能保留。先核对目标后再决定是否重试。文件变化、非法编码或解析错误会停止发送后续语句。[MySQL 隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html) · [MariaDB 隐式提交](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)

可以先用归档窗口导出原始 SQL，再通过本入口执行。原生转储中的显式库名和账号定义会按原脚本执行。不同服务器或版本的兼容性取决于脚本使用的语法与目标权限。[MySQL 原生转储选项](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) · [MariaDB 原生转储选项](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)

## 2026-11-07 验收

- Windows 测试虚拟机不可达，使用 macOS arm64 源码 Electron 和 Node.js 24.17.0。数据库运行于 Server-200 上的回环隔离容器，通过独立 SSH 转发连接。
- 从正式工具菜单执行 MySQL 8.4.11 的 `mysqldump --databases` 输出，脚本创建数据库并切换到该库。对 MariaDB 11.4.13 的 `mariadb-dump` 输出，选择预先建好的空库再回放。两份转储均包含表、视图、过程、函数、触发器及事件。
- 通过独立管理会话对比转储前和恢复后的目录及数据。无符号 64 位整数、35 位定点数、中文与 emoji、二进制内容、视图读取和函数返回值一致。两个容器、SSH 转发和测试账号会话均已清理。
- 重复键失败定位到第 3 条语句，保留前两条完整回执。真实行锁等待时取消，保留前序已提交记录，等待中的更新及后续写入均未生效。选择后替换文件时，执行计数为零。
- 早期两轮取消夹具观察到 `SELECT SLEEP()` 收到服务端完整响应，已保留这两轮记录。定稿改用可独立持有与释放的行锁验证取消语义。
- 类型检查、源码构建及双实库 Electron 用例通过。全量 Vitest 通过 1,357 个文件及 27,624 项，10 项按环境门槛跳过。Windows 源码窗口、安装包及客户端生成整库备份尚待验证。
