# 当前源码 macOS 关键字重启专项（2026-10-28）

## 原失败与复查范围

旧冻结产品 `bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2` 的 macOS arm64 upper 例，在第二个独立 owner 重启后，原 `formatAndUndo` 5秒正文断言失败：期望 SELECT／AS／FROM／WHERE，实际仍为混合大小写。Root已通过GitHub连接器回读原 job118104387921 的解码日志，与[原记录](../../tests/integration/acceptance-v028-keyword-20261019.md)一致；未重新运行旧job、安装或访问旧profile，不将解码日志称为本机原ZIP校验。

当前复查先保持产品及原 `sql-keyword-case-native.spec.ts` 不变，使用新隔离 macOS 托管环境运行同样 upper／lower 两例。原默认／两种大小写、单Undo／Redo、模块迟到撤销、SQLite9、工作台恢复、四个owner正常退出、120秒总期限及5秒断言均保留；没有截图／录像／trace、系统剪贴板、SQL执行或系统保存键。成功或失败都不追认旧冻结候选的结果。

Root随后取得旧artifact12192148660原ZIP（44098字节，SHA256 `24105dab20523d3dc0256e09a8f08b6d4f873796f14f1102ab327c2b070c8e02`），13成员CRC、路径和私钥块检查通过；原报告、准许及113文件清单摘要与旧记录相符。原report仍为unexpected1／skipped1／flaky0，不补判旧owner正常退出，也不能据这些旧原件确认当前根因。

## 新入口

`.github/workflows/sql-keyword-current.yml` 只在 main 上自身工作流、运行脚本或守卫测试变化时自动运行，也保留显式手动入口；无标签、发行或安装步骤。当前GitHub连接器提供读取／重跑能力，未提供新工作流派发，因此通过正常源码推送触发独立新run。

`scripts/sql-keyword-current-ci.mjs source` 限定准确仓库、main、工作流及job、GitHub-hosted、首次attempt和真实darwin／arm64。先记录实际OS、测试HEAD与产品src／package／lock对象，运行原回环拒连预检，再同job类型检查和构建，按本次真实文件集合签发源码准许及独立关键字清单，不复用旧113文件数量或旧安装清单。

专项子进程白名单清理环境，只打开原关键字门、integration=0，直接运行原spec，单worker／零重试。完整stdout／stderr直接写独占文件；进程非零或未知不能被成功报告覆盖。通过时消费原两例完整附件，要求四个owner及目录收尾；失败保留报告与未知状态，不自动强停、重试或补清。只上传明确公开的日志、报告、身份清单和receipt，不上传profile、应用或安装产物；托管机销毁不算正常退出证明。

WIN11-TEST预检已通过Node语法、类型及新旧运行器两文件46项；Root回读原件和冻结source119逐字匹配。没有可用Python YAML模块，该解析项未执行、未安装工具。预检不执行新Mac入口，实际Mac仍须新job验证。

## 证据边界

当前源码已在[新run40622537303](https://github.com/zhao-yc/DBArk/actions/runs/40622537303)完成Mac实际验证：macOS26.6.2／arm64，原upper／lower均单次通过，无跳过或重试，四个owner正常退出、两份临时目录清理。Root独立核35901字节／36项ZIP、完整原报告、准许及113运行文件清单；产品src／package／lock对象与本地相符，原spec和config未改。机器索引见[本轮证据](sql-keyword-current-20261028.evidence.json)。

本轮没有修改产品或证明根因，只能确认当前源码未复现旧失败。相比旧冻结候选，共享期限守卫此前已改为原框架单调时钟，仍守原120秒；owner／runtime、关键字门及原spec／config未变，本轮未再修改它们。不能将结果归因为某个配置事件、时钟修正或产品提交，也不追认旧bf候选通过。

实际结果见[专项验收](../../tests/integration/acceptance-sql-keyword-current-20261028.md)。Mac系统Cmd+S、安装版、Intel及完整Navicat工作包均不由本专项覆盖，暂不发布。
