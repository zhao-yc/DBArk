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

## 首次真实CI失败的有限修正（工作流39089165148）

原检查点为 `9e530da15a0ffe54197ccda860cd44f17967d3c8`。Windows缩进原报告SHA256为 `8b26275efaad117b7e1627e76e28293a65a421af347e16a7cef46d9cb3cf48c6`：已到只读预览后的页面无错断言，原错误名称为Canceled。原监听仅存name，没有message/stack，无法据此证明具体错误生产点；本片不猜测或改产品，只补原页面错误message/stack进失败附件，原errors数组及空数组断言仍保持。Canceled不会被过滤为成功。

macOS arm64分栏原报告SHA256为 `f2299566f40eb982011ffa8c8c2f71437174ed5e0de3319bf9a360f67d143231`：最初maximum>410前置实际为226。原resize只setContentSize，未核实际内容尺寸；Electron44.7类型定义说明macOS默认不允许窗口大于屏幕。现在通过所属BrowserWindow官方getContentSize取得夹取值，固定首次缩放，使用webContents.setZoomFactor配合物理内容大小建立原1400×1000 CSS场景；缩小480及恢复共用同一缩放。真实场景没有建立则直接拒绝，不通过填DOM、缩小410期待或加等待蒙混。每次请求/实际窗口尺寸/缩放/CSS尺寸都保留在原附件中，原拖动、键盘、短屏、SQL/model/Undo及持久恢复断言不变。

本片仅6个窗口RAM端口用例和2个原适配器pageerror用例通过，没有重跑旧适配器用例、消费者兼容、type/build/GUI/安装或CI。没有改consumer、清单、环境门、120秒期限、原owner类的退出/PID/清理实现。页面错误仍拒绝正常退出证明。原红报告不改写；场景修正是否在macOS实际通过仍待Root正式验证，Windows实际错误的生产点仍需补充后的原始堆栈才能继续定位，不能宣称两个真实失败均已闭环。

## 原关键await前的持久阶段诊断

同job的source CLI和启用专项的安装入口显式传 `diagnostics:true`，每个独立PW进程启动前，在本项已有目录独占创建 `progress.ndjson` 和 `progress-identity.json`；直接/RAM调用默认关闭。仅传开启门 `DBARK_NATIVE_EDITOR_PROGRESS=1` 及文件头摘要，不传输出路径。不要手工填写路径或重建旧日志。

runtime从已批准的 `source/installed-indent/layout-manifest.json` 固定名称推导兄弟专项目录，核原manifest摘要、目录真实路径、普通文件、单链接、dev/ino及文件头。每次只以append模式打开同一文件，核FD身份、文件头和原长度；不跟链接、不创建替代文件、不截断、不覆盖旧序号，失败后原writer不复活。文件头只绑定固定阶段身份和批准摘要；后续仅固定阶段枚举、递增序号、已登记PID数字及数量、已确认/就绪/关闭数量和retained/removed布尔状态，不记录SQL、凭据、环境、URL或任意动作文字。

覆盖 `scan.begin/done`、`launch.begin/returned`、`prepare.hook/window/statusbar/metrics/done`、`close.source/request/handshake/application/event/pids/done`。记录发生在原关键await前，后续promise不返回时最后一条进入记录也已落在本专项目录；不依赖catch才保存。所有runtime记录IO消费当前原owner/原TestInfo guard；迟到launch仍先按原规则登记句柄/PID，再被原guard停链，不能补写returned或借日志取得退出/清理权限。日志完全不参与成功consumer判据。

记录失败停止当前原操作并保留资源；原native错误发生后不再补写阶段来覆盖其原因，FD关闭或failure.json写入同时失败时用AggregateError保留原cause。默认关闭或list连stat都不做；新增协议/运行端口测试完全使用内存IO，不写实际诊断文件。

本次18个新增RAM用例及5个直接受影响旧例最终逐项通过；只选跑相关子集，没有重跑旧97整套、type/full/build/GUI。新CI提取夹具首轮2红为缺CommonJS/exports端口，修夹具后通过，原报告保留。两份直接提取runtime夹具显式补了新依赖及禁止真实FS的RAM端口。Root已修的query-layout-native-gate夹具0cc2a72保持在整合侧，本分支不回写其旧版本。

Root操作：保留现有8005145/0cc2a72/f574c15的整合内容，只接纳本次新commit；经独审后建立新检查点单次运行。现有always上传整个test-results已覆盖阶段文件，不需扩大权限或移动到全局目录。先看progress最后阶段，再结合原report/owner附件判断；任何阶段数字都不替代原退出/PID/目录闭合证明。原39089165148不重试，三个原失败及0.23不可发布边界保持。
