# Q01 LATERAL 派生关系作用域最小切片

日期：2026-10-16。基线：`4118a9bd6913d8e7b4062c11123ac44438e6ec9f`。普通独立分支：`task/parallel-q01-lateral-scope-20261016`。

本切片交付有能力门的语义分析、Worker 入口及专属测试。**主线程能力接线与实库验收仍由统筹完成，当前标准编辑器没有自动开启 LATERAL；Q01 仍为部分完成。** 未改 App、QueryTab、共享 IPC、驱动、公开版本或全局覆盖清单。

## 官方规则与版本边界

- [MySQL 官方 LATERAL 说明](https://dev.mysql.com/doc/refman/8.0/en/lateral-derived-tables.html)：MySQL 从 8.0.14 支持显式 LATERAL；同一 FROM 中非 LATERAL 派生表不能读取同级其它表。当前小切片只支持引用前置关系的方向。
- [MySQL JOIN 限制](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html)：右操作数依赖左操作数时仅允许 INNER/CROSS/LEFT JOIN；反方向有另一组限制。聚合归属与隐式 JSON_TABLE 也有独立规则，本切片不将字段可见性分析当成完整 SQL 合法性检查。
- [MariaDB 官方支持任务 MDEV-19078](https://jira.mariadb.org/browse/MDEV-19078) 当前仍为 Open，并说明 SQL 层尚不允许 LATERAL 派生表。[Lateral Derived Optimization](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/optimizations-for-derived-tables/lateral-derived-optimization) 是内部优化能力，不能据此开启显式语法。
- 实际依赖仍为 `dt-sql-parser@4.5.1`。已核对 `MySqlParser.js` 的 SubqueryTableItem / InnerJoin / OuterJoin 与 `mysqlEntityCollector.js` 的 `exitAtomSubQueryTableSource`。派生实体只给出括号、别名、父语句与输出查询，没有可信的独立 LATERAL 标志，因此额外将有界 token 和真实 AST 一一核对，不使用 `isAccessible` 猜关系。

`completionCapabilitiesForServer(dialect,version)` 目前只为已确认 MySQL 8 的规范版本开启：8.0.14 及以后，或 8 的后续次版本；允许规范版本附 `-log` / `-commercial` / `-debug`。5.7、8.0.13、MariaDB、未知方言、未知主版本及其它未确认版本格式返回 false。兼容分支或新版本需单独核验，不把它们的版本前缀自动视作官方 MySQL 能力。

## 最小接口建议与统筹接线

新增补全本地类型：

```ts
interface CompletionScopeCapabilities {
  lateralDerivedTables?: boolean;
}
```

语义入口为 `analyzeCompletion(source, offset, mode, capabilities?)`；Worker 请求支持同名可选字段 `capabilities`。缺省或 false 时，明确 LATERAL 语句停止且不发目录请求。Worker 拒绝非布尔值、数组和未知能力字段；就绪握手版本仍为 1。

统筹先确认当前服务器家族，再在已有可信 `ConnectionStatus` 上调用 `completionCapabilitiesForServer(status.dialect,status.version)`，随当前补全请求传入能力。该函数只做版本筛选，不认证服务器厂商；厂商未知时应直接传 false。现有 `CompletionWorkerClient` 只封装 id/source/offset/mode；建议以兼容旧调用的可选参数扩展并复制能力快照，沿用模型、连接修订、取消与超时门。此处不自行改客户端、SqlEditor 或上层数据流，也不新增探测 SQL、共享 IPC 或驱动行为。未知状态始终关闭，不能仅由用户输入了 LATERAL 就推定服务器支持。

### ConnectionStatus 与会话缓存的可信来源

以下依据本分支基线源码读取，不代表根后续接线已经完成：

- `src/engine/connection.ts:238-240` 在当前实际建连初始化中读取 VERSION、模式和默认库，将版本写入该 `ManagedConnection.status.version`。方言只按版本是否含 MariaDB 分类为 mariadb，否则分类为 mysql；后者是兼容类别，**不足以证明是官方 MySQL 厂商**。用户保存配置中的方言、手填版本和旧测试连接结果都不能替代当前物理连接状态。
- `src/shared/contracts.ts:31` 的 `ConnectionStatus` 只有 version/dialect/connectionId。`src/engine/completionSession.ts:28-33` 从固定查询会话的 ManagedConnection 读取默认库、模式、方言和对象修订；现有 `CompletionSessionState` 没有版本、厂商或 LATERAL 能力字段。
- 新建查询前的草稿可由统筹使用已核验端点的当前连接状态；查询会话建立后，应使用属于该物理会话的状态，并绑定会话/连接修订。管理连接、独立目录连接和查询会话不是同一物理连接；代理、多后端或重连时不能把另一个连接的版本自动当成会话能力。没有同源可信版本或厂商依据时保持关闭。
- 若根需要会话级保证，最小跨边界建议是由根给 `query.completionState` 的只读缓存结果追加已核验能力或版本，来源为该会话现有 `managed.status`，不额外执行 SQL；绑定、失效和接线仍归根维护，本分支不改共享返回或驱动。
- MySQL 9、新主版本、非规范版本/厂商后缀及其它兼容厂商均未在本切片确认。已知后缀会被版本筛选挡住；若兼容厂商恰好报告规范的 `8.0.x`，当前这两个字段无法识别它，必须依靠统筹另有可信来源，不能把版本函数的 true 当成厂商证明。

### 实际官方来源读取证据

本轮于 2026-10-16 已实际打开并读取以下官方页面，而非只列参考链接：

| 来源 | 实际读取部分 | 支持的结论 |
| --- | --- | --- |
| [MySQL 8.0：15.2.15.9 Lateral Derived Tables](https://dev.mysql.com/doc/refman/8.0/en/lateral-derived-tables.html) | 节首版本说明、Restrictions、JSON_TABLE 条目 | 8.0.14 门槛；同 FROM 前置依赖；INNER/CROSS/LEFT 方向限制；隐式表函数不等于本切片完整支持 |
| [MySQL 8.4：同名章节](https://dev.mysql.com/doc/refman/8.4/en/lateral-derived-tables.html) | Restrictions 的 FROM、连接方向、聚合归属及表函数段落 | 当前 8.4 的方向与语义限制仍需遵守 |
| [MariaDB MDEV-19078](https://jira.mariadb.org/browse/MDEV-19078) | Details 中 Status=Open、Resolution=Unresolved；Description 的 SQL 层限制 | 规划修复版本不是已发布能力，不据此开启 MariaDB |
| [MariaDB Lateral Derived Optimization](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/optimizations-for-derived-tables/lateral-derived-optimization) | 概览、Split Grouping/Split Materialized 别名与执行计划示例 | 内部优化与显式 SQL 关键字支持应分别判断 |

## 已实现的关系与输出

- 普通 SELECT FROM 的逗号列表，以及平坦 JOIN、INNER JOIN、CROSS JOIN、LEFT / LEFT OUTER JOIN 的右侧显式 LATERAL 派生表。
- 同级前置物理表、CTE、普通派生表和先前 LATERAL 输出可见；同级后置关系、自身派生别名和其它 UNION 分支不可见。
- 体内实际 FROM 来源正常可见，内层同名别名遮蔽祖先；重复同层别名不任选。普通关联子查询可以沿合法祖先读取，普通派生表和 CTE 屏障仍生效，不因外层出现 LATERAL 而整体解除。
- 输出沿用真实 SELECT 投影和首个 UNION 分支：显式别名、普通列名及明确 CTE 输出；WHERE/ORDER 中出现的列不能成为派生输出。
- `u.*` 通过同一可见关系函数定位来源，再按实际目录惰性展开；普通 `*` 只用本查询块 FROM，不把相关祖先混成输出。派生星号不暴露物理不可见列。
- LATERAL 体内未确认限定符不回退成数据库函数目录；普通派生体明确隐藏的祖先别名同样停止，避免用被屏蔽的别名去请求函数目录。字段插入继续保留限定引用、完整替换范围和既有目录上限。
- 点号、中文、反引号和原型同名别名按完整标识符处理；名称或注释中的 LATERAL 不触发能力门。

## 保守停止与未支持范围

- 当前 LATERAL 的 RIGHT/NATURAL/STRAIGHT_JOIN，括号化连接组，同级逗号与 JOIN 混合结构。
- 派生列重命名列表：包括本 LATERAL 的列表，及它依赖的同级前置派生表列表，防止沿用旧投影名。LATERAL 查询体以 WITH 开头、缺少完整括号或无法与实际 AST 一一对应也停止。
- 左侧 LATERAL 反向读取后置关系、隐式 JSON_TABLE 的 LATERAL 语义、例程局部名称、完整祖先输出别名、聚合归属合法性等没有扩展。这里只分析关系字段，不保证任意复杂 SQL 可以执行。
- 第三方解析器对部分合法保留字用法会恢复失败。例如 `u.from` / `u.order` 的组合在其 `validate` 中报错且收集不到表；本切片保持零目录请求，给这些字段加反引号后可正常分析。没有为填充候选而从词法猜物理表。

## 验证与实库准备

专属单元使用真实解析器、候选生成器和目录请求断言。真实 Worker 源码在 VM 中完成就绪及能力请求验证，没有启动 GUI、操作剪贴板或访问数据库。原词法模式与源码/token/深度预算先于能力分析；LATERAL 关系数量沿用 256 项上限，越界在调用解析器之前停止。8 秒启动、2 秒分析、取消与迟到消息保护均沿用原实现。目录协议、目标数和权限没有放宽。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/completion-lateral-scope.integration.test.ts
```

实库准备为独立的 6 项用例，默认全部跳过，不读本机凭据文件。只有统筹显式启用并核对允许的 200 隔离地址/端口后才建连；版本不支持时保留能力关闭并跳过正向用例。支持时仅建立唯一 `dbark_lateral_` 隔离库和两张表，经真实 Engine 目录、会话来源显式读回、实际候选替换范围组成 SQL 后直接执行，并核对前置字段、输出别名、遮蔽和星号结果。后置关系/非 LATERAL 反例不执行且目录为零。结束先关本例会话，再精确清理唯一库。

这套准备是无 GUI 的语义/目录/执行链验证，不冒充 Monaco、真实桌面、安装包或跨平台验收。实库未在本轮运行；后续统筹仍需完成能力接线及真实入口验收。

本轮实际结果：LATERAL 专属 36 项通过；完整单元 123 个文件、2383 项通过；类型检查、构建和差异空白检查通过；专属实库 6 项默认跳过。构建保留既有第三方注释与大分块提示。详细日志仅保存在本克隆忽略目录 `.cache/q01-lateral-unit.log`、`.cache/q01-lateral-build.log`。本轮没有启动 GUI、操作剪贴板、连接 200、使用 Docker 或生成长期密钥。
