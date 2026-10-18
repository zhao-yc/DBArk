# 第六轮原生终态与安装启动边界

[运行 39115617411](https://github.com/zhao-yc/DBArk/actions/runs/39115617411) 固定头 `08003fd3c1b9300e19703d1968c4645bc65eba7b`，源 `5cac4fd80fc2edb69be3df2fb65c2753506cdbbc`，已终止为失败。第五轮模块加载首败及其修复保留在[前轮记录](native-observation-r5-root-20261018.md)；本轮未重跑 R4／R5，也没有公开发行。

## 逐阶段结果

| 平台 | 源码缩进／分栏 | 源码 legacy | 打包 | 安装后缩进／分栏 | 安装后 legacy |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | 两项各单次通过 | 76 通过／297 条件跳过 | 成功 | 两项各单次通过 | 76 通过／297 条件跳过 |
| macOS arm64 | 两项各单次通过 | 76 通过／297 条件跳过 | 成功 | 缩进 120018ms 超时；分栏未执行 | 未执行 |
| macOS x64 | 两项各单次通过 | 76 通过／297 条件跳过 | 成功 | 缩进 120010ms 超时；分栏未执行 | 未执行 |

Windows 四份实际专项报告均只有一个 passed 结果，零重试；每份两个 owner 已准备，原正常退出与限定资源清理证明完整。legacy 的 76 包含组件层验证，不是 76 个完整安装业务路径。未访问私网数据库或系统剪贴板，不能代替本版实库／驱动矩阵。

Linux job `117640686270` 为 505 文件／9253 通过／10 条件跳过，类型及构建成功，包含四项正式 CJS／ESM 模块加载回归。原解码日志 143953 字节，SHA-256 `b75fbab0646a7546b44c7fcb7f8f72af045ddba94475fc1a0a780f0d85e2432a`。三平台源码步骤已跨过旧 import.meta 加载首败；两台 Mac 安装后原报告仍保留 timedOut 和额外 45 秒 worker teardown 超时。

## Mac 的实际观察

两台均只有一个 owner、prepared=false；固定标记附件均 observed、failed=false、stopped=true、earlyCoverage=1、dropped=0。arm64 36 条事件，x64 四条，不是标记收集失败，也不是旧语法错误。

- arm64 两次原来源采样完整返回，最后等待点 `[3,2,5388]`，随后进度到 prepare.hook。原诊断 launcher／main 同为 32665；启动阶段尚无窗口来源完整证明，不能写成 PID 不匹配。
- x64 最后等待点为首个 evaluate 进入 `[4,1,8409]`，没有对应返回；最新进度为 scan.done。两者均未到 firstWindow 调用。
- 两份附件都记录 Main 的 30、31（原 child stdout 和既有 console 各一次），没有记录 32、33。原源码 31 位于 `safeStorage.isEncryptionAvailable()` 前，32 位于返回后，可收窄到原启动能力检查边界；日志有界、早期缓存不保证完整，缺返回标记不能单独证明永不返回或操作系统内部原因。

现有证据没有确认 Keychain 锁、系统授权、签名或具体原生实现根因。下一步核对实际 Main／LocalStore／renderer 调用链及官方接口，选择改善应用启动并保持凭据安全语义的最小方案；不以延长期限、跳过安装或过滤原错误代替修复。

## 原件和独立核验

| 平台 | Artifact | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Windows | 12131959479 | 5353867 | 5765818fdc04397db9e1f62b56c19db6e66fbd6a83e8ea242d62f8b3abe9ee63 |
| macOS arm64 | 12132602382 | 3954428 | 0e8c864fcc921805aecdd6304d158ea1adf0d72fde518a97729facdc305c1f9c |
| macOS x64 | 12132387134 | 5283055 | ccbf414030fbbeb5a4aaacff23e5def6e9e86f318cb5e4b44c92c6d2dfdf6626 |

Root 重新核连接器元数据，再用无回显 stdin 内存通道下载并独立重读落盘摘要，临时地址未写参数、环境、文件或日志。员工安全核三份共 297 项 CRC，只提取 113 个文本，读取 69 个 JSON 容器中的十份实际专项报告；原错误、栈和超时状态完整保留，交接 SHA-256 `7510459e6981739d92338248296fdb22c6d927f7cfca2606f604cbac3b8f59a1`。

Root 又用 Python 标准库独立核原 ZIP、每项 CRC／摘要和十份原报告，Windows／arm64／x64 各 135／81／81 条目，证据 SHA-256 `1e6c1a9c515ffe7071f1162c19350c5b8001b2f53c1438243d00ff46082be1f4`。冻结 R5 读取器在全新 run／head／artifact 绑定下重读，输出与员工原件逐字相等，回执 `54bf20b69a18dc0231fce69c4f88f19a6b5fbd383782c4e49dfb4bb8ad9cd162`。格式合同沿 R5，轮次为本次第六轮，不重标原 R5 数据；实际 wire 源 SHA `2cef...` 与旧合同来源 `700608...` 分别记录。

本轮仍是 0.23 的独立诊断候选，没有下载或公开其 Windows 安装候选。它不作为 0.28、Mac 安装、凭据持久化或 Navicat 全功能完成证明。Root 的本机 0.28 关键字窗口专项属于另一固定源码与证据集。
