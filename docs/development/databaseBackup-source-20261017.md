# B01 固定只读源检查

普通独立克隆分支 `codex/employee3-backup-source-inspection-20261017`，基线 `6cfb89213c9e3e220ca677f05862f707ca30b34d`。只新增 `databaseBackupSource.ts`、专属 RAM SQL 测试及本文档；没有混入 `ee7e742` 执行器补修或修改既有元数据、连接退出、共享合同、main/engine/index。

## Root 接口

```ts
inspectDatabaseBackupSource(context, binding)
// context: { checkCancelled(), read({id,sql,params,maxRows,maxBytes,sensitiveResult:true}) }
// binding: { connectionId,database,connectionRevision,sourceLease,endpoint,threadId,
//            expectedInstance?,lockCapability? }
// result: { evidence,facts,blockers,unclassified,definers,metadataBytes,actualLockHeld:false }
```

`context` 可以由已登记的 `StructureTaskContext` 包装。Root 负责实际参数化发送、命令登记、限流、取消及退出，本模块不直接调用 mysql2、query/execute 或关闭连接。源会话必须是 Root 新建并登记的专用私有会话，不借用户查询标签的旧授权/会话状态，不自动重连。`read` 必须真实完成后才返回 complete=true；超量必须抛 `DatabaseBackupSourceLimitError` 或 `code=DBARK_BACKUP_SOURCE_LIMIT`，不得截断后假报完整。

Root 的参数化 read 包装仍须保持 `StructureTaskContext.commandStarted()`/实际命令终态记账；不能换成收到 abort 就提前当完成的普通 Promise 包装，也不能把取消 ACK 当作 complete。所有请求都标记 sensitiveResult=true，实际端口不记录响应数据或将原文写入用户查询历史。

`checkCancelled()` 必须实时反映 Root 控制器及租约的失效状态；模块在每次 read 前后调用它，失效后拒绝后续新 SQL，也不接纳晚到结果。既有句柄与在途命令仍由 Root 单独保留直至真实终态；抛出取消错误不构成资源已退出的证据。

绑定在首个 await 前复制，不能由异步调用换库/租约；CONNECTION_ID 必须与 Root 物理 threadId 相同，expectedInstance 如有提供必须逐字段一致。MySQL 使用实际 server_uuid；MariaDB 明确没有伪造 UUID，只报告 hostname/port/serverId 与同一物理会话，仍须 Root 的直接固定端点/租约保证身份。

返回的 evidence 可供前片计划器使用，但 Root 应同时保留 blockers/unclassified/definers 私有报告，不能丢弃未覆盖对象后展示“完整”。facts 用于私有租约核对，不应直接将整个私有报告透传 renderer。定义原文、SHOW GRANTS 原文和原始驱动错误均不返回；SHOW GRANTS 只在函数 RAM 生命周期解析，不保存原文、哈希或日志。

## 已实现语句清单

| 固定读取 | 内容与边界 |
| --- | --- |
| VERSION()/@@version_comment | 先辨准确家族/版本；当前 MySQL 8.4.11、MariaDB 11.4.13，旧版/未知分支先拒绝，不继续发送可能不支持的会话 SQL |
| 会话/实例 SELECT | hostname、port、server_id、CURRENT_USER、CURRENT_ROLE、CONNECTION_ID、sql_mode、sql_quote_show_create、连接字符集/排序规则、lower_case_table_names |
| MySQL @@server_uuid | 必须为实际规范 UUID，MariaDB 不发此语句 |
| MySQL show_gipk_in_create_table_and_information_schema | 前后确认生成不可见主键处于可见状态；OFF/未知会阻断完整定义，不由本模块发送 SET |
| SHOW GRANTS FOR CURRENT_USER() | 前后读取，RAM 中解析直接全局授权；不展开角色、不执行授权 |
| SCHEMATA | 精确数据库名、默认字符集/排序规则，BINARY 名称比较 + 单个参数，最多 2 行 |
| TABLES / VIEWS | 表/视图名、类型、引擎；视图名及 DEFINER 另读，两个目录必须一致 |
| TRIGGERS / ROUTINES / EVENTS | 完整可见名称、类型及 DEFINER；每类参数化数据库值、固定 LIMIT 10001 |
| SHOW CREATE DATABASE/TABLE/VIEW/TRIGGER/PROCEDURE/FUNCTION/EVENT | 所有已分类对象逐一读取，名称只通过既有 identifier/qualified 引用；数据库值不拼进目录 WHERE |

没有任意 SQL、USE、SET、DDL 或写数据入口。Root 若没有提供完整 SHOW CREATE 会话条件，本模块返回阻断，不自行修改 sql_mode/字符集。全部原始 SHOW CREATE 原文仅在本次函数 RAM 中使用，输出为 UTF-8 原文 SHA256；指纹表示读取内容，不单独证明完整性或可恢复性。

累计最多 10000 个数据库/表/视图/程序/未知对象（未知对象也计入），所有读取的字段和值累计最多 2 MiB，包含原始定义、授权及前后事实。Root 必须在实际读取过程中执行传入的行/字节上限；模块另做接纳时复核，遇超限、complete=false 或超量拒绝整批，不返回截断清单。未知对象类型保存在 unclassified，完整可见性降为 unknown，不能把 SEQUENCE 等暗中算成普通表。

## 权限、会话及零对象

第一准确配置仅承认可完整解析、明确授给当前账号的直接全局权限。MySQL 8.4 的 SHOW GRANTS 明确逐项显示全局权限，模块不把 ALL PRIVILEGES 猜成动态权限全集；MariaDB 的干净全局 ALL 可按其语义展开。账户/范围/后缀无法完整识别、角色、部分 REVOKE、局部授权或认证后缀均降为 unknown，不返回认证内容。规范 PROXY 行只作为不相关的附加能力识别，不增加备份权限。[MySQL SHOW GRANTS](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html)、[MariaDB GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant)

数据/表目录要求全局 SELECT；视图还需 SHOW VIEW；触发器需 TRIGGER；事件需 EVENT；过程/函数使用准确家族的全局权限门；获取全局读锁权限和 PROCESS 单独记录。权限未知时，即使目录返回 0，也只能说“未证明完整可见”，不能说不存在该类对象。MySQL 例程的全局 SELECT/SHOW_ROUTINE 可见性与定义规则，以及触发器的 TRIGGER 可见性均按官方说明处理；本片原生 dump 的 routines 权限门仍要求全局 SELECT。[ROUTINES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-routines-table.html)、[TRIGGERS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-triggers-table.html)

会话必须提供明确的引用模式、utf8mb4/utf8mb4_bin、不省略定义的 sql_mode，MySQL 还须确认生成不可见主键显示开启。Root 的私有上下文负责在本函数之前提供条件；本函数只报告事实，不执行修复 SET。缺定义/NULL、读取拒绝或定义目标不符都保留对象身份并降为未知，不把不可见定义当作空定义。

前后复核实例/账号/角色/会话事实及结构化全局授权证据。该预检不是原子快照，不能证明没有并发 DDL、授权 ABA 或数据变化；run 必须在真实同 owner 锁窗口内用相应新建私有会话重新检查完整范围及实际权限，不能用这份前检替代持锁和实际读取成功。

## 定义与依赖的首片能力

可以形成完整范围证明的首片是准确版本下的普通数据库/表，且其它类别数量为零的事实确有完整全局可见性支撑。数据库 SHOW CREATE 的字符集/排序规则需与 SCHEMATA 吻合；已知原生版本注释只按精确选项语法展开，加密 Y/未知选项阻断。

表依赖使用既有保偏移词法、字段、索引和外键解析器，不在原 SQL 上正则搜关键字。注释/字符串里的 REFERENCES、含点标识符不会假报跨库；真实出向外键必须指向本次同库清单内的表。未知约束、生成/非受控表达式、表达式/特殊索引、可执行片段、表空间/目录/未知表尾、引擎不符均保留原定义摘要并阻断。该正向语法能力逐类扩展，不能反过来声称所有数据库结构均已支持。

视图、触发器、过程、函数及事件都会完整枚举、SHOW CREATE、保留摘要及已知 DEFINER；第一片尚未证明完整程序/跨库依赖，因此明确阻断独立恢复，不跳过这些对象，不把实际范围改成单表导出。后续再逐类补齐定义上下文和语义分析，不是把 B01 永久缩为只支持表。

## 锁证明独立

默认 ddlCoverage 全为 unknown，versionValidated 为空。只有 Root 注入含 evidenceId、匹配家族、准确版本和 profile 的能力证明才逐类别接纳 proven；不根据 FTWRL 常识填满。无论是否有能力证明，actualLockHeld 都为 false，这个模块不发锁语句。真实 run 的锁、权限、来源、连续性和资源退出仍由 Root/执行器另证。

## 验证与交付边界

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupSource.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

27 项 RAM SQL 测试通过：准确组合及未知分支、全局/角色/部分撤销/局部/认证后缀权限、零目录、隐私、固定参数化语句/安全引用、全部类别定义摘要、复杂依赖、缺定义、未知类型、10000/2 MiB/截断边界、实例/授权变化、取消、Root能力声明、生成不可见主键及异步输入换绑。没有重跑既有 22/28 项、M02、全套或构建；没有实际 DB、SSH、GUI、产品 OS/文件端口、工具、凭据、剪贴板或 Docker 操作。真实 SQL 发送和退出由 Root 后续接线及验收，不能把 RAM 行结果称作实库验收。

最终 `tsc --noEmit` 退出码为 0。专项 JSON 报告保留在忽略目录 `.cache/database-backup-source/source-tests.json`，SHA256 为 `de15731b81cbc807f4ddb672f70417ba810d80fdb6f762b615fd7564ac12b427`。
