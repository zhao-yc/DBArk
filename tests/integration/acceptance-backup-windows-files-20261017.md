# Windows 备份选项文件运行端实证

Root 整合 `cc01341`／`952c11e`／`70a9732`，对应作者 `06a7c26`／`5c4fb02`／`2d50e3c`。这是私有文件端口及官方客户端配置读取验证，尚未接成完整备份、Main／IPC／UI 或恢复入口。

## 代码及独审

Root 三个相关文件 75 项通过、TypeScript 类型检查通过。独审发现原 helper 协议失效未传递到 SecretFile：成功回执后同块的异常帧、截断帧后 EOF、ready 后 helper error 仍可能发放凭据路径。永久健康门现已覆盖异步返回、缓存回执、路径及快照；未知时保留原 pending／frame／句柄，不重试清理。独审原同字节三红及三个健康／缓存／资源对照共六绿，原两绿未重跑。交接摘要 SHA-256：`7cb7e21316e6a52a1f0219c6d06df22613283ed9aff978446dc39350cec260b1`。

`run1476` 首次真实 C# 编译发现 Protect 的短路 out 调用导致 CS0165；拆开每次原生调用及返回值检查，未初始化变量来掩盖失败。`run1478` 新字节在 Windows 10.0.26200 x64、NTFS、签名有效的系统 Windows PowerShell 5 中实际编译通过；未调用 Program.Run。固定 C# SHA-256：`475b78748fcf1f9990c58d5926792ae978de71d1962f2e729805f0c35af45606`。

## 真实文件和客户端

`run1481-windows-files-native` 单次通过，实际执行内容：

- Root 建立新私有父目录。helper 读取全部 ACL，再以原句柄独占建立子目录／client.cnf，核卷号和完整 128 位 FileID、当前入口、非重解析及文件链接数。
- 对子目录／文件设置 Owner、受保护 DACL 并实际读回；独立系统 Get-Acl 另核全部显式及继承 ACE：恰当前用户与 SYSTEM 的 FullControl，两者均非继承，目录 OI／CI，文件无继承标志。
- 只在上述证明后取一次公开合成口令文本，实际 WriteFile、FlushFileBuffers、工作句柄关闭，独立读回同一文件字节。
- 前后完整核官方 MySQL 8.4.11 Windows x64 套件 80 文件。准确 mysql、mysqldump 各执行一次 `--defaults-file=<本例原文件> --no-login-paths --version` 成功，均为 8.4.11／Win64；每次执行前后同一原文件／目录身份及入口保持。
- 两个版本探测进程及三流实际关闭后，Root 才发清理许可。helper 沿原句柄删除文件及空子目录，核入口消失和 guard／writer 计数归零；正常 shutdown 后 helper 和三流实际关闭。Root 核私有父目录为空后非递归移除。

所有已登记原进程及流关闭，全部原文件、独占子目录及父目录已移除。没有真实数据库密码、数据库连接、dump、恢复、系统剪贴板、SSH 或 Docker。合成口令为公开测试常量，无后续用途，不属于需备份的长期秘密。

结果摘要 SHA-256：`04a636d7cd1b05f51b542b3de13f9cde08c241758b0bae4d81e81415ff4ed138`。首次 `run1479` 的 PowerShell 5 测试准备脚本因无 BOM UTF-8 解码失败，未执行目录创建或 helper；`run1480` 只读解析确认显式 UTF-8 无语法错误，`run1481` 仅修测试脚本 BOM 后用新编号补验，原失败保留。产品 bootstrap 使用 UTF-16LE EncodedCommand，不涉及该准备脚本解码路径。

## 后续构建门及边界

新增 `scripts/check-backup-windows-helper.mjs` 在 Windows 原生 CI 先核固定资源摘要，再通过私有 stdin 编译同一公开 C#，不执行协议；本机该脚本已实际通过并清理临时编译目录。其首轮检查把 PowerShell 初始化进度 CLIXML 计为 stderr，原失败保留；明确关闭进度流后同一 C# 通过，未屏蔽编译错误。

Windows 构建资源规则将固定 C# 放在 asar 外的 `resources/database-backup-windows/`，安装验收脚本新增实际资源类型、大小和摘要核对。配置和脚本已接线，新的安装包与原生 CI 尚待实际验收，不能把配置当成资源已随包通过。

本片没有实际取消、共享冲突、换绑／重解析／非空／只读失败矩阵，也未覆盖 macOS、真实认证、服务器线程与全局锁连续性、完整 dump 或恢复。CLI 版本探测只证明准确客户端在本次环境能读取合成配置；不代替完整 NativeProcess dump 状态机。

## 安装执行器夹具补充

整合头 `5d22044` 的完整 CI `39048057774` 保留为失败：428 文件中 427 通过，8003 项通过／1失败／10跳过。唯一失败为 `test-packaged-paths.test.ts` 的 VM 夹具未提供新增资源检查使用的 dirname／文件读取／摘要依赖；实际产品脚本已有正确导入。原日志 SHA-256：`a0c198a56f9793191a5ada60df435a359c73e2aac348c4f2e4b0120909856f52`。

后续仅补该夹具：仍运行从正式安装脚本提取的原执行块，文件端口为有界 RAM，使用真实 Node SHA256。Windows 两个固定资源读路径、macOS不读取Windows资源，以及缺失、符号链接、非文件、超限、内容替换时禁止启动测试的反例，合计9项通过，类型检查通过。未为此修改生产脚本，也未把旧完整 CI 改写成成功；修正后完整 CI 另记。
