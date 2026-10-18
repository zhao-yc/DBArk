# 0.23 原生专项第二检查点的实际结果

固定 `d4fb6e4c18c6a0f8d6bf6b77e4d27ad0aee4a776`，工作流 `39094458615`，单次运行、不重试。Linux 完整495文件／9125通过／10跳过、类型与构建成功。三平台源码专项和既有源码回归步骤成功，随后 Windows x64、macOS arm64／x64 均在实际安装专项失败，发行步骤跳过。0.23 未发布；原第一检查点 `39089165148` 及其失败继续保留。

## 已独立读取的原始证据

Root 对 Windows、macOS arm64 的报告 ZIP 分别核对 GitHub SHA256、准确大小、落盘重读摘要及逐项 CRC，仅提取文本／JSON／阶段记录，未执行下载附件。

| 平台 | 源码原报告 | 安装原报告及阶段 |
| --- | --- | --- |
| Windows x64 | 缩进及分栏两项各 accepted，SQLite、双 owner 正常退出、记录 PID 消失及用户目录清理确认 | 缩进 failed，运行身份检查 `regular → assertCurrent → seal` 拒绝；仅有 `scan.begin`，owner／PID 均为0，尚未启动应用；分栏未跑 |
| macOS arm64 | 缩进及分栏两项各 accepted，双 owner 及目录闭合；小屏经固定缩放得到原目标 CSS 场景 | 缩进120秒超时，末阶段 `prepare.statusbar`，1个 owner、4个 PID，未获正常退出证明；worker teardown 又超时45秒；分栏未跑 |
| macOS x64 | GitHub 源码步骤成功；本轮尚未独立提取原专项附件 | 原 job 日志确认安装专项失败；ZIP 下载在实际网络阶段失败、收取0字节，阶段／owner 细节尚未核对，不能借 arm64 推断 |

阶段文件仅用于定位等待，不取代原终态附件。源码四份已读取报告分别为：

| 平台／专项 | 原 report.json SHA256 |
| --- | --- |
| Windows 缩进 | `f46b7ba4e088698104b62263e7312b86056c040b0b593f902f36b23a404c2704` |
| Windows 分栏 | `cddbd688ae1d219fe2f39afec1aa9ce9bac05aefa1f366db81b2f831ff2aff42` |
| arm64 缩进 | `93615c6642679b2fce115ecabbf25c8effb1f9f9eca94c222eb8a304f1bb04cb` |
| arm64 分栏 | `232d8d11143286f515d164a293d774d3e216cdb02fdbe96b3ee8c44955f6cb70` |

Windows 安装缩进原报告 SHA256 `d8ffab9737a44aded67cd60ffe9c0d74ce87d3a72c0818c12c420a325643704b`；arm64 安装缩进原报告 `9d704eea9b5fe21a29cd39408edbf288a65fc64e2109412560164e80844b9a88`。它们仍为失败／超时，不以源码通过追认为安装通过。

## 归档与日志

Windows ZIP：artifact `12124152164`、2,704,801字节，SHA256 `d5a9129a33a82b92b1f02f1f72d1b462b9174399005ceae5a5bc31acc54811fd`；本地忽略目录 `run1710-native-progress-original-download`。

arm64 ZIP：artifact `12124521220`、3,948,204字节，SHA256 `17e7ce7c7f9d3bf9e9ec3b31db174d2d82bee47c08100a8da72ed79588bc989f`；本地忽略目录 `run1711-native-progress-original-download`。两份各81项，已按固定预算核验；图片留在原 ZIP，未用于 UI 通过判断。

三个实际 job 的解码原日志均已保存于忽略目录，SHA256 依次为 Windows `f0549c340a1f1131feca962615d131f0d082a8b8ed6676a85c22cf3bfa702366`、arm64 `00077938085831bca0f9f070716df0410ed5276703cecd685a1597a4293a7ea1`、x64 `43fac1c8344dd324db57db4b9b61099b8c6e24ff3e13cca634c469c32f346a7e`。

Root 已交负责人据原证据核对 Windows 规范路径和 macOS 安装启动／准备差异。未放宽身份、期限、断言或退出要求，没有重跑该工作流、强停应用或据失败阶段删除现场。当前证据不足以宣布产品根因或修复完成。
