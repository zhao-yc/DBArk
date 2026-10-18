# 原生启动观察的主线整合记录

本轮整合作者固定提交 `7004209bfb7b0eeaa1e99f95cbdd1ed9056fd6e3`，基线为 `7a48f546dcd5da1d0cd97f083fdfb07cd3591347`，整合提交为 `f072685440a68eaf1e8e9c100316d2137c2443e2`。作者交接 JSON 摘要为 `04191038bd7f6608151a61f8a7b98e620ad20775489c51a23efa55b9f73fa354`，主线已读盘核对。两棵整合树逐文件一致。

## 目的与审查

新增内容只帮助下一次原生运行保留启动阶段的有界事实。原两轮 CI 的失败仍成立；不能用本次离线检查宣称 Mac 产品已修复。没有修改产品源码、构建脚本、依赖或工作流，也没有重建产品。

独立审查核对了原 416 处断言及原用例标题、身份／目录／来源关键方法和等待次数。没有发现阻止接纳的已证问题。独立 RAM 组合了双 owner、各 4 页 32 事件、完整数字来源和所有相对时点，序列化附件为 6940 字节，低于 8192 字节上限。报告保存在主工作区 `.cache/employee4-startup-observations-review-20261018/.cache/startup-observations-audit`，不是原生运行证据。

原 TestInfo 的 120 秒期限、owner 失效后的停链、原字节清单核验、正常退出和目录清理要求保持不变。观察不能赋予退出、清理或重试权限。afterEach 在原 scope 留下墓碑后，只附加已经收集的内存；附件失败保留原失败原因。

## 主线验证

在固定整合提交上执行 5 个直接受影响的测试文件，99 项通过、0 失败、0 跳过；类型检查退出码 0。

```powershell
node .cache/run1729-verify-native-startup-root.mjs
```

控制器只使用隔离临时目录及 Vitest 缓存，关闭环境文件读取，不载入凭据，不启动 GUI、数据库、Docker、端口或剪贴板。原始日志在主工作区 `.cache/parallel-integration/run1729-native-startup-observations`：

| 证据 | SHA-256 |
| --- | --- |
| unit.log | `cc546b54fa7d581662456c8ad6f9f0a3d69dfe666d8aa47bf096cf2dea337e2f` |
| type.log（空日志，类型成功） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

此前基线 `7a48f54` 的完整 CI `39098165973` 已成功，类型、单元和构建步骤均成功，原生和发行条件步骤跳过；这不能代替当前差异的原生验证。

## 下一次实际运行的边界

只有新的固定检查点才能验证本次诊断。原运行 `39089165148`、`39094458615` 不重试，也不改写原结论。新检查点仍需分别读取平台终态、来源证明、正常退出、PID 消失及目录清理证据，不能只凭日志阶段名或空错误列表验收。

launch 返回前、preload hook 安装前及订阅送达前存在缺采窗口。正式事件订阅有异步协议登记，本次没有增加其等待。相对时间复用原权限门已校验的起点和缓存，不增加新的等待，不缓存或放宽逐文件哈希。阶段差值不能直接证明哪个函数导致超时。

本轮没有新的 Windows 安装、Mac 原生或私网数据库验收，也未公开发行 0.23。最新功能候选仍为 0.26；其源码 CI 与 Windows 构建结果按各自记录判断。

新检查点 `2f0a9b6f70af409b069d2bf0dd3d0f7bb3b6929e` 已推送到 `codex/native-checkpoint-v023-startup-20261018`，启动独立工作流 [39100233953](https://github.com/zhao-yc/DBArk/actions/runs/39100233953)。本段记录启动时点，终态尚待读取；检查点与本整合树只差一份固定 JSON。Root 已准备仅验证摘要、CRC 提取记录及枚举／数字观察数据的本地读取器；不执行下载附件，也不把缺失附件解释为启动无错。

本轮 Linux job `117594833632` 已成功：497 个文件、9145 项通过、10 项条件跳过，类型及构建成功。原解码日志已冻结为主工作区 `.cache/parallel-integration/run1733-native-startup-linux-green.log`，138780 字节，SHA-256 `7b38672a5b24be0dd697597f8988c84d24323c2683d378a9399d9abbf854963c`。

随后 Windows job `117594833547` 在既有源码回归失败：`history-pages.spec.ts:37` 的 seed 正常退出等待在 `desktop-fixture.ts:239` 超过原 12000 毫秒。该步骤为 75 通过、1 失败、297 条件跳过，安装专项尚未执行。不能将此归因为本次路径修正失败，也不能据此宣称安装路径已验收。原日志和已上传测试归档另行读取，尚未修改退出期限或重试原运行。Mac 两种架构此时仍在进行，整轮不得计为通过。

新运行随后终态为失败。Mac arm64 job `117594833629` 与 x64 job `117594833653` 的源码专项、既有源码回归及打包步骤成功，实际安装专项均报告子进程退出码 1。已取得下列原始解码作业日志；尚未读到专项归档内的启动观察，不能推断这次的具体页面阶段或 Mac 根因。

| 平台 | 原日志／字节 | SHA-256 |
| --- | --- | --- |
| Windows | run1734-native-startup-windows-original.log／97769 | `93c37e8e515a0d63740f4ae8b50097014fe2d407eb35df5510854f8a8b3674b0` |
| macOS arm64 | run1735-native-startup-arm64-original.log／102890 | `86065beccd3a49f9c8848ff35102841e9396c06fd94315e40cc709e8ae8128de` |
| macOS x64 | run1737-native-startup-x64-original.log／103234 | `7b14de8ed2600083870bf8537a1c2d5c78f7c92af1f0dbb23bc3668afa52a82d` |

日志均位于主工作区 `.cache/parallel-integration`。GitHub 终态归档目录保存为 `run1730-native-startup-final-artifacts.json`，包含 Windows `12126228500`、arm64 `12126646894`、x64 `12126491998` 的固定大小、摘要及同一源码头。Windows 数据归档第一次下载在接收 0 字节时失败，原 `download.failed.json` 留存于 `run1730-native-startup-windows-download`；没有成功收据、CRC 或解压证据。两份 Mac 归档本轮尚未下载，不能把 GitHub 上传成功计作本地独立校验。
