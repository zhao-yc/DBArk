# PostgreSQL 物化视图改名与删除

从物化视图的右键菜单或记录页打开「查看结构 → 管理视图」。此入口面向拥有物化视图且对目标 schema 有使用与创建权限的角色。核对 SQL 后再确认。

- 选择「重命名视图」，输入同一 schema 内的新名称。提交前会核对原物化视图身份、填充状态、索引和其他属性。确认后目录和记录页切换到新名称，数据库依赖继续有效。[PostgreSQL ALTER MATERIALIZED VIEW](https://www.postgresql.org/docs/18/sql-altermaterializedview.html)
- 选择「删除视图」，核对 `DROP MATERIALIZED VIEW … RESTRICT` 后单独勾选确认。服务器会拒绝仍被其他对象依赖的物化视图。提交后目录和记录页移除对应对象，其数据和索引由服务器移除。[PostgreSQL DROP MATERIALIZED VIEW](https://www.postgresql.org/docs/18/sql-dropmaterializedview.html)

确认时先锁定原物化视图，再核对预览对应的目录版本。发生同名替换或目录变化时，刷新结构后重新操作。提交回执中断时，请在原数据库目录核对结果。

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查和源码构建通过。完整单元回归覆盖 1,326 个文件，27,451 项通过，10 项 Windows 系统 `tar` 用例按平台跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。验证同名拒绝、预览零写入、预览令牌重放拒绝、改名保持原视图和索引 OID、依赖查询继续工作、受限删除回滚，以及同名替换后旧预览失效。删除原对象后，替换对象仍可从目录查到。只有 `MAINTAIN` 的委派角色只显示刷新权限。
- macOS Electron 原生窗口 1 项通过，覆盖 44 个观察点。改名后目录及记录页切换，索引和填充状态可以继续核对。删除需额外确认，独立连接验证原名称、改名后的名称和关联索引均已移除。通过轮次的窗口临时配置与数据库已清理。
- 首轮实库测试遗漏异步拒绝断言的等待，测试在已正确返回「预览已失效」时提前结束。已修正测试调用，失败轮次容器停止并保留诊断。
- WIN11-TEST 会话不可达，本轮 Windows 原生窗口、两平台安装包及旧版 PostgreSQL 实库待验收。
