# 缩进与查询分栏的三平台源码/安装专项 CI

此片基于 `9b734e5` 接线，尚未运行真实 GUI、安装或 Actions。Windows 源码此前各一次通过不替代本片 CI，更不代表 macOS 或安装验收。

## 顺序与身份

现有 desktop 矩阵（Windows x64、macOS arm64、macOS x64）依次执行：

1. `node scripts/native-editor-ci.mjs source`：原生 GitHub job 核 checkout SHA、干净源码和锁文件；一次类型检查及 `scripts/build.mjs` 成功后封存源码清单，逐项运行缩进、分栏原 spec。
2. 既有源码回归使用 `pnpm exec playwright test`，不再调用内含 build 的 `test:e2e`。随后 electron-builder 直接使用同一 dist 打包，不重建。
3. `test-packaged.mjs` 在安装前保存 `package-input.json`，固定同 job 源批准 hash、安装器/DMG hash、未安装 app 的完整合同字节。原有检测阻止覆盖现有安装。
4. 安装后只批准真实 app：Windows 的 `Applications/DBArk.exe` 或复制后 `.app/Contents/MacOS/DBArk`；核与同 job 打包参考一致，再逐项运行两个原 spec，之后继续既有安装回归。

普通源码回归显式输出到 `test-results/legacy-source`，启用专项的普通安装回归输出到 `test-results/legacy-installed`；它们与 `test-results/native-editor-ci` 为兄弟目录。Playwright会在启动时清空自己的outputDir，因此不得再对这些CI运行使用默认的整个test-results。每项专项仍只清自己的attachments目录；artifact继续整体上传test-results。未启用新专项的独立test:packaged保留旧默认输出参数。

源码批准输出通过本 job 的 `GITHUB_OUTPUT` 传给安装步骤；上下文包含有效 checkout SHA、run_id、run_attempt、job、OS/架构、Node/Electron/Playwright/产品版本、锁文件摘要。批准 hash 的信任起点是审核后的工作流和有效 SHA，并非对任意本地文件自签即可获得批准。PR 自改工作流的运行记录不冒充受保护发行批准。

清单遵守原严格 v1 合同：source 为 Electron 入口、default_app.asar、package.json、全部 dist 和原端口脚本；installed 为真实 app 入口、全部 resources（含 app.asar）及原端口脚本。此“完整”不扩大为 OS、全部 node_modules 或 Electron Framework 的供应链证明。

## 门、退出与失败

- 每个子进程只启自己的门，另一个门为0；布局进程不携带任何缩进清单变量。环境只继承桌面启动所需项，实库/凭据/预加载或大小写别名直接拒绝。安装进程的 `DBARK_EXECUTABLE_PATH` 只能取已批准实际 app。
- 每项只执行固定 spec、workers=1、retries=0、trace=off。保留原 TestInfo、120秒期限、afterEach 墓碑、owner、正常 will-quit/close、全部记录 PID 消失和两次独立启动闭合逻辑；不改任何原用例或 runtime。
- wrapper 要求原单例报告与原终态附件同时通过：两 owner 正常闭合、目录已删除、SQLite及专项字段完整。列表、skip、retry后成功、另一个 spec 或旧全量统计均不能代替。
- 首项失败后不运行第二项，不重新生成批准，不覆盖原日志或目录；手动重复调用同一输出也会被拒绝。
- 启用专项时，安装脚本只有两项原证明完整且后续旧回归也成功才卸载/清理；任一异常、报告缺失或退出未知都保留本次安装根及原现场，不强停应用。原未启用专项的调用保持旧行为。
- CI 按 run_id/run_attempt 隔离并禁止新 push 自动取消运行；会比过去保留更多同时运行的检查。外部取消/runner 回收不算正常退出证明。

证据位于 `test-results/native-editor-ci/`，按 source/installed、indent/layout 分目录，保存原 JSON、stdout/stderr、附件、批准与输入记录。上传步骤成功/失败均执行。各平台应分别有源码/安装各两项证明，共12份；本次没有生成任何真实专项通过记录。

## 本片已做的离线验证

只运行4份定向单元文件，43个唯一用例：新增25、既有安装路径/端口接线18，最终逐项均通过。首轮40绿3红来自新RAM完整收尾夹具漏接 `basename`；补端口后仅重跑原3例通过。之后对 helper 的原批准消费、重复运行拒绝及安装前输入封存作收紧，重跑新增25例通过，未重复旧18例。首个失败证据保留。

新清单由原 `sealEditorIndentLaunchIdentity()` 直接消费，环境由原两个 gate 直接校验；安装 try/catch/finally 用原 AST 执行，系统安装/运行/删除仅为RAM端口。另做三个脚本 `node --check`、YAML 解析和唯一一次 `tsc --noEmit`，均通过。类型检查后仅文档及安装收尾缩进变化，无逻辑变化。

没有运行 Electron、Playwright 实例/列表、网络、200、真实安装、数据库、剪贴板或项目 build；没有修改产品 src、版本、锁、Root/作者目录或推送。Root 复核后才可正式运行。
