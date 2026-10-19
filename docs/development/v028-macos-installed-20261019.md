# 0.28 Mac arm64安装缺项接线与实测

## 既有源码证明

冻结产品仍为`bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2`，src tree `20ff372f4cbc5c466e79d847afda2cb57f55426e`、package与锁文件不变。旧源码固定头`689b35247a3a5c3345f5c0e754c5ae0742e1a33c`，run39240838841/job118020965684的缩进、分栏及首次文件模型四例已有原报告与只读回读；12个正常owner、schema9、独立重启和目录清理已核准，不重复这六项源码测试。

本机交接摘要`.cache/serial-evidence/macos-689-accepted.json`本轮重新核为SHA256 `ce8df5e8da68b0e71b928f36ed84ab98c0a52babcdf7a7dec2c0db299eaf2a20`。四例原report SHA256 `87565d1f13503513b96d45aa76a8f8c0d0d1434f45ab0308219a1986e5d183f5`，源码批准`7fa47612c9b3601943e391eba0872cda43f2829d433a036fa601640a90caeeb2`。这不是安装证明。

## 新安装入口

唯一执行目录仍为普通clone`.cache/v028-serial-closeout-20261019`、分支`codex/v028-serial-closeout-20261019`。不改辅助Mac clone，不用worktree、不启动本机Docker或安装应用。

新增工作流`v028-macos-installed.yml`仅指定GitHub-hosted arm64、job `arm64-installed`。先用`node scripts/build-v028-macos-install-source.mjs`在同job类型检查、构建并封存新的source批准；这一步只提供安装来源，不称新源码六项通过。随后`pnpm exec electron-builder --mac --arm64 --publish never`构建原DMG与未安装参考，最后`node scripts/macos-mode-keeper-ci.mjs installed`调用原test-packaged流程。原600秒不可续期租约只覆盖实际DMG安装、缩进/分栏和首次文件四例；原六项闭合并正常恢复显示后，再在原模式执行普通legacy。此前把legacy也放在租约内的失败见下文。

原1400×1000/480真实客户区、稳定/布局断言、原用例期限、SQLite9及37 await/52 guard均不变；Swift保有器仍限制arm64、真实托管环境和精确分支/job，不向Intel、Rosetta、本机或自托管开放。未放宽原显示策略或伪造viewport。

安装脚本新增独立IPC清理确认：原六项专项完成后向原父通道请求；父控制器仍在有效租约内核原批准、原退出/几何/四例证据，然后正常恢复显示并确认，才允许进入普通legacy。最终卸载仍须legacy成功。错nonce、恢复未知、断线或15秒无确认时不运行legacy，保留原安装根，不卸载、不分离、不删除，也不发送应用强停或退出命令。若恢复后legacy失败，仍由原失败门保留安装根。普通Windows/macOS安装入口不开此确认门，沿原清理合同。

本地6文件142项相关检查、完整类型检查及脚本语法通过；首轮VM夹具因新增顶层await不兼容而7失败，已将真实控制块放入async执行，不删原断言，修后全通过。新增19项内存门测试不切显示器或运行应用。固定`cfadb2d`普通CI39252503606也成功；这不代替安装验收。

## 首轮原失败

[run39252503731/job118059526151](https://github.com/zhao-yc/DBArk/actions/runs/39252503731/job/118059526151)，固定`cfadb2d5de5ed1e9f7acf669d9f126a13cdd2b80`，同次source构建批准和DMG打包成功。Swift旧分支门在任何AppKit/CoreGraphics访问之前以78拒绝本次串行分支：原journal0字节、plan缺失、原native CLI为null，没有显示枚举/切换、产品安装或专项执行。不能据打包成功称安装通过。

原receipt SHA256 `04ae3632e4685e62a67cba15f6aecd09bedd097fec584f54def9805816b055f8`，accepted=false、restored=false。原证据artifact12185954090为18892字节，API digest `8ab5c04d954cf3673bfc9326db1db1590521a6b746a02dcca1c53bc81d3a8072`，独立ZIP/CRC尚未核；本机只接收解码job日志，不访问原VM或补清现场。

修正`5a4ca1b83fa26d43a91600202ab00fac174bc3f3`只将Swift门同步到明确串行分支及`arm64-installed` job，旧源码分支仍沿原门；原失败不重试、不改判。候选只在全部成功后上传，证据失败也上传。没有发布Release/tag或合并main。

## 第二轮原六项通过、租约闭环失败

[run39253421880/job118062601826](https://github.com/zhao-yc/DBArk/actions/runs/39253421880/job/118062601826)的实际安装缩进、分栏和首次文件四例均成功，12个原owner正常退出，schema9、独立重启与各专项资料目录闭合。原四次1400×1000/480几何与mode9/1600×1200、真实workArea1091均通过原策略核对；这六项没有使用放宽断言。随后普通legacy为76通过/313条件跳过，耗时8.4分钟。

失败在调度范围：原六项约12:42:40完成后仍持有模式跑legacy，600秒租约于12:50:42附近届满；legacy直到12:51:04结束，恢复确认超时。原安装根`/private/var/folders/n6/hn37q6pj7sj_9dmqqc2113800000gn/T/dbark-package-e2e-UC4Mrs`保留，未卸载/分离/删除，未强停；未上传可发行安装候选。原receipt accepted=false、normalRestore=false，SHA256 `8f1c8a1fac58c0f7b58f60f97087ac0aed370176056e0c6a6502fbf143c5b53d`。不由VM结束追认恢复或清理，也不把本轮整体写成成功。

原artifact12186697756为5227611字节，SHA256 `224d8f0c2d17b4ad2800a0374559581df56c77a87e5b605c21d992e13ad5e160`。[只读回读39255801179/job118070648882](https://github.com/zhao-yc/DBArk/actions/runs/39255801179/job/118070648882)在固定997b593已独立下载核字节/SHA/全部成员CRC，消费原source/installed批准与原六项报告、原footer/几何和租约失败帧。本机只接收回读摘要，未核本机ZIP或访问旧VM。

| 原installed证据 | SHA256 |
| --- | --- |
| source批准 | `72c3f63622c7089b4eac3ffd26c9cf4447ea490f7a8f31dd5e450a2ecf9adf81` |
| installed批准 | `d7939db355e870c5a95ba132fc30b6a6b4a84adabaa35ab855ae600e097850c2` |
| 缩进原报告 | `fd690163eaac0e75641ff0833b3b0935c6565a8973431c4b0958d319758bad8b` |
| 分栏原报告 | `8201c2a2aa21d638cd5e845a64d05411bc86636cd334f328771156813c83dbe2` |
| 首次文件四例原报告 | `748eb19e6bdbe1d67f23c897e2cb0d6c6e71a53ee71126b1dd47a318abbd1209` |

对应修正仅把确认等待移到原六项之后、legacy之前，600秒租约、原测试期限和原断言不变。新安装入口先恢复显示，再跑原legacy；两者均成功才规范清理。48项相关检查与完整类型检查通过，两个VM夹具改用async包装以执行原完整控制块，原断言保留。下一次仅在新隔离job验证此必要调度差异，不重试或补清旧运行；源码六项仍复用既有689证明。

安装版系统保存、关键字专项和x64不由这次接线证明；最终状态仍以[验收矩阵](../../tests/integration/acceptance-v028-release-matrix-20261019.md)及后续原报告更新为准。

## 第三轮原job成功，归档独立回读继续

固定`3fd87bb98555ba042f303762ee7a314582cb18d1`的[run39256090941/job118071627233](https://github.com/zhao-yc/DBArk/actions/runs/39256090941/job/118071627233)已成功。原六项后恢复到1024×768原模式，journal116帧最后为restored；receipt accepted=true、原test-packaged退出0、原两专项/四例证明已消费，正常恢复在keeper退出之前完成。随后原legacy76通过/313跳过（8.8分钟），13:13:00.930Z原脚本确认测试安装及临时目录已清理。原receipt SHA256 `041c57d9aaf3dfdb0768880125c96343d42dac84c31b9bc10efca6f7ebadb3d9`；源/安装普通回归和已核原生六项仍分层计证。

本轮候选artifact12188064300为339815801字节，API digest `6d72842063537d7b3313973574a627d01a7dda1bf5266a122bd6badd5e2ac2bc`；证据artifact12189350924为3953102字节，API digest `62ba852f2569e95cf93abc3d7fcd498bbf89f64f39bfb66e07ddb244c8fe4ab6`。这些尚待独立接收ZIP/CRC和原报告摘要核准，不冒称API摘要即本机校验。旧5a失败及其安装根边界保持。

下一缺项为当前候选arm64源码普通legacy。独立`v028-macos-source-legacy.yml`仅在前一实际安装结束后触发，按固定产品三对象核对→127.0.0.1:1原预检→同job构建并封存source批准→原普通回归→再次核批准字节执行。该入口不切换显示、不安装、不重复689已核的六项源码专项，失败总上传原证据；原字体/导航/复制/关闭其它查询等门与Windows源码legacy保持。新入口语法及YAML核对通过，实际结果待新job。
