# 原生专项的最小早期启动观察

固定基线：`7a48f546dcd5da1d0cd97f083fdfb07cd3591347`。本次仅准备下一次获批 CI 的证据，不启动新 CI，也不把诊断称为 Mac 产品修复。原两轮安装专项失败结果保留。

## 覆盖范围与缺口

已有 `prepare.statusbar` 只能证明到达记录点；无法据此判断 DOM、preload 或页面错误。本次在原 launch 返回且原 owner 门有效后，从所属 ElectronApplication 的 context 已缓存 pages 和 page 事件建立观察。原 firstWindow 返回后另记它当时的 URL 分类。

- `firstObservedUrl` 是首次观察页面的 URL 分类，不能代替原 renderer 来源认证。
- `firstWindowUrl` 是原 firstWindow 返回后同步读取的分类；若原等待未返回，此字段缺失。
- `pageerror`、页面崩溃、renderer/main 的 console error 只记录事件类别和本地页面序号，不记录名称、消息、堆栈、正文、DOM、SQL、完整 URL、路径或环境。
- `preload-error` 复用原 prepare hook 的同一次 evaluate 安装正式 Electron 监听。主进程只发送固定随机 owner 标记的衍生标记，不取该事件的脚本路径和 Error 参数。
- preload 覆盖仅从原 hook 安装后开始；launch 返回前、hook 安装前、订阅送达前或结束后才投递的错误均不能追认。空事件数组不证明整个启动过程无错。
- 原准备完成后封存观察；原 TestInfo、期限、owner 或停链状态失效后，迟到事件先停观察，不再读消息 getter 或修改旧 case。

## 上限与超时附件

每个 owner 最多观察 4 个页面、保留 32 个固定类型事件，丢弃计数封顶 1024；主进程最多监听 4 个 WebContents、发送 32 次 preload 标记。字段只来自固定枚举、布尔值和有界数字。

补充相对时间仅复用原 TestInfo 门最近一次已验证的时钟缓存：记录 launch 返回、首次页面观察、firstWindow 返回、原 statusbar 等待前和已保留事件的 elapsedMs，范围 0 至 119999。没有绝对时间，没有新增 Date.now、文件/SDK 读取或等待。旧 RAM 端口未提供原起点时省略时间字段，不补造起点。statusbar 标记紧随原 phase guard，仅取它的缓存时刻。

Root 已确认 identity.assertCurrent 每次完整 walk/read/hash，安装输入包含约 203MB app.asar；这是基线代码事实，尚不是 Mac 超时原因。本次时间只帮助区分到达各前置点的耗时，不缓存、跳过或放宽任何字节校验，也不把时点差值直接归因于某个函数。

两个原 spec 在 afterEach 首先消费原 scope 的 retain，再通过原 TestInfo.attach 附加已经捕获的内存。即使原 Promise 在 120 秒超时后仍未返回，hook 也无需等待它。附件最多 2 个 owner；每个 owner 只复用最后一条既有 sourceDiagnostics 数字来源记录，加上新 startupDiagnostics。整个 JSON Buffer 上限 8192 字节，超过上限拒绝写附件。

此处没有调用 Page、Electron、PID、目录、退出或清理端口；不依赖已经超时的 case catch 完成。附件失败与 TestInfo 已有错误通过 AggregateError 同时保留；没有原错误时，附件错误原样传播。原 pageErrors/错误名称拒绝门、原现场附件和原成功 consumer 均未更改。

## 运行边界

- 沿用现有 `DBARK_NATIVE_EDITOR_PROGRESS=1` 显式诊断开关及非 list 条件，没有新环境开关。
- 默认关闭和 list 不加载新 runtime，不新增文件/端口/桌面动作；未开启诊断的原 owner 没有新附件 IO。
- context/pages/url 是客户端本地缓存 getter；Page.console 的正式 `.on` 会让 SDK 异步登记订阅，本次没有新增对该订阅的等待。
- 没有新增 evaluate、firstWindow、launch、retry、RPC 等待或计时器；仅扩展原 prepare hook 的 callback。
- trace、截图、视频继续关闭；cwd、继承环境、120 秒 case 期限、15 秒 statusbar 断言、原来源认证和退出/删除权保持原样。
- 新字段是诊断线索，不能充当启动来源认证、正常退出、PID 消失、目录删除或业务验收的证明。

## 正式 API 的本地证据

基线依赖为 Playwright 1.64.0、Electron 44.7.0。本次直接核对依赖类型与实现，没有启动 Playwright list/GUI：

- playwright-core `types/types.d.ts` 的 ElectronApplication.context、Page.url、BrowserContext.pages/page、Page.pageerror/crash/console 和 ConsoleMessage.type/text。
- playwright-core `lib/coreBundle.js` 的客户端 ElectronApplication2.context 返回 `_context`；BrowserContext2.pages 返回已缓存 `_pages`；Page2.url 读取主 frame 的缓存 URL。
- 同一实现的 ChannelOwner.on/_updateSubscription 说明正式事件订阅会发异步 updateSubscription；因此只声称不新增 RPC 等待，不声称监听完全没有协议流量。
- Electron `electron.d.ts` 的 WebContents.preload-error、App.web-contents-created。
- playwright `lib/worker/workerProcessEntry.js` 的 TestInfo.attach 通过 normalizeAndSaveAttachment/本地 attachment 数据处理，不操作 Electron。

## 离线验证

新增观察对照 11 项、实际 runtime 接线 2 项、既有直接对照 12 项，合计 25 个唯一用例通过。它们是纯 RAM 事件、句柄、协议和 TestInfo 端口，不加载真实 Electron、不运行真实安装、不接端口、实库、剪贴板或凭据。

验证包括事件/页面/字节上限、主进程与页面 console 不取正文、preload 固定标记、默认 hook 无额外监听、迟到停止、错误不互吞、原 sourceDiagnostics 有界复用、原 launch/prepare RPC 次数对照，以及原 default/list/期限门。没有重跑整套旧单测；JSON 中 skipped 项不计入上述通过数。

类型检查首轮仅在新测试的可空附件参数标注处失败，修正后通过。所有原始报告和后续定向报告保存在本任务 `.cache/startup-observations-evidence`，交接文件记录逐项身份和 SHA-256；不据 RAM 或类型检查宣称 Windows/Mac 安装验收通过。

实际命令使用根工作区已安装的 Vitest/TypeScript Node 入口：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-native-startup-diagnostics.test.ts --reporter=json --outputFile=.cache/startup-observations-evidence/new-observations-initial.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-indentation-native-runtime.test.ts -t '本轮最小早期启动观察接线|正常扫描/launch/prepare/close' --reporter=json --outputFile=.cache/startup-observations-evidence/runtime-selected.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-indentation-native-gate.test.ts tests/unit/query-layout-native-gate.test.ts -t '默认关闭|RAM模拟list|原预检await期间|新case复用原TestInfo' --reporter=json --outputFile=.cache/startup-observations-evidence/gates-selected.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-native-startup-diagnostics.test.ts tests/unit/editor-indentation-native-runtime.test.ts -t '首个页面|4页面|期限结束后|已准备后|真实同步SDK|原120秒超时后|未开启诊断|原hook|默认原hook|本轮最小早期启动观察接线|正常扫描/launch/prepare/close' --reporter=json --outputFile=.cache/startup-observations-evidence/observations-final.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-native-startup-diagnostics.test.ts tests/unit/editor-indentation-native-runtime.test.ts -t '原120秒超时后|未开启诊断|双owner各32|原firstWindow等待内' --reporter=json --outputFile=.cache/startup-observations-evidence/attachment-final-shape.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-native-startup-diagnostics.test.ts -t '相对毫秒|双owner各32' --reporter=json --outputFile=.cache/startup-observations-evidence/elapsed-selected.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/editor-native-startup-diagnostics.test.ts -t '相对毫秒' --reporter=json --outputFile=.cache/startup-observations-evidence/elapsed-cache-final.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

原始第一份观察报告是新增用例增加之前的 9 项，不写成 10 项；新增双 owner 附件对照在最终结构报告里；新增时间对照和其有界双owner附件复核单独记录。最终整合和下一次 CI 由 Root 审核本地固定提交后决定，本任务不 push。
