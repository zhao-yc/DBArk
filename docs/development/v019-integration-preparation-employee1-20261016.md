# 0.19 候选集成准备：员工1交接

本分支只准备可逆集成候选，基点为 ROOT 指定的 `f0b67cc9d1ffce586145f76403afc90796ca60c5`。全局版本仍为 `0.18.0`；没有修改 CI、发行材料或旧验收记录，没有执行 GUI、200、SSH、系统剪贴板、Docker、安装或手动 CI。ROOT 仍拥有最终集成、实测和发布权限。

普通克隆：`D:/svn/DBArk/.cache/parallel-20261015/w02-workbench`；专用分支：`codex/employee1-019-integration-preparation-20261016`。没有使用工作树、切换 ROOT/作者克隆或合并主分支。开始时本员工原分支工作区干净、HEAD 与上游一致，完成 `git fetch origin --prune` 后才从固定基点创建新分支。

## 原提交与本分支映射

基点已经含 D04 `e5367ef`/`c2051e5` 的兼容移植及 legacy auto `9b7bb59`，本轮没有重复纳入；它们的既有映射见 [前一阶段组合说明](v019-candidate-assembly-20261016.md)。以下十一笔均按 ROOT 顺序使用 `git cherry-pick -x`，提交正文保留完整来源。

| 范围 | 原提交 | 本分支对应提交 |
| --- | --- | --- |
| W03 定义命中导航 | `6b41597ba057c4c23ea11514ba053a3710106188` | `344d80388140d9145b90778c8e9864afa950fe90` |
| Q01 命名窗口继承 | `2cb329debb612da3c11a018f20e5670ba102c600` | `e7f6311b0e6bfacb97746d73778b4dfacce9b4da` |
| Q01 分支完整性修正 | `b878d4baae8d238c5045091412e0515106b048ff` | `bbb08b2a0b2f85096ce4fd0acdd47800305a415f` |
| Q02 原文范围解析 | `b898bb0921a59c513a0df560bae7fd31374883df` | `bf4cd3437981d3b9d3c2127c9d877248ef6f7dbc` |
| Q02 完整执行接线 | `ca992a2a7a1ddb4c4fad3fd33dcc9bdfa7263d1c` | `70987fe0f07048aea89182469d0b073ee92cd2f8` |
| D02 复制记录草稿 | `e6efbc317b36210fb423ab1759a931785d1d3cbf` | `0f3d461757c937d76eb09caa8e423a3e94f01a7b` |
| D02 缺失字段安全拒绝 | `a3702241fcae858e408ada126d62b8d32b1446bb` | `4317a9e7ee5e209f9d32ccaf2fd40bdc782204e9` |
| 原生输入/只读观察辅助 | `dc48f6744ca6697d72d376fbe84b6a6beb5281a4` | `11cc90323be0c9ad771b94fe1a413df894541065` |
| 真正按键时的模型证明 | `ad260c61cdfca39196b687ebaa5a88f1f608857e` | `e65fbc03624a239bc68b0b7a7ccbf6fb89d6db70` |
| 原生清空旧选区 | `c07939afa03f381fb0eaee5b0b0d8109194ddb6a` | `758f64f1b7ebd757750e2d0836f43cecf535e0b6` |
| ROOT 既有网格用例定位修正 | `36de4a27456b6785e858e45e37a551f18dd3abfa` | `5c8c4a6d1eb4342ae4f61ddc381fa1eee85fbaad` |

最后一笔经第二次 fetch 取得，只把旧按钮名称“仅替换当前一处”修正为现有“替换当前”。没有挑入 ROOT 的两份 0.18 正式验收文档提交。挑入链末端为 `5c8c4a6`；最终交接 SHA 是再包含本文和混合测试兼容补充的提交，由最终交接消息和分支日志给出。

## 共享冲突与人工调整

仅 `TableTab.tsx` 在挑入 D02 时发生文本冲突；没有不确定的行为冲突留待猜测处理。

1. `e6efbc3` 导入区：合并 D04 `RecordPageNavigation` 导入与 D02 复制草稿/文案导入。
2. `e6efbc3` 加载成功段：保留 D04 页码/页大小验证、一次生成新行 UUID、导航完成和提示；在原重置段加入 D02 `copiedDraftIds.clear()` 及清空复制提示。不移除 D04 的代次和迟到回包保护。
3. `e6efbc3` 整行 JSX：以含 D04 的现有布局为底，仅加入复制按钮及复制提示；保留 DataGrid 点击撤销导航、RecordFormPanel 跨页属性及原 PageFind/表工具接线。
4. `a370224` JSX：只更新复制按钮 title，使缺失字段拒绝原因可见；保留上述组合布局及安全拒绝实现。

`validation.ts` 自动合并后保留基点的 legacy 第四确认校验，同时加入 Q02 唯一的 `query.execute.currentStatement` 严格偏移校验；其它命令和任务契约逐成员核对保持。

原 D04 混合测试抽取真实 `load`，但测试端口没有新增的 D02 复制标识和提示 setter，导致首轮两项失败。本轮补齐这两个真实依赖，没有删除、放宽或延长原 27 项断言；另加两项组合回归：

- 真实复制入口产生新增草稿后，真实 D04 导航拒绝跨页，保留原行、复制身份、活动选择，并且不调用数据库或确认放弃。
- 跨页成功读取同时清空旧复制状态，并仍按 D04 新页真实 UUID 完成目标选择。

该文件最终 29 项通过。这是本轮唯一额外测试文件修改；额外文档仅本文。

## 保留比对

忽略缓存中的 Git 对象/AST 比对共 480 项通过，覆盖原函数、属性、任务契约、旧 SQL 构造及原四个补全/会话 spec。

- 来源共涉及 62 个文件，60 个文件逐 blob 等于最后指定来源；两个人工组合文件为 `TableTab.tsx` 和 `validation.ts`。再加上述混合测试后，另外 1,051 个基点文件逐 blob 保持，60 份 `tests/integration/acceptance-*.md` 原字节保持。
- TableTab 的原函数、DataGrid、RecordFormPanel、PageFindPanel 属性以及 App 的全部 TableTab 属性保持。`duplicateCurrentRow`、`makePreview` 逐 AST 等于 D02 指定候选实现。D04 的加载、布局后选择、导航票据及保护仍在。
- QueryTab 原选区/全部/解释入口、建会话、取消、错误、事务与配置准备函数保持；只扩展当前语句捕获和 `runQuery` 新可选意图。Engine 原会话互斥、任务主链、取消与其它命令保持；主进程仅扩展当前语句实际片段历史。
- SQL 文件逐字等于已审 `b898bb0`；除范围扫描器明确扩展的方法外，原 SQL 构造函数逐 AST 保持。保留原脚本、参数、模式、事务、流和取消回归。
- 原四个 spec 仍为 21 项，标题、产品期待及显式测试期限保持。已审 helper 把原 13 秒及默认 5 秒等待收紧为同一截止时间的剩余量，未延长期限；保留比对只归一化这项已批准的等待表达式。四份 spec、公共 helper 与 45 项 helper 纯回归的文件逐字等于 `c07939a`，没有自行改写它们。
- `TaskRecord`、`TaskEvent` 旧字段及除 `query.execute` 外全部命令成员保持。版本、锁文件、全部 CI、README、CHANGELOG、coverage 及既有发行材料不改。

## 本轮验证

| 检查 | 结果与实际边界 |
| --- | --- |
| 首轮定向纯测试 | 1,465 项中 1,463 通过，2 项为上述 D04 测试端口缺失；原报告保留。 |
| 修复后混合回归 | 原 27 项加 2 项新组合回归，共 29 项通过。 |
| 扩大纯单元 | 222 文件、4,272 个唯一用例均已验证通过。首轮 4,263 通过，9 项测试自建 junction 遇沙箱 EPERM；只解除该文件操作限制后重跑同文件 34 项，全部通过，覆盖这 9 项原失败；没有修改这些测试或重复计数。 |
| 明确排除 | `tls-credentials-engine.test.ts` 会在内存生成一次性私钥；因本轮禁止真实密钥材料而未执行，不宣称完整无排除单元。其它 unit 原断言和期限保留。 |
| Monaco 旧回归 | 原 45 项全部通过，包含在上述扩大单元内。 |
| 类型 | 最终候选 `tsc --noEmit` 退出 0。 |
| 构建 | `node scripts/build.mjs` 退出 0，Vite 37.98 秒；仅本克隆源码打包，保留大 chunk 提示。之后只补入 `36de` 的测试字符串，全部产品构建输入不变。 |
| GUI 列表 | 最终 312 项、列表错误 0、实际执行 0。含 W03 8、Q02 5、D02 5、D04 10、legacy auto 3、原网格 7；原四个补全/会话 spec 保持 21 项。 |
| 列表守卫 | 实际原生/子进程放行 0、网络 0、私有文件读取 0。阻止了一次工具链 Node 平台探测，列表仍成功；这次被阻止的调用不记为实际启动。 |

首轮失败、有效重跑及只读保留比对均保存在本员工忽略缓存 `.cache/019-integration-preparation/`：`targeted-initial-results.json`、`mixed-results.json`、`broad-initial-results.json`、`junction-retry-results.json`、`compatibility.json`、`preservation-proof.json`、`preparation-data.json`、`ui-list.json`、`collect-guard.jsonl`、`typecheck.log` 和 `build.log`。没有把日志、运行环境、构建产物或私有材料提交。

实际命令（工作目录为上述普通克隆）：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config .cache/019-integration-preparation/vitest-targeted.config.mts --reporter=json --outputFile=.cache/019-integration-preparation/targeted-results.json
node node_modules/vitest/vitest.mjs run tests/unit/record-cross-page-mixed-table-tab.test.tsx --config .cache/019-integration-preparation/vitest-targeted.config.mts --reporter=json --outputFile=.cache/019-integration-preparation/mixed-results.json
node node_modules/vitest/vitest.mjs run --config .cache/019-integration-preparation/vitest-broad.config.mts --reporter=json --outputFile=.cache/019-integration-preparation/broad-results.json
node node_modules/vitest/vitest.mjs run tests/unit/c02-ssh-paths.test.ts --config .cache/019-integration-preparation/vitest-broad.config.mts --reporter=json --outputFile=.cache/019-integration-preparation/junction-retry-results.json
node .cache/019-integration-preparation/check-compatibility.mjs
node scripts/build.mjs
node --require ./.cache/019-integration-preparation/collect-guard.cjs node_modules/@playwright/test/cli.js test --list --trace=off --reporter=json --output .cache/019-integration-preparation/ui-output
```

测试临时文件和缓存均限定本克隆。`DBARK_INTEGRATION_ENABLED=0`，各新增专项开关为 0；GUI 仅 `--list`。Vitest 配置只为避免本普通克隆位于 `.cache` 而被默认排除，并限定两个 worker、原期限及上述单个 TLS 文件排除。

## 未验边界与 ROOT 下一步

- W03、Q01、Q02、D02、D04 与 legacy auto 的真实交互、数据库、焦点、跨页、新旧快捷键、实际模式、事务、取消/断线和历史仍由 ROOT 安排正式 0.19 组合验收。本轮纯测试、类型、构建和列表不累计为安装/实库实证。
- D02 当前只安全拒绝没有完整加载的普通/INVISIBLE 字段；没有加入员工5仍在准备的完整源值补取能力，不声称该能力已经实现。
- Q02 独审中保留的三个构造边界仍由 ROOT 单独判断生产可达性。本次保持指定已审候选，没有据构造端口擅自扩大协议或添加重连。
- ROOT 的既有 0.18 安装/组件实证及其未验边界保持原归属。没有把 ROOT 最新验收文档或结果复制成本分支自己的 0.19 实测，也没有触发任何 CI。

最终候选完成后只推送本专用分支。ROOT 可按上述来源映射逐笔检查和撤销；没有自动合并、部署、发布或改动其它聊天的分支。
