# MySQL 与 MariaDB 备份恢复目标检查

从「工具 → 打开数据库备份归档」选择归档。校验通过后，在「恢复目标连接」中选择已保存的 MySQL 或 MariaDB 连接，点击「检查目标」。

- 检查连接实际返回的服务器系列和版本，并与归档清单比对。目标库名取自已校验清单，默认库配置不会影响这次检查。
- 显示同名库中可见的表及其他关系、视图、存储过程及函数、触发器和事件，以及事件调度器状态。MariaDB 序列计入其他关系。
- 有可见对象时报告同名库已占用。仅当当前账号直接全局授权足以证明目录完整时，才根据零行报告同名库未发现或为空。角色、部分撤销、库级授权及不能证明的库名匹配可能显示未知。完整目录判定覆盖 MySQL 8.4 与 MariaDB 11.4 系列。
- 检查使用独立数据库会话，只读取目录和状态。原窗口、连接配置或归档文件发生变化时，重新检查。结果是当时的观测，目录没有加锁。来源实例身份、归档 SQL 语义、恢复执行和恢复后验收仍需另行验证。

权限判定参考 [MySQL 8.4 权限说明](https://dev.mysql.com/doc/refman/8.4/en/privileges-provided.html)、[MySQL 8.4 部分撤销](https://dev.mysql.com/doc/refman/8.4/en/partial-revokes.html)与 [MariaDB 11.4 权限和元数据变更](https://mariadb.com/docs/release-notes/community-server/11.4/what-is-mariadb-114)。

## 2026-11-07 验收

- Windows 测试虚拟机连接不可用，本轮改用 macOS arm64 源码 Electron 和 Node.js 24.17.0。实库为 `server-200` 上只绑定回环地址的隔离 MySQL 8.4.11 和 MariaDB 11.4.13，通过 SSH 转发测试。两套容器和转发均已清理。
- 从正式工具菜单进入，覆盖同名库为空、已占用、未发现、权限不足时未知、跨系列版本不匹配、调度器开启和关闭、归档代次变化后拒绝回执。实库独立复核目录计数、样本数据及调度器前后一致，测试账号残留会话均为零。
- 定稿通过 `node scripts/typecheck.mjs` 和 `node scripts/build.mjs`。以单 worker 分别运行 `database-backup-target-audit-native.spec.ts` 和 `database-backup-archive-sql-native.spec.ts`，验证双实库界面与离线原始 SQL 逐字节导出。
- 全量 Vitest 定稿回归通过 1,352 个文件，27,579 项通过，10 项按环境门槛跳过。归档窗口绑定、文件代次复核、取消等待及 IPC 输入约束通过回归。
- Windows 源码界面、安装包及恢复执行尚待验收。
