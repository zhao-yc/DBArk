# 0.28 Mac arm64原生、实际安装与资产实证

冻结产品`bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2`、src tree `20ff372f4cbc5c466e79d847afda2cb57f55426e`，package/锁文件Git对象与[总矩阵](acceptance-v028-release-matrix-20261019.md)保持。下列来源分别记录，不以产品相同省略准确HEAD和批准。本版尚未公开发行；macOS x64和系统Cmd+S不在这些通过范围内。

## 源码六项与普通回归

已核源码六项继续采用`689b35247a3a5c3345f5c0e754c5ae0742e1a33c`的[run39240838841/job118020965684](https://github.com/zhao-yc/DBArk/actions/runs/39240838841/job/118020965684)，源码批准SHA256 `7fa47612c9b3601943e391eba0872cda43f2829d433a036fa601640a90caeeb2`。缩进、分栏及LF/CRLF×按钮/格式化快捷键四例，共6例、12个正常owner；原schema9、独立重启、几何及恢复均已核。四例原报告SHA256 `87565d1f13503513b96d45aa76a8f8c0d0d1434f45ab0308219a1986e5d183f5`；本机接班摘要SHA256 `ce8df5e8da68b0e71b928f36ed84ab98c0a52babcdf7a7dec2c0db299eaf2a20`。本轮没有重复这些源码六项。

当前源码普通legacy另外由`0f39cf69b149a1466fa097deec554f4ff0e2f59d`的[run39258588418/job118080052594](https://github.com/zhao-yc/DBArk/actions/runs/39258588418/job/118080052594)补验，仍在进行中。新job原模式、固定离线预检、同次构建封存source批准及回归前后字节复核；无显示模式切换或安装，也不重新运行689六项。终态未回读之前不计通过。

## 本轮真实DMG安装

固定安装头`3fd87bb98555ba042f303762ee7a314582cb18d1`，[run39256090941/job118071627233](https://github.com/zhao-yc/DBArk/actions/runs/39256090941/job/118071627233)，attempt1，原生darwin/arm64、Node24.21.0、Electron44.7.0、Playwright1.64.0。同job源码构建批准SHA256 `9032e58b44d0ca6b1dde4a19536210acc76b8ac062c5130c8cde316762a643a6`，实际installed批准SHA256 `cf5835543d6473b053c0d18825a3e551db1d1ef3dd4beb92c4192a2f95b645ab`；source两个manifest均为`9077db7bfdc21b14ddd6db8004efebc096eb9d5108be8b050ff55e55be9be12a`、113文件，installed两个manifest均为`c66c5fc1e532f1a6235242c726460faec1437f249344711e13f7f26ff83a7b06`、117文件。

安装前package-input SHA256 `68876564aa2e2acfc8baca4060776da442c5afc299317999b94fdf77467eae34`封存本job源码批准、DMG与未安装app参考。原DMG实际只读挂载、复制到本轮Applications后，installed完整资源按相对路径与参考逐字节一致，再执行原缩进/分栏和四例；独立回读核本候选DMG摘要与该原安装输入一致。

| 原报告 | 通过/跳过 | report SHA256 | accepted SHA256 |
| --- | --- | --- | --- |
| installed/indent | 1/0 | `43c866c5bfe2cef6f2f74ce84cfadf1e0db3ab57886aad3d73faecd1f487139a` | `f393b684757ff7900b170fc3d4bd35f09f5b3a1cffd94d7fbe20f6f9d969c9d6` |
| installed/layout | 1/0 | `aaf44a7494d69b0d0205630906db0828664302b9f80fafcddd0030dd12f7b448` | `0d876aed46397782c32722a627f7f84195f922da3857de0c0fde8fd0490006cc` |
| installed/首次文件四例 | 4/0 | `cea2bb6e2890b07cbb5591dc80bd449a6aa236fb76b2e78f5b8d98f0cb65a7a9` | `75d8db27f9bb9c514162f58c03e6ab3a599d9afd86448ac241f8ece3fc4c22e9` |

原三份报告共6例零失败、零跳过、零重试，12个owner均有confirmed/willQuit/closed与原PID消失门，每个身份两个owner记录PID数量5、4。各专项资料目录正常删除；schema9、独立重启和四例完整原见证由现有严格消费者核准，不补取已结束VM的SQLite/SDK/PID。

原1400×1000/480客户区、稳定和整个外框落在workArea内的断言保持：当次mode9为1600×1200、真实可见高1091；原六项约13:04:06结束后正常恢复mode3/1024×768，再运行普通legacy。keeper共116原帧，末帧restored；receipt SHA256 `041c57d9aaf3dfdb0768880125c96343d42dac84c31b9bc10efca6f7ebadb3d9`，accepted=true，原keeper/test-packaged均退出0，normalRestoreObservedBeforeKeeperExit=true。没有续期600秒或放宽原用例期限。

随后原installed legacy为76通过/313条件跳过，8.8分钟，包含组件层；关键字两项、系统保存和实库相关条件门仍跳过。原脚本于`2026-10-19T13:13:00.930Z`（北京时间21:13:00.930）确认本次安装及临时目录已清理，DMG规范分离完成。不把普通76项称作76条安装产品路径，也不计作系统Cmd+S通过。

## 独立归档接收与可审资产

[只读回读39258845618/job118080923876](https://github.com/zhao-yc/DBArk/actions/runs/39258845618/job/118080923876)固定头`44dcf7b89d56c043586bb63b9f069db979ffedc4`，在GitHub-hosted Ubuntu独立下载原两个ZIP，实际字节、SHA256与所有成员CRC通过；应用ZIP内部741成员CRC也通过。不运行归档程序或挂载DMG、不访问旧Mac或清理现场。本机仅接收日志/摘要，rootLocalZipValidated=false。

| 原artifact | 字节 | 独立接收ZIP SHA256 |
| --- | --- | --- |
| [12189350924 证据](https://github.com/zhao-yc/DBArk/actions/runs/39256090941/artifacts/12189350924) | 3953102 | `62ba852f2569e95cf93abc3d7fcd498bbf89f64f39bfb66e07ddb244c8fe4ab6` |
| [12188064300 未发布安装候选](https://github.com/zhao-yc/DBArk/actions/runs/39256090941/artifacts/12188064300) | 339815801 | `6d72842063537d7b3313973574a627d01a7dda1bf5266a122bd6badd5e2ac2bc` |

| 候选原文件 | 字节 | SHA256 |
| --- | --- | --- |
| DBArk-0.28.0-mac-arm64-unsigned.zip | 170300524 | `2e2ef573daaa5f0273aef887d6e56a2eed5f452c45af73c5abf014f47e521f8d` |
| DBArk-0.28.0-mac-arm64-unsigned.dmg | 170177733 | `d415a686d0a9d1d001dd57b45380007b27beb362b6f91de0cdb84e6fe5ad6c99` |

实际安装验收覆盖DMG；应用ZIP仅核原字节和全部内部CRC，未另作ZIP安装验收。结构化原API/独立接收摘要、批准及保留期见[资产清单](../../docs/releases/v0.28.0-macos-arm64-assets.json)。

回读副本artifact12188987112为687626396字节，上传API digest `0b27924c76aa67e4b98884a378032109df3a2ec7ebf485dacd1803947e4f683b`，未再独立下载该副本。原候选及证据14天保留，到2026-11-02约13:13 UTC；这些是未发布工作流资产，不是永久公开Release附件。

## 历史失败与剩余边界

首轮cfadb2d/run39252503731在Swift旧分支门前拒绝，未安装；第二轮5a4ca1b/run39253421880的原六项和legacy虽通过，但模式租约届满、恢复失败、原安装根保留，整轮仍为失败。它们的原件、未知现场及独立回读均保持，未用第三轮成功改判或补清。原因及修正见[完整串行记录](../../docs/development/v028-macos-installed-20261019.md)。

本证据不覆盖macOS x64、真实系统Cmd+S、当前关键字专项、实库驱动版本矩阵、公开下载后安装或最终发行。源码普通legacy仍需上述独立新job终态；所有剩余项继续按总矩阵逐项记录。
