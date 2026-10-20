# main c40a97e 三平台原生 CI 与独立原件核对

## 固定身份与范围

准确提交 `c40a97ee8f05d743891b8663cbad50c3331db56e`，产品树 `ddd3c5182283266ada56517cbd7e044c0bb23293`；[CI39504142489](https://github.com/zhao-yc/DBArk/actions/runs/39504142489)，push、attempt1，API终态completed／success。

包含已交付的每列NULL位置与筛选快捷键源码；不包含后继文本排序大小写、复制条件及离线身份工具。Root只读取CI日志和ZIP做标准库静态审计，没有在开发机运行类型、单元、应用或安装器；原件均留在忽略缓存，不入库。

## 原日志结果

| 范围 | 实际结果 |
| --- | --- |
| Linux job118908705007 | 类型／587文件11275通过、10平台跳过／构建成功；单元142.48秒，Vite24.09秒 |
| Windows job118908704424 | 源码legacy80通过／316跳过，7.8分钟；同次NSIS实际安装legacy80通过／316跳过，7.3分钟 |
| ARM job118908705076 | 源码legacy80通过／316跳过，9.1分钟；同次DMG实际安装legacy80通过／316跳过，8.1分钟 |
| Intel job118908704902 | 源码legacy80通过／316跳过，10.2分钟；同次DMG实际安装legacy80通过／316跳过，9.7分钟 |

316项包含私网门及另行运行的专项，保持跳过；专项不与legacy80相加为功能完成数。发布及原生剪贴板job跳过，未发行签名，未创建标签或发布版本。

## 原件字节与 CRC

| 平台／artifact | 字节 | ZIP条目／解压字节 | SHA256 |
| --- | ---: | --- | --- |
| Windows x64／12303931923 | 5347667 | 137／5931271 | `607ffac4fff7c3b162f9624e615273461c6bd710e0c28ce8149cc52c561f950c` |
| macOS arm64／12304485861 | 7835294 | 137／8447873 | `6dde5044cfafd81c3d86b4928c274208d419cc0643233f8753dbf07b39afe794` |
| macOS x64／12303333836 | 10657088 | 137／11434848 | `e36dcc1333a45ce62524d47e4b4a18d0e650816e1f4401e0908f90b3204d8a71` |
| ARM显示租约／12304615837 | 10377 | 8／757714 | `a1f438434c7e85d30d5309d888bad42b5a9f790b658677ff2c417ecab0e46dff` |

四份下载长度及SHA均与上传metadata一致，全部ZIP CRC通过。只在内存读取JSON／附件，不解压或执行归档。审计摘要位于 `.cache/ci-c40a97e-audit-20261021/`；审计脚本限定准确提交、run、attempt及平台。

## 原生专项报告摘要

| 平台／阶段 | 缩进report | 分栏report | 首次文件模型report |
| --- | --- | --- | --- |
| Windows x64／source | `2870c3b58453719baeada15d2c5c3466f56310fcd47dd91f8dd7d22ed64ee7e6` | `26b6cfda84bab3f0368c125586ee14d02b0083f64a28e292b6f3b941c1001937` | `9f9d43e67dba41782c9a3a49983fe8c72a50e3f17902ac3765cee36186a40574` |
| Windows x64／installed | `a11cd58c10541bce9cf519a8f0bc5d4a86914807a6ec39b0a6463c20e8224d48` | `b971979be9f78eba3872e14fe6dbf91bb825dda6edfad446b6f34ce78d90c440` | `c0e6387e8ced020dbd65ff709a52714bd5db1b0f39a656152ef69a1250450fae` |
| macOS arm64／source | `764ad4d92c9956581e4a6703aefcbfa03520afd65eb6c8dc361abc1d24eacf5c` | `fff295df4471d7263425fdfef589c1267ef70befbed7c3c146af3f910ad12d08` | `d32414511d5832ff3e2988b69ca6f76acabee84cb44d92f5277ffd0b257b059f` |
| macOS arm64／installed | `2b17861199e4fb2ed60767a816a24c6498bf6bd526141fcec08d5da0f8c15306` | `77b8b2b28dd9a77d38dd052efdbc575939b880a730857ea6b6811b84f2933830` | `68203d82167e24ce983d67c9e8564daa9cc7649a3289cf126615d0d0e147ea9c` |
| macOS x64／source | `9952b609d39f5f356b83a0b0ae8b2fdb4c330a228c6b19f8fa7c07f32752b79f` | `dd5ca4d22a99428670086771cee98e6f665437130e6a3fdacde2576ab5601d3a` | `f28e5ec5f28b0455becce463b84e93f26bce209d80ccac1b451091fb88e6c0d1` |
| macOS x64／installed | `26fe783d43929dfc0923f04c8190899a53dc4ea6bb54b7af127932035924dea7` | `3a8accea16fe701cdefbb068a92024c51bbeaf45f45fa75116601c6bdc84d7fd` | `0bc69fc732b426705758dd8d6d0781fff114dabf99fa410626ccd66965fd9e3b` |

每个平台每阶段均为缩进1项、分栏1项、首次文件模型4项；原report摘要与accepted匹配，JSON proof逐项相等，零重试、失败／跳过／flaky为0。每阶段12个正常owner均confirmed／willQuit／closed=true，目录移除；SQL执行和系统剪贴板均0。四文件用例覆盖LF／CRLF×按钮／快捷键、普通与格式化单次Undo、Redo及独立重启clean，不转作私网驱动或系统键盘证据。

## ARM显示租约

source／installed为两份独立nonce，连续序号分别止于179／101。原模式3、frame1024×768、visible1024×674；ready及全部pulse实测模式9、frame1600×1200、visible1600×1091。计划估计1600×1106不是实测值。两阶段均在keeper退出0之前恢复原模式、frame及visible，applicationForceStop=false。

原receipt的artifactUploadConfirmed=false、postKeeperExitRestoreObserved=false和原事件postExitRestorationObserved=false保持原值；上传由独立artifact下载、长度与SHA另证，不回填receipt。installed.originalFileCLIResult=null，四文件由安装脚本内执行，未伪造额外独立CLI；六专项的原report／accepted另已逐份核对。

## 未验边界

本轮是CI中的离线源码及同次实际安装范围，不是Root独立下载安装包，也不是新NULL／筛选快捷键在macOS或安装版的私网GUI矩阵。Windows13384组合、独立文件读回和完整11284通过／1平台跳过[单独记录](acceptance-query-result-sort-filter-3fedb46-20261021.md)。后继1f8窗口的query.execute失败和收尾未知另线保留，本次成功不解释或修复它。

签名、公证、系统输入、原生输入法和其它数据库／故障矩阵不外推；旧4dae140／fcc及其它失败不追认。Navicat工作包仍为部分，不增加公开发行计数，暂不发布。
