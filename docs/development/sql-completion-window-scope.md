# Q01 普通 SELECT 窗口字段作用域小切片

日期：2026-10-16。基线：`90acbfc45ce0d5c677d956830b8473f5d2254290`。独立分支：`task/parallel-q01-window-scope-20261016`。本次未更新全局覆盖表、发行版本或发布产物。

## 已有能力与本次修正

先用实际安装的 `dt-sql-parser@4.5.1` 验证：普通 `OVER(PARTITION BY ... ORDER BY ...)` 与显式 `WINDOW w AS (...)` 原本已经能取得本查询块的表、CTE 和普通派生表字段。保留原有 AST 关系解析与惰性目录，不新增另一套关系推断。

实际缺口是外层 `ORDER BY` 包含窗口时，输出别名上下文会穿透窗口括号。例如：

```sql
SELECT u.id AS output_alias
FROM users u
ORDER BY SUM(u.id) OVER(ORDER BY out/* 光标 */suffix)
```

原实现会建议非法的 SELECT 输出别名 `output_alias`。现在窗口字段表达式不继承外层输出别名；当前关系中的同名真实字段仍可按 `别名.字段` 插入。窗口括号关闭后，外层 `ORDER BY`、合法位置的 `GROUP BY` / `HAVING` 沿用原有别名规则。

新增 `completionWindowScope.ts` 只识别有界 token 中当前 SELECT 的窗口容器，返回表达式或不支持的边界，不创建、修改或扩展任何关系来源。窗口内嵌子查询仍用自身查询块的规则。普通派生表与 CTE 仍不捕获外层别名；内层遮蔽和 UNION 分支隔离保持不变。

## 本次范围

- 普通 SELECT 的内联窗口，以及独立的显式命名 WINDOW 定义中的 `PARTITION BY` / `ORDER BY` 字段表达式。
- 限定与未限定字段、多个独立命名窗口、引用窗口名、带点中文窗口名和点号后的保留字字段，例如 `u.rows`。
- Monaco 的完整 token 后缀替换、键盘接受与撤销；本地 CTE 明确投影无需目录连接。
- 继承窗口（例如 `OVER(base ORDER BY ...)`）、窗口名编辑位置、帧边界位置保守停止建议；不推断窗口继承、窗口名称引用或帧表达式。已有窗口帧之前的字段表达式仍可使用。

本切片不是 SQL 合法性检查器，也没有声明完整窗口补全。SQL 本地分析沿用现有协议中的模式信息，不新增服务器版本探测或连接 SQL；MySQL 5.7 仍不具备窗口执行能力。离线字段建议通过不代表目标服务器能够执行窗口 SQL。

## 官方规则与实际解析器核对

- [MySQL 8.0 新增能力](https://dev.mysql.com/doc/refman/8.0/en/mysql-nutshell.html)：窗口函数属于 MySQL 8.0 新增能力，不能算作 5.7 覆盖。
- [MySQL 窗口语法](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html) 与 [命名窗口](https://dev.mysql.com/doc/refman/8.4/en/window-functions-named-windows.html)：窗口包含独立的分区、排序和帧规范；命名 WINDOW 位于 HAVING 之后、外层 ORDER BY 之前。
- [MySQL SELECT 名称规则](https://dev.mysql.com/doc/refman/8.4/en/select.html)：外层 ORDER / GROUP / HAVING 的别名规则不能直接应用到窗口内部。
- [MariaDB 窗口函数概览](https://mariadb.com/docs/server/reference/sql-functions/special-functions/window-functions/window-functions-overview)：已核对 OVER 的 PARTITION / ORDER，以及明确给出的 `WINDOW w AS (...)` 复用示例；本轮没有进行 MariaDB 实库执行验收。
- 实际依赖源码：`dt-sql-parser/dist/lib/mysql/MySqlParser.js` 的 `windowClause()`、`overClause()`、`windowSpec()` 分别接受 WINDOW 定义列表、括号规范或窗口名、可选继承名及 PARTITION / ORDER / frame；`mysqlEntityCollector.js` 的 `exitSelectElements()` 仍提供原查询结果上下文。本次只收窄窗口边界，未修改第三方解析器。

## 验证记录与统筹验收入口

首切片 `ea560bb` 的完整单元回归通过：122 个文件、2330 项；其中窗口专项 23 项，覆盖已有正向能力、别名泄露、继承/帧边界、保留字字段、CTE/派生隔离和取消。类型检查及正式构建通过，构建只保留既有的第三方注释和大包提示。复审修复的补充验证见下文。

首切片实际 Electron/Monaco 离线入口：4 项通过、1 项实库用例默认跳过。覆盖窗口字段与别名隔离两个入口，以及原有冷启动 CTE 和输出别名两个入口。截图保存在本克隆忽略目录 `test-results`；构建与全量单元详细日志分别保存在 `.cache/q01-build.log`、`.cache/q01-unit.log`，不提交产物或日志。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion.spec.ts tests/e2e/sql-completion-window.spec.ts --grep '离线|窗口字段接受后执行'
```

新增实库用例默认跳过，且本轮没有设置 `DBARK_INTEGRATION_ENABLED=1`、读取根目录凭据或连接 200。统筹核对实际测试服务器后，可在自己的验收环境启用 `tests/e2e/sql-completion-window.spec.ts`：

1. 从观察连接读取实际版本；MySQL 5.7 / 不支持窗口的版本明确跳过。
2. 仅在该用例创建的唯一隔离库内建立 `window_subject`，验证五种候选实际插入后的 SQL。
3. 通过真实 Monaco 接受候选，核对补全阶段任务和历史不变，再点击“执行全部”；直接执行接受后的模型，不重填预期 SQL。
4. 核对 PARTITION 排名、窗口 ORDER 排名、命名 WINDOW 两种字段位置、外层 ORDER 包含窗口时仍插入真实字段，并按行值断言结果。
5. 使用现有隔离库清理机制，先退出本例 Electron 释放会话，再精确清理唯一库。

Worker 就绪握手版本 1、启动 8 秒 / 分析 2 秒期限、取消和迟到结果丢弃均未变化。源码、token、深度、目录目标、目录权限与建议数量预算继续复用现有限制；未改 IPC、存储、会话、目录 SQL 或运行时版本。

## 2026-10-16 复审修复：集合全局窗口与恢复解析帧位置

以固定 `ea560bbf9f86f80e53490d24a6f9d8b2318e7ac3` 的实际分析器和候选生成器复现了两类目录错误：

```sql
SELECT u.id FROM users u UNION ALL SELECT o.id FROM orders o
ORDER BY SUM(id) OVER(ORDER BY out/* 光标 */suffix);

SELECT ROW_NUMBER() OVER(
  ORDER BY u.id ROWS BETWEEN UNBOUNDED PRECEDING AND CUR/* 光标 */RENT ROW
) FROM users u;
```

第一例原本从 UNION 末分支请求 `orders` 字段并插入 `o.字段`；第二例在恢复解析没有收集到查询分支时仍请求 `CUR` 前缀函数。这两类位置现在都返回停止结果，字段和函数目录请求均为零。第一类是首切片回归，第二类是复审同时确认并补齐的既有停止缺口。

集合查询上下文现在先独立判定，再决定是否展示输出别名；不支持的集合全局窗口不会借用末分支 FROM。[MySQL 官方集合查询规则](https://dev.mysql.com/doc/refman/8.4/en/set-operations.html) 对全局 ORDER 与括号内分支 ORDER 作了区分，并禁止全局 ORDER 使用分支表限定名。普通集合全局输出列规则继续沿用原实现。

帧停止检查先查看当前光标的所有实际窗口容器，不再依赖 AST 必须存在分支；帧内函数、字段及嵌套表达式都不能绕过。编辑 ROWS 关键字本身时，仅使用原词法 token 的已确认单词恢复这个边界，不改变 AST 或关系来源；`u.rows` 与引用字段继续按字段处理。之后才判断当前窗口表达式是否属于已确认查询分支。普通窗口排序中的独立子查询继续使用自己的规则。

新增 16 项正反回归：UNION 全局窗口停止、末分支目录零请求、首/末分支 SELECT 窗口、括号内分支 ORDER、ROWS/RANGE 帧关键词和函数/字段/嵌套表达式停止，以及帧之前字段继续补全。窗口专项现为 39 项，完整单元 122 文件、2346 项通过；类型检查及构建通过。

新增真实 Electron 用例只旁观真实 Worker 的请求长度、光标位置和返回状态，不存 SQL 正文，不替换 Worker、解析、期限、取消或返回值。负例等待匹配当前文本位置的实际 `blocked` 后确认候选未出现；正例通过实际键盘接受分支窗口和帧前字段，核对完整 SQL，再撤销核对原文。详细日志位于本克隆 `.cache/q01-window-fix-unit.log`、`.cache/q01-window-fix-build.log`；固定旧提交探针与输出也仅保存在本克隆忽略目录。本轮继续默认跳过实库，没有连接 200。

实际 GUI 结果：原有 4 项离线入口回归通过；新增集合/帧边界用例独立通过（3 个停止位置及 3 个接受/撤销场景）。实库 1 项仍默认跳过。Monaco 无候选时可以显示空面板，因此负例在实际 Worker 停止后核对候选行数为零，不把空面板存在误判为提供了建议。
