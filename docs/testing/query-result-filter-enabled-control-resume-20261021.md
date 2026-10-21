# 筛选启停控制加载修正后的续验

## 已确认终态

原回合01a15caa-1ba6-7991-9ddd-44b01498d9f8已completed并停链。产品仍准确c4495066f4f570fbff69769ea377f442c66a0aea，src0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2；准备144项、类型及新构建通过，CLI15408退出0。失败仅发生在外层Node直接加载TS合同时，错误为`TypeScript parameter property is not supported in strip-only mode`；不是产品GUI失败，没有独立GUI CLI退出码。正式GUI／读回未启动，nonce和两输出文件未生成。

原metadata封存80文件，report摘要a6f47836674e4478c5ccc0aeedb901e36a4490198a8e7928294a34ad6fe8953b，manifest摘要e74c451f53bd7b63733cfbdd95a1b76d59a99dabedeefb6095a74a3ba57b3f62，control-failure摘要0cc707fb60505f80e4e971cf514965a1e52359a56b3e1e89b95c7c6d182e3aa9。新dist图摘要e14808de3720460b34747a75207efc6efea5b5b557ea928d13c2ec9f24fc32f9。原报告、错误及80封存不可改写。

## 本次唯一控制修正

Root本机用锁定esbuild把原`tests/helpers/queryResultColumnsUi.ts`打包为独立.cjs，Node24.17实际加载通过；合成RAM检查确认构造函数、配置永久撤销、120秒期限及身份合同仍正确。没有修改合同或产品，没有启动GUI或数据库。原源文件摘要cadf163bbc06a2a7bac95785209ca39b0397325b11046dda16408b423bd7ac7e，生成76068字节、摘要334eb1b1313fc75080a9578b7537ce341a2909bcb2697a536e15c1467ea3d02b；不同工作区先核自身准备图，不靠改变原文件换行凑本机摘要。

外层控制器不能再直接加载.ts。只在新独占metadata的control子目录生成.cjs，再用原生require加载该绝对.cjs路径。实际Playwright仍编译原.ts，不换产品、用例或合同实现。使用项目现有esbuild，`bundle`须开启以包含csv-parse，便于从项目外metadata加载；不加external、不改变源文件、不用eval或实验性TS开关。例如通过argv数组执行：

```text
pnpm exec esbuild tests/helpers/queryResultColumnsUi.ts --bundle --platform=node --format=cjs --target=node24 --log-level=error --outfile=<新metadata内的绝对.cjs路径>
```

编译前检查输出不存在，记录原源SHA／目标Git身份及生成文件SHA／长度；加载后只输出布尔，不打印模块、binding、环境或任何敏感对象。该模块仅用于外层RAM绑定和身份预检，不提前构造真实GUI的期限对象。若编译、加载或合同检查失败即停，不能删文件或重试掩盖原错。

## 续验范围

允许一次fetch统筹指定的操作单提交，仅git show读取本单，不checkout新头；产品保持干净c449。先确认原80已封存、GUI从未启动且当前无本例活进程，核576源码／1312测试／109新dist及构建输入与原失败报告的最终新图一致，十一套旧封存（前十套加80）及旧两文件保持。不要误用旧0a4的前置构建图，也不重跑准备、安装或full。

新独占metadata固定`outputs/result-filter-enabled-c449506-control-resume-vm-20261021`；已有目录或匹配进程则续读原任务，不重复启动。旧metadata原样保留。本次仅用上述.cjs修正外层加载，再按[原固定操作单](query-result-filter-enabled-c449506-vm.md)的“唯一实库GUI”和“条件独立读回”两节执行；保持原120秒、零重试、准确目标／RAM快照、原观察连接和严格收尾、全部断言与复制导出期待。准备已通过，新nonce从未生成，可在新metadata下按原合同生成一次新nonce；不使用旧文件或目录。

正式命令仍只有一个query-result-sort-case.spec.ts整例。先确认readonly UUID预检连接native／stream正常关闭；正式GUI若未通过，不进入读回。通过后先写并核原文件身份、长度及SHA checkpoint，才用已验证的独立Python脚本读新两文件。编译原模块不等于GUI验收，不更换Node解析规则来跳过合同。

沿原监督模板先过语法、ready／首CIM再启动正式Node，保存原.NET handle创建／退出及独立原字节日志；字符串替换用函数回调，异步返回用`[void]`。仅本页合成DataTransfer复制，不读写系统剪贴板；不用SSH／Docker，不新建库、用户或权限，不落盘或轮换凭据。原父RAM三项保留，不展开旧误输出对象。

最终核产品／测试／dist／构建输入／Git、十一套旧封存、旧两文件和新文件及本例原进程身份，保留所有原失败／unknown。逐项SHA封存新报告、manifest、编译加载元数据、原日志及附件，回报实际到达阶段、GUI／读回和资源状态后停止。
