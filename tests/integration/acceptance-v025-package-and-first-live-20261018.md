# 0.25 Windows 候选及首次批量填充实跑

## Windows 候选

Root 从固定 `e80b05a86ccda291a7a71381e98efbec13715540` 打包；产品编译仍来自 `66920f782873c35ab05870400874f7d2e2f42cfa`，108份活动编译文件在打包前封存。执行 `node node_modules/electron-builder/cli.js --win --x64 --publish never`，退出0，未重建产品、未生成密钥或证书。

候选 `DBArk-0.25.0-win-x64-unsigned.exe` 为142,357,527字节，SHA256 `012611ceb932dd9d62be42ea1d6a6111d2c6f7a2e3d556d281ea4f542a4984ce`。同批 `app.asar` 为203,059,913字节，SHA256 `b33ee3d60cb45f568c3695c7be260ee59cd7f82a0c05a3bd761d6b3dfacaab38`。本地忽略收据 `run1688-v025-windows-package/artifacts.json` SHA256 `a5726b56ecb1d8bf03dcd3ac09bc4a0afea3278cd27849b082598a7ae123ab01`。

这是未签名的本地候选，尚未安装、未发布。macOS 本版本候选亦未验收。

## Server-200 与只读预检

本轮 SSH 确认实际主机为 Server-200。每条 Docker 只读命令前均重新核对主机、machine-id 摘要、显式 Unix socket 及环境，未操作本机 Docker，也未改变任何容器。目标准确为既有隔离 MySQL8.4 端口13384；原生 mysql2 探针实际核对8.4.11、服务实例 UUID 与 Linux，并等待其原物理流关闭。凭据只从既有本地文件读入内存，没有写入命令、文档或报告。

## 首轮实际界面结果

固定测试头 `1bd61008a1f28636411be8a5ea451f0b344c28eb`，Windows 源码模式，使用上述同一产品构建。两条正式用例串行、每例120秒、零重试，trace／截图／视频与失败截图均关闭。

首例进入本轮随机隔离库及三行表，经实际网格勾选和批量窗口暂存 SQL NULL；随后测试脚本用 `^note(?:\s|$)` 匹配列头，在读取 `aria-colindex` 时30秒超时。原例34263毫秒失败，尚未点击集中提交；第二例未运行。不能把已有草稿或静态测试当作实际提交、精度保持及冲突回滚已通过。

原错误触发保留资源，退出／删库未获确认，随后 worker teardown 45秒超时。原随机库、配置目录和失败现场均保留，Root 没有强停、删库或重放操作。定位修正和后续新运行将另行记录，不能覆写本轮失败。

本地忽略报告 `.cache/parallel-integration/run1699-batch-fill-source-live/report.json`，SHA256 `75d7cecbc7bb7a82a7ac5b5e2636cf1cad8cbe340c1ef9daef2bac69d2b7b4df`。正式实库结果目前为1失败、1未运行。

## 离线检查的独立边界

专项门和真实 mysql2 内存握手关闭对照两文件49项已通过；随后仅修正内存对端可选回调的 TypeScript 类型守卫，同一三项探针对照及完整类型检查通过。源码与原始数据期待未放宽。这些结果不替代上述真实界面失败，也不替代先前 `74102c8` 的完整 CI 检查点。D02 仍为部分完成，公开版本仍为0.21。

## 列头定位修正

作者固定 `59d4b6b`、Root `e63678a7600160da045a398c8bbae0172ec1d8f3` 只修正专项列头定位，另增加一项生产 JSX 渲染对照。原失败报告没有 DOM 快照；结合原等待表达式与生产列头代码，离线确实复现列名和类型形成 `notetext` 连续文本。新定位只匹配固定 `note` 的直接文本，并仍从实际列头取得原坐标；不能以该离线端口宣称浏览器已运行 XPath。

作者原46项门控及新增对照共47项通过、类型通过；Root 在整合头只执行新增一项定位对照及完整类型检查，均通过。原 BIGINT 排序修正、探针关闭、所有数据期待和提交／回滚断言保持。本地忽略 `run1701-batch-cell-locator/unit.log` SHA256 `f97fc85d84f306fbe13a565bbb604af74919810e052f6f0b8325b376f961109b`。首次实跑仍为失败，修后两例尚待新的实际窗口验收；旧现场不动，本轮不再调用 Computer Use。
