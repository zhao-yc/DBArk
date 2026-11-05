# PostgreSQL 图形化新建函数和过程

从 PostgreSQL 数据库右键菜单或工具栏「函数」列表点击「新建 PostgreSQL 函数或过程」。选择目标 schema、对象类型和 SQL 或 PL/pgSQL 语言，填写名称、参数及正文。可填写注释，确认后自动打开定义并刷新对象树和函数列表。

参数支持 `IN`、`OUT`、`INOUT`、`VARIADIC`，类型可使用 PostgreSQL 内置类型、数组和带 schema 的自定义类型。默认值可选择 `NULL` 或类型字面量。函数支持显式返回类型、按输出参数推导和 `SETOF` 集合返回。[PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/18/sql-createfunction.html) · [PostgreSQL CREATE PROCEDURE](https://www.postgresql.org/docs/18/sql-createprocedure.html)

默认按调用者身份执行。选择 `SECURITY DEFINER` 会固定搜索路径为 `pg_catalog, pg_temp`，正文中的业务对象需要完整 schema 限定名。正文直接填写例程代码，预览展示完整 DDL。

预览只读取原目录及类型。确认时复核 schema、角色、类型 OID 和输入签名，交给 PostgreSQL 校验正文，并在同一事务内创建、写注释及回读。已有相同输入签名时要求换名或改参数类型。创建后可在查询页显式调用。

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查及源码构建通过。
- macOS 完整单元回归共 1,326 个文件，27,455 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。覆盖同名表与函数并存、两个输入签名、带引号的名称、自定义类型、字面量默认值、定义者身份、集合返回、可变参数、过程输出参数、非法类型拒绝、正文校验回滚、一次性令牌和同名类型或签名并发变化。预览和创建含写入副作用的函数时，独立计数保持为零。
- 首轮实库发现目录查询共用了驱动会消耗的读取预算。改成每次读取独立分配预算后，连续预览和重名检查复跑通过。
- macOS 原生场景通过，共 56 项观察。函数列表和数据库右键分别创建函数及过程，预览零写入，确认后打开定义，目录同步刷新。独立核对新建正文与注释、原表数据、零剩余连接、独占容器及临时配置清理。
- Windows 测试虚拟机连接不可用，本轮改在 macOS 验证。Windows、两平台安装包及较早 PostgreSQL 版本待验证。
