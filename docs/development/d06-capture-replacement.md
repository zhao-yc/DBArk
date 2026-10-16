# D06 显式正则捕获替换

日期：2026-10-16。员工5普通克隆分支 `codex/d06-capture-replacement-20261016`，固定父版本 `8fd7f1a12003898f991d32ec4fa7ea97cc603ae3`。本次与原 ABA/IME 修复独立提交，不修改ROOT、其它克隆、主进程、TLS、存储、对象属性、依赖或数据库提交接口。

## 先核实现状，再补真实缺项

8fd7f1a 已具备正则模式入口、独立 Web Worker、JavaScript Unicode 匹配、整格分支、零宽码点推进、单处和整批字面替换、超时/取消终止及单调意图保护；原11项查找替换单元、4项 WorkerClient 时序单元及 fd/8fd 的当前替换回归覆盖这些能力。既有真实界面和实库的历史证据属于各固定版本，不能替代本候选验收。

实际缺项是捕获组替换：原集中中文文案和开发说明都明确 `$1/$&/$$` 保持字面、捕获组后续。覆盖表 D06 行却仍把已实现的“单处替换、用户正则”统列为后续；本次仅修订该行，保留历史统计、部分状态及验收边界。

## 最小产品契约

- 沿用原查找替换面板与按钮，在替换输入旁增加默认关闭的“展开正则捕获”。仅文字正则模式可用，关闭正则或切换 NULL/DEFAULT 会同时关闭捕获。修改选项后仍须明确点击“查找当前页”，不新增另一套入口，不在输入时自动执行用户正则。
- 关闭捕获时，普通文字及正则都保持原美元字面语义，旧 `$1` 零宽界面断言无须改变。启用时使用 JavaScript 静态替换字符串语义：`$$`、`$&`、数字组 `$1`～`$99`、命名组 `$<名称>`、原文前缀 `` $` ``、后缀 `$'`。不支持执行函数或脚本。
- 未参与的存在组展开为空；数字引用越界尝试单数字回退，否则保持字面。`$01` 可引用第一组，`$0` 保持字面。模式存在命名组时，缺失名称为空；模式没有命名组或缺少闭合符时，相应文字保留原生语义。展开后的内容不递归解释。
- 既有模式范围不变：正文不带分隔符；固定 Unicode/global、可选忽略大小写，不开放其它 flags；整格仍先包边界再核完整长度。原文 UTF-16 偏移与码点零宽推进不变。
- 单处只展开当前 UUID行/可见列/精确原文范围，成功后的下一处定位按实际插入长度计算，不能按 `$1` 等模板长度跳过。整批仍先预览、确认后一次形成本地草稿；最终数据库写入沿用已有集中提交。

替换字符串依据：[ECMAScript GetSubstitution](https://tc39.es/ecma262/multipage/text-processing.html#sec-getsubstitution)。没有引入 Python、PCRE 或 SQL 替换语义。

## Worker、预算与旧意图约束

正则只在原 Worker 入口编译，预览的一次扫描直接使用当次捕获构造每处替换值，不在 renderer/main 重新匹配，也不把捕获数组传回渲染线程。查找消息仍只有原范围；预览消息仍是原 `PageReplacement`，没有新增主进程或IPC协议。

每段替换先计量再加入字符串列表，所有选中替换展开累计受原16 MiB限制；完成文本、整行 data/original及元数据仍走原计划总预算，超限不返回部分补丁。只读列、非文本值及非选中命中不做无用捕获展开。模式512单元、模板4096单元、最多50000处、请求/响应预算、128 MiB估算、8秒启动和1.5秒执行时限均保持原值。浏览器没有硬堆限额，估算不能称作操作系统内存上限。

捕获开关沿用8fd7f1a的同步意图撤销；文字、组合、导航、上下文及选择守卫保留。即使结果已生成且只等待终止确认，捕获开关ABA也不能让旧命令落稿。单处完成后的实际插入内容只用于自动查找定位，绝不自动执行下一次替换。

## 本候选验证

新增纯单元包含原生 JavaScript 安全常量对照、数字/命名/可选组、两位及99号组、美元和前后缀、原型同名组、空文本/Unicode零宽/前后查找捕获、只读/单处范围、预算、原值与精度保持；完整生产面板端口模型覆盖默认模式、扩张及删除后的定位、整批确认和开关ABA。端口模型仅替换React调度/展示和消息时序，不属于真实GUI验收。

另把完整当前生产 Web Worker 编译为浏览器脚本，在 Node 真实独立线程中仅桥接 `self` 消息端口，配合真实 WorkerClient 运行。验证实际捕获预览、非法开关和输出放大拒绝，以及捕获模式的灾难回溯在超时/取消后真正退出（threadId=-1）、下一请求恢复。危险模式从不在测试主线程编译或执行。测试中的100毫秒运行限时只用于新增超时用例，产品1.5秒和旧测试期限不变。该桥接不能代替 Electron CSP、实际 Web Worker 加载或原生界面证据。

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run tests/unit/page-capture-replacement.test.ts tests/unit/page-capture-worker.test.ts tests/unit/page-replace-intent.test.ts tests/unit/page-replace-current.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-find-worker-client.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

实际结果：新增26项单元通过；全量164个文件3107项全部通过（maxWorkers=2，71.03秒）；TypeScript检查通过；生产构建通过（29.45秒，保留既有第三方注释及大分块提示）。全量单元与构建顺序运行，日志保留在本克隆忽略目录 `.cache/d06-capture-full-unit.log` 和 `.cache/d06-capture-build.log`。

没有执行任何 Electron GUI、剪贴板、SSH、200、Docker、实库或安装包测试，也未修改既有 D06/百万行界面用例的源码、ID或期限。原开发说明中“捕获后续”的语义属于其固定版本；本说明记录新候选，不能回写旧证据为本次已验。
