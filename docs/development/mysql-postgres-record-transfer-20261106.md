# MySQL／MariaDB 到 PostgreSQL 的记录复制

运行 MySQL 或 MariaDB 查询，从当前结果勾选记录，在结果菜单点「暂存勾选结果到 PostgreSQL」。暂存使用当前显示顺序和可见列，单批最多 100 行、200 个字段和 1 MiB。打开 PostgreSQL 目标表并点击「从查询结果复制记录」，核对源驱动、连接、查询结果集及目标，再加入新增草稿。

唯一同名字段按已知映射自动配对。整数和定点数优先对应无精度修饰的 PostgreSQL `numeric`，以容纳超出有符号 64 位范围的无符号整数。带精度约束的数值字段可手动映射，最终由目标库校验。二进制由实际返回值确定，普通文本字段保持文本。部分协议类型须手动映射。 [MySQL 整数类型](https://dev.mysql.com/doc/refman/8.4/en/integer-types.html) · [MariaDB BIGINT](https://mariadb.com/docs/server/reference/data-types/numeric-data-types/bigint)

预览及确认沿用目标表事务。只复制已经返回的值，不重跑源 SQL。原查询结果里的 NULL、空字符串和零字节分别保留。浮点字段沿用已返回的浮点值。

## 验证记录

- macOS arm64、Node.js 24.17.0 的运行时检查、类型检查和构建通过。12 项定向单测覆盖两个网络来源的协议值、无符号整数原文、同名匹配、混合类型拒绝和原粘贴路径。
- 完整单测覆盖 1,346 个文件，27,541 项通过，10 项 Windows 条件测试跳过。
- Server-200 的 MySQL 8.4.11 与 MariaDB 11.4.13 分别对 PostgreSQL 18 做 Electron 原生验证。每轮三项观察。预览时目标为空，确认后独立读回两条勾选记录，源库保持三条。验证了无符号 64 位最大整数、20 位小数、非空及零字节、SQL NULL 和空字符串。窗口正常退出，目标库核对零连接后，两侧独占容器清理。
- PostgreSQL 实库回归覆盖 5 个文件、7 项测试，全部通过。原表页、PostgreSQL 查询结果及 SQLite 到 PostgreSQL 的 Electron 兼容回归通过 6 项观察。
- WIN11-TEST 连接不可用，本轮回退 macOS。Windows、安装包及其他数据库版本待验。
