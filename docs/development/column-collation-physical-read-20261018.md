# 单列排序规则：独立物理身份读取

基线：`9c260582e6cb30a7b8b38cd952710695e142a570`。本片仅新增私有 engine reader、纯 RAM 测试及本文，不接入 shared、Tasks、UI，不执行 DDL。

`readColumnCollationPhysicalFacts(context, target, base)` 使用调用方已经读取完整原定义的同一结构 context。`base` 是 engine 内部真实 `StructureDefinitionRead`，不是 IPC 输入或服务器身份重新认证端口。读取器校验其准确版本、解析后的目标名及有界普通数据字段；它不会因调用方填入 ID、能力布尔或原定义摘要而生成物理事实。

## 结果与支持范围

- `status: observed`：四次真实查询已完成，返回 `tableId` 原始十进制字符串、固定目标、原定义的 `serverIdentity`、实际名称映射观测及 `bytes`。
- `status: unavailable`：返回明确 `reason`、失败 `stage`、此前已接受的证据字节数；不携带部分 TABLE_ID 或可写资格。
- 准确 MySQL `8.4.11` 同时匹配握手、原快照及同会话 `VERSION()`。不接受厂商/商业后缀或其它补丁号；未另外使用 `version_comment` 鉴定服务器发行包。
- 编译平台大小写归一后只接受 `linux` / `debian-linux-gnu`，同时保留原始 `compileOsReported`；`lower_case_table_names` 只接受数值 `0` 或字符串 `'0'`。
- 库表名各为 1–64 个 ASCII 字母、数字、下划线；实际目录必须唯一、精确同名、`BASE TABLE`、`InnoDB`、非分区。
- TABLE_ID 必须是非零、无前导零且不超过 uint64 的十进制字符串；不经过 JavaScript Number。

## 查询和预算

所有查询通过既有 `structureTaskQuery` 串行执行，最多四条，无重试、会话 SET、授权/例程/触发器枚举或额外 SHOW CREATE：

1. `VERSION()`、`@@version_compile_os`、`@@lower_case_table_names`。
2. 精确二进制库表条件读取 `information_schema.TABLES` 的库名、表名、类型、引擎。
3. 相同精确条件读取 `information_schema.PARTITIONS.PARTITION_NAME`。
4. 精确二进制原生名称读取 `information_schema.INNODB_TABLES.TABLE_ID/NAME`。

四条查询均为固定 SELECT 并带 `LIMIT 2`；目录查询中名称只使用 UTF-8 十六进制字面量。每个结果最多两行、固定字段、64 KiB。字节计量覆盖已接受的目录字符串及 JSON 转义表示，成功结果还包含输出目标、映射和 ID 的 JSON 字节；原始 `base` 不复制入结果，由调用方既有完整定义预算负责。`bytes` 应由 Root 接入共享 16 MiB 证据预算。

64 KiB 是收到驱动结果后的接受预算，不承诺限制 mysql2 收包期间的瞬时内存；本片没有替换共用传输实现。目录失败结果的 `bytes` 只统计失败之前已接受的结果，不表示服务器已发送的全部字节。

## 错误与生命周期

只把明确非 fatal 的 `1142/1143/1227` 权限错误降为 `catalog-permission`。认证、未知 SQL/驱动错误、断线和取消继续抛出；已有 driver 错误在 broken/abort 时保留原对象。数据缺失、歧义、超预算、未知映射或不支持的引擎关闭能力。调用方输入访问器、Proxy、额外 ID 等抛输入错误；目录访问器、Proxy、陌生字段等关闭能力，不执行 getter/toJSON。

使用真实共用查询的 `commandStarted`/完成回调、error/end/abort 监听清理；不自行关闭 context、不声明资源已释放。当前 `StructureTaskContext` 没有 `assertActive` 方法，沿用 `checkCancelled` 并检查 managed broken/signal；不改变 `report` 或原宿主收尾规则。

## Root 后续接线边界

get、preview、apply 前核是否同物理身份由 Root 比较实际观测决定。执行后 TABLE_ID 允许因合法重建变化，本 reader 不规定前后 ID 相同，不声称默认 ALTER 算法、无锁、数据不变或消除外部 DDL 并发窗口。外部程序、视图和应用排序语义变化沿用预览告知确认，不要求全服务器动态 SQL 不存在的证明。

本片验证只有合成目录和 RAM 驱动事件、路径/预算反例及 TypeScript；实库查询语法、真实账号权限、取消/KILL/关闭、GUI 和最终 Tasks 接线均未验收。

验证命令：`node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-physical-read.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads --reporter=json --outputFile=.cache/column-collation-physical-review/results.json`，81 项通过。`node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`，退出码 0。复用已有本地依赖，未安装依赖或执行网络 fetch；从 Root 固定本地提交建立普通 clone，交付推送为唯一网络操作。

首轮为 78/80：两处测试误把 abort 先到时共用查询已确定的中止错误当成晚到驱动错误/取消原因。修正断言并增加相反事件顺序后为 81/81；未改共用查询实现。首轮原件保留在本 clone 的忽略目录 `.cache/column-collation-physical-review/before-results.json`，最终原件为同目录 `results.json`。
