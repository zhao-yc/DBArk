# 执行计划原生诊断：4917d0a 验收记录

## 固定范围

固定提交 `4917d0a1f085b7e36206629f933e5b77b8f785f4`；产品 `src/` 与 main `43c8bf6` 相同。本批只增加离线测试诊断，不改变原点击、断言、窗口状态、45秒用例期限或30秒点击期限。首个5f0a470仅在虚拟机完成fetch／快进／只读准备，已撤销，未执行类型、构建或GUI。

## WIN11-TEST 原队列

在“dbark测试”既有普通克隆及分支串行执行，回合 `01a158b9-2992-7362-a288-c7efb81e6497`：

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/check-local.mjs --build tests/unit/snippets-native-diagnostics.test.ts tests/unit/ui-explain-plan-state.test.tsx tests/unit/explain.test.ts` | 类型检查、3文件78项及新构建通过，101.837秒 |
| 原执行计划离线GUI，retain-on-failure、workers=1、retries=0 | 单次通过，10.668秒；成功按原策略删除诊断trace／state |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json` | 577文件、11092通过、1项POSIX条件跳过，退出0，338.717秒 |

原件目录为虚拟机 `outputs/explain-diagnostics-4917d0a-vm-20261020`。报告 `explain-control-result.json` SHA256为 `f8ca9fa12207472528c87f9b2f67a101fa21050e6286f9212d9d2f75810b4eb3`；原GUI JSON为 `967b39263536f6b6677bef130f82aa6de78ecc7f7f3536649e3cd153daf5b63a`；完整单元原JSON为 `b3d825066cc9575c7f8cb5a4b28485e758af9b3321531ba70685047e59967b0d`。

## 独立正向采集

原队列完成后，在同一固定源码及构建上单独执行一次trace=on的原GUI，不是重试失败；没有再构建或运行单元。单次退出0、6.286秒。原件另存 `outputs/explain-positive-trace-4917d0a-vm-20261020`。

state为failed=false，initial段saved、四个固定标记齐全、诊断错误0；8个样本，只观察原窗口及webContents ID 2，实际backgroundThrottling=true，7个ready样本目标正尺寸，6次ready/rAF交付。虚拟机独立有界读取原ZIP：94个条目、517条trace事件，其中127个真实browser frame-snapshot均匹配本例 `explain-view.html`，不是runner-only trace。

state SHA256为 `39e899923da92b0dced29ec400fbfe0e4b002232c790df866f30950cad4621a6`，原生ZIP为 `f7e0c118df6e49b07c2e911c18ab3b78659b18c2be2af9acdea5ea924ecd3241`。首次读回遇到Windows长路径及Python读取器路径错误，均只修正只读检查，没有重新执行GUI。开发会话已读测试回报，尚未独立下载虚拟机原件，不将上述摘要写成开发机独立复算。

## 独立CI与边界

[首次push CI39403583333](https://github.com/zhao-yc/DBArk/actions/runs/39403583333)类型、577文件11083通过／10原win32条件跳过及构建通过，223.63秒。[原生CI39404469208](https://github.com/zhao-yc/DBArk/actions/runs/39404469208)只派发一次：ARM和Intel源码／安装legacy均各80通过、314跳过。开发会话核原日志，Intel执行计划源码6.9秒、安装5.7秒，未复现旧超时；成功按原retain策略不留失败诊断，不外推Mac正向采集。Windows在既有敏感文件helper检查停止，尚未进入GUI，整轮仍失败，发布跳过。

虚拟机最终Git干净、所属准确PID无残留，109个构建文件哈希不变；未连接数据库、SSH、Docker或使用系统剪贴板。此记录证明Windows诊断能够采集真实上下文，不证明旧Intel偶发超时或另一次Windows查找替换失败的根因已修复。安装、实库、系统输入及全平台完成均不外推；暂不发布。

诊断源码及前述验收记录已于 `f4dd93d4fea2ef7a3d6861618e2764ca0f0f9fd2` 推送main，主目录快进同步；该交付提交只在已验4917d0a上追加文档，不继承候选ref的CI身份。
