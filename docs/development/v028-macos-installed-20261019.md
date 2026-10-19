# 0.28 Mac arm64安装缺项接线与实测

## 既有源码证明

冻结产品仍为`bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2`，src tree `20ff372f4cbc5c466e79d847afda2cb57f55426e`、package与锁文件不变。旧源码固定头`689b35247a3a5c3345f5c0e754c5ae0742e1a33c`，run39240838841/job118020965684的缩进、分栏及首次文件模型四例已有原报告与只读回读；12个正常owner、schema9、独立重启和目录清理已核准，不重复这六项源码测试。

本机交接摘要`.cache/serial-evidence/macos-689-accepted.json`本轮重新核为SHA256 `ce8df5e8da68b0e71b928f36ed84ab98c0a52babcdf7a7dec2c0db299eaf2a20`。四例原report SHA256 `87565d1f13503513b96d45aa76a8f8c0d0d1434f45ab0308219a1986e5d183f5`，源码批准`7fa47612c9b3601943e391eba0872cda43f2829d433a036fa601640a90caeeb2`。这不是安装证明。

## 新安装入口

唯一执行目录仍为普通clone`.cache/v028-serial-closeout-20261019`、分支`codex/v028-serial-closeout-20261019`。不改辅助Mac clone，不用worktree、不启动本机Docker或安装应用。

新增工作流`v028-macos-installed.yml`仅指定GitHub-hosted arm64、job `arm64-installed`。先用`node scripts/build-v028-macos-install-source.mjs`在同job类型检查、构建并封存新的source批准；这一步只提供安装来源，不称新源码六项通过。随后`pnpm exec electron-builder --mac --arm64 --publish never`构建原DMG与未安装参考，最后`node scripts/macos-mode-keeper-ci.mjs installed`调用原test-packaged流程，在原600秒不可续期租约内做真实DMG安装、缩进/分栏、首次文件四例及原legacy。

原1400×1000/480真实客户区、稳定/布局断言、原用例期限、SQLite9及37 await/52 guard均不变；Swift保有器仍限制arm64、真实托管环境和精确分支/job，不向Intel、Rosetta、本机或自托管开放。未放宽原显示策略或伪造viewport。

安装脚本新增独立IPC清理确认：只有原专项与legacy全部成功后才向原父通道请求；父控制器仍在有效租约内核原批准、原退出/几何/四例证据，然后正常恢复显示并确认。错nonce、恢复未知、断线或15秒无确认时保留原安装根，不卸载、不分离、不删除，也不发送应用强停或退出命令。普通Windows/macOS安装入口不开此确认门，沿原清理合同。

本地6文件142项相关检查、完整类型检查及脚本语法通过；首轮VM夹具因新增顶层await不兼容而7失败，已将真实控制块放入async执行，不删原断言，修后全通过。新增19项内存门测试不切显示器或运行应用。固定`cfadb2d`普通CI39252503606也成功；这不代替安装验收。

## 首轮原失败

[run39252503731/job118059526151](https://github.com/zhao-yc/DBArk/actions/runs/39252503731/job/118059526151)，固定`cfadb2d5de5ed1e9f7acf669d9f126a13cdd2b80`，同次source构建批准和DMG打包成功。Swift旧分支门在任何AppKit/CoreGraphics访问之前以78拒绝本次串行分支：原journal0字节、plan缺失、原native CLI为null，没有显示枚举/切换、产品安装或专项执行。不能据打包成功称安装通过。

原receipt SHA256 `04ae3632e4685e62a67cba15f6aecd09bedd097fec584f54def9805816b055f8`，accepted=false、restored=false。原证据artifact12185954090为18892字节，API digest `8ab5c04d954cf3673bfc9326db1db1590521a6b746a02dcca1c53bc81d3a8072`，独立ZIP/CRC尚未核；本机只接收解码job日志，不访问原VM或补清现场。

修正`5a4ca1b83fa26d43a91600202ab00fac174bc3f3`只将Swift门同步到明确串行分支及`arm64-installed` job，旧源码分支仍沿原门；原失败不重试、不改判。新[run39253421880](https://github.com/zhao-yc/DBArk/actions/runs/39253421880)仍待原安装与显示恢复终态。候选只在全部成功后上传，证据失败也上传。没有发布Release/tag或合并main。

安装版系统保存、关键字专项和x64不由这次接线证明；最终状态仍以[验收矩阵](../../tests/integration/acceptance-v028-release-matrix-20261019.md)及后续原报告更新为准。
