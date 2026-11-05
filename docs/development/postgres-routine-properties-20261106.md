# PostgreSQL 函数和过程属性编辑

从对象树或工具栏「函数」列表打开目标重载的定义，选择「编辑例程属性」。窗口预填当前值。修改后预览 SQL，再点击「确认更新属性」。清空注释会删除原注释。提交成功后会重新读取当前重载的定义和属性。

- 函数可修改易变性、并行级别、NULL 输入行为、执行成本估算、执行身份和注释。返回集合的函数也可修改返回行数估算，估算接受正数和科学计数法。
- 过程可修改执行身份和注释。字符串正文和 SQL 标准正文均可使用此入口。已有参数、正文、权限和依赖会在同一事务中核对。
- 切换到定义者身份时，SQL 同时将 `search_path` 设置为 `pg_catalog, pg_temp`，并保留其他例程配置。确认前须勾选同意让已有执行权限的角色以所有者身份调用。正文应以完整 schema 限定名引用业务对象。切回调用者身份时保留已设置的搜索路径。[PostgreSQL ALTER FUNCTION](https://www.postgresql.org/docs/18/sql-alterfunction.html) · [PostgreSQL ALTER PROCEDURE](https://www.postgresql.org/docs/18/sql-alterprocedure.html) · [PostgreSQL 定义者身份说明](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)

预览只读目录。确认后锁定原例程，并按 OID、完整输入签名及目录摘要复核。变更和回读在同一事务中完成，旧预览或回读不符时回滚。

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查和源码构建通过。
- macOS 完整单元回归共 1,326 个文件，27,455 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。覆盖带引号的名称、单项和多项修改、成本小数及科学计数、仅集合函数行数估算、过程属性限制、注释转义和清除、定义者搜索路径及其他配置保留、原 OID 和依赖保留、SQL 标准正文，以及过期预览回滚。
- macOS 原生窗口回归通过，共 59 项观察。核对了函数与过程字段区别、定义者身份确认门槛、提交后属性回读和清空注释。独立连接验证原正文、原表数据、零剩余连接、测试容器及临时配置清理。
- Windows 测试虚拟机不可达，本轮切换到 macOS。Windows、两平台安装包和较早 PostgreSQL 版本待验证。
