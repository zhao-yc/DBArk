# PostgreSQL 调用参数提示

在 PostgreSQL 查询标签键入函数或 `CALL` 的左括号时，编辑器显示可见重载的调用签名。接受函数补全插入的新调用时也会显示。可在调用内按 Ctrl+Shift+空格手动打开，macOS 使用 Command+Shift+空格。

签名显示参数名称、类型、默认参数标记、`OUT`、`INOUT`、`VARIADIC` 和返回类型。当前参数随逗号移动。命名实参按名称高亮，嵌套调用、数组或字面量中的逗号由各自语法层处理。重载按已知参数位置和名称筛选，实际类型匹配由 PostgreSQL 执行时解析。`WITHIN GROUP` 的排序参数显示在签名中，实参高亮覆盖主调用括号。[PostgreSQL 调用函数](https://www.postgresql.org/docs/18/sql-syntax-calling-funcs.html)

目录按原会话的角色、搜索路径和 `EXECUTE` 权限精确查询函数名称。数据库只收到解析后的名称和 schema，提示不会执行原查询或函数。事务打开时暂停目录读取。[PostgreSQL pg_proc](https://www.postgresql.org/docs/18/catalog-pg-proc.html)

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查、源码构建和 14 项定向单元通过。
- macOS 完整单元回归共 1,326 个文件，27,455 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。核对精确大小写、重载、默认参数、可变参数、函数输出字段和过程 `OUT`／`INOUT`、有序聚合元数据、原角色的执行权限、事务内暂停，以及读取签名不会调用带写入副作用的函数。
- macOS 原生场景通过，共 54 项观察。验证接受补全后自动提示、左括号及逗号触发、`CALL` 提示、快捷键、嵌套逗号、命名参数高亮和执行历史保持。原表数据、零剩余连接、独占容器和临时配置清理已核对。
- Windows 测试虚拟机连接不可用，本轮在 macOS 验证。Windows、两平台安装包及较早 PostgreSQL 版本待验证。
