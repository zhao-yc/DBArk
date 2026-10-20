# main f505f6b三平台原生CI与独立原件核对

## 固定身份与范围

准确提交 `f505f6b413d991dba8a383d97dc2f184fa43be82`，[CI39484974797](https://github.com/zhao-yc/DBArk/actions/runs/39484974797)。产品树仍 `675ffa2320aba0f55e21ccef2b2eee349531ff9c`，仅增加原生TestInfo守卫诊断及17项RAM回归。NULL排序、筛选快捷键及其合并候选不在此提交内，不能继承本次平台结果。

Root读取GitHub原日志与ZIP，在本机只做标准库数据静态审计；未执行类型、单元、应用、安装包或桌面测试。原[4dae140失败及Intel后继重跑](acceptance-main-4dae140-ci-20261021.md)分开保留。

## 已读原日志

| 范围 | 实际结果 |
| --- | --- |
| Linux job118842911856 | 类型／586文件11246通过、10平台跳过／构建通过；单元223.81秒，Vite32.37秒 |
| Windows job118842912367 | job成功；源码legacy80通过／315跳过、8.0分钟，未发行签名NSIS构建及同次真实安装完成；安装legacy80通过／315跳过、7.3分钟 |
| ARM job118842912369 | job成功；源码legacy80通过／315跳过、9.2分钟，同次DMG安装legacy80通过／315跳过、7.5分钟；六专项及两代显示租约原件另已独立核对如下 |
| Intel job118842912531 | job成功；源码legacy80通过／315跳过、12.2分钟，同次DMG安装legacy80通过／315跳过、10.9分钟；原脚本报告安装及临时目录清理 |

315跳过包含私网门与另行运行的专项，不能当作通过；专项计数也不与legacy80相加为功能或工作包完成数。没有发布、签名或Mac私网验收声明。

## Windows独立附件审计

artifact12294741814，5349325字节；Root下载到自有忽略目录，SHA256 `304df0e48ed0b17adfc486cf44c0dec7675af51daee8ff523176ec6ec4f82a0a` 与上传记录一致。ZIP共137项、解压大小5931935字节，CRC全部一致。仅在内存读取首次文件模型report／accepted及JSON附件，无程序解压或执行；静态摘要在 `.cache/ci-f505f6b-audit-20261021/windows-first-model-static-audit.json`，原件不入库。

- source/report.json：摘要 `9031485b037cef5380756fe3afe8aa6689cad8ceea0a0f94f30fb39ee958821f`；4通过、0失败／跳过／flaky，56.541892秒。
- installed/report.json：摘要 `6322bd73c8a2a1556b268e373cc8bb4f95434b58965a2526a769310fdf122eae`；4通过、0失败／跳过／flaky，64.458942秒。

两阶段accepted引用各自原report摘要，automaticRetry=false、cleanupAllowed=true。每阶段均完整覆盖LF／CRLF×按钮／快捷键四例，retry=0、accepted及directoryRemoved=true；各例两个正常owner均confirmed／willQuit／closed=true。全部八阶段记录含初始模型、普通编辑与一次Undo、格式化与一次Undo／Redo、最终Undo及独立重启clean；ordinarySingleUndo／formatSingleUndo=true，SQL执行、查询库写入、系统剪贴板均0。

后继还从同一ZIP独立核对Windows缩进及布局各一例／每阶段，原审批上下文均为f505f6b／39484974797／attempt1／win32 x64；report SHA与accepted匹配，原JSON proof逐项相等，0失败／跳过／flaky及零重试、正常退出／目录移除均成立。source indent／layout摘要分别为 `87d518071e985345ae11c611df83d9bd556d68dbd57901aac00c8989166fcc18`、`5a53ab1575563ffa12b6475ab3d40bff627d6567f319ed26edb2a763407071de`；installed分别为 `3a6ae1856e3360253724a8076f4d57d29e8a48e8fa07e425783722fcd2e19a2a`、`43b46e68e0c3311f76b1845c2c82eae91831aea7a7dd277f4556c9312d273711`。故Windows每阶段六项专项、12正常owner已核，不与legacy80合并计数；补充摘要为同目录windows-records-12294741814-native-audit.json。

## ARM独立附件与显示实测

测试记录artifact12294134443：7836317字节，SHA256 `d94cc371dffe0683c3c0eb4d8d7b2cef9c3fe9dd2b629460c1e0c76e8a9dfbdb`；137项、解压8447001字节。显示租约artifact12294389055：10487字节，SHA256 `fe23be96c560eb8fd67f63d69c3ed7e9477116ba61983d4982f2048859bb4b4f`；8项、解压773680字节。Root独立下载，两份上传摘要及全部CRC匹配，仅静态内存解析，没有执行程序。摘要保存在同一忽略审计目录的arm-native-static-audit.json、arm-display-static-audit.json。

原审批上下文逐项核对为f505f6b／run39484974797／attempt1／darwin arm64，Node24.21.0、Electron44.7.0、Playwright1.64.0。每阶段缩进1项、布局1项、首次文件模型4项均0失败／跳过／flaky，所有原测试retry=0，accepted的report摘要匹配；缩进／布局的proof还与原报告JSON附件逐项相等。两阶段各12个正常owner均confirmed／willQuit／closed=true，目录均已移除；四类文件模型均有原八阶段与独立重启，SQL及系统剪贴板0。这里不与legacy80相加为功能完成数。

| 原report | source SHA256 | installed SHA256 |
| --- | --- | --- |
| indent | d10477a3c3950f87d3fa42f0d98083c8c27276db32c15b0b73f833fda0bd0db8 | 5fec1dee768a0cac6f699dc62d360d8decdea0eea447c2d257e94f87723cd6bd |
| layout | 484b7e474028ce9773cf22a50ded9ec9c2de0bb6aadb8d62519827282c7f512d | b2a1bde52dcf6c78973d214b11d600990cbcbbadd30bc792a4f8336dde4697b6 |
| first-file-model | 0d1c0fcb0f74269884de6608bbb4cf1e4f1edfdfb352f5f17406cc7f595825dd | 7a9da8683e5c148e4c41a064f818c1c9f554ced826305382f13c8960dec7f010 |

两代独立nonce及连续seq已核，source175条、installed111条。实际模式均从1024×768（mode3）切到1600×1200（mode9），ready及全部pulse实测可见区域始终1600×1091，满足原1440×1050门槛；计划估值1600×1106不是实测。最后restored记录与原mode、frame和visibleFrame逐项相等，keeper正常退出0；只证明退出前恢复，postExitRestorationObserved仍false。原receipt的artifactUploadConfirmed仍false，上传由GitHub artifact-id／digest及本次独立下载另证；installed的originalFileCLIResult原值null，四例来自原打包脚本内部，不补造独立CLI。原断言不变，无应用强停或失败资源补清理。

## Intel独立附件与全轮终态

测试记录artifact12295536052：10652226字节，SHA256 `283e2027403e1a99427b389209e307d6db3e3ed352f876c4019ccfb601daac64`，与上传记录一致；137项、解压11429922字节，全部CRC匹配。Root只静态解析，原件和派生摘要intel-records-12295536052-native-audit.json均在忽略审计目录，不入库、不执行程序。

原source／installed审批上下文均为f505f6b／39484974797／attempt1／darwin x64。每阶段缩进1项、布局1项、文件模型4项，0失败／跳过／flaky和零重试；六份原report SHA与accepted匹配，缩进／布局proof与原JSON附件逐项相等。每阶段12正常owner的confirmed／willQuit／closed均true，全部目录移除，SQL及系统剪贴板0；文件模型四例均含八阶段、独立重启和两种一次Undo。

| 原report | source SHA256 | installed SHA256 |
| --- | --- | --- |
| indent | b9a823acbaef86bfdd617e3e01afdab74c2b988ecd3f4c95d5c6c699150eb575 | 4f310a3fd17a67d3b56a6106a38aa00a7a768e0a836a2c26bc5a8b371eb5c1d3 |
| layout | 9d4ece184aa6aa6664136ae78a38ad201af0da78b78d1a50714fc1bebbc88191 | 2d9ef9a8a42393d0317760d8cddffb7625187c1233565ab86c5163f940610541 |
| first-file-model | 36a45fd4f4307cf1b0a41befeb488983d4c9bf6d78e29ad7e0d5c8bb4abfc9d4 | 911dd936afe2bd55c17aa169f7813b27b7bd3e2c7251a225e259ec714f473e55 |

GitHub全轮API已另核head=f505f6b、attempt1、event=push、status=completed、conclusion=success；只闭合本轮明列的离线类型／完整单元、三平台源码／真实安装及专项。原私网条件跳过、未发行签名／公证、独立公开安装包下载及新功能组合范围不因此获得通过或发行授权。

## 未验与原失败

原4dae140 Windows安装第四例曾在联合守卫失败，具体分支未被原报告捕获；本次通过未触发新的失败诊断，不能倒推旧根因、追认旧owner退出或清理旧profile。WIN11-TEST六文件队列保持原5b4e7c3，连接不可访问期间不重复派发或改回本机。Mac私网及组合候选仍待准确Windows／私网窗口与独立文件读回，暂不发布，不增加完整Navicat工作包完成数。
