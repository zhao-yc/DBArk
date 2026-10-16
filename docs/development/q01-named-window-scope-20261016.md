# Q01 裸OVER命名窗口候选与版本能力

## 源码差距与固定父版

固定父版73c81963b4487f76afd3e290eb7b848a5b6b14f3。当前公开0.19已有completionWindowScope的PARTITION/ORDER字段和completionWindowInheritance的有界继承，相关真实解析/建议测试已存在；本轮没有为这些能力换名重做。旧plans文字保留历史检查点，不能作为当前缺项证明。

初版曾以两个父版真实管道反例先红后实现；2026-10-17原生CI暴露旧字段回归后，第二项需求解释已纠正，具体见末节：

1. `SELECT ROW_NUMBER() OVER rece|suffix FROM sales s WINDOW recent AS(PARTITION BY s.region ORDER BY s.day)`，父版实际建议为空，不能提供已声明的recent窗口。新结果只含`recent`的引用文本，不把它冒充字段/表或查询目录。
2. 初版将已知MySQL5.7.44的`OVER(ORDER BY s.|)`返回ready当作缺陷并新增全局门。这混淆了既有文本字段编辑与服务器窗口执行支持，现已撤回该门；5.7负例改为新增裸OVER窗口名称仍blocked/capability，不能冒充支持执行。

初版父版两例0通过/2失败、实现后2通过的原JSON及源码绑定仍保留在独立克隆.cache/q01-window-scope，不覆盖历史原件；它们不能继续作为限制旧字段编辑的依据，也不是服务器或GUI复现。当前正确边界是名称候选按能力开放，既有关系/CTE字段分析沿用原路径。

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

新增裸OVER窗口名称候选只对已核验家族的MySQL8.0.2+/8.x、MariaDB10.2+/11.x开放；MySQL5.7、MariaDB10.1、厂商标记不符、未知/损坏版本及本轮未核验主版本关闭。9.x/12.x等的关闭表示本切片未确认，不宣称服务器本身缺少窗口功能。MariaDB的兼容前缀5.5.5-和发行后缀按明确形态解析，不把任意厂商串当MariaDB。既有文本内CTE/关系字段与输出别名编辑不以此门证明执行能力，也不由此改写服务器事实。

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

## 2026-10-17：恢复原离线窗口字段，保留新增名称能力门

ROOT提供的原生CI运行38938039965，开发头`903f953eb6ce11cf05949af7d48e738d53632054`在Windows和Mac arm64均有3个原离线窗口用例无法取得`value_column`。对应正式文件`tests/e2e/sql-completion-window.spec.ts`在新建未连接草稿中，没有服务器事实；真实`completionContextCapabilities()`得到关闭窗口执行能力的快照。c027把`windowContext`整体加上`windowFunctions===true`门，导致旧OVER/WINDOW内部CTE字段在分析阶段直接blocked。另一项schema5失败由独立任务处理，不归本修复。

独立普通克隆固定ROOT基点`d5e57ec4e40f52e0958148aee07bdb2b8662f1f9`，不使用worktree。新增纯回归复用原UI的9个正向SQL及完整插入期望、3个集合/帧负例，并覆盖已知5.7的纯字段编辑，共13项；默认能力直接来自无会话真实context，不伪造版本，不将分析器或建议生成替换为桩，只有不应被调用的目录端口是IO替身。

| 固定版本与同一测试原字节 | 结果 |
| --- | --- |
| c027直接父版`73c81963b4487f76afd3e290eb7b848a5b6b14f3` | 13通过、0失败 |
| ROOT未修复`d5e57ec` | 4通过、9失败：8项旧字段/作用域正例及1项5.7文本字段编辑被拦截；窗口结束后的普通输出别名和3个原负例仍通过 |
| 本次修复 | 13通过、0失败；相同13项测试未修改原字节 |

产品修复仅移除`completionAnalysis.ts`中旧`windowContext`的过宽能力门，并加中文注释区分文本投影分析与执行支持；`namedWindows`专用`windowFunctions===true`门保留。没有新增能力位、三态或重写client/worker/context/版本判断，也没有修改执行、目录、取消或会话时效链路。LATERAL、帧、集合全局排序、继承/重复/未知窗口与输出别名隔离仍经过原有语法守卫。

初版新增的两个“5.7/缺省能力阻断窗口字段”单元断言修正到裸OVER名称路径，仍断言blocked/capability、零目录；这是纠正新增能力的适用范围，未放宽名称负例。原65项命名窗口、真实Worker白名单以及其余旧窗口/继承负例保留。完整相关544项／22文件通过，0失败/跳过，类型检查及源码构建退出0，构建仍保留既有大包提示。此前纯验证和独审沿用了显式`windowFunctions:true`前提，漏掉真实无服务器context，不能以原531通过否定这次原生CI回归。

所有原UI文件、断言、时间预算、输入/剪贴板帮助器保持原Git字节，没有加wait/retry、伪造服务器或调整定位。当前只做纯验证和源码构建，GUI、200、剪贴板、手动CI实际执行均为0；原3个界面回归仍由ROOT安排真实复验，不能用本地管道通过冒充原生CI已绿。

本克隆忽略目录`.cache/offline-window-regression-20261017`保存父版Git快照、parent/before/after/related原始JSON、类型/构建退出与stdout/stderr、纯验证守卫和绑定报告。守卫拒绝实际网络、GUI/JVM/数据库子进程，仅允许本Node/esbuild；Vite的`net use`路径优化只返回空映射，不执行系统命令。依赖包只读复用既有安装，未安装或修改共享包；ROOT源码和员工2的CALL任务未改动。
