# 单次保存快捷键的 Main 被动观察准备

父提交为 `d34c4e4a1d2a388cffeb5346c368543f46b9d6f2`，普通 clone 为 `.cache/employee2-query-file-main-probe-20261019`，分支为 `codex/employee2-query-file-main-probe-20261019`。仅扩展原快捷键准备测试；没有修改产品、依赖、workflow、原 runtime、退出门、文件 helper 或 R9。没有执行原生案例、Playwright（含 list）、GUI、端口、数据库、Docker、CI 或依赖安装。本分支只作本地提交及 bundle，不推送。

Root 已独审 run1906 的单次 `Page.keyboard` 保存失败。本任务没有再访问该失败文件、报告或进程现场；旧失败不因本准备补丁改写。原准备说明中“没有 before-input-event 处理”的段落描述扩展前版本，本说明记录本次新增的被动观察。默认/list 的独立门及原保存成功标准继续沿用原说明。

## 观察范围

原 runtime 完成 Main/window/webContents 来源确认后，原 BrowserWindow 只读样本须与已完成的来源诊断中的两个数字身份相等。随后只从该原 `application.process().stdout` 订阅数据。使用与页面观察器不同的新 nonce，安装与成功解绑 RPC 分别经过原 `run.step`；未增加按键、焦点设置或保存派发。

安装 RPC 通过 `BrowserWindow.fromId` 再核同一 window/contents 及未销毁状态，读取 `Menu.getApplicationMenu()`。最多遍历128项、祖先深度8；以产品现有精确文字“保存查询”识别保存项。菜单缺失、保存项缺失或重复均如实记录；只有唯一保存项才记录其完整祖先链及自身的 enabled、visible、accelerator。各层记录各自布尔值，不把父项可用性推算为实际菜单激活证明。没有输出任何菜单文字。

只在已捕获的 webContents 上增加一个 `before-input-event` listener。该回调仅读取 Electron 提供的 input 的数据属性和本地 deadline/closed 墓碑；访问器不执行，不调用窗口/SDK getter。仅记录 Ctrl/Cmd 与 S 对应的事件：普通按键、原 key/code、modifiers、SQL、表单、认证、路径和任意错误正文不输出。既不访问事件的取消状态，也不调用 preventDefault。

没有包装或调用菜单 click，没有产品 handler、保存 IPC、sendInputEvent 替换或补按。观察器错误被隔离为固定数字 fault 帧，不能从输入回调抛出而阻断后续产品 listener。

## 安全帧合同

每行前缀为独立 `DBARK_FILE_MAIN:<nonce>:`，正文所有值仅为数字或布尔。公共字段为 `stage/seq/window/contents`，同一 window/contents、连续序号和精确字段白名单必须成立。

| stage | 含义 | 附加字段 |
| --- | --- | --- |
| 1 | 原应用菜单快照摘要，第一帧 | menuExists、saveCount |
| 2 | 唯一保存项的祖先/自身，从外到内 | depth、target、enabled、visible、accelerator |
| 0 | 安装完成，按键前必须收到 | 无 |
| 3 | 原 contents 的输入 | type、keyS、codeS、control、meta、shift、alt、repeat、composing、location |
| 4 | 成功路径本地解绑，继续验证前必须收到 | 无 |
| 5 | Main 观察故障，父进程立即停链 | 无 |

输入 type：0=keyUp、1=keyDown；keyS/codeS 只表示是否等于 S/KeyS，不输出原文字。accelerator 枚举：0=未配置，1=`CmdOrCtrl+S`，2=`CommandOrControl+S`，3=`Ctrl+S`，4=`Control+S`，5=`Cmd+S`，6=`Command+S`，7=`Super+S`，8=其它未知值。未知值不擅自解释为有效保存快捷键。

Main 最多32份正常帧，溢出最多追加一份数字 fault 后本地解绑。父进程逐字节解析原 stdout，非本 nonce 的行不缓存正文；只保留固定前缀和最多2048字节 ASCII 正文，不把 stdout 任意内容拼接到日志。每份帧在进入附录前校验原父门、精确字段、数值范围、阶段、序号及身份；故障帧、未知字段/正文、溢出和原 owner 失效均永久停链。已经 stop 或 detached 后的迟到数据不再接收。

成功路径在原 scope 内解绑 Main/页面订阅，父进程须分别收到 detached。失败路径仅停止父端接收、封存已验证帧，不发解绑 RPC、不补读 Main/SDK/SQLite/源文件；Main 只靠本地 timer 或捕获的 closed/destroyed 事件解绑自己的 EventEmitter listener。未知 owner 不退出、不清理、不重启。

## 验证与限制

纯 RAM 测试执行真实序列化 Main 回调的独立 VM，覆盖菜单状态、零派发/零拦截、同一 window/contents、事件内禁止 getter、隐私字段、输入访问器、跨块/CRLF/无关大 stdout、乱码/超大/未知帧、错 owner、时间倒退/截止、迟到 RPC、重复安装、错误解绑、溢出和 stdout 异常不阻断原 listener。另复核原声明默认/list 零 live/清单/应用/端口，以及原 owner/期限门。RAM 投递 input 是反例模拟，不是原生证据。

本地结果：4文件102项全部通过（新增Main观察44、原快捷键准备30、原owner13、原环境/期限门15），`tsc --noEmit` 退出0。使用上层已有依赖二进制，没有安装、更新或建立依赖链接。测试及类型检查原输出只存本 clone 的 `.cache/main-probe-evidence`。

原 runtime 字节保持，37个 await、52次 guard、120秒原期限、15秒正常退出门及零重试保持。原用例仍只发送一次 `Control+s`/`Meta+s`；5秒保存断言、完整 UTF16LE+BOM/CRLF golden、来源修订、正常退出、SQLite9、独立重启及目录门未放宽。

菜单状态快照不能直接证明 click 回调执行；before-input-event 也不证明系统真实按键或菜单已消费。此观察器不读取其它 listener 的行为，因此不能据此判断是否有其它 listener 调用了 preventDefault。Main/DOM/onMenu/task 的缺席或出现须按各自原始阶段报告，不能唯一归因于 CDP、Electron 或产品。

Electron 固定44.7.0官方资料：[web-contents.md](https://raw.githubusercontent.com/electron/electron/v44.7.0/docs/api/web-contents.md)。文档说明 before-input-event 在页面 keydown/keyup 前发出，preventDefault 可同时阻止页面事件和菜单快捷键；sendInputEvent 承诺向页面发送输入，且所属窗口需要焦点。它没有承诺与系统键或菜单执行等价。本补丁没有运行或替换 sendInputEvent。

Root 独审本地提交、bundle 与 RAM/类型证据后，再决定是否为全新 profile 建立清单并批准新的单次执行。本准备不证明 Ctrl/Cmd+S、Main 输入、原生菜单、安装版或 macOS 已经通过。

## 626之后的安装期限增量修正

员工4独审 MIP-1 指出626的安装闭包只在整段窗口/菜单读取后复核原期限：窗口 webContents 或菜单 label getter 跨deadline时，仍会继续后续getter。旧626提交、原handoff和原bundle保留，本修正另建提交，不将原102项通过改写成已覆盖此反例。

窗口fromId、销毁状态、window/contents身份链、应用菜单、每层items/label/submenu、enabled/visible/accelerator以及每次listener注册，分别通过本地checked在前后复核同一deadline、有限单调时钟和closed/state墓碑。晚回只拒绝，不能继续下一getter、注册或ready帧。submenu及菜单状态只读取一次，后续用本地值；没有增加期限或改变原120秒预算。原事件回调仍无窗口/SDK补读。

未注册时失败只清除本地标记，不能为了清理调用SDK。开始注册前先设置同一原deadline的本地timer；若注册本身晚回，只解绑已发起的自身EventEmitter listener，不读窗口、不退出owner、不派发保存或补SDK。未知/倒退时钟下也不发fault正文，观察清理异常不能打断产品输入。

新增27项原闭包RAM反例逐项覆盖19个SDK读取节点、timer及3个注册节点晚回、NaN/Infinity/时钟倒退和单调有效时钟正例，核跨时后lateSDKReads=0、无后续注册/ready、无派发。原44项Main观察、30项快捷键准备及28项owner/期限门继续复核；本地5文件129项及类型检查通过。证据只写新的 `.cache/main-probe-deadline-fix-evidence`，不覆盖626原件；仍未运行GUI、原生案例、Playwright/list、端口、DB或CI，也未推送。
