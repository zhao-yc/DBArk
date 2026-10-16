# D06 捕获替换的完整计划分配前预算

日期：2026-10-16。员工5独立普通分支 `codex/d06-capture-budget-fix-20261016`，直接父版本 `075f31ef3eff7fcf5ac201d0d7561d4e51aa0ae8`。本次只修复捕获预算顺序，不混入迟到UI准备。原075、原审查失败证据及其它分支保持冻结。

## 问题与最终行为

旧捕获路径仅在展开模板时累计16MiB，随后仍先把展开结果与原文拼接、编码，再判断输出或完整计划超限。一个32768字符的前缀、零宽模式和512次前缀引用，展开本身恰好16MiB，加上原文后却已超限；原流程在拒绝前已经把16809984字符交给编码器。员工3补查确认单处、跨格累计和合法请求中完整行加补丁总量也有同一缺口。

本次将计划构造改为两阶段，预算不通过时没有展开字符串、大join、编码数组、快照clone或部分补丁返回：

1. Worker只匹配一次，保留选中范围对应的原生捕获；替换表达式枚举既有原文、模板和捕获的字符串区间，不slice原文前后缀、不join捕获输出。只读、非文本及非选中命中仍不保留捕获。
2. 第一阶段计量每格完整输出，包括所有保留的原文、零宽前后文和捕获展开；跨格累计UTF-8预算，逐字段计量全部补丁、受影响行data/original、元数据，再检查实际预览响应的结构和signature字符串再次JSON转义的成本。
3. 所有总量通过后才分块join实际after、序列化signature及structuredClone行快照。默认字面路径复用同一前检，既有字面美元、无变化拒绝、列资格、完整原值与最终应用守卫保持原契约。

新增 `PageTextSize` 直接计数字节，无需先分配TextEncoder数组。UTF-8按码点、孤立代理按替换字符的3字节计量；JSON另计控制字符、引号、反斜杠和孤立代理的转义成本。片段边界上的高低代理可以拼成同一码点，计量会合并该边界，避免重复转义或保守多算而拒绝合法结果。分片最终构造采用有界小引用数组，不能先收集逐字符的巨型数组。

模式512单元、模板4096单元、50000处、16MiB及128MiB估算、8秒启动和1.5秒运行均未放宽。暂存的原生捕获数组和字符串也计入现有内存估算；128MiB仍是估算，不是浏览器/V8堆的硬限制。没有在renderer/main重新执行用户正则，没有改变WorkerClient取消、终止、请求/意图或网格选择保护。

## 原反例与合法语义保留

员工3原报告与探针在其 `d06-find-replace/.cache/review-d06-capture-075f31e` 目录中完整保留。本轮复制到本员工 `.cache/capture-budget-fix-probes`，仅把固定075导入改指当前修复源码，原8项断言、原生对照和15秒探针期限不变；原件SHA256及来源记录在副本的 `source-manifest.json`。

- 原8项副本全部通过：包含1224次原生String.replace对照、3项理论大输出保护，以及原来失败的4项严格预算反例。1224次仍全部一致，82次无变化继续按旧契约拒绝；没有删除合法正例或把预算异常当作合法语义通过。
- 原单格、单处及跨格反例的超限编码观察均为0；完整行反例在预算错误前的大join观察为0；structuredClone均为0，原文保持不变。副本证据为 `independent-fixed-results.json`、`preallocation-evidence.json`、`budget-single-evidence.json`、`budget-batch-evidence.json` 和 `budget-row-total-evidence.json`。
- 新增永久21项单元：保留上述4个反例输入与严格分配断言，补充中文/astral UTF-8、after及完整行JSON转义、signature再次转义、合法7MiB捕获输出，以及不同分片边界和孤立代理的原生字节计量对照。合法大输出用真实JSON.stringify/TextEncoder核对最终响应不超16MiB，不生成非法巨型原生预期。

上述证据确认分配顺序已前移；原反例没有证明OOM，本次也不把前置预算测试表述成已发生或已复现OOM。新版本仍需独立复审和ROOT安排原生组件/真实数据库验收。

## 验证命令与结果

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/d06-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run tests/unit/page-capture-budget.test.ts tests/unit/page-capture-replacement.test.ts tests/unit/page-capture-worker.test.ts tests/unit/ui-page-find-replace.test.ts tests/unit/page-replace-current.test.ts tests/unit/page-replace-intent.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# 下列命令仅在本克隆保留的探针副本目录执行。
node ../../node_modules/vitest/vitest.mjs run --config probe.vitest.config.mts --reporter=json --outputFile=independent-fixed-results.json
```

实际结果：新增21项与原相关93项单元通过；全量165个文件3128项全部通过（maxWorkers=2，71.16秒）；TypeScript检查通过；生产构建通过（29.43秒，保留既有第三方注释及大分块提示）。独立8项及其中1224次语义对照全部通过，不与全量单元重复计数。日志在本克隆忽略目录 `.cache/d06-capture-budget-full-unit.log`、`.cache/d06-capture-budget-build.log` 及 `.cache/capture-budget-fix-probes/independent-fixed-results.json`。

没有修改已有单元、E2E文件、ID、断言、超时、生产提交接口或依赖；未运行GUI、200、剪贴板、SSH或Docker。
