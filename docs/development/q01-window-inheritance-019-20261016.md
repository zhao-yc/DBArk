# Q01：命名窗口继承中的ORDER字段作用域

日期：2026-10-16。从冻结`80b65746242190b9ca3ea22fdb2677c0a8046d0d`建立普通分支`codex/employee2-q01-window-scope-019-20261016`，供0.19候选评审。Q01仍是部分完成，本切片不更改0.18版本、发行文件、历史验收或全局覆盖率。

## 先核已有能力，再补单一缺口

80已有普通`OVER(PARTITION BY ... ORDER BY ...)`及独立`WINDOW w AS(...)`的字段作用域；已有测试覆盖窗口内部不能借外层输出别名、CTE/派生表隔离、同名遮蔽、UNION与帧边界。对应源码和开发说明是`completionWindowScope.ts`及`sql-completion-window-scope.md`，因此不重复实现这些能力。

本切片只增加：当前SELECT命名窗口为空或仅含PARTITION时，继承规范中的ORDER字段补全。例如：

```sql
WITH q AS (SELECT 1 AS value_col)
SELECT SUM(value_col) OVER (base ORDER BY val/* 光标 */suffix)
FROM q
WINDOW base AS (PARTITION BY value_col);
```

接受建议使用原管道将`valsuffix`完整替换为引用后的`q`.`value_col`。限定输入`q.valsuffix`仅替换字段，保留已有`q.`。`WINDOW base AS(...),child AS(base ORDER BY ...)`中的字段同样沿用当前查询块来源。既有CTE明确投影保持零目录；物理表继续按实际库、表和前缀惰性读取。

## 有界规则

- 只承认当前SELECT、当前集合分支的一个完整WINDOW定义列表，不向祖先、CTE外部或兄弟分支查找窗口名，不把名称回退成物理表、数据库或函数目录。
- 新继承切片的整个列表只接受64字符以内ASCII窗口名，可引用ASCII名并按ASCII大小写比较；复杂Unicode比较、中文/点号窗口名仍保守停止新继承补全。原独立窗口的名称范围不收窄。
- 基础定义只能为空、仅含PARTITION BY，或引用此前定义的无属性名称。引用链使用集合防循环，并沿用64层、256条目及原词法/Worker预算。
- MariaDB只从先前命名定义寻找引用；MySQL允许前向引用。当前Worker没有区分这一差异的能力事实，因此本切片只接受双方共同的向后链，不新增猜测的版本能力或共享协议。内联OVER可以正常引用写在语句后方的完整WINDOW列表，这与定义之间的前向链不同。
- 目标只接受`base ORDER BY ...`。列表重复名称、当前继承路径上的未知引用/循环、重复/覆盖ORDER、任何继承PARTITION叠加、继承帧、帧编辑位置、不完整列表和超预算均停止；不新增窗口名候选或完整SQL合法性诊断。
- 当前继承字段仍不借外层SELECT输出别名；窗口关闭后的原ORDER/GROUP/HAVING别名行为不变。普通派生表和CTE不捕获外层关系；合法内层同名窗口只验证内层定义。
- 第三方解析恢复可能在第二个WINDOW之前提前结束。新规则同时检查真实词法括号/集合边界，重复WINDOW不能靠AST截断隐藏；不把错误语法恢复视为已证明的定义。

本地语义分析不证明服务器支持窗口执行。没有新增服务器探测SQL、权限推断、执行写操作、目录权限或缓存。未知版本保持原事实规则；MySQL5.7不因本补全获得窗口能力。新代码不修改App、TableWorkspace、共享IPC、能力facts、Worker消息、Monaco协议或第三方依赖。

## 官方一手资料与实际解析器

- [MySQL8.4命名窗口](https://dev.mysql.com/doc/refman/8.4/en/window-functions-named-windows.html)：支持OVER继承、属性只可新增；定义间可前后引用但不能循环。
- [MySQL8.4官方window.cc](https://raw.githubusercontent.com/mysql/mysql-server/8.4/sql/window.cc)：`resolve_reference`只遍历当前query block；`setup_windows1`拒绝循环、子窗口PARTITION、重复ORDER及继承有帧窗口。名称使用服务器大小写比较；客户端仅取ASCII子集，不模拟其完整Unicode排序规则。
- [MariaDB窗口函数概览](https://mariadb.com/docs/server/reference/sql-functions/special-functions/window-functions/window-functions-overview)：核对OVER、PARTITION/ORDER及命名窗口复用的基本语法。
- [MariaDB10.11官方sql_window.cc](https://raw.githubusercontent.com/MariaDB/server/10.11/sql/sql_window.cc)：`check_window_names`仅查此前定义，拒绝重复名、引用窗口的PARTITION、重复ORDER及引用帧。该来源用于收窄共同语义，不据分支源码推断全部已发布版本能力。精确10.11.19标签页面抓取失败，未冒充已读取。
- 实际已安装`dt-sql-parser@4.5.1`的`windowSpec()`接受可选窗口引用再加PARTITION/ORDER/frame。真实`queryResult`、SELECT分支和既有关系解析继续作为字段来源，新helper只返回已证明/拒绝，不生成关系。

## 实际生产接线与验证边界

标准`SqlEditor`的Monaco provider调用`CompletionWorkerClient.analyze`，真实`completion.worker.ts`调用`analyzeCompletion`，后者经`completionWindowContext`调用本helper。输出仍是原`CompletionAnalysisReady`，经原`completionSuggestions`产生普通文本插入和原完整替换范围；模型版本、连接修订、模式、对象修订、取消与迟到结果校验都沿用原入口。只读SQL预览仍不注册提供器。

纯测试从实际解析器到实际建议生成，覆盖新增正反作用域、CTE/派生/物理目标、完整后缀替换、引用链、不同方言共同边界、重复/循环/帧/解析恢复及取消；结构化克隆后仍使用原结果形状。原测试中一条“已定义空base的继承窗口暂不支持”属于本批明确开放的形式，已增加原样正向对照，并把旧负例改为“base已有ORDER、child又加ORDER”的非法覆盖，未删除该守卫。首次失败和后续结果保留在本分支ignored `.cache/q01-window-inheritance-019-20261016`。

最终相关纯回归为19个文件459项全部通过，包括新增38项；类型检查通过，正式构建通过（43.66秒，保留既有大块资源提示）。默认UI列表收集13项、执行0项。实际命令使用仓库已有工具：

```powershell
$testFiles=@(rg --files tests/unit | Where-Object { $_ -match '(completion|session-objects)' })
node node_modules/vitest/vitest.mjs run @testFiles --reporter=json --outputFile=.cache/q01-window-inheritance-019-20261016/related-final.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# 在子进程清除DBARK环境后只收集列表，不执行自动桌面夹具。
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion.spec.ts tests/e2e/sql-completion-window.spec.ts --list --reporter=json
```

员工2没有启动GUI、200、Docker、真实env/key、剪贴板或手动CI。详细报告在ignored `.cache/q01-window-inheritance-019-20261016`；不得把这些检查写成Monaco键盘、真实目录或服务器执行已验收。

## ROOT后续实测点

1. 在新候选的标准Monaco查询标签，使用上面CTE及命名child两种形式，核候选、Ctrl+空格/接受、完整后缀替换、平台撤销；确认未知/循环/跨块名称零目录回退。既有Worker期限和剪贴板保护不得为通过测试放宽。
2. 在明确支持窗口的MySQL8.0/8.4、MariaDB10.11/11.4隔离实例，使用已有真实表字段补全并只读执行SELECT，核当前库/模式、物理目录目标和结果；13484保持严格TLS。引用链只测向后定义，不能把MySQL前向链当作MariaDB已支持。
3. 分别核对内层同名窗口、UNION各分支、已有ORDER的拒绝、字段与输出别名同名、取消/迟到目录，以及MySQL5.7/未知版本未获得新的窗口执行能力。此切片不提供祖先输出别名、例程局部变量、窗口名建议或完整窗口SQL恢复。
