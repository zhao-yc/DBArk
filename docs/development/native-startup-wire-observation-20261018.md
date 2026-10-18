# 原生启动固定标记观察

本改动从 `9057178829b892b6e820337e1b8341ba6e548758` 增加必要观察，供 Root 合并 vendor 高亮补丁后统一重建 R5。没有运行 GUI、Electron、应用、数据库、SSH、Docker、端口、剪贴板或新 CI；没有修改、重批或重跑原 9057/R4 产物，也未修改读包器。当前不能据此判定 Mac 原首败原因。

## 三层观察

1. 只在既有显式原生专项进度诊断启用时，为已登记的原 owner 启动收集。通过 Playwright **1.64.0** 同进程映射核对 `_process` 就是原 child、browser 名为 electron，再校验 `RecentLogsCollector.onMessage/recentLogs` 的原方法 SHA-256。`onMessage` 同步重放已缓存的 child stdout/stderr，覆盖早于 `app.on('console')` 挂接的输出。只接受原 child PID 前缀和完整固定标记，其他原始行立即丢弃。缓存本身有限，`earlyCoverage:1` 仅代表已接通既有缓存，不能表示历史完整。
2. 重放后只由原 child stdout/stderr 及既有 console 回调持续收集；SDK 后续副本只核观察存活，不重复占据标记预算。没有启动新RPC、读取页面正文、控制流或进程。console 复用原 `message.text()` 的同一次返回，不多读 SDK 消息。source/hook 标记均嵌在原两个 evaluate 回调内，不拆 RPC；对象属性、getter、metrics、windows 的原求值顺序和次数保持。
3. Main 原 `app.info` 在原同步 safeStorage 调用前后输出最少固定标记。Main 默认完全关闭；只有 `DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS=1`、原 progress=1、integration=0、缩进/分栏恰好一个专项开启且非 list 才输出，单应用最多32条。新开关仅由当前批准的诊断 runner 显式传给本次子进程，不继承父环境。没有新增 safeStorage 调用、切换加密、改变返回对象、吞原 API 错误或转为异步。

## 固定字典

线格式严格为 `DBARK_STARTUP_V1:<十进制枚举>`。不附加 SQL、正文、路径、URL、异常、环境、凭据或 PID。

| 标记 | 原同步位置 |
|---|---|
| 1 / 8 | source 回调进入 / 离开 |
| 2 / 3 | 原路径、打包状态及进程属性求值之前 / 之后 |
| 4 / 5 | 原 getAppMetrics/map 之前 / 之后 |
| 6 / 7 | 原 windows/WebContents 读取之前 / 之后 |
| 20 / 24 | hook 回调进入 / 离开 |
| 21 | 原 will-quit 监听登记返回 |
| 22 / 23 | 原现有窗口 preload 监听登记之前 / 之后 |
| 30 / 33 | 原 app.info 进入 / 返回前 |
| 31 / 32 | 原 safeStorage.isEncryptionAvailable 之前 / 之后 |
| 99 | 诊断输出自身同步失败的固定后备标记 |

source 仅在尚未分配 `own.page` 的原启动来源采样中输出，不扩展后续关闭/正文采样；hook 仅在既有显式诊断对象中输出。关闭时保留原调用和握手，零新增输出。

## 独立附件与预算

新增附件名为“原生启动固定标记”，JSON `version:1`，**独占 2048 字节**，不挤占原“原生启动有界观察”的8192字节。原最坏8106字节正文、两owner各32事件、完整数字来源和64条等待点均逐字保持。新附件必须由后续读包器单独适配；旧R4 reader及证据未改。

形状为 `{version:1, missingMarkerMeansNotCalled:false, owners:[{owner:1|2,data:{version:1,sdk:164,events:[[channel,code]],dropped,failed,stopped,earlyCoverage}}]}`。最多2个 owner，各64条事件，dropped上限1024；通道1/2为SDK早期out/err，3/4为原child持续out/err，5为既有console。新记录没有时刻，不能把启动后重放时间冒充原发出时刻，也不能推导跨通道的准确先后。需要关联原相对等待时间时继续读取旧附件。

child 行缓冲每流至多256字节；单chunk扫描最多4096字节，过大chunk或非ASCII/超长行丢弃到换行，不拼接秘密正文。SDK行至多128字符，完整标记至多64字符；未知标记和多余字段拒绝。饱和/缓存截断可能漏标记，所以**无标记不等于未调用**。只有看到同一原边界的进入且未看到返回，才可收窄等待范围，仍不能自动归因为 Keychain/getAppMetrics/系统提示。

观察只读原 TestInfo、原 owner、原墓碑和已校验字段；不读新时钟、不调用环境权限门。当前 TestInfo 替换、原状态失效、owner切换、prepare完成或afterEach均永久stop/seal，不向下一例借观察。stop只移除自身stream监听，不关流、不处置SDK/应用、不发quit/kill、不查PID、不清目录。SDK没有公开取消缓存订阅接口，残留回调只在本同一收集器内检查封存并立即返回，不读取新内容或修改已封存数据。

日志收集失败仅写固定失败位；附件仍尝试保存已捕获的有界数据，然后使诊断明确失败。两份附件独立尝试，任一失败都保留原异常链；Main/RPC日志输出失败不会替换原业务值或原API异常。所有日志都不产生任何退出、终止、重试、清理或身份许可。

## 独立证明与验证

`tests/fixtures/native-startup-wire-baseline.json` 冻结9057的原runtime、Main case、原权限门及旧附件函数。去诊断证明只剥离精确固定mark闭包和完整已核接线；用各const initializer及返回属性一对一重建原对象字面量，对比保留全部节点、字面量、调用及次序的AST。不能仅改hash来放行。期限、额外API调用和权限漂移反例均拒绝。

原runtime文件的 **37个await、55次guard调用** 保持；其中 `createEditorIndentNativeRun` 本身是34/51，其余原两个函数3/4原文保持。原身份、退出/清理函数、120秒主体及45秒worker期限不改。新增观察的附件await不在这些原资源函数中。

窄RAM覆盖：固定SDK原缓存类的早期重放、chunk任意切分、秘密行/伪PID/非法枚举/超长数据拒绝、SDK版本/实现漂移、失效/ABA封存、半挂接失败清理自身监听、饱和预算、原8KiB正文不变、两附件失败保留原错、实际runtime+真实观察helper接线、source每个原getter/native异常对象和顺序、hook和Main异常对象、日志双路径失败、默认/list零输出及runner不继承诊断开关。SDK仅抽取真实缓存类在RAM执行，不导入Playwright运行时或建立连接。

实际命令、结果、日志 SHA-256 及整合边界见本克隆 `.cache/mac-startup-observation/handoff.json`。这些证明不能代替R5真实Mac/Windows安装及SDK桥接验收。尤其 SDK 私有适配明确固定1.64.0，升级或桥接不匹配会保留失败，不静默退回为“无早期错误”。

## 原只读交接与整合

原只读交接精确路径：`D:\svn\DBArk\.cache\parallel-20261015\employee3-mac-installed-startup-readonly-20261018\.cache\mac-installed-startup-readonly\handoff.json`，SHA-256：`deb1396a92bf58e43b7af0aa7a8655d7a45bd0026a8bfa4c1d3b84cf3b559684`。

本任务触及Main原app.info、native-editor-ci显式环境传递、原生runtime/gate/owner及附件接线。Root应从9057三方核对与vendor高亮补丁的重叠；新R5重新封存/构建/打包/安装由Root统一执行。没有改产品版本、工作流、旧R4 reader、旧R3/1556、Root或其他成员分支。
