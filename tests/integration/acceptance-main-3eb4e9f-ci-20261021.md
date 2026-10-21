# main 3eb4e9f 三平台原生 CI 与原件核对

## 固定身份与范围

准确提交 `3eb4e9fe22e3f5bd38e9c9961b2fd18320cbc553`，产品树 `585875a1c1dc39062cf65969a6f063342809536c`；[CI39531540729](https://github.com/zhao-yc/DBArk/actions/runs/39531540729)，push、attempt1。四个实际执行的 job 均 completed／success；原生剪贴板和发布 job 为 skipped。

本批 main 交付结果排序每列文本大小写、复制筛选条件和小数简写，具体 Windows 私网组合及独立读回见[338 准确验收](acceptance-query-result-sort-case-338a06b-20261021.md)。不包含后继 Q01 窗口帧补全。Root 本轮只读取 CI 日志与 ZIP，未在开发机运行产品测试、应用或安装器；测试原件保留在忽略缓存。

## 原日志结果

| 范围 | 实际结果 |
| --- | --- |
| Linux job118998334407 | Python21通过、0.299秒；类型／591文件11380通过、10平台跳过／构建成功；单元137.24秒，Vite23.42秒 |
| Windows job118998334428 | 源码legacy80通过／317跳过，6.4分钟；同次NSIS实际安装legacy80通过／317跳过，6.4分钟 |
| macOS arm64 job118998334489 | 源码legacy80通过／317跳过，9.0分钟；同次DMG实际安装legacy80通过／317跳过，6.9分钟 |
| macOS x64 job118998334441 | 源码legacy80通过／317跳过，8.4分钟；同次DMG实际安装legacy80通过／317跳过，8.9分钟 |

317项包含私网门及另行运行的专项，保持跳过；专项不与legacy80相加为功能完成数。未发行签名，未创建标签或发布版本。

## 原件字节与 CRC

| 平台／artifact | 字节 | ZIP条目／解压字节 | SHA256 |
| --- | ---: | --- | --- |
| Windows x64／12316551453 | 5351083 | 137／5933105 | `35e6d041723b3a00e9a48a2190d75a7dd63afd37d54c54457a8c280a322ec087` |
| macOS arm64／12317065258 | 7837598 | 137／8447866 | `65af91bcaa18e3e6d648cac7eed49278f0f69e4aab7400ff58985f478e81fa5c` |
| macOS x64／12316861272 | 10657582 | 137／11435034 | `b9bdf355c37ed80c24ac926a1893ec4587e9df6c128328a8a559b80a9ea605c4` |
| ARM显示租约／12317075337 | 10429 | 8／765705 | `bb3c9129160270eacef627032b239e2b64b420d3b3c0cab7ea4eba82e2b7af05` |

四份下载长度及SHA与上传metadata一致，全部ZIP CRC通过。只在内存读取报告和附件，不解压或执行归档。Intel记录首次下载网络超时退出，之后只重试不可变归档下载，未重跑测试。审计摘要位于 `.cache/ci-3eb4e9f-audit-20261021/`，未将归档、日志或构建产物提交仓库。

## 六专项原报告摘要

| 平台／阶段 | 缩进report | 分栏report | 首次文件模型report |
| --- | --- | --- | --- |
| Windows x64／source | `6aea6637b4bea62deb55e60e87539113c4bd74651a0d6efa27f4d0bb3fb02efa` | `bacf241a67f35c92c3843f4a9810cdbf706ffd2d3cfd88526d256f3ed59124eb` | `765d6e34b01bf6d94fa57e10190d7def7d43e1e903b1e9dec6322fc857334a7a` |
| Windows x64／installed | `83bce3a6294353affd128cd231472662e20e91272e8b06df8d1ac16d29af057e` | `1c38347c02175e8b9941a84e6fff5b70f02fa05270ab548526cf5521cd130b3b` | `04a9b384c1e1f67401acf68d47285ca42abde2b8de143dad3461ee45b3b6a152` |
| macOS arm64／source | `fafa615ac6c2eb701744701e5751acd78c15de9bd9d4f7240f55eec8d1e094d5` | `565d3de03e04f021a364d1ea893d8651ea328ece5af8701ff92083effd9e9f5a` | `1bcdca175da7826ced37882b5ec57d13c5a0cdc9924cbdba286d5b6498e98b1f` |
| macOS arm64／installed | `23767775c124605c3c3f628623ddc6858d1974b408fc12199b76dca45e66a8a7` | `94f0cdc6b2ba9b77ef958451f70c202ceae2529a342e0601d04431d1e68cfc5a` | `9c03afb7636b78246d7b78195dfa0aab2949b2a5314dc9b0cbad1186dd7062f3` |
| macOS x64／source | `f23c9e7ad4eee041bf3b6d355f724fcf5a604536966428e26e2f1c766242aa18` | `47cca5d61bf1eb994ef0af5304ff7a88058a78b7f55d28c23a87c5b5222564c8` | `41f8ed2cfc2fff56c768f3e3b4e28363de131e5f7bf0c3837dca1fc3cbbbbb56` |
| macOS x64／installed | `936aaffd9235ff164b9def4aa599e15be3d6c9ef01a9eb8a047a88b3f1620311` | `2f525e0fdcc1e963f4a057cb0301c4899fe404b6cab9059516fa97eaec670ede` | `e72d2f8aae0125f1d90d742dbf614c5953ff40e48eb597452cbb076ad4abf0b2` |

每个平台每阶段为缩进1项、分栏1项、首次文件模型4项，均零重试、零失败／跳过／flaky。原report字节摘要与accepted一致，approval、context、completed及JSON proof逐项核对通过。每阶段12个正常owner均confirmed／willQuit／closed=true，临时目录移除；SQL执行、系统剪贴板均0。四文件用例覆盖LF／CRLF×按钮／快捷键、普通与格式化单次Undo、Redo以及独立重启clean，不转作私网驱动或系统键盘证据。

## ARM显示租约

source／installed使用独立nonce，原序号连续且分别止于192／91。原模式3、frame1024×768、visible1024×674；ready及全部pulse实测模式9、frame1600×1200、visible1600×1091，满足原计划下限。计划估计1600×1106不作为实测值。两阶段都在keeper退出0前恢复原模式、frame和visible；applicationForceStop=false。

原receipt的artifactUploadConfirmed=false、postKeeperExitRestoreObserved=false及其它原false字段保持不变，上传由独立下载长度／SHA另证。installed.originalFileCLIResult=null，四文件由原安装脚本内部执行，不伪造独立CLI结果；专项原report另已逐份核对。

## 未验边界

本轮是CI离线源码与同次实际安装范围，不是Root独立下载安装包，也不是排序大小写／复制条件在macOS或安装版的私网GUI矩阵。Windows13384真实组合、原CSV／JSON独立读回和完整11389通过／1POSIX跳过单独记录；原7f高度、1f8排序规则及首次Python读回失败仍保留，不用本次成功解释旧unknown。

签名、公证、系统输入、输入法及其它驱动／故障矩阵不外推。后继Q01另留开发分支，其Windows准备与凭据误输出事件另线处理，本CI不证明该事件已处置。Navicat工作包保持部分，不增加完整包或公开发行计数，暂不发布。
