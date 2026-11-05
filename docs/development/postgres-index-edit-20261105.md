# PostgreSQL 普通表索引编辑

从表页或对象菜单打开「查看结构 → 索引 → 编辑索引」。创建时选择内置方法、按顺序加入键列，并按方法能力设置包含列、唯一性、升降序和 NULL 位置。已有独立索引可重命名或删除。将多项改动加入同一批，预览实际 SQL 后再提交。删除须额外勾选确认。

- 支持 B-tree、Hash、GIN、GiST、SP-GiST 和 BRIN 的列索引。多键、包含列和排序选项按索引方法开放，类型与默认运算符类是否兼容由 PostgreSQL 检查。[PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html)
- 重命名和删除使用带 schema 的准确名称。主键、约束和复制标识索引不进入候选。删除使用 `RESTRICT`，服务端按实际依赖拒绝不允许的操作。[PostgreSQL ALTER INDEX](https://www.postgresql.org/docs/18/sql-alterindex.html) · [PostgreSQL DROP INDEX](https://www.postgresql.org/docs/18/sql-dropindex.html)
- 预览绑定原表、索引身份、连接修订和窗口。执行前后核对关系身份，提交前回读索引键、包含列、排序、有效状态和原索引 OID。同名同定义的索引替换会使原预览失效，后序失败会使整批回滚。
- 提交期间会独占锁定原表。大型索引可通过 SQL 编辑器另行安排 `CREATE INDEX CONCURRENTLY`。表达式、部分索引、显式运算符类或表空间仍可通过 SQL 编辑器配置。

## 验证

- Mac 类型检查、构建和 8 项定向单元测试通过。覆盖原字段编辑回归、索引 SQL 转义、方法约束及真实定义核对。
- Mac 完整单元回归覆盖 1,321 个测试文件，27,411 项通过，10 项 Windows 系统 `tar` 检查按平台跳过。
- Server-200 独占 PostgreSQL 18 实库 5 项通过。实际创建六种内置方法的索引，验证复合 B-tree 的唯一性、包含列和排序，确认保护主键与复制标识索引、拒绝同名同定义替换和令牌重放。重复值导致唯一索引创建失败时，前序重命名已回滚。
- 实库并发用例在原索引的真实锁等待期间将其名称交给另一张表的索引。最终目录回读拒绝提交，回滚后两张表的索引各自保留原 OID，客户端拟写入的名称未留下。
- Mac 原生窗口用例 1 项通过，17 个观察点，单 worker、120 秒、零重试且关闭 trace。原生表单创建复合索引并重命名，随后独立确认删除，主键关联索引保持。原窗口正常退出，独占库与临时配置目录已清理。
- 首轮窗口用例的 Playwright 通用禁用断言把带 `disabled` 属性的选项判为可用，改查原生选项 DOM 的禁用属性后复验通过。首轮失败现场保留。
- WIN11-TEST 会话不可达，本轮未派发，按约定在 Mac 验证。Windows 原生窗口和安装包尚待验收。
