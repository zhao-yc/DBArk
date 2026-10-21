# 699741b三平台CI：分层原件核对

## 准确来源与现有终态

[CI39637252434](https://github.com/zhao-yc/DBArk/actions/runs/39637252434)，准确提交`699741b7ab01b873d305f290f1f1e6f20247f78d`，src树`dd9a17784ce94ad60f53302cb9fabe08bce2ba2e`。Linux类型／612文件11682通过、10条件跳过，186.22秒，Vite29.05秒。当前已核Windows和ARM作业成功，Intel仍在安装验收，不能称完整三平台已闭合。

| 平台／作业 | 源码legacy | 同次安装legacy | 专项与原件 |
| --- | --- | --- | --- |
| Windows x64／119351026951 | 80通过／322跳过，7.3分钟 | 80通过／322跳过，6.6分钟 | 两阶段各6通过／12正常owner，报告与accepted摘要核对 |
| macOS arm64／119351027002 | 80通过／322跳过，8.3分钟 | 80通过／322跳过，7.8分钟 | 两阶段各6通过／12正常owner，报告与accepted摘要核对 |
| macOS x64／119351027536 | 待终态核对 | 待终态核对 | 尚未取得本阶段最终记录 |

专项为缩进、布局及四个首次文件模型场景。Root以Python标准库直接读取ZIP，核全条目CRC、准确head／runId／platform、原report SHA、approval SHA及首次文件manifest SHA；逐例单次passed、零失败／flaky／跳过／重试，每个原owner均confirmed／willQuit／closed，目录移除及零SQL／系统剪贴板成立。当前两平台四阶段共24专项／48个正常owner；不将重复平台次数当新功能数量。

## 下载与显示证据

GitHub连接器元数据绑定准确head且未过期；2026-10-22下载到忽略目录`.cache/ci-699-artifacts-20261022/`，实际字节与SHA-256匹配服务端digest，随后独立CRC检查。不是仅凭CI绿色或文件名接纳。

| artifact ID | 记录 | 字节 | ZIP SHA-256 |
| --- | --- | ---: | --- |
| 12363439612 | Windows测试 | 5365726 | `9768074578796cb768ba5cd60e4e7a3b2b0b0bcc6f8b318bd151b793a2117f2c` |
| 12365287495 | ARM测试 | 7870719 | `f08a121929d75b33cbd58ce48c0ee42de0693bc55a45c2f20a5d66397ff0f8b4` |
| 12364968307 | ARM显示租约 | 9947 | `34c5243ef805ada66b70b771fa6c951e3b6b7de6732d818ddeb739d3fa9b740a` |

ARM两阶段原keeper ready均实测1600×1200、可见1600×1091，restored均为1024×768；源码可见高675，安装可见高674，不能沿用旧回合统一674的数字。receipt均accepted且退出前恢复成立，`postKeeperExitRestoreObserved`、`artifactUploadConfirmed`仍false；原件真实上传由独立artifact元数据证明，不改写原receipt。

## 尚未覆盖

只下载测试和显示记录，未独立下载／重新安装本轮安装器；CI内部真实安装另有以上专项原记录。签名、公证和可选系统剪贴板未由本轮证明，未发布。

本轮是离线CI范围，未开启私网排序专项。该专项在[WIN11-TEST首轮](acceptance-query-sort-panel-699741b-failure-20261022.md)的应用前七行矩阵读取失败，原App及观察流关闭未知，不能以本轮离线源码／安装成功替代。后继62ba2c23仅增加有界读取诊断，产品src相同，但其实际窗口结果仍另记。完整工作包计数不增。
