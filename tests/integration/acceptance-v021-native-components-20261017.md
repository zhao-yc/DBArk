# 0.21 固定候选的原生组件补验

范围固定 `93f33ecab4090a5284a7988bc52d7744f8d99118`。13 个涉及原生剪贴板的开发 Electron 组件身份分别取得证据；它们不计作安装产品，不代表本机系统剪贴板或非空多格式恢复已验收。

## 原运行一项与新专项十二项

原 [38992901072](https://github.com/zhao-yc/DBArk/actions/runs/38992901072) 在 Windows x64、macOS arm64/x64 的源码及安装阶段，均实际通过 `binary-cell-offline.spec.ts` 中“单元格及记录表单真实剪贴板超限不截断，选区替换整次拒绝，合法边界可暂存”。该定义没有原生门或提前跳过，实际调用 Electron `clipboard.writeText` 和系统粘贴快捷键，覆盖 cell/form 两入口。它自行启动开发 Electron，即使位于安装阶段也仍是组件用例。清理仅尝试清除本例注入文本，不能证明原剪贴板内容完整恢复。

新 [38998536907](https://github.com/zhao-yc/DBArk/actions/runs/38998536907) 的三个原生专项 job 均成功，实际各为 12 项：`query-binary-types-offline.spec.ts` 两项及 `record-input-guards-offline.spec.ts` 十项。三个报告的完整 file/titlePath/projectName 均与冻结矩阵相同，12 expected、零 skipped/unexpected/flaky/error；每项单次 passed、retry 0，原 45 秒期限、单 worker 和 repeatEach 1 保持。

工作流只选择这两个文件，不能将新专项写成单 job 13 项。原一项和新十二项按两个来源分别记录，同一身份跨平台或阶段不重复累加。本批没有修改工作流、产品或测试定义，Windows 安装候选仍来自原运行的 artifact `12086192049`，不以新运行产物替换。

## 附件与恢复边界

三个测试 ZIP 经 Root 固定元数据下载和独立只读复核，run/head、长度、SHA-256、CRC、路径、链接、加密、重复路径及限额检查均通过，没有执行归档内容。

| 平台 | 附件 ID | ZIP SHA-256 |
| --- | --- | --- |
| macOS arm64 | 12088630069 | d8da1af64ece971d5be7ae902904df2ec42786c4f20d23b818f1195f36871ee2 |
| macOS x64 | 12087334062 | de1b4bca0503047d141cddf76b561c03919c1a66fc342e7cebbad199e965304f |
| Windows x64 | 12087239146 | a4cd2dc96408f8c0c6273714c6d957841278b981c11368a8abe4af46a8889c08 |

36 份恢复回执均报告保存、恢复、条目数、类型集合和文本匹配，缺失/新增类型及 payload 不匹配均为零。但全部捕获的可读条目数都是零；它们只证明这些临时 runner 的空可读快照恢复，不覆盖非空多格式原剪贴板。退出依据为 GitHub 步骤/job success、原日志及报告结果，附件没有独立操作系统退出文件，不补造双层退出记录。

独立 ZIP 报告 SHA-256 `58e7ccb0587e17e4bd8835d6c6036491d1b476f5de445c95bf2811bb8b0801d7`；13/12 差异和原一项逐平台日志报告 `187fde576d59b76e925fa1cbfb0780cc6013eb062bc819b74b8c2a4305f330ac`。前期连接/DNS 下载失败保留，由后续三个摘要相符的 ZIP 补齐检查。本机剪贴板写入为零；四个本机复制身份继续等待本轮许可。本记录只接纳已终态的三个原生专项，不推断同一新 workflow 的其它 job 已全部结束。
