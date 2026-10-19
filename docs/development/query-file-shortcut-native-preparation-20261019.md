# 单次文件保存快捷键被动观察准备

基线为已推送 Root `21dd5f969ab9caefda551e93640de08dd304d7dc`。本分支只新增独立测试、门、观察 helper、RAM 反例和本说明，不修改产品、原 runtime／文件 helper、原 run1893 或共享 fixture。当前尚未实际运行，不表示 Ctrl/Cmd+S 已通过或原因已确定。

## 未来单次用例

`tests/e2e/query-file-shortcut-native.spec.ts` 默认及 list 只登记一项 skip，不加载 live、清单、应用或端口。实际运行必须由 Root 独立批准以下环境，不能复用其他专项的批准门：

- `DBARK_QUERY_FILE_SHORTCUT_NATIVE_TEST=1`
- `DBARK_QUERY_FILE_SHORTCUT_NATIVE_APPROVED=1`
- `DBARK_INTEGRATION_ENABLED=0`
- `DBARK_QUERY_FILE_SHORTCUT_MANIFEST`：Root 批准的绝对完整清单路径。
- `DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256`：该原清单的 SHA256。

门拒绝其它 DBARK 环境、认证、预加载、录制及配置覆盖；支持 Windows／macOS，保持原 TestInfo 的 120 秒总期限、原退出 15 秒门和零重试。原 runtime 的 37 await／52 guard、完整输入封存、实际 Main/window/webContents 来源、正常退出/PID/目录门保持原字节。Root 独审后再决定是否执行，本任务没有提供自动运行脚本。

用例通过正式 UI 创建无密码离线配置和草稿，原 runtime 仍要求回环端口拒连前检；只回答一次精确 OpenDialog，真实打开自有 UTF16LE+BOM/CRLF 文件。编辑由文本框 focus、全选及键盘插入完成。源文本和修改后完整 golden 复用原手写 `sourceSql`／`savedSql`，磁盘始终精确期望 UTF16LE+BOM/CRLF。macOS 模型可能为 LF，仅按初始模型官方 EOL 映射手写编辑预期，不改模型、不从文件读回结果生成 golden。

保存阶段仅一次 `Control+s`／`Meta+s`，不点击保存按钮、不调用菜单 click、不重发保存 IPC，也不添加 DOM 产品 handler。即使观察到按键或菜单通知，文件仍 dirty 时按原 5 秒保存断言如实失败；观察事件不能代替保存成功。

保存成功还须：原第一个标签完全不变、活动标签及正文不变、原来源 ID 不变且修订恰好加一、Main 来源路径不变、完整磁盘 golden 相符、摘要对应原保存快照；只有 open/save 两个 completed 文件任务，没有查询库记录和 SQL 历史。随后沿原正常退出门读本例 SQLite9，独立重启核原 tabs/activeTab/模型正文和原保存文件对象，再正常退出并通过原目录删除门。

## 观察能力和明确盲区

保存前仅只读记录原 BrowserWindow/webContents 数字身份及焦点布尔值，不改变窗口前台或补焦点。页面仅额外订阅公开 `onMenu`、`onTask`，添加 capture keydown 监听；没有 Menu 包装、before-input-event 处理、preventDefault、保存分派或新 RPC。每个 SDK await 由原 run.step 前后核对，保存前后读取 Main settings 的活动标签；事件瞬间仅记录所属可见 pane，不伪称读到了 renderer 私有 activeTab 或 busyRef。

页面事件由独立 nonce 标识，最多 32 条正常记录，溢出另发一次失败通知；仅包含阶段、命令类别、计数、布尔焦点/IME/repeat、pane、disabled/aria-busy 投影和保存任务 ID/终态/phase/wrote。普通菜单消息只记 `other`，不记录正文、错误消息、表单、密码、路径或 SQL。父进程只接收该 nonce 的 console 事件并检查原 scope/owner；未知字段、owner 失效和溢出均留下单向停链。观察 getter 失败或溢出不得向原事件分派抛出异常，只发无错误正文的 fault 并解绑，防止观察器改变产品行为。订阅前确认 `before` 内存事件，成功解绑后确认 `detached` 内存事件，避免把异步 console 传递当同步完成。

`onMenu` 的 `save-query` 证明 preload 已实际转发，但没有 Main 菜单 click 的直接观察；其缺席不能唯一归因于 CDP 未触发菜单。UI disabled/aria-busy 只是界面投影，不能反推 private busyRef。事件回调执行顺序也可能让 onMenu 记录到保存已开始后的 busy 状态。keydown 可能被原生菜单先消费，因此不以“必须存在一条 DOM keydown”判定保存成功；最终仍要求一个 save-query 收件、一次文件任务和一次来源推进。

成功时在原期限和 owner 内解绑；失败时先保留原错误，只附加父进程已经收到的内存日志，停止 console 接收，禁止再 evaluate、截图或读取旧 SQLite/文件补证。页面观察器在原总期限内通过本 document 的本地 timer 自动解绑，不调用 SDK、窗口、文件或下一 owner。文件 helper 的 finally 仅关闭已有句柄，未知 owner 不退出、不重签、不清理、不再启动第二实例。没有菜单包装器，因此不存在包装器 finally 恢复或手动调用包装器冒充 native 的路径。

## 本地验证与后续

只运行新准备的 30 项纯 RAM 测试和必要类型检查，另有未改动的 18 项原退出护栏通过；RAM 以真正序列化的观察回调在独立 VM 中验证订阅、零派发/零拦截、白名单、截止解绑、重复安装拒绝、getter失败/溢出不阻断产品和旧 owner 停链，并验证实际声明源默认/list 不加载资源、真实原 run.step 拒绝迟到后续动作。手动向 RAM listener 投递 `save-query` 只是反例测试，不能成为 nativeMenu 证据。

Root 下一步独审本分支和 bundle，再为全新 profile 固定清单后决定单次实际执行。Windows CDP 是否驱动 nativeMenu、真实系统 Ctrl/Cmd+S、macOS、安装和真实数据库均未验。保留原 run1893 失败与 run1896 按钮成功各自边界，不将本准备结果改写为任何实际通过。
