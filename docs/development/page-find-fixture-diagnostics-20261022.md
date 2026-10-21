# 离线查找夹具的原生控制台诊断

当前 Electron 44 的 WebContents `console-message` 结构化消息位于首参数。原夹具监听器声明两参并读第二参数的 level/message，因此实际数值级别导致警告及错误没有被记录；声明旧参数还触发弃用警告。依据本地 electron.d.ts 的 WebContents 重载及 WebContentsConsoleMessageEventParams 修正为只声明首参数；警告／错误分类、2048 字符上限、原加载及退出行为保持。

真实夹具文件在 VM 中执行，仅替代 Electron 端口的原 5 项回归：修前 1 通过／4 失败，修后同断言 5 通过。Windows 本机原查找替换五例完整通过，0 跳过／重试，27.124 秒；新增原生控制台专项从真实渲染器发出固定 warning/error，准确捕获消息和级别且无旧参数弃用警告，1 项通过、0 重试，3.758 秒。未改原 30 秒就绪门、45 秒用例期限、搜索／替换断言或恶意正则准备流程。当前虚拟机明确 idle、准备未启动；按既有授权在本机执行，不重复派发。

旧 CI `39680932974`／Windows `119502907560` 仍保留为 beforeEach 按钮未出现失败；本修复补齐诊断，未证明那个启动故障已定位或消除。另一准确旧统计提交 37b0d0c1 的 CI `39684122705`／Windows `119513727704` 在 `check-backup-windows-helper.mjs` 的签名 BEGIN 后 60 秒 SIGTERM，未到 SOURCE_READ／ADD_TYPE／编译成功标记，退出 1。它没有执行该 job 的产品原生测试；不改签名验证或期限，不重写为成功。相关两种失败分别保留，不能混为同一根因。

后续核对同一运行 `39684122705` 已全部终结：Linux 类型／单元、macOS arm64 与 macOS x64 job 成功；Windows 仍为上述失败，两个可选 job 跳过。没有重启原运行，不以 macOS 成功覆盖 Windows，也不以旧统计提交代替本次固定结果对比的准确提交验收。

| 原始证据 | SHA256 |
| --- | --- |
| 夹具回归修前 | `9b6780738025d95c17f343d995e18eef42eac0c2b528925ca2311ff7ce92fc89` |
| 夹具回归修后 | `39c370accb209824c3369c1f17735877a145525e2ba58ec1fc49fd4d3cd2bdb0` |
| 原生控制台专项 JSON | `0ff08934b5cdbc0b0f4a83d36895220bc7fee20a8eb159a77cc426f23baee4f0` |
| 原生五例 JSON | `41392ea5cd658fbf471420564a4508c183082ee1d36aeb6d7f41cda9da7f10b1` |

以上都是源码夹具与本机原生证据，不代表安装版、macOS 或原 CI 的同机复现。未发布、未操作数据库或系统剪贴板。

## 后续固定编译阶段诊断

Windows helper 预检原 SIGNATURE_BEGIN 与 SOURCE_READ 之间实际还包含路径计算、签名调用、结果判断和编码初始化，现有日志不足以证明超时发生在 Authenticode API 内部。脚本仅新增 PATH_READY／CALL_BEGIN／CALL_RETURN／ACCEPTED／ENCODING_READY 固定标记，失败时另记源长度和原 stdin finish／close 的单调相对时间；stdin 关闭不代表子进程已读完源码。

原环境、Get-AuthenticodeSignature、Valid 与 Microsoft signer 要求、60 秒、三流关闭和成功后的精确清理门均保留。执行真实脚本、只替换进程／文件边界的 18 项 RAM 回归通过，覆盖缺失／乱序标记、超时、三流、日志上限；本轮没有运行新 PowerShell 预检，因此不将它记作真实编译成功。后继准确 d292452f 的 CI 39689687468 已越过原签名预检并进入原生测试，原失败根因仍未证明。
