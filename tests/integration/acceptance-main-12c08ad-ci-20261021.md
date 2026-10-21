# main 12c08ad 三平台 CI 与原件核对

## 固定身份与范围

准确源码 `12c08ad52a638bfced8101c71bfdb4cb84071765`，产品树 `7ad1c2e8a71ff6de9fc4bba933584960174f96a7`；[CI39539815211](https://github.com/zhao-yc/DBArk/actions/runs/39539815211)，push、attempt1。类型单元与三个原生job均completed／success；原生剪贴板及发布job为skipped，未创建标签或发布版本。

包含筛选条件启停源码，不包含后继904新增的启停实库组合步骤或c449的Q01整合。Root只读取日志与ZIP并运行标准库静态审计，没有下载执行安装器；归档和原日志留在忽略缓存。

## 原日志结果

| 范围 | 实际结果 |
| --- | --- |
| Linux job119024747003 | Python21项、0.267秒；类型／592文件11398通过、10平台跳过／构建成功；Vitest134.98秒，Vite21.85秒 |
| Windows job119024746686 | source legacy80通过／317跳过，7.6分钟；同次NSIS实际安装legacy80通过／317跳过，7.5分钟 |
| macOS arm64 job119024746950 | source legacy80通过／317跳过，8.0分钟；同次DMG实际安装legacy80通过／317跳过，6.4分钟 |
| macOS x64 job119024747052 | source legacy80通过／317跳过，11.0分钟；同次DMG实际安装legacy80通过／317跳过，8.4分钟 |

317项包括私网门及另行运行的专项，不改成通过。专项不与legacy80相加为功能完成数；离线安装流程不代替启停条件的专用实库GUI。

## 原件长度、SHA 与 CRC

| 平台／artifact | 字节 | ZIP条目／解压字节 | SHA256 |
| --- | ---: | --- | --- |
| Windows x64／12319389849 | 5350611 | 137／5932650 | `e5a6999533efa8e1cf5f3bb390f364e71a82dde79d892a06bf5cbbc79192868a` |
| macOS arm64／12319148344 | 7839468 | 137／8450229 | `d5fbb56683891d270b3a9882495e90f0ffcddb924c4d04048716d96decf94a78` |
| macOS x64／12319844022 | 10657286 | 137／11434814 | `601da271a06b6d1bd7a9fee8600807279dd0461bf7d9646b6d594a03f477c283` |
| ARM显示租约／12320200089 | 9980 | 8／699185 | `d67d2daa61582ddf7234d157f59e49d1f1167f78d3647bfd20b424df3aee5a6b` |

四份下载长度及SHA与上传metadata相同，全部ZIP CRC通过；没有解压或执行归档内容。平台报告context固定原commit／run／attempt／platform／arch；原report字节SHA与accepted匹配，approval和completed中的proof逐项相等。

## 原专项报告摘要

| 平台／阶段 | 缩进report | 分栏report | 首次文件模型report |
| --- | --- | --- | --- |
| Windows x64／source | `3416a29a6fc462633d0e588667c7575ce8c445e42ca452bd1a7837ff8ac0194c` | `1a67ae3069b14bc4ef1cd0d3c0c8e604b6ba952121f31dfe9f6d85df93fe1a37` | `eb070bb6131acf31ea1f6b5f3d19e25e4f22183fc114b4715c8e87d8832cdc44` |
| Windows x64／installed | `8ef8f10946541f1712ffad523583b482e631a03ce244aeb5a17809108a8724dc` | `147751f76ea7126c311d8eb76d18a2d203cd2d0c1db53293703efb158437e150` | `7a2e00cf894ee371d445641083f0349629c6c027703c9cf7519e5ce7cc3d6c0b` |
| macOS arm64／source | `b46fd0dccf61132e46978b05f284730daf2586cc8b259ba281b31d3cb03806e6` | `429d064f18da78b5ad409aa3d38b2d95932cc137c445998d100d61e5b6aed95c` | `c48073f41f61f2434da08c7a26a4917ecd5ed50414aadf43563ed2af1a35fd8f` |
| macOS arm64／installed | `7b8033ca4d5f9147adc66147684f33bc6c342f1a9ac2301c8fcb1345793e82bd` | `5ae3747662ab4698ce6863fd8aa9b293f900599c92527a081752926062f9eecb` | `28f566d879d0fe4a7c0b3c03c5114c92b73a0c650bdf1f402e340427bba9fcdb` |
| macOS x64／source | `0f436d1c883ed625ce457ee09a39298f60ce1572a6fdc89e13c11a3e4c2d5b0e` | `8b5ce073ba8c4700ef7802bdea211cef773019a55fe6ca756aeb5405ce98869b` | `92c89494e89e6e8056dab7febfd8f08cd59521e2da4f5f34171359d1eb469b1a` |
| macOS x64／installed | `e3e1fd19947eac011ac813b547b99172ff81ec6e2b0e3a65784bb461b8a8b2a5` | `e7a555bf3aeba5680ca253ccf40025f58fe90afc0358c078fcb3a78a79b043a8` | `9c10ff135776f6e213656ca4ac4bd19278aa400597f56d9908480f4f0fb1324b` |

每平台每阶段缩进1项、分栏1项、首次文件模型4项均通过，零重试、失败／跳过／flaky为0。每阶段12个正常owner均confirmed／willQuit／closed=true，目录移除；SQL执行及系统剪贴板均0。四文件覆盖LF／CRLF×按钮／快捷键、普通及格式化单次Undo／Redo与独立重启clean，不作为系统键盘、输入法或新启停GUI证据。

## ARM 显示租约

source／installed为独立nonce，序号连续并分别止于172／86。原模式3、frame1024×768、visible1024×674；ready及全部pulse实测模式9、frame1600×1200、visible1600×1091，满足原计划下限；计划估计1600×1106不是实测。两阶段在keeper退出0前恢复原模式、frame及visible，applicationForceStop=false。

原receipt的artifactUploadConfirmed=false及postKeeperExitRestoreObserved=false等字段保持原值，上传由独立下载、长度和SHA另证，不回填receipt。installed.originalFileCLIResult=null，四文件由原安装脚本内部执行，不伪造独立CLI结果。

## 未验边界

本轮仅CI离线源码及同次真实安装范围，未发行签名或公证。Root未独立安装候选，也没有在本轮验证启停复选框、私网数据库或系统输入。后继c449的Q01窗口、启停整合GUI和独立文件读回按各自固定提交另记；不能用本CI推断其结果或处置此前凭据误输出事件。

旧失败和unknown保持原记录；Navicat完整工作包、公开发行计数不增加，暂不发布。审计脚本及摘要保留于`.cache/ci-12c08ad-audit-20261021/`。
