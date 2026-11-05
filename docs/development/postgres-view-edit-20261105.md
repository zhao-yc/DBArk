# PostgreSQL 图形化编辑视图定义

从普通视图的右键菜单或记录页打开「查看结构」，在「视图定义」里选择「编辑视图定义」。编辑器预填服务器当前的查询。输入单条查询并用 schema 限定业务对象，点击「预览视图修改」检查 SQL，再选择「确认更新视图」。

保留原列的名称、顺序和类型，可在末尾追加列。客户端沿用 PostgreSQL 的 `CREATE OR REPLACE VIEW`，显式带回已有选项，并在事务中回读视图 OID、所有者、授权、注释和选项。[PostgreSQL CREATE VIEW](https://www.postgresql.org/docs/18/sql-createview.html)

确认时对原视图执行同 schema 的 `ALTER VIEW … SET SCHEMA` 取得锁，再重新核对视图身份和规则版本。发现其他会话已修改定义或原属性时，请刷新后重新编辑。提交确认后刷新结构和对应的记录页。回执中断时从原数据库重新读取定义。 [PostgreSQL 18 锁实现](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/commands/tablecmds.c#L17812)

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查和源码构建通过。完整单元回归覆盖 1,326 个文件，27,450 项通过，10 项 Windows 系统 `tar` 用例按平台跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。用独立连接复核同一视图 OID、依赖视图、所有者、授权、注释、`security_invoker`、`security_barrier` 和 `LOCAL CHECK OPTION`。核对预览零写入、令牌隔离、原列不兼容时回滚、底表持有写入锁时正常更新，以及另一会话先提交后准确拒绝过期修改。
- 首轮并发用例发现，确认时先反编译定义会等待共享锁，调整为先取得目标锁再读目录后复验通过。首轮原生脚本以标签定位预填文本框超时，已改用有名称的文本框角色。后续原生回归发现确认参数多传 `table`，主进程拒绝请求，独立回读确认视图仍返回原值。确认调用已对齐严格 IPC 契约。失败轮次的独占容器已停止并保留诊断数据。
- 最终 macOS Electron 原生窗口 1 项通过，覆盖 36 个观察点。验证原定义预填、预览期间记录保持、确认后重新读取结构、已打开记录页更新及原注释保留。独立连接读取更新后的记录与原注释，通过轮次的临时配置和数据库已清理。
- WIN11-TEST 会话不可达，本轮 Windows 原生窗口和两平台安装包待验收。
