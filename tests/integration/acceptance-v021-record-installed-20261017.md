# 0.21 候选记录浏览与编辑：14批56项安装实证

限定固定 `93f33ecab4090a5284a7988bc52d7744f8d99118`（R93）、同一 Windows x64 未签名 NSIS 0.21.0 候选。公开版本仍为 **0.20.0**；本记录不构成0.21公开发布，也不接纳后续源码开发线或新源码四项UI。候选来源沿用[首批安装记录](acceptance-v021-priority-installed-20261017.md)。

| 候选产物 | SHA256 |
| --- | --- |
| 安装器 | `1e24b5e23a0b201b4173e96fbe1adbefbd929729d3a95d790a6768f5d87e1754` |
| EXE | `d32866e8fea1c76f56635fb63b554448bb0c0d1e362ca87515998e0233e1bf2a` |
| asar | `d1ce5e001f9c8e28b2605dc040f84a9cf98cd820ed82fbac5aae342e4b2c5a07` |

## 正式执行与完整身份

准备为 `run1334-v021-record-preparation`，实际为 `run1336-v021-record-installed`。原W批映射到同号B批，共14批、56个完整 file/titlePath/projectName 身份，全部单次 passed，零skip、产品retry及报告errors；不是把partial、诊断或列表结果计作通过。

| 原批 → 实际批 | 完整身份数 |
| --- | ---: |
| W054 → B054 | 3 |
| W055 → B055 | 3 |
| W056 → B056 | 5 |
| W057 → B057 | 4 |
| W058 → B058 | 1 |
| W062 → B062 | 4 |
| W063 → B063 | 4 |
| W064 → B064 | 6 |
| W065 → B065 | 3 |
| W066 → B066 | 5 |
| W067 → B067 | 5 |
| W068 → B068 | 5 |
| W069 → B069 | 4 |
| W070 → B070 | 4 |
| 合计 | 56 |

原caseKey、grep、argv、flags、角色、每例与批预算保持；worker=1、repeatEach=1、产品retries=0，没有拆身份或延长预算。产品目标仅200的13384/MySQL 8.4.11/plain，原CA键保留为空，不作为TLS或证书验收。其它五实例的只读资源观察不计产品组合通过。

## 独立采证与资源终态

员工3只读独采核对1396份源码、108份dist、357份controls，共 **1861个摘要条目**。它们对应 **1788个独立解析路径及文件标识**，另73条为重复引用，不能称1861份独立文件或新增覆盖。1396份源码的SHA256和固定R93 Git blob均匹配，候选三摘要及安装初始、每批安装后的摘要一致。

14批各有list/test两种退出，分别持久化runner与public original两层记录，共 **56份双层退出文件**，全部status=0且signal/error为空。另4份生命周期退出不混计；规范卸载、afterRun完成，注册表终态及本轮owned-temp父目录为空。

资源回执 **16份**：14份between-batches，加before-owned-cleanup和before-owned-root-remove各1份。**31份有效native观测**的processes/visible均为正数、owned均为0，没有把权限失败或全零枚举当成释放。对应16份六实例阶段记录，加前 `run1335-record-pre`、后 `run1337-record-post` 共18份，相关临时库、用户、线程均为0。

R2-final保留已审实现：五个非CLI模块保持，其中runner仅有本轮队列digest绑定；十个CANONICAL规范函数及规范块匹配。public-cli只追加显式单源码根的两种分隔符前缀。本轮全pass，不据此称新增失败投影分支已实测。

## 剪贴板边界

选中身份中有 **8条路径**调用`positionMonacoCaret`：B056四项、B057三项、B058一项。它们真实读取系统剪贴板全部可读格式及独立纯文本，只在Electron主进程RAM物化、比较，finally删除临时快照；没有系统写回、粘贴或原载荷落盘。8是路径数，不是额外计量的原生读取次数，不能把“写0”解释成“零读取”。

B064一项、B067一项直接构造DOM DataTransfer/ClipboardEvent，共 **2项直接合成DOM路径**；属于页内事件载荷，不算原生系统copy/paste验收。独采所选源码路径的系统clipboard写为0，未额外监视整个系统剪贴板；未选身份不混入56项。

## 并集与剩余边界

以[后续53项](acceptance-v021-next53-installed-20261017.md)及[原B015新完整批](acceptance-v021-alias-installed-20261017.md)形成的159个完整caseKeys为旧集合，与本轮56项交集为0，得到 **215/340**，剩余 **125**。340仅是固定R93原就绪集合，不是全项目或Navicat功能覆盖分母。

| 剩余角色 | 身份数 |
| --- | ---: |
| 通用安装产品路径 | 98 |
| C02专用安装产品路径 | 3 |
| 开发Electron组件 | 21 |
| 安装宿主源码组件 | 3 |
| 合计 | 125 |

`run1274` B015的1fail/2partial及`run1280`诊断1pass保留原件，不改写旧红，不称修复其根因。215不包含新源码四项UI，也不外推macOS、其它数据库产品组合或完整取消/断线矩阵。

## 可追溯来源

以下为Root仓库根目录下的ignored本机证据位置，不随本文提交：

- 独采目录：`.cache/parallel-20261015/employee3-table-drop-owner-20261017/.cache/run1336-installed-independent-review-20261017/`；完整身份、摘要去重及退出明细见`independent-review.json`，并集见`accepted215.json`。
- 固定交接`handoff.json` SHA256：`4d506e1778b849463e9dd8aeb4ec8eec898ebfaac392c7b15ceeeb8f2ba6f4f9`。
- 独采`independent-review.json` SHA256：`b024aa00d2c74c015aa467cce0bd256572eeccca12b79a9899dfe869a073da6f`。
- 队列摘要：`fc83061db841e1d47426dcb0f7548afaf4d9ec6a637e2a4fb87a51ee68d2c0b0`；原件为`.cache/parallel-integration/run1334-v021-record-preparation/`和`run1336-v021-record-installed/`。

本文仅整理已存独采来源，不新增实际验收；215不代表全项目或Navicat功能完成比例。
