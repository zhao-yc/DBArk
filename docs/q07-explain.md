# Q07 可视化执行计划开发与验收说明

## 已接通的切片

- 查询标签工具栏的“执行计划”优先使用原标签会话发送 `EXPLAIN FORMAT=JSON`，支持 SELECT、JOIN、子查询、CTE 和原入口允许的数据修改语句；所有请求均加 EXPLAIN 前缀，不发送用户原语句或 ANALYZE。
- 计划结果内可切换树形计划、原始输出及结果表格。“获取文本计划”重新分析首次捕获的 SQL，仍走同一标签会话。MySQL 显式使用 `FORMAT=TRADITIONAL`，避免 `explain_format` 改变文本入口。
- 分别提取 MySQL `rows_examined_per_scan` / `rows_produced_per_join` / `cost_info`，以及 MariaDB `rows` / `filtered` / 实际存在的 `cost`。成本为优化器估计，单位不显示为毫秒；缺项显示不可用。
- 树边表示服务器 JSON 的包含关系，保留连接数组顺序；不额外推断执行先后和基数。未知对象仍有节点、JSON Pointer 和原始详情，未知标量在原始数据中可见。
- 方向键、Home、End、Enter、空格、箭头点击、双击和全部展开/收起可操作节点；树与详情各自滚动，狭窄容器下纵向排列。

## 边界

JSON 最大 192 KiB、64 层、16000 个解析项；树最多 300 个节点，名称最多展示 160 字符，路径最多展示 2048 字符，节点详情最多 16000 字符。超长路径会提示直接查看原文，防止长公共键名在跨进程节点数据中重复放大。原始结果沿用流式单元格预算；超限、无数据及解析失败均明示，不能把截断数据当完整计划。文本计划最多 1000 行，仍受用户结果行上限和 1 MiB 任务预算限制。

JSON 数字在解析前原样转成文本，保留大整数、小数和指数的精度。节点详情的数字显示为带引号文本；原始输出保留服务器原文。

能力来自当前真实连接的服务器版本：MySQL 5.6 及以上、MariaDB 10.2 及以上尝试 JSON；较早或未知版本保守使用文本。格式未知、不支持、语法不兼容的服务器错误允许一次文本回退；权限错误、取消、连接中断及其他错误不回退。解析失败保留原文并允许用户手动获取文本。

沿用 SQL 扫描器的当前模式、DELIMITER 和模式不确定性保护，拒绝多语句、可执行版本注释、EXPLAIN/ANALYZE 输入。不为能力探测新建会话，不改变默认库、事务或临时表；取消仍通过现有任务注册及 KILL QUERY 收尾。

## 样本来源

`tests/fixtures/explain/` 的五份文件是**按公开格式人工编写的静态形状样本，不是本轮五版本实库采集结果**：MySQL 5.7/8.0/8.4、MariaDB 10.11/11.4。测试覆盖 JOIN、物化子查询、窗口、排序、块连接及未知节点，不能由文件名推导实库兼容性已通过。

- [MySQL 8.4 EXPLAIN 语法与格式](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [MySQL 8.4 EXPLAIN 输出字段](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html)
- [MariaDB EXPLAIN FORMAT=JSON](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain-format-json)
- [MariaDB EXPLAIN 语法](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/explain)

MariaDB 官方明确说明其 JSON 与 MySQL 不同，且未提供完整字段规格。因此复杂及新方言节点目前保留真实对象与原文，不能宣称全部语义已经解释。

## 当前验证

- 独立克隆已通过锁文件安装自身依赖，锁文件无变更。
- `node node_modules/vitest/vitest.mjs run tests/unit/explain.test.ts tests/unit/engine-runtime.test.ts tests/unit/validation.test.ts tests/unit/engine-sql.test.ts tests/unit/query-parameters.test.ts tests/unit/ui-query-context-preparation.test.ts tests/unit/main-query-context.test.ts tests/unit/query-context.test.ts tests/unit/task-privacy.test.ts`：135 项通过，包括实际 Engine 接线、同一会话、取消释放、格式回退和精度/预算。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node scripts/build.mjs`：通过；仅有原有第三方注释及大包提示。
- `node node_modules/@playwright/test/cli.js test tests/e2e/explain-view.spec.ts`：1 项 Electron 离线用例通过，覆盖真实组件的方向键/首尾/展开收起、未知与原型同名节点、缺失指标、长文本、原始数据和 1024×680 窗口；已复核截图。
- 离线窗口使用本克隆的独立 Electron 依赖、独立临时配置目录和沙箱；仅验组件交互，不能算成真实 SQL/数据库兼容性通过。
- 五版本实库验证及最终安装包：由统筹安排，本任务未执行。

## 统筹实库所需资源

请主对话在核对 Server-200 / 192.168.31.200 身份后，统一安排五个版本的隔离测试连接。不修改业务库，不运行本机 Docker。

每个连接需要一个临时 `dbark_e2e_*` 隔离库（沿用仓库隔离测试帮助器），三张小表 customer/orders/detail，允许在该库建表、插入少量样例、SELECT、EXPLAIN、事务及会话临时表。测试后删除自身创建的库即可。凭据只通过调用环境注入，不复制主目录秘密或提交到仓库。

已准备 `tests/e2e/query-explain.spec.ts`。统筹核对服务器和授权范围后，向测试进程注入 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`，逐版本执行 `node node_modules/@playwright/test/cli.js test tests/e2e/query-explain.spec.ts --workers=1`。该入口验证真实界面的 SELECT/JOIN/子查询/分组/UNION、原会话临时表、事务、默认库及编辑草稿后仍分析原 SQL 的文本操作。其余权限/取消实库场景仍需统筹补验。

需要实测：SELECT/JOIN/相关及物化子查询/UNION/排序分组、各版本真实字段、缺失指标、原会话临时表、事务和默认库保持、格式不支持/权限拒绝、取消后资源释放及后续会话复用。真实取消受查询优化耗时影响，应使用可控隔离对象，不把快速完成误记为取消通过。

## 公共文件改动

- `src/shared/contracts.ts`：QueryOutcome 增加可选 explain；query.explain 增加可选 auto/text 格式。
- `src/shared/validation.ts`：严格校验该格式。
- `src/engine/index.ts`：原查询会话及任务内调用独立执行计划模块。
- `src/renderer/components/QueryTab.tsx`：接入结果计划视图和原 SQL 文本计划操作。
- `tests/unit/engine-runtime.test.ts`：补充原引擎链路测试。

其余代码、文案、样式和样本均为本功能独立新增文件；未改统一覆盖表、版本、发行说明或发布流程。
