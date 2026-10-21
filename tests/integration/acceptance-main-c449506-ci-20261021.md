# main c449506 三平台原生 CI 与原件核对

## 固定身份和范围

准确提交`c4495066f4f570fbff69769ea377f442c66a0aea`，src树`0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2`；[CI39541666500](https://github.com/zhao-yc/DBArk/actions/runs/39541666500)，push、attempt1，API最终completed／success。Linux及三个原生job均success，原生剪贴板及发布job跳过；无标签或新发行。

本头包含Q01窗口帧补全、筛选条件启停及904的组合用例准备。归档核对仅运行标准库读取，不执行其中程序或安装器；此前[Windows0a4实库和Root合并检查](acceptance-q01-window-frame-0a4b23f-20261021.md)另记，不能混为本轮新GUI。

## 原日志结果

| 范围 | 实际结果 |
| --- | --- |
| Linux job119030571609 | Python21项、0.304秒；类型／593文件11478通过、10平台跳过／构建成功；单元174.00秒，Vite27.29秒 |
| Windows job119030572031 | source legacy80通过／317跳过，7.8分钟；同次NSIS实际安装legacy80通过／317跳过，7.0分钟 |
| ARM job119030571789 | source legacy80通过／317跳过，7.8分钟；同次DMG实际安装legacy80通过／317跳过，7.8分钟 |
| Intel job119030572051 | source legacy80通过／317跳过，10.2分钟；同次DMG实际安装legacy80通过／317跳过，9.6分钟 |

317项含私网门及独立专项，保留跳过；专项不与legacy80相加为完整功能计数。当前CI中的源码和同次安装不证明私网启停、窗口帧或系统输入矩阵全部完成。

## 原件长度、SHA 与 CRC

| 平台／artifact | 字节 | ZIP条目／解压字节 | SHA256 |
| --- | ---: | --- | --- |
| Windows x64／12320004890 | 5350238 | 137／5932046 | `a198d5fc8564446f6dd2a2ab13c04831b3ac37547981014cb7cbb43ec61928f4` |
| macOS arm64／12321110324 | 7836747 | 137／8448214 | `6da2d1e255c7857a63966149c6546787d20b978b18387913ddb3c436a81edb74` |
| macOS x64／12320667690 | 10651560 | 137／11428950 | `6802ccba7d1ed9f5fb650ebd20e05f378ff6bfef25b8f90afe4be6784cdca5dc` |
| ARM显示租约／12320044853 | 10303 | 8／747074 | `415ba7cf3d5c7f6480d4884ecedbdfc8a252ff434519ae5b08a7475123b24c33` |

四份下载长度及SHA与上传metadata一致，ZIP CRC全部通过。未解压或执行归档；审计位于`.cache/ci-c449506-audit-20261021/`，原件和日志不入库。报告context的commit／run／attempt／platform／arch逐项锁定；report字节摘要、approval、accepted、completed及proof严格核对，不用重新序列化JSON的摘要替代原件。

## 六专项原报告摘要

| 平台／阶段 | 缩进report | 分栏report | 首次文件模型report |
| --- | --- | --- | --- |
| Windows x64／source | `194d0168184520c811ccffead8b5d9a1796d656858aa9103ebe5d3bd070b18ce` | `7e61a4febce0e1d2661056e2894d0fea685f7b82ae06b2d1b3e06df6cf097603` | `107db1109d9819f65731db2c700d5dfeb3aa46f68a011371c0ea90f45d3544e6` |
| Windows x64／installed | `28697f154c17e5438d41e1490ce0dd624da3c0923838eb758d71634f787ea64a` | `1f1a3d8295ff8a5b4cabbbd0ff6d7e036e607365e4fd605b086b1ae36e0594a5` | `6b05e346f648b040777638707112e852100ca5a1d44e54b869e1fa81b81cd3a6` |
| macOS arm64／source | `19a6fad1e15b7ba379f2e1f2f1b9d79b0f9a514a2ccdfdc824091da5562ab5d4` | `866adf8707cd93cfad2df1f2d5a4c034cc904b2cf20d0fa250b7e7db23dd9e4f` | `fcf29c73811d155075338ccae04fee2ee303bb50125286351693f799a1d2dd47` |
| macOS arm64／installed | `90975427cabdf5a937d704fcf65671c33137d4e33e4b10cb3011c34e17206ed6` | `e975398ad9a3ca407be232de2c63dcf148e809acbfd9a00913370ea93c42ccef` | `83f378fb4c1b5cd71ab8f85387dfbcbdf37c848694fe593886f53e2054e63a71` |
| macOS x64／source | `b826170cb8ad81dc00a3733b561cc3092bcac9c416d739fd80c8081d8a27e8a2` | `268ea55a29b757bc69a586345f26907f57cac972ccf7e99d0e1f875a12ac93b7` | `603e8f7da25da82033b08f19bc9d3f8a6949c5ee0b27f36a37788aaa94d30ec6` |
| macOS x64／installed | `37e05b9720b6424b4f2e8ea92587ba08dd20e17099a3a35bc3a800bea3cea23f` | `c7ecfed12050d66e280239e2b9e0bd2787678d3dac3d8a9d794ea2dd0e535ee6` | `4c90036b946396bdfb9d5d269c247218aa8385cb99c0634d5c19b91995ed6ead` |

各平台每阶段均缩进1项、分栏1项、首次文件模型4项，零重试、零失败／跳过／flaky。每阶段12个正常owner均confirmed／willQuit／closed=true，目录已移除；SQL执行及系统剪贴板0。四文件覆盖LF／CRLF×按钮／快捷键、普通与格式化单次Undo／Redo以及独立重启clean，不转作私网或系统键盘证据。

## ARM显示恢复

两阶段nonce独立，原序号连续并分别止于181／95。原模式3、frame1024×768、visible1024×674；ready及全部pulse实测模式9、frame1600×1200、visible1600×1091，满足原计划下限。计划估计1600×1106保持为估计。两阶段在keeper退出0之前恢复原模式、frame及visible，applicationForceStop=false。

原artifactUploadConfirmed=false、postKeeperExitRestoreObserved=false及其它原false字段不回填；上传由独立下载长度／SHA另证。installed.originalFileCLIResult=null，四文件由原安装脚本内部执行，不伪造独立CLI退出。

## 未验范围和原失败

这是CI离线源码与同次安装范围；Root未独立安装候选，新功能的Windows／macOS私网和安装GUI、签名公证、原生输入法及系统输入仍按各自门槛验收。新启停GUI曾在控制准备直接加载TS时失败，正式GUI未启动；该原错误、80封存及后继.cjs加载修正另记，不能用本次CI解释或覆盖它。

此前凭据误输出事件的完整暴露范围及用途仍未知，CI通过不是事件处置。其它旧失败及unknown保持，不增加Navicat完整工作包或公开发行计数，暂不发布。
