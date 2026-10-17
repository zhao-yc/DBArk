# 0.22 三平台候选检查点

日期：2026-10-18。固定源码 `91e3c0ca6bfe188a299fdb28658d8d1dd93c036f`，版本0.22.0，分支 `codex/native-checkpoint-v022-presets-indent-20261018`。这是候选验收，尚未创建0.22公开发行或标签。

## 原生及完整检查

[工作流39076032988](https://github.com/zhao-yc/DBArk/actions/runs/39076032988)的四个必要任务全部成功：

| 平台 | job | 源码桌面阶段 | 实际安装后阶段 | 重试 |
| --- | --- | --- | --- | --- |
| Windows x64 | 117523259369 | 76通过 / 292条件跳过 | 76通过 / 292条件跳过 | 0 |
| macOS arm64 | 117523259566 | 76通过 / 292条件跳过 | 76通过 / 292条件跳过 | 0 |
| macOS x64 | 117523259533 | 76通过 / 292条件跳过 | 76通过 / 292条件跳过 | 0 |
| Linux完整检查 | 117523259495 | 469文件 / 8824通过 / 10条件跳过 | 类型及构建成功 | 无重跑 |

桌面统计包含源码组件测试，不是76个安装产品路径。`test:packaged`通过实际安装入口运行，不能据此补齐跳过的私网数据库组合、剪贴板专项、新批量草稿GUI或缩进专用GUI。可选剪贴板任务117523260064和发行任务117528636161均为跳过。没有将0.21的291跳过数移作本版统计。

候选只比 `0724e258abb5e677e06b3847cde8861591a9d74a` 增加构建标记；产品、测试、脚本、包、锁及工作流相同。Root后续整合的专用GUI准备链路不在该候选中，默认门关闭，不能继承本表的完整结果。

原始日志保留于Root忽略目录，SHA256如下：

| 日志 | SHA256 |
| --- | --- |
| Windows `run1606-v022-native-windows.log` | `9e23f5c50586265b72c19690c2d01906b99c19e8a25b2563493d8b0d599a42e0` |
| macOS arm64 `run1606-v022-native-mac-arm64.log` | `e4789aa5acb4f7b87b3b967463f07057bb3ac631e9981a141469e9d2f4f19b06` |
| macOS x64 `run1606-v022-native-mac-x64.log` | `edd22306a98cc3af5e7f164e311a46a25652e3ac6ab2ad89bf8098655c4a32d8` |
| Linux `run1604-91e3c0c-native-linux-full-ci.log` | `ca0b66a99a1396c3284cd9dac3b5c843835c6685440267d217152e474c3e194a` |

## Windows候选独立下载

GitHub候选附件12117293340已通过独立网络流及落盘重读两次核验：ZIP为142472949字节，SHA256 `1c8177448e3c80c4860c4e783fb1cf6efdd00dfda26f9e6ec6961601fbc517d6`，与GitHub附件摘要一致。下载器不执行文件，没有读取数据库凭据；临时下载地址未进入参数、环境、日志或文件。

仅按固定白名单解出两个普通文件，逐文件核对大小、CRC及独立落盘SHA256：

| 文件 | 字节 | SHA256 |
| --- | --- | --- |
| `DBArk-0.22.0-win-x64-unsigned.exe` | 142319896 | `d90b7aae077fcb47512fb3db126d5202ce35dabc01b60acef7e9f721e2fd513e` |
| `DBArk-0.22.0-win-x64-unsigned.exe.blockmap` | 148857 | `ee7433c2d789f55bc0738ba7d319da25a047155abb72670f668a5436d822bd31` |

PE版本元数据为DBArk/0.22.0。该exe是NSIS安装器，不能作为应用主程序传入Electron启动接口。本机尚未执行安装器或启动此安装候选；CI实际安装与本机数据核验分别记录。Windows无发行签名，macOS为adhoc签名且未公证。

两份macOS附件随后也完成一次独立下载、网络流与落盘重读SHA256，均与GitHub附件摘要一致；下载地址仅进入无回显stdin，未落盘。这里核验的是外层CI附件ZIP，没有解包或在Windows运行macOS程序：

| 附件 | 字节 | 外层ZIP SHA256 |
| --- | --- | --- |
| macOS arm64 / 12117537093 | 339247916 | `8961b435cd91d7475c60485a5e7d215292ab16cce9e62f57d58af24b107bdd2f` |
| macOS x64 / 12117264341 | 352987526 | `48cd30022ad63c68285f32e5d4c1380f8bda083d587d4feb9e8517c5d83b48a4` |

原回执分别保留在Root忽略目录 `run1612-v022-mac-arm64-download/download.json`、`run1612-v022-mac-x64-download/download.json`；Windows回执在 `run1608-v022-windows-download`。后续新源码离线GUI专项及其原失败另见[准备与实际尝试](acceptance-p0-native-preparation-20261018.md)，不回填本候选统计。

新功能实库、专用原生GUI及完整发行下载仍待完成；Navicat全功能目标继续。随机 `dbark_phys_*` 控制器仍未启动，原授权问题待答，本检查点未借用其它命名空间创建测试资源。
