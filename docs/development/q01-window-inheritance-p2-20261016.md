# Q01继承窗口：P2完整语法收口

本次在员工2专用分支追加修复，直接父为冻结`2cb329debb612da3c11a018f20e5670ba102c600`。原2cb提交、开发说明、员工4原报告和探针均保留，不改0.18、ROOT或组装候选。

## 问题及修复

员工4用真实生产Worker、Client、Directory及SqlEditor provider的受控回放确认：光标位于先前`OVER(base ORDER BY u.va/* 光标 */suffix)`时，以下未完成定义会被原2cb误放行并请求`db.users`列目录：

- `WINDOW base AS(),`
- `WINDOW base AS() other AS()`
- `WINDOW base AS(PARTITION BY u.id,)`

列表循环遇到非逗号就结束、走到token末尾也结束，不能证明后继合法；仅按分区属性词和数量检查，也不能证明完整表达式。本次不特判这三个字串。

`analyzeCompletion`现在只为新增窗口继承路径提供当前SELECT分支的完整语法校验。分支范围仍由有界token的真实括号/集合边界决定，不能信任恢复AST提前结束的位置。校验源是本地规范化后的原语句片段，包含光标哨兵、WINDOW列表、PARTITION完整表达式和同分支后继；实际安装的MySQL解析器必须无语法错误才继续。

该校验新建独立的现有`QuietMySQL`，避免改变已收集实体，且不会回显SQL。未提供校验器时继承helper保守拒绝。回调只在同一个本地Worker内部传递范围，不改变Worker消息、分析输出类型、共享IPC或能力facts，不新增目录、探测或执行命令。原2秒解析期限、token/源码/深度预算不变。

完整语法只是新增的必要条件。原当前查询块和UNION隔离、ASCII名称、同名歧义、合法向后链、排序覆盖、继承帧及深度拒绝仍逐项检查。普通内联窗口和独立命名窗口不增加这项完整分支要求。新增继承补全会更保守：同一分支其它部分尚未写完时也停止，待语法完整后恢复；这不是完整SQL合法性或服务器版本/权限证明。

## 独立材料与验证方法

员工4的报告及`independent-probe.cjs`逐字复制到本克隆ignored `.cache/q01-window-p2-20261016`，保存SHA256，不修改外部原件。原2cb先原样复跑：27项断言通过，其中三项是缺陷复现，不能算安全通过。

修复后继续原样执行同一探针。原有24项正常/拒绝/失效检查应通过；三项缺陷复现断言仍期待`ready`，因此修复后应报告实际`blocked`与旧期待不符。原探针的源码、断言、三条SQL字串和硬编码的旧2cb标签均不改写，不能把该标签当成新提交身份。

另有独立的`acceptance-probe.cjs`：通过AST直接读取原探针的同三条SQL和原受控端口函数，在新固定源码上运行实际Worker、Client、Directory和生产SqlEditor provider，要求全部`blocked`、零建议、零目录。该文件不改原探针任何断言；新提交身份由外部源文件/补丁摘要绑定。端口中的线程投递、目录传输和Monaco模型为假端口，不冒充GUI、真实Worker线程、键盘或目录验收。

新增30项纯测试覆盖列表尾逗号、缺分隔符、未知后继、分区前/后/重复逗号、缺操作数、空括号、函数缺参数、CASE不完整、相邻缺操作符和未完成外层ORDER。正向包括多列、算术、函数、CASE、CAST、合法ORDER/LIMIT后继、嵌套/CTE/UNION分支及合法向后链。原两个窗口测试文件没有修改，所有原断言保留。

相关纯回归为20个文件489项通过（新增30项），类型通过；最终构建和固定候选原样探针结果记录在ignored `.cache/q01-window-p2-20261016`。实际使用仓库已有工具：

```powershell
$testFiles=@(rg --files tests/unit | Where-Object { $_ -match '(completion|session-objects)' })
node node_modules/vitest/vitest.mjs run @testFiles --reporter=json --outputFile=.cache/q01-window-p2-20261016/related-final.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

本轮没有GUI、200、Docker、私有材料、真实env/key、剪贴板或手动CI。正式Monaco接受/完整替换/撤销及真实MySQL/MariaDB只读SELECT仍由ROOT安排，不能以受控回放替代。
