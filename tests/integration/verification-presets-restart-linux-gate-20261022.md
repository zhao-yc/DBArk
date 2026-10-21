# 命名整理重启声明门：Linux 单测夹具修正

## 两次 CI 的准确来源

旧提交为 `5b852463ace135abe6230c02007ae7f86ffbe4a1`（记录命名整理方案实库窗口与独立读回验收），对应 [run 39668756814](https://github.com/zhao-yc/DBArk/actions/runs/39668756814)。下表仅记录 Root 在本轮实际读回的即时 job 状态，不补推其它阶段或平台细节：

| 旧 5b job | 本轮读回状态 |
| --- | --- |
| Windows `119460674782` | 成功 |
| Linux `119460675351` | 成功 |
| macOS arm64 `119460675314` | 成功；源码六专项与安装六专项成功，通用 packaged step 按设计跳过 |
| macOS Intel `119460675477` | 首次读回仍运行于 `pnpm test:packaged`；本轮后续读回已成功 |
| 可选剪贴板 `119460677844` | 跳过 |

新提交为 `37be084f1f3f1de51888afe47150959dc9567e48`，对应 [run 39671935173](https://github.com/zhao-yc/DBArk/actions/runs/39671935173)。本次直接读取的是 [Linux job 119471777922](https://github.com/zhao-yc/DBArk/actions/runs/39671935173/job/119471777922) 的已解码日志；该 job 的 `pnpm test` 失败。Root 本轮读回时，同 run 的三个桌面 job 仍在运行，不能把旧 5b 的成功状态移给新提交。

## 新 37be 原失败

日志时间为 UTC `2026-10-21T20:38:27` 至 `20:42:37`，Vitest 总耗时 **249.40 秒**，结果：

- 文件：**622 通过、1 失败，共 623**。
- 测试：**12004 通过、2 失败、10 跳过，共 12016**。
- 原命令 `pnpm test`，退出码 **1**；不是 CI 重跑结果。
- 失败文件 `tests/unit/query-result-presets-restart-gate.test.ts` 共 21 例，其中两例失败。

两条失败名称分别是“原绑定只传批准清单和真实gate，漂移后即使改回也永久撤销”和“原argv或批准摘要变化后不能重新使用捕获binding”。二者均在原文件第 27／38 行的首次 `f.run()` 失败，共同堆栈为：

```text
Error: 结果方案重启缺少原运行身份批准
Object.assertCurrent evalmachine.<anonymous>:19:27
evalmachine.<anonymous>:30:13
Object.run tests/unit/query-result-presets-restart-gate.test.ts:16:21
```

原日志没有这些失败对应的超时、OOM、堆耗尽或进程被杀证据。单文件执行约 **439 毫秒**；失败是确定的平台校验异常，不能归因为 runner 资源不足。

解码日志的 LF 保存副本为 `.cache/query-result-presets-linux-gate-20261022/job-119471777922.log`，SHA-256 为 `46b71b91e2f93d235ed84ca534a915eb3b74b544ffe59590493c9fabec3ed4e3`。副本只作本机原失败追溯，不入库，不记录临时下载地址。

## 根因及本轮改动

原单测 fixture 把宿主 `process.platform` 注入隔离 VM。在 Linux CI 中，该值是 `linux`；被测的真实声明文件 `tests/e2e/query-result-presets-restart.spec.ts` 仅允许 `win32`／`darwin` 进入有批准的原生重启验收。正向夹具因此在 runtime 登记前即被原平台门正确拒绝。部分原负例在 Linux 下也可能因同一平台错误先行拒绝，从而未证明所写的环境或 CLI 限制。

本轮仅修改单测夹具：显式提供合成平台，两个正向场景分别覆盖 `win32`／`darwin`；环境和 CLI 负例在受支持的合成平台执行，并断言对应的准确拒绝原因；另加 `linux` 明确拒绝且未加载 runtime 的反例。单测仍只执行原 spec 的声明与绑定，runtime 使用登记哨兵，不创建 Electron、数据库或系统输入资源。

生产 spec 的平台门、批准清单要求、授权漂移永久撤销和原期限均保持。本轮没有把 Linux 加入真实原生重启验收，也没有延长任何超时或重跑原 CI。

## 本轮验证与边界

Root 在本机 Windows 授权回退范围运行 `pnpm exec vitest run tests/unit/query-result-selected-filter-gate.test.ts tests/unit/query-result-presets-restart-gate.test.ts --maxWorkers=2`：两文件 43 项通过，其中本门 24 项，命令退出 0；后续与完整回归一同再核。原 37be 两条失败继续保留；本次 VM 平台覆盖不能充当 Windows／macOS 原生重启、安装包或实库验收。

随后完整 `pnpm exec vitest run --maxWorkers=2` 已退出 0：624 文件通过、1 文件跳过，12112 项通过、1 项 POSIX 条件跳过，251.07 秒。本门 24 项包含在该完整结果内，不与专项重复累加。完整原日志为 `.cache/query-result-selected-filter-full-unit-20261022.log`；Linux CI 新提交仍待独立结果，不能用本机成功改写旧 37be 的失败。
