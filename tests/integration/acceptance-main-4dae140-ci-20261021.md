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
| ARM macOS job118818415384 | job成功；源码legacy80通过／315跳过、8.8分钟，同次DMG真实安装legacy80通过／315跳过、7.5分钟 |

首次Intel单job重试请求被GitHub以“整轮仍在运行”拒绝，没有启动新attempt。ARM完成后，Root仅请求重跑原Intel失败job，已被接受；attempt2的新Intel job118833967012正在运行，尚无客户端或安装终态。原下载失败保留，Windows已证安装失败不重写为通过；其他job的沿用状态也不另加验收计数，暂不发布。

## Windows原件静态审计

artifact12291407597，2720467字节，SHA256 `69fb11b5ed24d30bf25284bbe3b78303e60b16f539827005fb1e050a40a9245a` 与上传记录一致。Root实际下载到自有忽略目录，91项、解压3157461字节，全部CRC一致；没有解压执行程序或改写原件。静态摘要保留于 `.cache/ci-4dae140-audit-20261021/windows-first-model-static-audit.json`，不将原日志或ZIP入库。

首次文件模型source/report.json的原摘要 `cc2f3fcd653fbfefa126588f711b644fccac1c348635b203a5707c9b09520414`：四例通过、无跳过／重试／flaky。LF／CRLF×按钮／快捷键均含原编辑、普通Undo、格式化Undo／Redo、最终Undo与独立重启；八个owner均报告confirmed／willQuit／closed，四个目录removed。该专项与legacy计数分开，不相加为功能完成数。

installed/report.json原摘要 `db523c2e4ce1a85fbab23bd238e4a2499c8164fc9cc7cf90fb47a602e9bfa879`：三例通过、一例失败、无跳过／重试／flaky。前三例各有两个正常owner及目录移除证明。第四例crlf-shortcut已记录初始模型、普通编辑及Undo、格式化及Undo／Redo、最终Undo且clean；仅有第一owner正常关闭记录，随后独立重启的preflight在editor-indentation-native-gate.ts:43联合守卫失败。

第四例没有第二owner或独立重启成功证明，directoryRemoved=false、accepted缺项，原failure.json明确automaticRetry／automaticForceStop／cleanupAllowed均false。错误同时检查TestInfo身份、开始时间、时钟顺序、原120秒及状态；没有记录具体失效分支，不能按12.898秒的案例时长推断超时、时钟回退或产品内容故障。保留原失败和现场，不放宽守卫或原断言换取通过。

Windows helper安装资源摘要475b78748fcf1f9990c58d5926792ae978de71d1962f2e729805f0c35af45606已由原脚本核对，未执行协议。当前没有完整Windows同次安装legacy或Intel终态通过证据。ARM常规源码／安装日志已通过，但本次没有独立下载ARM专项附件，也没有新通配私网或NULL排序能力的macOS窗口证据；不增加发行、完整工作包或新功能平台通过计数。

## 后继守卫诊断

`72c0950c3b214feedb688ca7e06f15666494e4c4` 仅修改测试守卫和新增RAM回归：原联合条件按原短路次序逐项检查，错误补充首个失败分支与已捕获的start／instant／previous／deadline。诊断不额外读取TestInfo字段，不输出标题、SQL、路径或任意状态值，不修改120秒期限、环境检查、失效永久保留、重试或清理规则。上游环境异常对象仍直接上抛。

新增17项RAM用例检查失败分支、原时钟、失效后输入恢复仍拒绝、状态getter读取次数、成功路径属性读取次序和失败短路。静态审查及 `git diff --check` 通过；准确72c0950的[Linux CI39483984163](https://github.com/zhao-yc/DBArk/actions/runs/39483984163)、job118839526773已成功，Root实际读取原日志：类型／586文件11246项通过、10平台跳过／构建通过，单元235.59秒，新增17项全部通过，Vite35.72秒。本机未运行测试或桌面。该分支的原生、剪贴板和发布job均跳过，不能作为Windows／macOS实际守卫失败诊断或新安装验收。

该候选不解释旧Windows失败，也不恢复或清理旧profile。NULL排序窗口准备失败仍由WIN11-TEST在固定fcc8530现场独立取证，不切换其提交、不重复原队列；原失败断言与期限不变。暂不发布。

守卫诊断按main交付f505f6b413d991dba8a383d97dc2f184fa43be82后，[原生CI39484974797](https://github.com/zhao-yc/DBArk/actions/runs/39484974797)的Linux job118842911856另已通过。Root实际读取原日志：类型、586文件11246通过／10平台跳过、构建通过，单元223.81秒，Vite32.37秒；17项诊断测试已包含在完整计数中。产品树仍675ffa2320aba0f55e21ccef2b2eee349531ff9c。Windows、ARM及Intel原生job尚在执行，此处不记为全平台通过，原4dae安装失败不被覆盖。

## 原4dae140的Intel单job重跑终态

attempt2的Intel job118833967012已成功。Root读取原日志：源码legacy80通过／315跳过、11.1分钟；同次未发行签名DMG真实安装legacy80通过／315跳过、9.9分钟，原脚本报告本次安装及临时目录清理。原下载失败仍保留，重跑来源仍是4dae140，不归到后继f505f6b或NULL／快捷键候选。

Root另下载测试记录artifact12294007618到自有忽略目录：10656813字节，SHA256 `492d073c81e1716706759b9dc5ca182961b9dda92db45b9851f90a9f8f3caa45` 与上传记录一致。ZIP共137项、解压大小11435771字节，全部CRC一致；仅在内存解析报告及JSON附件，没有解压执行程序。静态审计摘要位于 `.cache/ci-4dae140-audit-20261021/intel-first-model-static-audit.json`，原件不入库。

source/report.json摘要 `e9dea6de3664a64e7a3f2385dc5e4e514540982f0296bc5ad723a804ecd48118`，4通过、0跳过／失败／flaky，74.208秒。installed/report.json摘要 `77cdbee44135913703c05248fd40d65a375311706170971a5e8b051c73141867`，4通过、0跳过／失败／flaky，88.981453秒。两阶段accepted均引用各自原report摘要，automaticRetry=false；每阶段LF／CRLF×按钮／快捷键四例均retry=0、accepted及directoryRemoved=true，各有两个confirmed／willQuit／closed正常owner。逐例均记录初始模型、普通编辑与一次Undo、格式化与一次Undo／Redo、最终Undo及独立重启clean；ordinarySingleUndo／formatSingleUndo=true，SQL执行、查询库写入和系统剪贴板均为0。

这八项专项与两组legacy80分别记录，不作为额外工作包完成数。只完成Intel本次离线源码／真实安装范围；原Windows安装失败仍未通过，Mac私网驱动及NULL排序、筛选快捷键能力未据此验收，暂不发布。
