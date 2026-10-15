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

最终代码的完整单元回归通过：122 个文件、2330 项；其中新增窗口专项 23 项，覆盖已有正向能力、别名泄露、继承/帧边界、保留字字段、CTE/派生隔离和取消。类型检查及正式构建通过，构建只保留既有的第三方注释和大包提示。

实际 Electron/Monaco 离线入口：4 项通过、1 项实库用例默认跳过。覆盖新增窗口字段与别名隔离两个入口，以及原有冷启动 CTE 和输出别名两个入口。截图保存在本克隆忽略目录 `test-results`；构建与全量单元详细日志分别保存在 `.cache/q01-build.log`、`.cache/q01-unit.log`，不提交产物或日志。

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
