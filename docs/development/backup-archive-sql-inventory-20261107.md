# MySQL 与 MariaDB 归档 SQL 对象检查

从「工具 → 打开数据库备份归档」选择归档，等待字节校验通过，点击「检查 SQL 对象」。检查结果列出脚本里的定义数量、数据写入语句数量、显式目标库、显式声明的 `DEFINER`，以及脚本和清单相差的对象。差异列表各显示前 50 项及总数。

- 检查重新流式读取归档并复核整包摘要。客户端不会运行归档 SQL，也无需打开数据库连接。
- 清点清单库中显式创建的数据库、表、视图、触发器、过程、函数和事件，计入脚本明确删除和重建的对象。数据写入数量按可识别的 `INSERT INTO … VALUES` 与 `REPLACE INTO … VALUES` 语句统计。转储生成的临时占位视图在最终定义替换后只计一次。
- 显式目标库来自受支持语句的对象目标、`USE` 以及触发器目标表。条件注释依据归档声明的方言和版本解释。已核对 `DELIMITER`、可识别的 `SQL_MODE` 保存和恢复及 MariaDB 沙箱前缀。
- 未识别的语句、词法歧义、非 UTF-8 内容或超出预算时显示部分结果。预算为 4 Mi UTF-16 码元的待扫描文本、50 万条语句、1 万项定义，目标库、定义者和模式变量各 256 项。字节完整的归档仍可导出原始 SQL。
- 对象一致指已识别的类型及名称与清单一致。存储程序体、查询依赖、表定义内容、数据行、来源真实性、执行权限和恢复可用性仍需另行验证。

转储格式及条件注释规则见 [MySQL 转储 SQL 格式](https://dev.mysql.com/doc/refman/8.4/en/mysqldump-sql-format.html)、[MySQL 条件注释](https://dev.mysql.com/doc/refman/8.4/en/comments.html)、[MariaDB 转储工具](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)和 [MariaDB 条件注释](https://mariadb.com/docs/server/reference/sql-statements/comment-syntax)。

## 2026-11-07 验收

- 在 `server-200` 的回环隔离 MySQL 8.4.11、MariaDB 11.4.13 容器中分别用原生转储工具生成夹具，含库、表、视图、触发器、过程和事件。测试结束后核验容器及 SSH 转发均已清理。
- Windows 测试虚拟机连接不可用，本轮以 macOS arm64 源码 Electron 验收。两份原生转储均识别出六项定义、一条数据写入语句及显式定义者。修改夹具能显示脚本多出的视图、清单多出的表和异库切换。归档前后字节一致，客户端连接列表为空。
- 定稿通过 `node scripts/typecheck.mjs` 和 `node scripts/build.mjs`。Playwright 单 worker 的 `database-backup-sql-inventory-native.spec.ts` 与 `database-backup-archive-sql-native.spec.ts` 均通过，覆盖 SQL 对象检查和原始 SQL 逐字节导出。
- 全量 Vitest 通过 1,353 个文件，27,584 项通过，10 项按环境门槛跳过。专项覆盖跨块编码、模式切换、条件注释边界、动态语句降级、换包和跨窗口拒绝。
- 本轮 Windows 源码界面、安装包及恢复执行尚待验收。
