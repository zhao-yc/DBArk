# O01 FULLTEXT / SPATIAL 实现与验收边界

本批基于已推送集成提交 `8199bf6ff914e3694206c8dfc93d5f0d43a5237e`，在普通克隆的 `task/parallel-o01-special-indexes-20261016` 分支开发，不使用 worktree。

## 已实现范围

- 在现有索引面板显示 FULLTEXT / SPATIAL 种类、原始定义和只读原因；根据服务器、字段的可信能力提供新增和明确删除。
- 仍由后端快照引用生成 SQL，先预览一条 ALTER，再用一次性令牌执行。特殊索引不会走 BTREE 的前缀、方向、键字节预算或外键候选逻辑。
- 新增 FULLTEXT 仅接受完整 CHAR、VARCHAR、TEXT 系列字段，同一索引各列的实际字符集、排序规则必须相同；不接受 binary、ucs2、utf16、utf16le、utf32。
- 新增 SPATIAL 仅接受一个完整、已经 NOT NULL 的空间字段，不自动改列、转换数据或设定坐标系。
- 已有特殊索引只开放受控定义的删除；不支持改名、重建、与 BTREE 互换。新增草稿的种类切换会清除旧的前缀、方向和复合字段选择，方法同步为 FULLTEXT 或 RTREE。
- 明确分区、隐式分区或分区信息未知时，本批均不新增特殊索引。单条 ALTER 最多新增一个 FULLTEXT，不自动拆成多个命令。

## 版本与字段判断

以下是本批的**代码启用策略**，不是本批特殊索引实库通过记录。基础索引模块此前的版本、InnoDB、Dynamic、16 KiB 页大小门槛继续保留；不能据旧 BTREE 验收认定本批特殊索引已验收。

| 实际版本门槛 | FULLTEXT | SPATIAL 附加条件 |
| --- | --- | --- |
| MySQL 5.7.44，确认 large_prefix | 完整文本字段及一致字符集/排序规则 | 明确空间类型且 NOT NULL；不外推 MySQL 8 的 SRS_ID 目录 |
| MySQL 8.0.46 / 8.4.11 | 同上 | SHOW CREATE 中显式 SRID 与独立 `information_schema.COLUMNS.SRS_ID` 必须完整一致，包括 SRID 0 |
| MariaDB 10.11.19 / 11.4.13 | 同上 | 明确空间类型且 NOT NULL，不假定支持 MySQL 8 的 SRID 声明 |
| 其他版本、引擎、行格式或未知页大小 | 保留基础模块的只读门槛 | 不按相近版本猜测能力 |

MySQL 8 的 SRID 来源只接受原定义的直接 SRID 属性，或严格的 `/*!80003 SRID 数字 */` 版本注释。目录能力先独立查询，缺少 SRS_ID 不冒充 SRID 0；任何缺失、NULL、超范围、访问器、源/目录冲突均关闭该字段的空间新增能力。其他可执行属性仍不解释。

源码确认了目录与 DDL 的区别：InnoDB 的 `INDEX_TYPE` 对空间索引报告 `SPATIAL`，模型中的算法仍为 `RTREE`；完整空间字段的 `SUB_PART` 可能为内部 32 字节 MBR，不能当成用户前缀。仅接受完整原字段对应的 NULL/32，绝不把内部长度写入 SQL。FULLTEXT 目录方向为 NULL，空间目录方向按 InnoDB 的 A 核对，生成特殊索引 SQL 均不带 ASC/DESC。

MySQL 5.7 的空间计算和 MySQL 8 的 SRID 优化条件不同。本工具不调整坐标系，也不保证优化器选用新增索引；实库验收必须分别核对真实版本和查询行为。

## 明确只读及副作用

- WITH PARSER、ngram/MeCab、表达式、生成列、隐藏列、显式前缀/方向、特殊索引的显式 USING、其他无法保真的属性保留原片段，只读。
- 本批使用服务器默认全文解析器，不承诺中文分词、停用词或词长配置；不替用户更改服务器全文设置。
- 新增全文索引可能重建表并由 InnoDB 建立隐藏 FTS_DOC_ID 及辅助索引；删除全文索引可能保留文档定位结构。风险确认单独增加 `special-index-change`，不会误要求“移除唯一约束”确认。
- `FTS_DOC_ID_INDEX` 名称不能受控创建或重建，定位列不能成为普通索引或特殊索引的新候选。已有显式 FTS_DOC_ID 时拒绝新增全文索引，不猜其维护方式和定位键来源，也不自动清理内部结构。
- `definitionVerified` 仍表示公开表定义、字段、约束、能力与最终索引集合的后核验，不宣称验证 InnoDB 内部全文辅助表、文档 ID 生命周期或优化器执行计划。
- FULLTEXT/SPATIAL 不能替代 BTREE 外键支持键。唯一键判断收紧为显式 PRIMARY/UNIQUE，外键父表候选只作必要的两处消费适配。

## 继续保留的执行约束

预览和执行前均重新读取源定义、对象身份、真实版本、SQL 模式、字段目录、SRID 目录能力、索引统计和依赖摘要。变化或读取失败时不投递 DDL；不把权限拒绝当作“无依赖”。

仍使用独立结构连接，开启 FK/unique 检查；不提交查询标签的事务。DDL 的隐式提交和外部 DDL 并发窗口仍需明确确认。令牌在执行入口即消费；权限错误、取消、断线、后核验失败都不会自动重试或重放。取消等待原任务及连接关闭，投递后无确认终态仍报告未知。

## 自动验证

本批员工 4 不连接 200、不启动 Electron、不操作系统剪贴板或 Docker。

- 索引及外键相关 19 个单元测试文件：842 项通过；另补充主进程结构命令出口 1 文件 / 9 项通过，合计 20 文件 / 851 项。包含新增特殊索引字段、原定义、目录、SQL、依赖和前端纯规则测试。
- 真实 Engine + 驱动替身：FULLTEXT/SPATIAL 新增和删除、专属风险确认、公开定义后核验、源定义变化、SRID 目录变化、目录权限失败、服务器拒绝、取消及令牌不重放。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node scripts/build.mjs`：通过；保留依赖包注解及产物体积的既有构建提示，不把构建产物提交到Git。
- `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-special-indexes.integration.test.ts --reporter=dot`：1 文件 / 7 项默认跳过；只证明收集和关闭门槛有效，没有实库通过声明。

## ROOT 后续验收

专属实库准备文件为 `tests/integration/engine-special-indexes.integration.test.ts`。必须先由 ROOT 核对当前连接确实指向 200 开发环境，再从既有安全渠道注入各实例连接参数；员工 4 未读取或生成凭据。

两个开关同时为 1 才启用：`DBARK_INTEGRATION_ENABLED` 与 `DBARK_SPECIAL_INDEX_INTEGRATION_ENABLED`。其余连接参数沿用既有 DBARK_TEST_HOST / PORT / USER / PASSWORD、SSH、严格 TLS 参数。默认不启用、不自动读取配置或凭据文件；对六个既定实例分别执行同一文件，不新增 Docker。

准备覆盖：真实版本与字段能力、全文复合列与空间单列预览/新增/独立 SHOW INDEX/查询/删除、数据和 BTREE 保留、一次性令牌、独立 DDL 摘要变化、非法字段预览拒绝、两类索引在元数据锁等待时的取消和收尾。每轮只操作随机 `dbark_special_...` 数据库，确认无残留连接后删除；无法确认清理时保留现场。

原索引实库文件中“所有全文索引只读”的旧断言已同步为本批的“受控全文可删、不可改名或重建”，生成列旧键仍只读。ROOT 应补充原生面板的类型切换、只读原因、SQL 预览和风险确认验收；本批纯函数或构建通过不替代这些结果。

## 追加验收准备：产品源码固定在65e7db5

本次追加以 `65e7db5501a6aa81a3a42663e8b8989ad93f29bb` 为基准，仅修改验收、专属辅助代码及本文档；`src/` 产品源码保持该提交不变。

实库文件通过透传包装实际 `connect` 记录原返回对象和真实线程 ID，明确包含未绑定数据库的基础探测连接、元数据短会话及取消控制连接。原参数、驱动返回和失败原因均不替换；无返回对象或无可信线程 ID 时，不声称线程归属完整。

`afterAll` 先尽力执行 `engine.closeAll()`，随后尝试严格关闭本轮其他真实连接。迟到建连使用5秒/50毫秒预算，逐ID查证继续使用12秒/100毫秒预算，不放宽原任务或连接期限。独立观察连接通过 PROCESSLIST 的实际 ID 集合查证，DB为空、Info为空的基础连接也不能漏过。只有集合完整且逐ID清零后，才精确 `DROP DATABASE IF EXISTS` 本轮 `dbark_special_` 随机库，再查询 SCHEMATA 确认不存在；查证失败保留现场。最后恢复观察包装并严格关闭 observer；各项失败分别保留，多项失败的 AggregateError 以首个错误为 cause，finally不覆盖原清理错误。

新增 `tests/e2e/table-special-index-live.spec.ts`，两条参数化完整流程分别执行 FULLTEXT、SPATIAL。复用现有 `isolatedDatabase` / 桌面生命周期 helper，从真实对象树打开表页，再进入 IndexPatchDialog。覆盖：

- 原BTREE复合前缀草稿切换SPATIAL及FULLTEXT，实际方法、字段重选、候选禁用、前缀/方向禁用和空间单列限制。
- 生成列旧键的只读原因与按钮禁用；已创建特殊索引的原片段及不可编辑原因。
- 真实SQL预览前后独立 SHOW CREATE、数据一致，真实 apply IPC及任务计数保持零；风险确认前、漏特殊风险确认时不能执行。
- 实际双击仅一次新增、已消费按钮禁用；独立 SHOW INDEX 核对字段顺序、方法和注释。随后通过真实删除按钮、风险确认及执行删除，核对原BTREE、生成列只读索引及原始文本/空间WKB数据保留。

UI仅旁观真实主进程handler的命令名，参数、执行和返回完整透传；不使用夹具按钮、注入状态或直接引擎调用代替产品索引入口。原生确认框沿用既有helper；此准备不能证明操作系统原生确认交互已验收。

UI须同时开启 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_SPECIAL_INDEX_INTEGRATION_ENABLED=1` 和 `DBARK_SPECIAL_INDEX_UI_ENABLED=1`。ROOT还须预先确认 `DBARK_TEST_HOST=192.168.31.200`，端口只接受13357、13380、13384、13310、13311、13484；可通过 `DBARK_SPECIAL_INDEX_TEST_PORT` 明确选择，不能自动替换目标。MySQL8夹具按独立观察连接返回的真实版本创建显式 SRID 0 字段；严格TLS沿用现有helper和ROOT提供的CA，不扩展或绕过认证。

本轮仅执行类型检查、6项收尾纯控制流测试，以及关闭开关时的收集/跳过检查：实库7项跳过，真实产品面板2项跳过。员工4未启动GUI、访问200/Docker或读取凭据；未声称这些新增准备已在真实数据库、TLS实例或原生面板通过。ROOT可用以下命令在其已核对环境统一运行：

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-special-indexes.integration.test.ts --reporter=dot
node node_modules/@playwright/test/cli.js test tests/e2e/table-special-index-live.spec.ts --output .cache/o01-special-ui-live --reporter=list
```

## 官方依据

- [MySQL 8.0 全文限制](https://dev.mysql.com/doc/refman/8.0/en/fulltext-restrictions.html)：字段类型、字符集、同元组排序规则、分区及解析器边界。
- [MySQL 8.0 CREATE INDEX](https://dev.mysql.com/doc/refman/8.0/en/create-index.html)：特殊索引语法、空间字段、前缀与方向限制。
- [MySQL 8.0 空间类型](https://dev.mysql.com/doc/refman/8.0/en/spatial-type-overview.html) 与 [空间优化条件](https://dev.mysql.com/doc/refman/8.0/en/spatial-index-optimization.html)：显式 SRID、NOT NULL 与旧版本的空间语义差异。
- [MySQL 8.4 InnoDB 全文索引](https://dev.mysql.com/doc/refman/8.4/en/innodb-fulltext-index.html) 与 [在线 DDL 操作](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)：隐藏文档 ID、辅助结构、重建及单次全文新增限制。
- [MariaDB 全文索引](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/full-text-indexes/full-text-index-overview) 与 [空间索引](https://mariadb.com/docs/server/reference/sql-structure/geometry/spatial-index)：本方言字段和操作规则。
- [MySQL 5.7.44 官方 InnoDB 源码](https://github.com/mysql/mysql-server/blob/mysql-5.7.44/storage/innobase/handler/ha_innodb.cc) 与 [目录读取源码](https://github.com/mysql/mysql-server/blob/mysql-5.7.44/sql/sql_show.cc)：空间目录类型、方向和内部长度表示。
- [MySQL 8.0.46 STATISTICS 源码](https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/dd/impl/system_views/statistics.cc)、[字段顺序投影](https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/dd/dd_table.cc)、[目录内部长度函数](https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/item_func.cc)：与旧版独立核对目录含义。
- [MariaDB 10.11 InnoDB 官方源码](https://github.com/MariaDB/server/blob/10.11/storage/innobase/handler/ha_innodb.cc) 与 [目录读取](https://github.com/MariaDB/server/blob/10.11/sql/sql_show.cc)：独立确认该方言空间目录表示。
