# main 0ee5886 原生 CI 检查点

准确主分支提交 `0ee58861cbdc01320abc553199fec1de1bb74ba9`，源码树 `508855f6818a1aabb40c0e04ffb4daad91922c52`。此为 SQL 文件重载已验源码的基线，不包含后续通配筛选候选。

[GitHub Actions 39459624649](https://github.com/zhao-yc/DBArk/actions/runs/39459624649) 四个检查／桌面作业均成功；原生剪贴板及发布作业跳过，未发行新版本。Root 通过连接器读取准确 job 元数据及原始日志，没有在本机启动程序、安装产物或运行测试。

| 平台与作业 | 原日志结果 |
| --- | --- |
| Linux，118755374536 | 类型通过；584 文件、11203 通过／10 平台跳过，227.47 秒；构建通过 |
| Windows x64，118755374521 | 源码 legacy 80 通过／315 跳过，7.2 分钟；同次安装产物 legacy 80 通过／315 跳过，7.2 分钟 |
| macOS arm64，118755374819 | 源码 legacy 80 通过／315 跳过，8.6 分钟；同次安装产物 legacy 80 通过／315 跳过，7.0 分钟 |
| macOS x64，118755374152 | 源码 legacy 80 通过／315 跳过，11.3 分钟；同次安装产物 legacy 80 通过／315 跳过，9.3 分钟 |

工作流在对应系统构建 unsigned EXE／DMG，再执行 `scripts/test-packaged.mjs`。该脚本对 Windows 使用本轮 NSIS 临时安装，对 macOS 从本轮 DMG 复制到独立 Applications 目录，并运行同一 legacy 套件；CI 成功证据不等于开发机另行独立下载、安装或哈希复算。表中时间采用原日志的小数分钟，不转换为虚构精确秒数。

这些数字分别属于平台和阶段，不将重复用例累加为功能数或覆盖率。条件跳过保持原状态，未强制启用私网／系统输入或剪贴板范围。作业级成功不替代逐例原生专项附件或公开安装包的独立审计。

## ARM 显示租约原件静态核对

Root 已只读下载 artifact12283657344 的原 ZIP，大小10610字节，SHA256 `8e7475552ec76ae7734f5cfbe6362b4022566d8159cc9ede0f4516af4bcfe54e` 与 GitHub 元数据一致，全部 ZIP 条目 CRC 匹配。只解析原 JSON／JSONL，未运行其程序或本机测试。环境为 macOS26.6.2／25G83、arm64、镜像20261013.0424.1。

源码阶段192条记录、安装阶段101条记录，各自单一nonce、seq连续。两阶段均从1024×768切至1600×1200，实际可见区1600×1091；最后原restored记录恢复1024×768及可见区1024×674，originalModeRestoredBeforeExit为true。两回执accepted为true、keeper退出0、原native CLI退出0、正常退出前恢复观察为true，无应用强停。postKeeperExitRestoreObserved为false，不将其表述为退出后另一次独立观察。

源码回执的originalFileCLIResult退出0；安装回执该字段为null，文件流程在原test-packaged内部执行，不能补造一个外层文件CLI结果。上传事实由后续artifact元数据及原ZIP摘要独立核对，不把receipt中的artifactUploadConfirmed:false改写为true。公开安装包尚未下载复算。

## ARM 逐例原件静态核对

测试记录 artifact12284545194 原 ZIP 为7839768字节、137条目、解压8453053字节，SHA256 `71d904c06adb8426f07bdb3ffa0cd39a689d6204f25c58ed77c860524301c880` 与远端元数据一致，全部CRC匹配。Root仅读取原件，没有执行下载内容。

源码与安装阶段分别有分栏1项、缩进1项、首次文件模型4项。六份原报告中每条测试的expectedStatus和实际status均为passed、retry均为0，errors为空；对应accepted中的reportSha256全部与本地读到的原报告字节匹配，首次文件专项context绑定准确0ee5886及darwin/arm64。四个文件身份为lf-button、lf-shortcut、crlf-button、crlf-shortcut，原proof均接纳，普通编辑与格式化单步撤销、SQLite及独立重启证据保持。

每阶段12个normalOwner，共24个，原confirmed／willQuit／closed均为true且recordedPids大于0，相关目录移除记录为true。文件proof明确sqlExecution／queryLibraryWrites／systemClipboard均为0，不将这些离线原件描述为私网数据库、系统剪贴板或新文件重载入口验收。Windows及Intel的逐例ZIP本记录未另行下载审计，不能从ARM结果外推。

当前新文件重载的 Windows 定向、真实文件 GUI 和完整单元另见[固定 603dc5a 验收](acceptance-query-file-reload-603dc5a-20261021.md)。它的独立 GUI 入口在常规 CI 默认关闭，不能将上表当作 macOS 新重载的实际操作证明；通配筛选候选的真实入口及未验范围见[开发记录](../../docs/development/query-result-wildcard-filter-20261021.md)。Navicat 全功能目标仍进行中，暂不发布。
