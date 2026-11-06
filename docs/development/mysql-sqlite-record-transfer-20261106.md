# MySQL 和 MariaDB 到 SQLite 的记录复制

在 MySQL 或 MariaDB 当前查询结果勾选记录，从结果菜单点「暂存勾选结果以跨库复制」。打开可写的 SQLite 表，在「更多」菜单选择「从 MySQL 查询结果复制记录」或「从 MariaDB 查询结果复制记录」。核对来源、目标和字段映射后可暂存新增草稿。经过 SQL 预览并确认提交才写入 SQLite。每批最多 100 行，沿用源快照和目标编辑预算。

有符号 64 位范围内的整数可保存为 SQLite INTEGER，也可映射至 TEXT 保存精确原文。如果选中批次的某个整数列有超范围值，该列在本批统一保留文本原值，包括范围内的值。定点小数按 TEXT 保存，映射窗口过滤会发生数值转换的目标列。字节值按 BLOB 保存，SQL NULL、空文本和空字节各自保留。SQLite STRICT 表的 ANY 列也能保留传入的存储类型。[MySQL 整数范围](https://dev.mysql.com/doc/refman/8.4/en/integer-types.html) · [MariaDB BIGINT](https://mariadb.com/docs/server/reference/data-types/numeric-data-types/bigint) · [SQLite STRICT 表](https://www.sqlite.org/stricttables.html)

## 验收

- WIN11-TEST 不可达，按授权使用 macOS arm64 和 Node.js 24.17.0。真实网络数据库在 Server-200 的隔离容器，SQLite 在测试窗口的临时配置目录。Windows、安装包与其他数据库版本留待验证。
- 原生运行时预检、严格类型检查、构建均通过。定向单测 5 个文件、99 项通过。全量单测覆盖 1,347 个文件，27,545 项通过，10 项按 Windows 条件跳过。
- macOS 原生窗口分别以 MySQL 8.4.11 写入 SQLite STRICT 表、以 MariaDB 11.4.13 写入普通 SQLite 表。两例均回归同一源结果到 PostgreSQL 18，并分别独立读回源记录和目标。SQLite 暂存与预览阶段均为零写入，确认后只增加两条勾选记录。
- SQLite 独立读回保留了无符号最大值及同列的 `0` 文本、20 位小数原文、`00FF` 和空 BLOB，以及 NULL 与空字符串。64 位有符号整数的两个端点分别验证了 INTEGER 和 TEXT 映射。既有 PostgreSQL 与 SQLite 双向复制也完成原生兼容复测。
- 首次定向测试遗漏了未映射目标字段的默认占位，补齐断言后通过。首轮全量测试暴露普通剪贴板入口提前调用来源识别函数的问题，修复后仅跨库入口调用该函数。原始失败日志保留在本轮验收缓存。
