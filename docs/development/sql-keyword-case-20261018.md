# SQL 格式化的关键字大小写偏好

固定基线为 `3985b421c1ce908013321ed8a822212504d72428`，版本保持 0.26.0。本片不修改版本号、覆盖总表或工作流。需求依据为 Root 转交的 Navicat 17 手册印刷页 126 选项审计；没有在本任务重新读取手册。

## 使用与持久化

在现有全局“偏好设置”中集中提供“SQL 格式化偏好”，有“保持原样（默认）”和“关键字大写”两项。按钮和原格式化快捷键共用设置；有选区时只改选区，否则处理全文。它们仍只编辑当前草稿，不执行 SQL、建连、写查询记录或使用系统剪贴板。

选择、取消更改和恢复默认只改本次草稿；点击“保存格式化偏好”后生效。恢复默认也需要保存。保存只合并当时的 `sqlKeywordCase`，不携带打开面板时的 SQL/标签快照。保存失败时当前窗口保留已经应用的偏好并显示重试说明；不会用失败回包还原后来的 SQL。旧面板卸载后的回包不能更新后来打开的面板。

字段仅允许 `preserve` / `upper`，沿原 settings JSON 存储，不增加表或 schema 版本。旧缺项默认保持原样且不被读取操作补写；损坏存量仅局部读取回退。IPC 原始输入和直接 LocalStore 写入都拒绝显式 undefined、未知值及错误类型，未知字段仍由严格 schema 拒绝。

## 为什么不能仅开启 keywordCase

本地锁定依赖实际为 sql-formatter 15.9.0。它公开导出的 MySQL 方言具有 `tokenizerOptions.postProcess` 扩展点，以及 `raw`、`start`、`type`、`text` 正式 token 字段。本片包装该扩展点时首先执行依赖原后处理，不导入私有 lexer，也不另造关键字单词正则表。

但正式 token 类型仍不是 SQL 语法角色：合法的非保留词列名、表名或别名可以被标为关键字。仅按 RESERVED_KEYWORD/RESERVED_CLAUSE/END 放行大小写变化会破坏名称，不能作为安全证明。

因此大写模式还使用项目已有 dt-sql-parser 4.5.1 的 MySQL 解析器与生成的正式监听器。uid、限定名称及函数名上下文提供原始位置跨度，覆盖未限定列/表名、显式/隐式别名和函数名。原输入必须无解析错误、无错误节点并完整消费至 EOF；不确定时整次拒绝。使用正式监听器实例保留框架要求的默认回调，并关闭第三方默认错误输出，不输出用户 SQL。

角色解析只对非 ASCII UTF16 单元做等长度 ASCII 投影，避免 ANTLR 码点索引与 JavaScript UTF16 偏移混用。引号、转义及注释分隔符保持不变；投影既不成为格式化输入，也不进入编辑器。真实 formatter 和原四种引号/反斜线模式校验仍使用原文。非 ASCII 的形似关键字（如 `ſelect`、`Key`）不能获得大小写放宽。

## 允许变化的精确条件

只有以下条件同时成立，某个原 word token 才可以由原文变为其精确 ASCII 大写：

1. 位于依赖正式关键字类型范围内，并且整个正式 token 都属于原选区。
2. 不与正式解析器的名称/函数名跨度重叠，也不处于点号限定名称中。
3. 不属于依赖正式函数表确认的关键字/函数调用歧义，例如 `INSERT()`、`REPLACE()`。
4. 原四种词法模式下 token 数量、顺序、类别及敏感空白仍相同；新 raw 只能等于原 raw 的精确大写。

字符串、注释、引号、反引号名称、变量、函数名、数据类型及其它 token 的 raw 继续逐字比较。没有整体忽略大小写。依赖归类为函数或类型的同形词不会为了追求“全大写”被重新解释。格式器输出即使被污染成名称大写，也不能越过此校验。

全文使用完整上下文取角色/正式 token；选区同样先检查完整原上下文，不能把 `t.order`、`@order` 或函数名的选中后半段当作孤立关键字。formatter 不支持、解析器不支持或角色不确定的语法都保守拒绝，原已有 DELIMITER、存储程序、可执行注释、模式变更、截断 token、过深/过长等拒绝条件保持。

## Root 转交独立反例的实际结果

| 输入 | 本片实际结果 |
| --- | --- |
| `select offset, end from offset;` | 正式 uid 角色确实捕获 `offset/end/offset`；因上游大写输出试图更改受保护名称，整次拒绝，不产生编辑计划。 |
| `select 1 as end, 2 end, 3 as offset, 4 offset;` | 正式角色捕获两个 `end` 和两个 `offset`，包含隐式别名；整次拒绝，不产生编辑计划。 |
| `create table demo (year year, bit bit(1), name varchar(8));` | 可以将 `CREATE TABLE` 大写；`demo/year/bit/name` 列表与 `year/bit/varchar` 类型原文保持，不借 RESERVED_DATA_TYPE 改列名。 |

独立输入方向由 Root 转交，原独立输出 SHA-256 为 `5a96f8362dd9dffe2738d7cb523eeb3682ac91cbf69a378bbe8d8b84318bd81d`。本任务没有读取其他员工目录；本片实际结果由自己的生产模块与逐项断言验证。

## 预算与未验边界

保持原样模式沿用原格式器和原大小预算。大写模式增加一次同步 MySQL 角色解析；全文再走一次正式 formatter，局部选区可能还需第二次 formatter。为限制额外工作，大写模式保守限为完整源 32768 个 UTF16 单元、2048 个原 token，原深度上限继续有效；超过预算只拒绝，不截断或异步补写。

638 初版曾将语法解析器静态导入 renderer；追加窄修已改为仅在明确 upper 格式化后动态加载，默认保持原样不初始化解析器，见 [延迟加载窄修](sql-keyword-case-lazy-20261018.md)。新增预算不是性能证明；本任务没有测量原生冷启动、最终 bundle、真实设备响应或内存峰值。整合时应在同一机器、同一源长/token/嵌套规模，对保持原样和大写模式比较冷启动、格式化耗时与内存。本片没有为此启动 GUI 或服务。

某些 MySQL 合法写法可能因依赖语法覆盖不足被拒绝，例如限定名称恰为保留词的函数形式；不通过降级到词法放行来接纳它们。SQL 服务器具体版本、模式以及 MariaDB 差异未做实库验收。单次编辑事务、模型和选区映射沿用原 formatSqlEditor 主体；RAM 接线验证不代替真实 Monaco 键盘 Undo/Redo 或桌面安装验收。

## 验证与交付

638 首版的验证记录为 77 个唯一用例通过：新大写/语法角色/偏好/存储/Query 入口 48 项，必要旧保持原样与缩进入口对照 29 项。跳过项、中间失败项和已替换的本任务测试标题不重复计数。中间报告保留，不将早期词法方案的通过结果冒充最终角色版本。

真实保存对照使用本 clone 缓存中的独立 sql.js SQLite 文件，经正式 IPC schema、LocalStore 保存和重开核对；没有连接业务数据库或读取用户数据。最终 39 项大写、角色跨度和 Query 接线定向检查通过，完整 TypeScript 检查通过；未重跑旧全套。

主要命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/sql-keyword-case.test.ts tests/unit/sql-formatting.test.ts --reporter=json --outputFile=.cache/sql-keyword-case-evidence/lexer-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/sql-keyword-case-storage.test.ts --reporter=json --outputFile=.cache/sql-keyword-case-evidence/storage-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/sql-keyword-case-ui.test.tsx --reporter=json --outputFile=.cache/sql-keyword-case-evidence/preferences-ui-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/ui-query-formatting.test.tsx -t '关键字偏好沿真实入口|显式操作使用当前全局宽度' --reporter=json --outputFile=.cache/sql-keyword-case-evidence/query-selected.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/sql-keyword-case.test.ts tests/unit/sql-keyword-case-roles.test.ts tests/unit/ui-query-formatting.test.tsx -t '^(?!.*显式操作使用当前全局宽度)(?!.*选区/全文只走)(?!.*拒绝时正文).*' --reporter=json --outputFile=.cache/sql-keyword-case-evidence/final-uppercase-and-query.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

没有运行 GUI、真实 Playwright/list、安装、实库、Docker、SSH、服务、端口或剪贴板，没有修改旧启动诊断固定提交。仅推送独立任务分支，中文提交附 `[skip ci]`，不创建 PR 或派发新 CI；Root 整合后再决定完整 CI。
