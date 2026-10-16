# 0.19：三平台原生开发组件补验与317身份计划收尾

2026-10-16，ROOT在本轮[两项Windows真实安装复制](acceptance-v019-windows-candidate-20261016.md#run970本轮两项原生复制实际通过)完成后，独立触发[CI 38910633307](https://github.com/zhao-yc/DBArk/actions/runs/38910633307)。三平台原12项均实际通过，ROOT的run977已完成独立下载、逐例核对并接纳。本文记录原计划收尾，0.19仍待正式标签构建及公开下载验收。

## 固定来源与任务边界

- 产品源码为`dbd1db098c15c7b3349bcdfa756ccd1b702e8476`，版本0.19.0；Windows安装器、EXE及ASAR继续归于[候选实证](acceptance-v019-windows-candidate-20261016.md#构建与候选身份)，不冒领新CI头。
- 组件CI实际头为`c8bf0b7e2ae561cc8745a72c4048d7260dd86132`。它只在人工参数为true时排除完整checks和desktop任务，保留三平台原native12；原生job及原12用例未变，没有新增测试或放宽恢复断言。此轮checks/desktop/release被跳过，不将这些job的跳过误报为用例跳过或完整发行通过。
- 发布源码文档基线为`77b83715148229b3f524cbe68935eead813896ae`。相对于该点，组件CI头的差异仅为三份Markdown和`.github/workflows/ci.yml`；其余非文档blob、产品与测试均逐项相同。发布文档分支不带入这处CI条件修改，版本、依赖、测试、构建和脚本保持基线原blob。
- 基线相对产品dbd1的后续变化只在tests及文档，不能将其描述成新产品代码验收；ROOT后来开发的C03/D08、paste或诊断新代码不在本发布分支中。

## 三平台实际结果与归档身份

每个平台均为`query-binary-types-offline.spec.ts`原2项与`record-input-guards-offline.spec.ts`原10项，在GitHub临时原生机器运行；单worker、零重试及原期限保持。每个完整caseKey由文件、完整标题路径、项目名构成，精确等于317原计划剩余的12个开发组件身份。每项只有一个实际passed结果，无失败、无flaky、无跳过、无重试。

| 平台 | Job | 单次通过 | 跳过 | 重试 | 归档ID | ZIP字节 |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Windows x64 | [117005281923](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/job/117005281923) | 12 | 0 | 0 | [12050411493](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/artifacts/12050411493) | 85654 |
| macOS arm64 | [117005281799](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/job/117005281799) | 12 | 0 | 0 | [12050122920](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/artifacts/12050122920) | 141945 |
| macOS x64 | [117005281444](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/job/117005281444) | 12 | 0 | 0 | [12049678748](https://github.com/zhao-yc/DBArk/actions/runs/38910633307/artifacts/12049678748) | 168508 |

| 归档 | SHA-256 |
| --- | --- |
| Windows x64 | `18cdb9a9c4c5d9b8886475533412fd42fe55a491d5519f5a3c86f2a87c3024d3` |
| macOS arm64 | `2ed8bfcc0573b136d27d730b1c4f2846bcd68be5ea1c5b3fcba33a1e920f0d2e` |
| macOS x64 | `4ebe67c8ece22fc01872bdb453d2e891580233195d5868fda2c58e426acca102` |

run977逐个核对API run/head、归档ID、大小、SHA-256及ZIP CRC，再在内存核对报告完整caseKey、单次结果和恢复附件。最终接纳记录是`run977-v019-native-artifacts/verified-reports.json`的`accepted=true`；较早`run977-v019-native-artifact-metadata.json`的“尚须独立下载逐用例核对”只反映当时步骤，不覆盖最终结论。本次文档整理另只读复核三个ZIP及报告、22份run972引用原件，不重跑产品或CI。

## 恢复诊断的实际范围

每平台12份“原剪贴板恢复结果”附件均为`restored/snapshotSaved/itemCountMatches/typeSetsMatch/textMatches=true`，`missingTypes/additionalTypes/payloadMismatches=0`。捕获及恢复两端均为1个原始空壳、0个可读条目、1个空类型条目；保存和实际类型数均为0。

这只证明本轮CI当前空壳规范化及严格恢复断言通过，不能外推富文本、多格式、多条目、非空系统剪贴板，也不证明用户本机剪贴板已恢复。run970的两项本机复制另有本轮覆盖且不保留旧内容的有限授权，实际没有备份或恢复旧剪贴板；CI机器上的恢复不改变这一事实。多类型、零字节及异常恢复的纯反例仍单列，不冒充实际平台验收。

## 原317计划的计数

| 层次 | 原已接纳 | 本轮补入的不同身份 | 计划累计 |
| --- | ---: | ---: | ---: |
| 安装产品 | 282 | 0 | 282 |
| 开发Electron组件 | 20 | 12 | 32 |
| 安装宿主源码组件 | 3 | 0 | 3 |
| 合计 | 305 | 12 | 317 |

原计划现为317/317：282安装产品、32开发Electron组件、3安装宿主源码组件。三平台重复的12身份用于各平台实证，不能累计为36个新功能、36个新身份或安装产品通过数，也不把三平台源码/安装离线各72项与本计划重复相加。这不是Navicat全功能完成比例。

run970保留两批原list、结果、退出、输入和实际安装摘要；run971独立只读核六实例临时库、账号、线程均0；run972重新核原件与先前303身份，接受同候选305身份，并核卸载注册/相关原生进程0。这些原件继续归于run970/971/972，本次CI只补入原12组件。

## 原失败与发布边界

[0.18原生组件记录](acceptance-v018-native-components-20261016.md)保留`38873542572`的Windows reporter启动前失败、Mac恢复失败及`c3042ec`的窄修来源，不倒推原失败唯一根因。0.19此前`38892945068`的Windows安装71通过/1失败/245跳过、输入准备为空及之后`38897780700`的三平台离线各72项通过分别保留于[候选记录](acceptance-v019-windows-candidate-20261016.md#三平台原生ci终态)；后续通过不表示原根因已确认或修复。run885包装后核和run890输出路径等原失败也不改写。

MDL专用观察用例仍待对应环境与实际验收，原七项核心实证不改称八项全过。正式标签CI、公开附件/下载链、公开Windows安装、macOS私网、签名公证及全功能清单剩余能力均单列；本次不创建或移动标签、不发布、不触发CI。

## 本地证据索引

以下文件均位于ROOT的忽略目录`.cache/parallel-integration/`，只提交脱敏结论与摘要；不提交原始报告、截图、认证、ZIP或临时下载地址。

| 相对路径 | 字节 | SHA-256 |
| --- | ---: | --- |
| `run977-v019-native-artifact-metadata.json` | 9470 | `1e041c222ae9dbbe1453efefa1da41562545cc63fb43af72908ae1bae62ae950` |
| `run977-v019-native-artifacts/download-proof.json` | 799 | `47cee2fb3f8585a75ff84b062c67dc8c0f695204ccc1d43f6e72043f3da153b6` |
| `run977-v019-native-artifacts/verified-reports.json` | 34430 | `da3671a38abbfbc058cad1c4c55055303182534f84b97915c7f76995eaa05ef3` |
| `run970-v019-native-copy-two-call70e3d73-summary.json` | 1655 | `618d9453abe1ef2469f2f11b799de9669d4ddbd4b96492c2b75d1ac3919d4fb5` |
| `run971-after-native-copy-resources.json` | 1123 | `aff188ae0ffe41f724483c3e61a549f53e88d66d0b53b20feaf9a2b1536d6095` |
| `run972-v019-native-copy-collected.json` | 4827 | `1a4277aad44c7e7b77743c1ae6f3cceeac9363732e6572164c45778623ea6499` |
