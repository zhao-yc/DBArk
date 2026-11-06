# PostgreSQL 外键选值

在可写的记录表单、网格新增或编辑弹窗中点击「选择外键记录」。选择外键约束后，可以按键值或说明字段搜索候选，或每页浏览 40 条。说明字段从当前账号可读的列中选取，最多 16 列，可按需收起。 [Navicat 外键选值手册](https://www.navicat.com/manual/online_manual/en/navicat_18/win_manual/data_rdbms.html#edit-records-with-foreign-key-foreign-key-data-selection---available-only-in-enterprise-and-standard-edition)

点击「使用此记录」，将全部外键字段按约束顺序一次填入表单。选值保留 `bigint` 原文和 BYTEA 原始字节。可核对输入或取消表单，再按原流程暂存、预览 SQL 并确认整批提交。

候选查询在只读事务中按当前表页、连接与实际外键目录定位。读取需要被引用 schema 的访问权限及全部引用列的 SELECT 权限。普通单列和复合外键均可用，生成列及 PostgreSQL 时间范围外键不进入此选值入口。引用关系或权限变化后需重新打开，确认写入时仍由数据库验证实际外键约束。 [PostgreSQL 外键目录](https://www.postgresql.org/docs/18/catalog-pg-constraint.html)

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、严格类型检查及源码构建通过。3 项定向单测覆盖复合键、大整数、字节、非法元组和 IPC 请求边界。
- macOS 完整单元回归共 1,330 个文件，27,482 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。核对含引号的表名、复合键顺序、候选分页、字面搜索、列级读取权限、权限撤销、错误原文档及过期页。两次通过的实库测试均确认零连接及原测试记录后清理容器。
- macOS 原生窗口回归通过，共 74 项观察。新增弹窗可选值后取消。记录表单支持跨 schema 搜索说明列，并整组填入复合键。独立连接核对暂存时的原值及提交后的精确大整数和配对字段。已核对截图、应用正常退出和临时配置清理。
- 首轮检查因测试文件变量重名停止。已修正命名并保留原断言，失败日志与已停止的独占容器保留。
- Windows 虚拟机不可达，本轮按约定使用 Mac。Windows 原生操作、两平台安装包和较早 PostgreSQL 版本待验。
