# main f505f6b原生CI与Windows原件核对

## 固定身份与范围

准确提交 `f505f6b413d991dba8a383d97dc2f184fa43be82`，[CI39484974797](https://github.com/zhao-yc/DBArk/actions/runs/39484974797)。产品树仍 `675ffa2320aba0f55e21ccef2b2eee349531ff9c`，仅增加原生TestInfo守卫诊断及17项RAM回归。NULL排序、筛选快捷键及其合并候选不在此提交内，不能继承本次平台结果。

Root读取GitHub原日志与ZIP，在本机只做标准库数据静态审计；未执行类型、单元、应用、安装包或桌面测试。原[4dae140失败及Intel后继重跑](acceptance-main-4dae140-ci-20261021.md)分开保留。

## 已读原日志

| 范围 | 实际结果 |
| --- | --- |
| Linux job118842911856 | 类型／586文件11246通过、10平台跳过／构建通过；单元223.81秒，Vite32.37秒 |
| Windows job118842912367 | job成功；源码legacy80通过／315跳过、8.0分钟，未发行签名NSIS构建及同次真实安装完成；安装legacy80通过／315跳过、7.3分钟 |
| ARM job118842912369 | 原安装六专项显示租约步骤仍在执行，尚无本次终态 |
| Intel job118842912531 | 原test:packaged仍在执行，尚无本次终态 |

315跳过包含私网门与另行运行的专项，不能当作通过；专项计数也不与legacy80相加为功能或工作包完成数。没有发布、签名或Mac私网验收声明。

## Windows独立附件审计

artifact12294741814，5349325字节；Root下载到自有忽略目录，SHA256 `304df0e48ed0b17adfc486cf44c0dec7675af51daee8ff523176ec6ec4f82a0a` 与上传记录一致。ZIP共137项、解压大小5931935字节，CRC全部一致。仅在内存读取首次文件模型report／accepted及JSON附件，无程序解压或执行；静态摘要在 `.cache/ci-f505f6b-audit-20261021/windows-first-model-static-audit.json`，原件不入库。

- source/report.json：摘要 `9031485b037cef5380756fe3afe8aa6689cad8ceea0a0f94f30fb39ee958821f`；4通过、0失败／跳过／flaky，56.541892秒。
- installed/report.json：摘要 `6322bd73c8a2a1556b268e373cc8bb4f95434b58965a2526a769310fdf122eae`；4通过、0失败／跳过／flaky，64.458942秒。

两阶段accepted引用各自原report摘要，automaticRetry=false、cleanupAllowed=true。每阶段均完整覆盖LF／CRLF×按钮／快捷键四例，retry=0、accepted及directoryRemoved=true；各例两个正常owner均confirmed／willQuit／closed=true。全部八阶段记录含初始模型、普通编辑与一次Undo、格式化与一次Undo／Redo、最终Undo及独立重启clean；ordinarySingleUndo／formatSingleUndo=true，SQL执行、查询库写入、系统剪贴板均0。

## 未验与原失败

原4dae140 Windows安装第四例曾在联合守卫失败，具体分支未被原报告捕获；本次通过未触发新的失败诊断，不能倒推旧根因、追认旧owner退出或清理旧profile。本记录只证明本次离线源码／真实安装路径通过。ARM／Intel终态及其独立专项原件另待核对；WIN11-TEST六文件队列保持原5b4e7c3，连接不可访问期间不重复派发或改回本机。组合候选仍待准确Windows／私网窗口及独立文件读回，暂不发布。
