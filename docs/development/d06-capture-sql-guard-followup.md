# D06 捕获UI静态SQL辅助的窄补强

日期：2026-10-16。独立普通分支`codex/employee3-d06-capture-sql-guard-20261016`，直接基于冻结候选`59ac39ea74e8263be6a697ce703ba8b296f61b14`。本片只补测试辅助、纯回归及说明，并准确修正新spec的一行门控注释，不修改产品、公共live-helpers或旧D06用例。

## 原保障缺口及复现

员工4最终报告指出，旧completeCaptureSql只检查WHERE存在、完整参数、占位符数、id位于参数集合及before曾出现，没有把列和操作符与具体参数位置绑定。原四个where表达式保持如下：

| 原样反例 | 旧59ac结果 | 本片严格预期 |
| --- | --- | --- |
| 键比较列由id改为amount | 接受 | 拒绝 |
| id的空安全相等改为<> | 接受 | 拒绝 |
| note旧值比较换为? IS NOT NULL | 接受 | 拒绝 |
| 原值比较尾部添加OR 1=1 | 接受 | 拒绝 |

先把员工4原independent-probe.mjs逐字复制到本员工ignored目录，在59ac完整归档上执行，四项均被接受；没有导入E2E/live模块或读取env。随后新增严格false断言，在修改辅助前实际运行，4失败、另外7项因名称过滤跳过；该失败结果原件保留。再补辅助，原四个断言不变且全部通过。

这是测试保障缺口，不能据此声称生产SQL错误或原UI失败。ROOT已反馈旧候选集成为462708c，run682/run683六组合18项真实UI首次通过；这些原通过、原审批记录及员工4报告均不回写。本辅助补强后的真实UI仍待ROOT按新固定提交复验。

## 仅接受本片静态模板

completeCaptureSql限定capture_batch/capture_current两列夹具及capture_unicode六列夹具，不是通用SQL解析器，不用于生产SQL授权、执行或其他表。

- note赋值必须为问号参数；WHERE首项必须是id <=> ?，可选的历史第二份id谓词也必须相同。每个id参数按对应位置与精确字符串核对，不能借参数中出现id就放行。
- note旧值必须是固定的BINARY CONVERT(note USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)，绑定相应before位置；before出现在生成列等其他位置不能代替note保护。
- 六列夹具完整后缀逐项限定amount、payload、nil、generated的列名、操作符和参数顺序，分别核对原精确DECIMAL、00 01 ff的binary协议值、SQL NULL及原生成值。二进制对象按结构比较，忽略对象键的序列化顺序，不忽略额外字段。
- 未知表模板、额外条件、OR、注释、错误列/操作符、残余参数和重复预期行均拒绝。没有调用生产SQL生成器计算预期，也没有复制其通用列遍历或执行逻辑。

原SQL完整渲染守卫、JSON尾部、逐行原生after、Monaco前后同一innerText接口、确认前服务器未变、最终独立完整行结果都保留。新spec唯一差异是门控注释，没有改变3个ID、数据、原断言、期限、重试或UI动作。

新增11项纯单元保留四个原样负例，覆盖两类结构/两种键布局正例、重复键绑定错误、note原值错位、二进制/数值/NULL/生成列旧值错误及未知条件拒绝。原5项完整性正例/负例保持不变。

## 门控及证据边界的准确说明

两道开关控制本片测试体及自动per-test桌面夹具；任一关闭都跳过本片UI/实库体。静态导入的既有live-helpers读取本地.cache/dbark-test.env只受DBARK_INTEGRATION_ENABLED控制：全局为1、专项DBARK_D06_CAPTURE_UI非1时仍可能读取该文件，但不因此运行本片GUI或连接实库；两者均0时该模块读取条件不成立。

本片只修正说明和新spec注释，不修改公共helper、导入结构或其他测试的副作用。普通非正则模式在原UI只核默认复选框状态；原美元完整预览发生在正则开启、捕获关闭分支，不能另算普通模式已完成真实替换验收。

## 本次纯验证与交接

两道开关显式为0，实际执行：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/page-capture-sql-bindings.test.ts --testNamePattern='员工4原样严格反例' --maxWorkers=1
# 上一命令在补强前运行，4失败和7过滤跳过的原结果保留。
node node_modules/vitest/vitest.mjs run tests/unit/page-capture-sql-bindings.test.ts tests/unit/page-capture-live-sql.test.ts tests/unit/page-capture-budget.test.ts tests/unit/page-capture-replacement.test.ts tests/unit/page-capture-worker.test.ts tests/unit/page-find-worker-client.test.ts tests/unit/page-replace-current.test.ts tests/unit/page-replace-intent.test.ts tests/unit/ui-page-find-replace.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/page-capture-live.spec.ts --list
```

最终相关9文件134项通过、0失败/跳过；类型退出0，列表仍准确列出原3项。没有运行GUI、200、剪贴板、Docker、工作树或build。原生after、捕获预算和意图保护的原相关118项仍通过，但纯单元不能替代新辅助版本的真实UI复验。

本员工ignored证据根为.cache/capture-sql-guard：repro59保存员工4原脚本、原报告副本、固定59归档及独立复现；baseline-strict-results.json保留补强前4失败；strict-fixed-results.json和related-results.json保留补强后结果，verification.json记录原件哈希、固定提交及Git交付状态。ROOT后续按原双开关及原三用例运行命令复验，暂不在本说明填写新的UI通过次数。
