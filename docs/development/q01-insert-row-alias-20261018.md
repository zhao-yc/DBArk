# UPSERT VALUES 新行别名字段补全

基线：`85db9596a2ce4dc065fa0620ade74296ecbd08ae`。本切片只处理本地补全，不执行 SQL，不修改第三方解析器、元数据 IPC 或引擎写入路径。

## 行为

```sql
INSERT INTO app.users(id, name)
VALUES (1, '甲'), (2, '乙') AS incoming
ON DUPLICATE KEY UPDATE name = incoming.|
```

`|` 为光标。补全将 `incoming` 绑定为目标表 `app.users` 的新行别名，只请求该表字段目录，沿用原前缀、建议数量、请求预算及取消机制。字段来自实际元数据，不依据 INSERT 列清单伪造；目标表未限定库时采用当前有效补全上下文的库，未知库不读取。

此路径仅在同条 INSERT 的更新赋值右侧、限定名与声明别名一致时开放。支持单行及多行 VALUES、VALUE、简单行别名、普通函数及括号表达式。原文替换范围仍来自词法分析的 UTF-16 半开区间；AST 必须确认同一目标表，替换光标名称后的整条语句也必须语法有效。

## 能力和停止边界

- 新增本地 `insertRowAliases` 能力，WorkerClient 固定快照，Worker 入口继续严格检查能力白名单和布尔值。旧消息缺项关闭新能力，启动握手版本不变。
- 仅项目已认可版本格式的 MySQL 8.0.19 起及 8.x 后续小版本开启。MySQL 5.7、8.0.18、MariaDB 10.11/11.4、未知版本、未知主版本及未认证厂商关闭。
- 列别名列表、INSERT SET 中真正声明的新行别名、任何嵌套 SELECT、分区目标、限定更新左侧、别名与表同名、大小写不确定或括号未闭合等结构保守停止。大小写不确定只阻断该局部路径，不推定平台名称规则。INSERT SELECT 投影及 CAST 类型的 AS 不是新行声明，保留原有 schema 例程补全路径。
- 已识别局部别名但语法/位置不支持时，在例程目录回退前停止；注释、字符串和上一条语句中的 AS 不声明当前局部名。合法 schema 例程和既有 UPDATE/DELETE/LATERAL/INSERT 列清单继续走原路径。

官方依据：[MySQL 8.0.19 发布说明](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-19.html)、[MySQL 8.4 UPSERT 说明](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html)。MariaDB 不在本片支持声明内，不能据此断言其所有未来版本不支持。

## 验证和交接

新增 `completion-insert-row-alias.test.ts`：38 项 RAM 用例，使用真实解析器、实际 Worker 打包入口、WorkerClient 和目录实现；目录传输为内存端口，不连接数据库。覆盖真实字段来源、前缀/后缀/引用名、UTF-16、串注释/后续语句隔离、停止边界、版本/消息门、模型取消和连接撤销后的迟到目录结果。

已执行：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/completion-insert-row-alias.test.ts tests/unit/completion-analysis.test.ts tests/unit/completion-suggestions.test.ts tests/unit/completion-named-windows.test.ts tests/unit/completion-call-routines.test.ts tests/unit/completion-worker-client.test.ts tests/unit/completion-context.test.ts tests/unit/completion-lateral-scope.test.ts --reporter=json --outputFile=.cache/insert-row-alias-related.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/completion-insert-row-alias.test.ts tests/unit/completion-worker-client.test.ts tests/unit/completion-directory.test.ts tests/unit/session-completion-directory.test.ts --reporter=json --outputFile=.cache/insert-row-alias-final.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

第一轮相关验证 8 套件 253 项通过；随后新增大小写歧义和失败/预算用例并调整测试目录端口类型，最终相关增量 4 套件 74 项通过，其中新切片 38 项、WorkerClient 18 项、目录 15 项、会话目录 3 项。两轮有重叠，不能相加为独立测试总数。类型检查退出码 0。

首次开发验证曾有 3 项失败：未闭合 INSERT 列括号的 AS 深度使局部名称漏识别（产品修复）；UTF-16 预期错误地计入光标标记（夹具修正）；同一测试两次真实 Worker 启动超过默认 5 秒（该组合用例设 20 秒上限，产品启动/解析期限未修改）。修复后上述最终增量全部通过，不将首次失败追认为通过。

本轮不运行完整套件、应用构建、原生 GUI、剪贴板或数据库环境。Root 仍需独立审查、真实补全及整合；本报告的 RAM 组合验证不代表已完成真实服务器或安装包验收。列别名列表、INSERT SET/SELECT 和子查询关联引用留给独立切片。

上述执行记录属于原提交 `621f6d3` 的作者验证；后续独审发现的 AS 位置误判及窄修记录见 [AS 声明位置修复](q01-insert-row-alias-as-position-fix-20261018.md)，原记录不追认为已覆盖该问题。
