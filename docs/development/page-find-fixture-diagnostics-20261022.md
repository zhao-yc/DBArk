# 离线查找夹具的原生控制台诊断

当前 Electron 44 的 WebContents `console-message` 结构化消息位于首参数。原夹具监听器声明两参并读第二参数的 level/message，因此实际数值级别导致警告及错误没有被记录；声明旧参数还触发弃用警告。依据本地 electron.d.ts 的 WebContents 重载及 WebContentsConsoleMessageEventParams 修正为只声明首参数；警告／错误分类、2048 字符上限、原加载及退出行为保持。

真实夹具文件在 VM 中执行，仅替代 Electron 端口的原 5 项回归：修前 1 通过／4 失败，修后同断言 5 通过。Windows 本机原查找替换五例完整通过，0 跳过／重试，27.124 秒；新增原生控制台专项从真实渲染器发出固定 warning/error，准确捕获消息和级别且无旧参数弃用警告，1 项通过、0 重试，3.758 秒。未改原 30 秒就绪门、45 秒用例期限、搜索／替换断言或恶意正则准备流程。当前虚拟机明确 idle、准备未启动；按既有授权在本机执行，不重复派发。

旧 CI `39680932974`／Windows `119502907560` 仍保留为 beforeEach 按钮未出现失败；本修复补齐诊断，未证明那个启动故障已定位或消除。另一准确旧统计提交 37b0d0c1 的 CI `39684122705`／Windows `119513727704` 在 `check-backup-windows-helper.mjs` 的签名 BEGIN 后 60 秒 SIGTERM，未到 SOURCE_READ／ADD_TYPE／编译成功标记，退出 1。它没有执行该 job 的产品原生测试；不改签名验证或期限，不重写为成功。相关两种失败分别保留，不能混为同一根因。

| 原始证据 | SHA256 |
| --- | --- |
| 夹具回归修前 | `9b6780738025d95c17f343d995e18eef42eac0c2b528925ca2311ff7ce92fc89` |
| 夹具回归修后 | `39c370accb209824c3369c1f17735877a145525e2ba58ec1fc49fd4d3cd2bdb0` |
| 原生控制台专项 JSON | `0ff08934b5cdbc0b0f4a83d36895220bc7fee20a8eb159a77cc426f23baee4f0` |
| 原生五例 JSON | `41392ea5cd658fbf471420564a4508c183082ee1d36aeb6d7f41cda9da7f10b1` |

以上都是源码夹具与本机原生证据，不代表安装版、macOS 或原 CI 的同机复现。未发布、未操作数据库或系统剪贴板。
