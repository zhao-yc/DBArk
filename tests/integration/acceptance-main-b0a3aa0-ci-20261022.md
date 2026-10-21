# b0a3aa0d三平台CI与原件核对

## 来源与终态

准确提交`b0a3aa0de0193840d0353db964aa8c4d495f663a`的[CI 39621803878](https://github.com/zhao-yc/DBArk/actions/runs/39621803878)，Linux、Windows x64、macOS arm64及x64作业均成功。Linux类型、609文件11616项通过／10条件跳过，156.46秒，Vite构建23.72秒。Windows固定C#编译预检通过；旧回合60秒失败的根因仍未确认，不用本轮成功追认旧失败。

| 平台／作业 | 源码legacy | 同次安装legacy | 每阶段专项 |
| --- | --- | --- | --- |
| Windows x64／119296959460 | 80通过／321跳过，7.4分钟 | 80通过／321跳过，7.4分钟 | 6通过，零跳过／重试 |
| macOS arm64／119296959729 | 80通过／321跳过，10.2分钟 | 80通过／321跳过，8.2分钟 | 6通过，零跳过／重试 |
| macOS x64／119296958913 | 80通过／321跳过，10.6分钟 | 80通过／321跳过，10.0分钟 | 6通过，零跳过／重试 |

专项为缩进、布局及四个首次文件模型场景。独立读取ZIP内原`report.json`与`accepted.json`，核对报告摘要、approval摘要、准确提交／runId／平台、单次passed及零失败／flaky；每阶段12个owner均confirmed／willQuit／closed，原目录移除及零SQL／系统剪贴板证据成立。三平台共六阶段36项、72个正常owner；这不覆盖私网实库、后继URI或JSON功能。

## 下载与完整性

2026-10-22通过GitHub连接器取得元数据并下载下列测试记录。下载文件位于忽略目录`.cache/ci-b0-artifacts-20261022/`；实际字节数及SHA-256匹配服务端digest，Python标准库独立检查ZIP全条目CRC通过，未执行档案代码。

| artifact ID | 内容 | 字节数 | ZIP SHA-256 |
| --- | --- | ---: | --- |
| 12355389516 | Windows测试记录 | 5361314 | `dd38ab46a32a9ad7192c4b9a8b60d813cebeeb80cf8bfe5291f7da6808ae426e` |
| 12356049219 | ARM测试记录 | 7870220 | `4501ff193f13f7df4e055397734f04bf89af2b4b5750c61e9fe5e40402bb19c6` |
| 12357261823 | Intel测试记录 | 10696174 | `b1ea1afd3b8d15ca3be34bdc7f88cca95647dc919b7c9e2aa649ae08fb878dae` |
| 12356309858 | ARM显示租约 | 11071 | `20df4a2ac289ae3e652c039945cd863b2b6a375fb4a8c9ed286493e34efe7c23` |

ARM源码／安装租约receipt均accepted，原专项与文件证明已消费，退出前恢复原1024×768（可见高674）；测试期间实测1600×1200。`postKeeperExitRestoreObserved`、`artifactUploadConfirmed`仍为false，不能改写；后来上传成功由独立artifact记录证明。原日志另保留在`.cache/ci-39621803878-job-<jobId>-decoded.log`，为连接器解码文本，不称字节相同原ZIP。

## 边界

仅下载测试／显示ZIP，未下载并重新安装安装器。CI内部的真实安装与上述专项报告有来源链，独立下载的安装器验收尚未实施。签名／公证、可选系统剪贴板及发行预览跳过；没有发布。b4a22208原Linux15失败、Windows编译失败及本机Worker五项超时仍保留。后继491f81e3与9d713bb8的CI须分别核对，不继承本轮成功；完整工作包计数不增。
