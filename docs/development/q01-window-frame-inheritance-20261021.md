# Q01 命名窗口帧继承开发候选

## 目的和实际入口

已有0757803只支持无基窗口引用的帧关键字。后继允许在同一查询块已有的空窗口、分区窗口、排序窗口及其有界继承链后添加帧，例如 `OVER(base ROWS CURRENT ROW)` 和 `WINDOW child AS(base ROWS CURRENT ROW)`。继续经过真实Worker、完整候选解析与标准建议管道，不新增IPC、不执行SQL或读取元数据目录。

`completionWindowFrameBase.ts`从有效候选的真实查询块定位完整WINDOW列表，核ASCII名称唯一性和引用链；内联OVER可以使用本块整个列表，命名child和中间继承链仅引用前面已定义的窗口。MySQL的非循环前向引用尚未扩展，Unicode名称比较未作服务器规则承诺。

## 语义和隔离

继承只能添加属性，不覆盖排序；引用已有窗口时不添加分区，被引用链不能已有帧。未知、重复、循环、祖先／兄弟／外部CTE名称、尾逗号及冲突均停止，不向字段或函数目录回退。限定字段名的保留字不作为属性词。名称最多256个，引用深度沿用64；完整原文、词法、Worker期限及既有精确偏移比较保持。

同时从完整候选核窗口所在子句：SELECT、当前块ORDER及真正WINDOW定义允许，WHERE／GROUP／HAVING拒绝；同块窗口不能嵌入另一个窗口定义，独立子查询仍按自己的查询块判断。集合全局ORDER沿用0757803的有效AST反例门。对本文引用的语义依据可查[MySQL命名窗口](https://dev.mysql.com/doc/refman/8.4/en/window-functions-named-windows.html)及[MariaDB4011—4013错误](https://mariadb.com/docs/server/reference/error-codes/mariadb-error-codes-4000-to-4099)。语法候选不是服务器执行或字段类型正确性证明。

## 检查与交付边界

新增继承、链、quoted ASCII、RANGE、内层遮蔽、两UNION分支等正向，以及未知／循环／重复／覆盖／已有帧／查询块隔离／不合法子句反例，全部经真实分析和建议入口；目录调用会使正向测试失败。原075中 `base AS()` 加ORDER及帧的负向完整SQL迁移为正向，不删除样本；另加真实构建Worker入口的有效／未知引用对照。

本机仅静态审查与 `git diff --check`，Linux结果如下；Windows、实库、安装和macOS均待验。当前338排序筛选读回请求保持原准确39脚本与两原文件，不能checkout后继产品或把旧GUI通过计入本能力。main仍待原排序筛选闭合后分开整合；Q01工作包保持部分，暂不发布。

首轮准确2a4c724的CI39527307974／job118984882704：Python21项、0.271秒及类型通过；Vitest592文件中591通过／1失败，11450通过／1失败／10跳过，238.78秒，构建未执行。唯一失败是 `PARTITION BY u.rows ORDER BY u.range` 的原SQL返回blocked；固定4.5.1包内uid包含ROWS而缺RANGE，dottedId又依赖uid，不能把第三方语法拒绝当成MySQL非法语句。原失败和SQL保留。

后继只在解析投影中给两／三段合法名称链后的RANGE加引用，保留原始token来源及替换区间；变量链和任意语法不修补。依据见[MySQL限定名](https://dev.mysql.com/doc/refman/8.4/en/identifier-qualifiers.html)。真实建议仍对原文做完整目标替换，不写回此投影。另保留Unicode／带空格命名窗口及普通标量父表达式正向，不让新增ASCII继承名限制误拦原直接窗口；WINDOW子句内仅真正命名定义开放，嵌套窗口拒绝。修正候选等待新准确CI，不回改2a首轮失败。

只增加嵌套守卫的e0505b5亦保留原RANGE失败：[CI39527810841](https://github.com/zhao-yc/DBArk/actions/runs/39527810841)、job118986474330为Python21项通过、0.246秒及类型通过；Vitest591文件通过／1文件失败，11452项通过／1失败／10跳过、223.44秒，构建未执行。两个新增嵌套阻断反例通过，不把它们通过外推为全部继承通过。首次推送e050曾因GitHub443连接失败退出，核远端仍为2a后正常重试成功，没有强推或取消原CI。

RANGE投影及Unicode位置修正位于准确 `81f3a42d2cfa220319ecfda697f0e7959c11de32`，产品树 `44853a769acc789cf3884dc1b495c1633ea42ead`；[CI39528508065](https://github.com/zhao-yc/DBArk/actions/runs/39528508065)、job118988696432已成功。Root读取原日志：Python21项、0.218秒；另有Vitest592文件11458通过／10跳过、172.75秒，类型及构建通过、Vite26.58秒。帧分析76项、真实构建Worker3项均通过，包含原失败两／三段RANGE完整原文、Unicode引用窗口、标量父表达式、嵌套阻断及非法名称链，不回改旧失败。原生、剪贴板与发布job跳过。本次静态核39至当前的两份Python脚本无差异，WIN11-TEST仍只验原338与独立39读回器，其后续full不覆盖本能力。

后继在原 `sql-completion-window.spec.ts` 私网窗口用例中保留五个旧场景，追加两步：内联OVER继承基窗口后补CURRENT、命名child追加帧时补PRECEDING。原输入保留右侧suffix，接受必须完整替换为真正不同的正文，避免用无文本变化的接受冒充Undo证明。真实Monaco按键接受后须完整SQL一致，原生Undo／Redo各核正文与任务／历史不变，再执行保留的接受模型；两步独立预期均为20／30／30。沿用原服务器能力门、三行隔离表、150秒及原清理路径，不新增数据库用户、格式或测试开关。这些新增UI场景仅准备，尚未实际执行，也不属于81原Linux或338原GUI。

2026-10-21 Windows准备：准确d155d76的原CLI进程13832已退出0；类型检查39.18秒，24文件699项全部通过、无失败或跳过，普通新构建50.99秒，原生总计122.954秒。该阶段消息已读到，最终文件／旧封存／进程终核及报告尚待原回合返回，不能先视为最终验收。

后继准确`0a4b23faf4f631d8204ef48f4fd79e6eb4059753`只给本文件实库describe开启既有`preserveOnUnconfirmedExit`选项，产品树仍为44853a769acc789cf3884dc1b495c1633ea42ead。既有strict实库清理在确认同一owner正常退出之后才删除本例随机库，退出不明则保留原现场。原五个场景、两步新帧场景、断言、超时及默认其它用例不改。

远程连接不稳后按用户新授权，在开发机仅执行一次`node scripts/check-local.mjs tests/unit/completion-window-frame.test.ts tests/unit/completion-window-worker.test.ts`：类型49.43秒、2文件81项全通过、Vitest8.27秒，CLI进程20316于02:57:03.1838847Z创建，60.7853369秒后退出0。未执行构建、GUI或SQL；子进程没有DBARK_*变量。原stdout／stderr独立字节文件在`.cache/q01-0a4b23f-local-20261021/`，SHA分别为c2c7afa883b231d1ed0faea520da12fbcb0cc551b20443b35a37d20dc4346bec及空文件e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855。外层PowerShell控制输出出现两行VoidTaskResult，未混入这两份独立原生日志；保留原观察，不重跑检查。

测试会话本轮报告过含凭据RAM对象误输出到工具结果，当前暴露范围仍待只读脱敏核对；不能用本地或CI成功宣称该事件已处置，也不在文档复制敏感对象。主分支排序筛选已另行交付，后继Q01仍待真实GUI和完整平台验收，暂不发布。
