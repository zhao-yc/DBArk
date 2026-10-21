# 离线查找夹具的启动失败诊断

准确3005511的CI39547268906在Windows原源码legacy中出现1失败／79通过／317条件跳过：beforeEach等待“当前页查找替换”30秒未找到，正则用例正文尚未执行，安装未到达。Root已核原失败ZIP的长度、SHA与71项CRC，详见[原分层记录](../../tests/integration/acceptance-bulk-enabled-ci-20261021.md)。原早期加载／renderer原因没有足够记录，保持未知，不改判随机失败或已修复。

本轮仅增加固定离线夹具的证据，不改变产品、窗口尺寸、Vite配置、30秒断言、原测试步骤、退出或重试：

- Main在loadURL前记录加载失败代码、renderer退出、有限console警告／错误及加载完成；加载拒绝仍抛原错误。
- 每个实际子进程分别保存stdout／stderr原字节，各最多128KiB，超额显式标记；只在该用例失败时附加原字节及PID、退出／信号、页面URL、renderer错误与字节／截断状态。
- 回调绑定本例独立缓冲对象，前例迟到数据不能写入下一例。Main单条console最多2048字符，不回显环境或命令行。

此夹具只加载本例本地Vite页及RAM表数据，没有真实数据库认证／查询数据；本轮未启动GUI，不读取系统剪贴板或实库。`node --check tests/fixtures/page-find-replace/electron.cjs`通过；第一次类型检查PID27744退出0／25.4902804秒，回调绑定本例缓冲修正后再核，PID39992创建UTC2026-10-21T05:40:26.6335896Z、完成05:40:51.9850114Z，退出0／25.5402005秒。原stdout／stderr均为空，日志分别在`.cache/page-find-startup-diagnostics-type-20261021/`与`.cache/page-find-startup-diagnostics-final-type-20261021/`，子环境无DBARK_*。诊断附件是否在真实失败中产出尚未验，不能用静态检查声称定位原根因，旧CI失败保持。
