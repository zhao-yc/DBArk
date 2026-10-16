# Q01 裸OVER命名窗口候选与版本能力

## 源码差距与固定父版

固定父版73c81963b4487f76afd3e290eb7b848a5b6b14f3。当前公开0.19已有completionWindowScope的PARTITION/ORDER字段和completionWindowInheritance的有界继承，相关真实解析/建议测试已存在；本轮没有为这些能力换名重做。旧plans文字保留历史检查点，不能作为当前缺项证明。

新增两个父版真实反例，先红后实现：

1. `SELECT ROW_NUMBER() OVER rece|suffix FROM sales s WINDOW recent AS(PARTITION BY s.region ORDER BY s.day)`，父版实际建议为空，不能提供已声明的recent窗口。新结果只含`recent`的引用文本，不把它冒充字段/表或查询目录。
2. 已知MySQL5.7.44的`OVER(ORDER BY s.|)`仍被父版分析为ready；新版本按已核验能力返回blocked/capability，不读取目录。

父版两例0通过/2失败，新增实现后原两例2通过；原JSON及源码绑定留在独立克隆.cache/q01-window-scope，交付清单提供摘要。它们是本地分析和建议管道反例，不是服务器或GUI复现。

## 本轮可交付边界

- 裸`OVER name`处提供**当前SELECT查询块**的完整WINDOW列表候选；适用于SELECT表达式和本块ORDER BY。
- 支持独立空/分区/排序定义，以及本列表中可证明的后向继承；不覆盖既有属性，完整SELECT分支语法必须通过真实静默解析器。
- ASCII窗口名保留声明拼写，反引号中的点号、美元、内嵌反引号等按单个名称引用；替换范围覆盖右侧suffix，插入为普通文本，无片段或触发点号。
- 不跨父子查询、CTE、普通派生表、UNION分支或语句；集合全局ORDER、重复名称、循环、缺失定义、恢复不完整、非法属性覆盖均保守停止，不回退字段/函数目录。
- 前向继承、帧、Unicode窗口名比较、`OVER (name ...)`名字位置等暂不新增名称候选；这不等于服务器不支持这些语法。已有窗口内字段/继承切片继续沿原模块处理，本轮未改两个旧窗口作用域模块。
- WHERE/GROUP/HAVING不获得窗口名称；窗口内部不混入SELECT输出别名。已有外层ORDER/GROUP/HAVING、CTE投影、内层遮蔽与会话临时目录路径保持原规则。

本功能不是完整SQL语义校验器，也不验证所有用户表达式是否可在服务器执行。局部符号完整性与目录权限仍分开，不会解析或执行用户SQL来验证补全。

## 官方依据与保守选择

[MySQL 8.0.2官方介绍](https://dev.mysql.com/blog-archive/mysql-8-0-2-introducing-window-functions/)记录窗口函数的引入；[MySQL命名窗口手册](https://dev.mysql.com/doc/refman/8.0/en/window-functions-named-windows.html)说明WINDOW定义、本块OVER引用、属性不可覆盖，并允许无环前向/后向引用。本切片没有把MySQL的前向能力推广给所有方言。

[MariaDB 10.2官方介绍](https://mariadb.com/resources/blog/whats-new-in-mariadb-server-10-2/)与[窗口概述](https://mariadb.com/docs/server/reference/sql-functions/special-functions/window-functions/window-functions-overview)给出版本与查询阶段边界。[MariaDB 10.11官方实现](https://github.com/MariaDB/server/blob/10.11/sql/sql_window.cc#L23)只向列表先前定义查找，并检查重复名称、继承分区/排序覆盖及引用帧限制。本切片采用共同可证明的后向子集；并未借MySQL AST的语法通过宣称MariaDB全部兼容。

## 版本和本地接口

本轮只启用已核验家族的MySQL8.0.2+/8.x、MariaDB10.2+/11.x；MySQL5.7、MariaDB10.1、厂商标记不符、未知/损坏版本及本轮未核验主版本关闭。9.x/12.x等的关闭表示本切片未确认，不宣称服务器本身缺少窗口功能。MariaDB的兼容前缀5.5.5-和发行后缀按明确形态解析，不把任意厂商串当MariaDB。

只有本地Worker接口变化：

- CompletionScopeCapabilities新增可选windowFunctions布尔位；界面从既有连接/会话事实计算，不额外建立会话或发送探测SQL。
- CompletionAnalysisReady新增可选windowNames数组，仅带有界名称；候选只作为本地alias展示“命名窗口”，不查询元数据。
- CompletionWorkerClient把两项能力按独立不可变快照复制；Worker白名单只接收两项明确布尔值，未知键/非布尔拒绝。启动握手仍版本1，8秒启动/2秒解析和全部取消、替换、迟到守卫不变。

主进程shared IPC/commands/contracts/validation/sqlCompletion协议、Engine、App/QueryTab/TableTab/store、目录缓存、SessionCompletionDirectory和serverFacts均未改。

## 验证及验收限制

本轮相关531项／21文件通过，0失败/跳过，其中新增命名窗口65项、真实构建Worker入口1项。既有窗口/继承/别名/LATERAL单元只补入显式窗口能力事实，原关系、插入文本、拒绝与目录断言保留；能力对象断言增加窗口位，原LATERAL门槛不降低。

测试覆盖完整命名列表、后向链、重复/循环/不完整、内外层/CTE/派生/UNION、别名隔离、四种模式、引号、预算、取消、服务器版本和Worker白名单；既有会话临时目录时效、未知来源、worker启动/迟到、服务器事实生命周期一起回归。父红新绿使用真实dt-sql-parser和真实候选生成，仅目录端口替身。

正式UI文件sql-completion-named-window.spec.ts默认关闭，需DBARK_INTEGRATION_ENABLED和DBARK_Q01_NAMED_WINDOW_UI同时为1。只准备两项：支持版本的完整名称插入/撤销或MySQL5.7能力阻断；内外层/UNION/重复/循环/不完整真实Worker阻断。使用原monaco-caret只读证明和13秒预算，同正文/光标/按键/世代才接受Worker结果；没有用空面板替代负向事实。trace/截图/video关闭，现有原生输入、Clipboard只读帮助器和期限没有改。

本轮仅list，未执行GUI/200/原生Clipboard/数据库/安装/手动CI。上述正式用例仍由Root安排实际版本矩阵，不用纯测试替代真实Monaco或服务器证据，也不宣称整个Q01完成。

最终验证命令：

- 纯测试：node --require ./.cache/q01-window-scope/guard-compiler.cjs node_modules/vitest/vitest.mjs run --config .cache/q01-window-scope/vitest.config.mts --pool=threads --maxWorkers=1 --minWorkers=1（531通过）
- 类型：node --require ./.cache/q01-window-scope/guard-compiler.cjs node_modules/typescript/bin/tsc --noEmit（退出0）
- 构建：node --require ./.cache/q01-window-scope/guard-compiler.cjs scripts/build.mjs（退出0；保留现有大包体积提示）
