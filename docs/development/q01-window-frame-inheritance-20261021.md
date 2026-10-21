# Q01 命名窗口帧继承开发候选

## 目的和实际入口

已有0757803只支持无基窗口引用的帧关键字。后继允许在同一查询块已有的空窗口、分区窗口、排序窗口及其有界继承链后添加帧，例如 `OVER(base ROWS CURRENT ROW)` 和 `WINDOW child AS(base ROWS CURRENT ROW)`。继续经过真实Worker、完整候选解析与标准建议管道，不新增IPC、不执行SQL或读取元数据目录。

`completionWindowFrameBase.ts`从有效候选的真实查询块定位完整WINDOW列表，核ASCII名称唯一性和引用链；内联OVER可以使用本块整个列表，命名child和中间继承链仅引用前面已定义的窗口。MySQL的非循环前向引用尚未扩展，Unicode名称比较未作服务器规则承诺。

## 语义和隔离

继承只能添加属性，不覆盖排序；引用已有窗口时不添加分区，被引用链不能已有帧。未知、重复、循环、祖先／兄弟／外部CTE名称、尾逗号及冲突均停止，不向字段或函数目录回退。限定字段名的保留字不作为属性词。名称最多256个，引用深度沿用64；完整原文、词法、Worker期限及既有精确偏移比较保持。

同时从完整候选核窗口所在子句：SELECT、当前块ORDER及真正WINDOW定义允许，WHERE／GROUP／HAVING拒绝；同块窗口不能嵌入另一个窗口定义，独立子查询仍按自己的查询块判断。集合全局ORDER沿用0757803的有效AST反例门。对本文引用的语义依据可查[MySQL命名窗口](https://dev.mysql.com/doc/refman/8.4/en/window-functions-named-windows.html)及[MariaDB4011—4013错误](https://mariadb.com/docs/server/reference/error-codes/mariadb-error-codes-4000-to-4099)。语法候选不是服务器执行或字段类型正确性证明。

## 检查与交付边界

新增继承、链、quoted ASCII、RANGE、内层遮蔽、两UNION分支等正向，以及未知／循环／重复／覆盖／已有帧／查询块隔离／不合法子句反例，全部经真实分析和建议入口；目录调用会使正向测试失败。原075中 `base AS()` 加ORDER及帧的负向完整SQL迁移为正向，不删除样本；另加真实构建Worker入口的有效／未知引用对照。

本机仅静态审查与 `git diff --check`，CI、Windows、实库、安装和macOS均待验。当前338排序筛选读回请求保持原准确39脚本与两原文件，不能checkout后继产品或把旧GUI通过计入本能力。main仍待原排序筛选闭合后分开整合；Q01工作包保持部分，暂不发布。

首轮准确2a4c724的CI39527307974／job118984882704：Python21项、0.271秒及类型通过；Vitest592文件中591通过／1失败，11450通过／1失败／10跳过，238.78秒，构建未执行。唯一失败是 `PARTITION BY u.rows ORDER BY u.range` 的原SQL返回blocked；固定4.5.1包内uid包含ROWS而缺RANGE，dottedId又依赖uid，不能把第三方语法拒绝当成MySQL非法语句。原失败和SQL保留。

后继只在解析投影中给两／三段合法名称链后的RANGE加引用，保留原始token来源及替换区间；变量链和任意语法不修补。依据见[MySQL限定名](https://dev.mysql.com/doc/refman/8.4/en/identifier-qualifiers.html)。真实建议仍对原文做完整目标替换，不写回此投影。另保留Unicode／带空格命名窗口及普通标量父表达式正向，不让新增ASCII继承名限制误拦原直接窗口；WINDOW子句内仅真正命名定义开放，嵌套窗口拒绝。修正候选等待新准确CI，不回改2a首轮失败。
