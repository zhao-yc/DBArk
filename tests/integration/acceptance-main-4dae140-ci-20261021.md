# main4dae140原生CI检查点与失败原件

## 准确源码与读取边界

固定 `4dae140d7cd0b497c95847cb4689d6c800e41aa8`，[CI39477866564](https://github.com/zhao-yc/DBArk/actions/runs/39477866564)，产品树675ffa2320aba0f55e21ccef2b2eee349531ff9c。通配源码的Windows实库／独立读回／完整单元[另有准确记录](acceptance-query-result-wildcard-63fb0f6-20261021.md)；本原生CI和安装结果分别记录，不由此前0ee5886或后继NULL候选代替。

Root仅读取GitHub原日志、下载ZIP并用Python标准库静态解析数据，没有在本机运行应用、安装包或测试。

## 已读取的原job

| 范围 | 原始结果 |
| --- | --- |
| Linux job118818415455 | 类型／585文件11229通过、10平台跳过／构建通过；单元231.14秒，Vite33.72秒 |
| Windows job118818415259 | 源码legacy80通过／315跳过、7.3分钟，NSIS打包完成；安装阶段文件首次模型3通过／1失败，后序未完成，job失败 |
| Intel macOS job118818415026 | 安装依赖通过，在install-electron下载阶段报Undici TypeError: terminated，job失败；客户端构建／桌面和安装测试未到达 |
| ARM macOS job118818415384 | 最后一次读取仍在运行，没有据此验收终态 |

Intel单job重试请求被GitHub以“整轮仍在运行”拒绝，没有启动新attempt；当前保留原下载失败，等待当前运行终态。Windows失败与Intel下载问题分开，不凭重跑计划将原job改成成功，暂不发布。

## Windows原件静态审计

artifact12291407597，2720467字节，SHA256 `69fb11b5ed24d30bf25284bbe3b78303e60b16f539827005fb1e050a40a9245a` 与上传记录一致。Root实际下载到自有忽略目录，91项、解压3157461字节，全部CRC一致；没有解压执行程序或改写原件。静态摘要保留于 `.cache/ci-4dae140-audit-20261021/windows-first-model-static-audit.json`，不将原日志或ZIP入库。

首次文件模型source/report.json的原摘要 `cc2f3fcd653fbfefa126588f711b644fccac1c348635b203a5707c9b09520414`：四例通过、无跳过／重试／flaky。LF／CRLF×按钮／快捷键均含原编辑、普通Undo、格式化Undo／Redo、最终Undo与独立重启；八个owner均报告confirmed／willQuit／closed，四个目录removed。该专项与legacy计数分开，不相加为功能完成数。

installed/report.json原摘要 `db523c2e4ce1a85fbab23bd238e4a2499c8164fc9cc7cf90fb47a602e9bfa879`：三例通过、一例失败、无跳过／重试／flaky。前三例各有两个正常owner及目录移除证明。第四例crlf-shortcut已记录初始模型、普通编辑及Undo、格式化及Undo／Redo、最终Undo且clean；仅有第一owner正常关闭记录，随后独立重启的preflight在editor-indentation-native-gate.ts:43联合守卫失败。

第四例没有第二owner或独立重启成功证明，directoryRemoved=false、accepted缺项，原failure.json明确automaticRetry／automaticForceStop／cleanupAllowed均false。错误同时检查TestInfo身份、开始时间、时钟顺序、原120秒及状态；没有记录具体失效分支，不能按12.898秒的案例时长推断超时、时钟回退或产品内容故障。保留原失败和现场，不放宽守卫或原断言换取通过。

Windows helper安装资源摘要475b78748fcf1f9990c58d5926792ae978de71d1962f2e729805f0c35af45606已由原脚本核对，未执行协议。当前没有完整Windows同次安装legacy通过证据，也没有Intel或ARM终态接纳；不增加发行、完整工作包或新平台功能通过计数。
