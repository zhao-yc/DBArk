# 0.18 表级下一自增值独立切片

基线为`4b00d80c949a825ad1c0f5b4a040dfc560ec7ce4`，分支`codex/employee1-auto-increment-20261016`。本切片只编辑表级AUTO_INCREMENT下一值，不新增、删除或修改列级自增属性，不代表完整O01。重命名P2另由独立补丁`361b7be`交付，未混入本分支；ROOT汇合时必须保留该修复及独立Sidebar/CSS改动。

## 已核对的现有能力及最小契约

字段解析器已识别并保留列级AUTO_INCREMENT；字段补丁公开可编辑属性不含自增开关。既有表注释、默认编码面板只有只读自增计数。此次新增独立入口，不重做列级编辑。

| 命令 | 输入 | 可信行为 |
| --- | --- | --- |
| `schema.tableAutoIncrement.get` | connectionId/database/table/taskId | 绕过统计缓存，读取精确目录计数字符串、唯一自增列与类型上限、原生物理ID、完整定义、服务器/会话模式及能力；返回限时快照与只读原因 |
| `schema.tableAutoIncrement.preview` | snapshotId/value字符串/taskId | 从快照取得目标与上限；只接受规范正十进制、严格上调；重新核对全部来源及当前计数，只读返回一条固定SQL和独立用途令牌 |
| `schema.tableAutoIncrement.apply` | previewToken/准确三项确认/taskId | 等待前消费令牌；可信连接revision由主进程注入；共享同表执行租约、重核完整来源及目录计数后，只发单一ALTER |
| `schema.tableAutoIncrement.release` | snapshotId或previewToken | 精确释放本用途，快照释放同时撤销关联预览 |

固定SQL仅为`ALTER TABLE qualified_table AUTO_INCREMENT = value;`。客户端不能提供SQL、revision、列定义、最大值或模式。计划不查询业务行、MAX或LAST_INSERT_ID，不用数据样本猜计数，不SET全局、不借用查询标签会话。

## 版本语义与首批范围

本轮核对官方主源后保守限定：MySQL 8.0.30及以上8.0分支、8.4分支，Linux、lower_case_table_names=0、ASCII命名、非分区InnoDB基本表。MySQL5.7、MariaDB及其他版本/引擎/名称映射当前只读。

- [MySQL 8.4自增处理](https://dev.mysql.com/doc/refman/8.4/en/innodb-auto-increment-handling.html)：自增计数持久化；请求降低到已持久计数以内时，服务器可能进行最大值检查。本版仅上调新鲜目录观测值，不承诺消除重核后外部DML窗口，也不承诺服务器内部零读取/零处理。
- [MySQL 8.0自增处理](https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html)与[官方5.7归档](https://docs.oracle.com/cd/E17952_01/mysql-5.7-en/innodb-auto-increment-handling.html)：5.7重启可能取消仅设置的计数，不能套用8.x持久化表述。旧dev.mysql.com的5.7地址现会跳转其他版本，引用官方归档核对。
- [MySQL统计缓存变量](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_information_schema_stats_expiry)：TABLES.AUTO_INCREMENT可能来自缓存。本版只在自己的结构会话设置information_schema_stats_expiry=0并读回确认，保留SHOW CREATE与目录计数一致性检查，不调用ANALYZE修复或读取MAX。
- [MariaDB自增处理](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/auto_increment-handling-in-innodb)：其持久化和回滚仍有自身语义；本版尚未独立证明对应目录/运行能力，明确只读，不据“支持持久化”自动开放。
- [InnoDB运行变量](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html)：InnoDB只读及强制恢复不作为普通写环境。本版将任何非零恢复状态保守设为只读，没有修改或尝试修复服务器配置。

计数由CAST(AUTO_INCREMENT AS CHAR)获取，输入、快照、计划、输出及UI均为字符串；通过位数/字典序比较，整个计数链不经过JS Number。只证明TINYINT/SMALLINT/MEDIUMINT/INT/BIGINT及可选UNSIGNED的实际上下限，含BIGINT UNSIGNED精确上限18446744073709551615。浮点、DECIMAL、ZEROFILL、未知类型、无唯一自增列、目录与定义矛盾、超上限或无上调空间均只读/拒绝，不自动修剪、截断或改列类型。

要求会话和全局自增步长/偏移均为1，锁模式为已知0/1/2，read_only、super_read_only、innodb_read_only及innodb_force_recovery均为0，并证明直接ALTER权限。角色、部分撤销、陌生语法及无法读到能力时不猜测可写。原生身份和完整定义读取器的其他只读边界继续保留。

## 并发、核验与资源事实

get/preview/apply绑定完整定义、服务器身份、原生TABLE_ID、原始/规范SQL模式、精确目录计数、自增列类型/上限及运行能力。DML在预览或发送前推进计数也使旧快照失效。维护窗口明确要求暂停写入；最后重核与服务器实际执行之间仍存在外部DDL/DML窗口，不能用UI确认声称已消除并发。

收到成功响应只表示DDL完成。输出分别提供ddlCompleted、structureVerified、counterState、requestedValue及after.value：

- `matched`只表示后核验时目录观测值等于请求值；还须原生身份、模式、完整定义及警告状态都一致，definitionVerified才为true。文案明确不保证下一次插入使用此值。
- `different`记录实际更大或更小的观测值，可能由并发DML、服务器忽略或调整造成；不称请求值设置成功，不自动重放。
- 取消、读取失败或断线导致`unverified`，保留已收到的DDL完成事实。即使数值曾吻合，严格关闭或请求收尾异常仍单列，不伪装资源已释放。

后核验只豁免顶层AUTO_INCREMENT计数选项，列级属性、列定义、键、表注释、行格式和其他物理选项仍比较。生产路径只有单一计数ALTER；没有回写数据或重述表。服务器内部行为及实际数据保持需ROOT实库验收，单元替身不替代。

对象树/表页两入口使用同目标全部隐藏表页的数据、列布局草稿及活动任务保护。同步请求围栏阻止双击、迟到响应套用新目标；检查回执的请求值、原生ID和成功字段一致性。取消不提前释放busy，令牌在失败、取消和未知后不能重放；卸载/返回编辑/关闭会释放快照及预览。结果不明只标记目标过期，完整吻合后才触发真实表页刷新；配置版本变化不刷新新服务器。

## 本分支验证和待验边界

专属纯测试使用真实Engine、生产main dispatch/退出、解析器和UI守卫，仅替换驱动、IPC或调度边界。覆盖2^53相邻值、UINT64上限、类型范围、缓存/权限/模式、DML推进、服务器忽略/调整、物理ID变化、取消、关闭失败、令牌生命周期、隐藏草稿及矛盾回执。最终相关回归17文件233项通过，其中新增自增专属3文件76项通过；加目录回放共4文件78项通过。类型检查、构建通过。日志留在本克隆`.cache/table-auto-increment-*.log`，不提交运行日志、依赖或产物。

实际使用已安装依赖直接执行`node node_modules/typescript/bin/tsc --noEmit`、`node scripts/build.mjs`、`node node_modules/vitest/vitest.mjs run`加上述专属及结构/工作区/布局回归文件列表。布局持久化测试的TEMP/TMP显式限定到本克隆`.cache/table-auto-increment-test-tmp`。默认关闭检查以两个开关均为0运行单一集成文件；UI只执行`node node_modules/@playwright/test/cli.js test tests/e2e/table-auto-increment.spec.ts --list`。

默认关闭的实库核心准备为`engine-table-auto-increment.integration.test.ts`共6例；正式Electron准备为`table-auto-increment.spec.ts`共3例。必须双显式开启DBARK_INTEGRATION_ENABLED=1及DBARK_TABLE_AUTO_INCREMENT_TEST=1；目标/账号显式注入，仅允许已核对200六实例，13484必须同一严格TLS和已有CA，不降级，不创建账号或证书。其他版本只验证只读边界。

核心准备覆盖真实大数计数、原定义/数据保持、类型耗尽、DML使预览失效、同定义重建、连接revision和MDL取消，并核对线程/隔离库清理；UI准备覆盖两入口、只读SQL、双击一次、无自增列只读、降低/非法值拒绝、风险确认及返回编辑释放。服务器忽略/并发后推进已用纯驱动探针严格验证，真实并发压力、断网、重启持久化与跨设备仍待ROOT补验。

本轮不GUI、不200、不剪贴板、不Docker、不worktree；只执行纯单元/type/build、核心默认关闭检查和UI --list。不改ROOT/其他克隆，不改CSS/退出流程，不把准备或skip算作实库通过。
