# main f505f6b原生CI与Windows原件核对

## 固定身份与范围

准确提交 `f505f6b413d991dba8a383d97dc2f184fa43be82`，[CI39484974797](https://github.com/zhao-yc/DBArk/actions/runs/39484974797)。产品树仍 `675ffa2320aba0f55e21ccef2b2eee349531ff9c`，仅增加原生TestInfo守卫诊断及17项RAM回归。NULL排序、筛选快捷键及其合并候选不在此提交内，不能继承本次平台结果。

Root读取GitHub原日志与ZIP，在本机只做标准库数据静态审计；未执行类型、单元、应用、安装包或桌面测试。原[4dae140失败及Intel后继重跑](acceptance-main-4dae140-ci-20261021.md)分开保留。

## 已读原日志

| 范围 | 实际结果 |
| --- | --- |
| Linux job118842911856 | 类型／586文件11246通过、10平台跳过／构建通过；单元223.81秒，Vite32.37秒 |
| Windows job118842912367 | job成功；源码legacy80通过／315跳过、8.0分钟，未发行签名NSIS构建及同次真实安装完成；安装legacy80通过／315跳过、7.3分钟 |
| ARM job118842912369 | job成功；源码legacy80通过／315跳过、9.2分钟，同次DMG安装legacy80通过／315跳过、7.5分钟；六专项及两代显示租约原件另已独立核对如下 |
| Intel job118842912531 | 原test:packaged仍在执行，尚无本次终态 |

315跳过包含私网门与另行运行的专项，不能当作通过；专项计数也不与legacy80相加为功能或工作包完成数。没有发布、签名或Mac私网验收声明。

## Windows独立附件审计

artifact12294741814，5349325字节；Root下载到自有忽略目录，SHA256 `304df0e48ed0b17adfc486cf44c0dec7675af51daee8ff523176ec6ec4f82a0a` 与上传记录一致。ZIP共137项、解压大小5931935字节，CRC全部一致。仅在内存读取首次文件模型report／accepted及JSON附件，无程序解压或执行；静态摘要在 `.cache/ci-f505f6b-audit-20261021/windows-first-model-static-audit.json`，原件不入库。

- source/report.json：摘要 `9031485b037cef5380756fe3afe8aa6689cad8ceea0a0f94f30fb39ee958821f`；4通过、0失败／跳过／flaky，56.541892秒。
- installed/report.json：摘要 `6322bd73c8a2a1556b268e373cc8bb4f95434b58965a2526a769310fdf122eae`；4通过、0失败／跳过／flaky，64.458942秒。

两阶段accepted引用各自原report摘要，automaticRetry=false、cleanupAllowed=true。每阶段均完整覆盖LF／CRLF×按钮／快捷键四例，retry=0、accepted及directoryRemoved=true；各例两个正常owner均confirmed／willQuit／closed=true。全部八阶段记录含初始模型、普通编辑与一次Undo、格式化与一次Undo／Redo、最终Undo及独立重启clean；ordinarySingleUndo／formatSingleUndo=true，SQL执行、查询库写入、系统剪贴板均0。

## ARM独立附件与显示实测

测试记录artifact12294134443：7836317字节，SHA256 `d94cc371dffe0683c3c0eb4d8d7b2cef9c3fe9dd2b629460c1e0c76e8a9dfbdb`；137项、解压8447001字节。显示租约artifact12294389055：10487字节，SHA256 `fe23be96c560eb8fd67f63d69c3ed7e9477116ba61983d4982f2048859bb4b4f`；8项、解压773680字节。Root独立下载，两份上传摘要及全部CRC匹配，仅静态内存解析，没有执行程序。摘要保存在同一忽略审计目录的arm-native-static-audit.json、arm-display-static-audit.json。

原审批上下文逐项核对为f505f6b／run39484974797／attempt1／darwin arm64，Node24.21.0、Electron44.7.0、Playwright1.64.0。每阶段缩进1项、布局1项、首次文件模型4项均0失败／跳过／flaky，所有原测试retry=0，accepted的report摘要匹配；缩进／布局的proof还与原报告JSON附件逐项相等。两阶段各12个正常owner均confirmed／willQuit／closed=true，目录均已移除；四类文件模型均有原八阶段与独立重启，SQL及系统剪贴板0。这里不与legacy80相加为功能完成数。

| 原report | source SHA256 | installed SHA256 |
| --- | --- | --- |
| indent | d10477a3c3950f87d3fa42f0d98083c8c27276db32c15b0b73f833fda0bd0db8 | 5fec1dee768a0cac6f699dc62d360d8decdea0eea447c2d257e94f87723cd6bd |
| layout | 484b7e474028ce9773cf22a50ded9ec9c2de0bb6aadb8d62519827282c7f512d | b2a1bde52dcf6c78973d214b11d600990cbcbbadd30bc792a4f8336dde4697b6 |
| first-file-model | 0d1c0fcb0f74269884de6608bbb4cf1e4f1edfdfb352f5f17406cc7f595825dd | 7a9da8683e5c148e4c41a064f818c1c9f554ced826305382f13c8960dec7f010 |

两代独立nonce及连续seq已核，source175条、installed111条。实际模式均从1024×768（mode3）切到1600×1200（mode9），ready及全部pulse实测可见区域始终1600×1091，满足原1440×1050门槛；计划估值1600×1106不是实测。最后restored记录与原mode、frame和visibleFrame逐项相等，keeper正常退出0；只证明退出前恢复，postExitRestorationObserved仍false。原receipt的artifactUploadConfirmed仍false，上传由GitHub artifact-id／digest及本次独立下载另证；installed的originalFileCLIResult原值null，四例来自原打包脚本内部，不补造独立CLI。原断言不变，无应用强停或失败资源补清理。

## 未验与原失败

原4dae140 Windows安装第四例曾在联合守卫失败，具体分支未被原报告捕获；本次通过未触发新的失败诊断，不能倒推旧根因、追认旧owner退出或清理旧profile。本记录只证明本次明列的离线源码／真实安装路径通过。Intel终态及其独立专项原件另待核对；WIN11-TEST六文件队列保持原5b4e7c3，连接不可访问期间不重复派发或改回本机。Mac私网及组合候选仍待准确Windows／私网窗口与独立文件读回，暂不发布。
