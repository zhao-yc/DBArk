# 0.19 准备：D04 跨页与旧引擎自增候选组合

本分支仅组装候选，基线为 ROOT `80b65746242190b9ca3ea22fdb2677c0a8046d0d`。全局版本继续为 `0.18.0`；ROOT、发行说明和既有实证不改。本候选没有运行真实 GUI、200 实库、剪贴板、Docker、安装或手动 CI，不视为正式交付。

候选分支：`codex/employee4-v019-candidate-assembly-20261016`。使用员工4原普通克隆；没有使用工作树。开始前工作区干净、上游差异为 0/0，并完成 `git fetch origin --prune`。

## 精确提交链与冲突

| 顺序 | 上游来源 | 上游直接父提交 | 本分支对应提交 |
| --- | --- | --- | --- |
| 1，D04 兼容移植 | `e5367efe2f316f6bfe163684ef60212937fc7a59` | `80b65746242190b9ca3ea22fdb2677c0a8046d0d` | `b7f22afee304af7350d55d8257b2d389e03563e9` |
| 2，D04 混合保护 | `c2051e5e1507c840b308644fd678ab0d5c70694e` | `e5367efe2f316f6bfe163684ef60212937fc7a59` | `9e8e1762d64d8258285b9fd90a6dc2be6a6186cc` |
| 3，legacy auto | `9b7bb59fe99a4160fa68eac5de0aa1ee0b03bd96` | `80b65746242190b9ca3ea22fdb2677c0a8046d0d` | `4c7384522f3c310099b94efda6a72386a2bc92f1` |

三次均使用 `git cherry-pick -x`，无冲突、无人工语义调整。D04 的原作者提交为 `33d4c7c1285f75b38b7763fd5113c92316c6e2cc`，原父为 `2938c7c20a2e7dff3709fdd77b9c45c4aed095b2`；员工2已将其兼容移植到80形成第一项，再加第二项混合测试。因此不另外挑入33，避免重复。D04 原开发文档保留其作者历史基线说明。

两组相对80分别改8、14个文件，没有文件交集。代码固定点为 `4c7384522f3c310099b94efda6a72386a2bc92f1`；本文另作候选交接提交，最终提交号以分支日志为准。

## 相对80的完整文件清单

| 文件 | 来源及用途 |
| --- | --- |
| `docs/development/record-cross-page.md` | D04原说明 |
| `src/renderer/components/RecordFormPanel.tsx` | D04跨页导航按钮及提示 |
| `src/renderer/components/TableTab.tsx` | D04意图、加载及提交后选择接线，保留80入口 |
| `src/renderer/locales/recordViews.zh-CN.ts` | D04提示 |
| `src/renderer/recordPageNavigation.ts` | D04意图状态机及全页草稿守卫 |
| `tests/e2e/record-cross-page.spec.ts` | D04默认关闭正式准备，10项声明 |
| `tests/unit/record-page-navigation.test.tsx` | 原D04状态机/输入模型/SSR，32项 |
| `tests/unit/record-cross-page-mixed-table-tab.test.tsx` | 员工2混合生产函数/接线保护，27项 |
| `docs/development/table-auto-increment-legacy-019-20261016.md` | legacy作者依据、范围及未验边界 |
| `src/engine/tableAutoIncrementCapabilities.ts` | legacy能力、原生计数及实际模式选择 |
| `src/engine/tableAutoIncrementRead.ts` | legacy原生计数前后夹读，保留MySQL8缓存核对 |
| `src/engine/tableAutoIncrementTasks.ts` | 能力快照、告知及5.7第四确认 |
| `src/renderer/locales/tableAutoIncrement.zh-CN.ts` | 5.7重启风险确认文案 |
| `src/renderer/tableAutoIncrementUi.ts` | 三/四项确认精确匹配 |
| `src/shared/tableAutoIncrement.ts` | 能力和确认项扩展，原执行结果接口保持 |
| `src/shared/validation.ts` | 仅扩展已知第四确认，仍拒绝未知和重复项 |
| `tests/e2e/table-auto-increment-legacy-019-live.ts` | legacy独立显式环境帮助，不加载.env |
| `tests/e2e/table-auto-increment-legacy-019.spec.ts` | legacy默认关闭正式UI准备，3项声明 |
| `tests/helpers/tableAutoIncrementLegacyTarget.ts` | 六端口实际方言/版本匹配 |
| `tests/integration/engine-table-auto-increment-legacy-019.integration.test.ts` | legacy新核心准备，6项声明 |
| `tests/unit/engine-table-auto-increment.test.ts` | 原Engine回归和legacy替身扩展，共64项 |
| `tests/unit/table-auto-increment-legacy.test.ts` | legacy能力/模式/确认纯回归，22项 |
| `docs/development/v019-candidate-assembly-20261016.md` | 本次组装交接；唯一额外文件 |

前22个文件的Git blob逐一等于对应上游候选；没有混入其它代码。机器清单、来源blob和SHA256保存在员工4忽略缓存 `.cache/v019-candidate-assembly/preservation-proof.json`，不把日志、构建产物或私有材料推送到Git。

## 逐项保留证明

13项独立Git对象/AST核对全部通过：

- 22文件之外的1056个ROOT80原文件逐blob保持；全部60份 `tests/integration/acceptance-*.md` 原字节不改，覆盖原7份实证及更早记录。`package.json`、锁文件、CHANGELOG、README、coverage、E2E说明、CI、既有安装脚本及全部发行文档保持。
- W03 的 `getSelectionToken`、`pageFindGeneration`、`applyPagePlan`、`selectCurrentCell`、`handleGridKeyDown` 原文保持；PageFind跳转、应用、网格活动位置及复制粘贴接线保持。D04仅在原跳转前撤销跨页意图。
- TableTab的重命名、自增、备注、默认编码四属性按钮及禁用条件逐字保持；App、对象树入口和保存查询导航模块不改。
- O01公共任务主链和共享contracts不改。自增apply中实际发送、DDL完成、后读取、结构/计数核验及未知态的最后主段原文保持；初始progress和 `TableAutoIncrementApplyOutput` 的独立事实/三种计数终态接口不改。legacy只扩展能力读取、快照和确认要求。
- 原MDL辅助、20项纯匹配、原核心用例及15秒等待期限、MDL说明和原实证逐blob保持。
- 原33的D04 helper、面板、locale、正式准备及32项纯保护逐blob保持；80原记录输入Hook、有界文本框、整行/节点结构输入模块保持。最终TableTab逐字等于已审的D04兼容候选。

## 本次验证与证据层次

| 检查 | 实际结果与边界 |
| --- | --- |
| 完整纯单元 | 210个文件，3893通过，0失败/跳过；2 worker，原期限。首跑3884通过、9个既有junction创建遇沙箱EPERM；首跑原件保留，解除该文件操作限制后同套完整复验退出0，无测试修改。 |
| 类型 | `node node_modules/typescript/bin/tsc --noEmit`，退出0。 |
| 构建 | `node scripts/build.mjs`，退出0；仅源码打包。存在工具链PURE注释和大chunk提示，没有构建失败。 |
| 默认正式UI收集 | 真实Playwright `--list --trace=off`，294项；281个既有项加D04 10项、legacy UI 3项，执行数0。 |
| 专项UI收集 | D04双门00/01/10/11各10项；legacy双门00/01/10/11各3项；两专项同时开启仅收集13项。 |
| 额外核心收集 | 真实Vitest `list --config vitest.integration.config.ts ... --json`；关闭时跳过suite不列项，双门开启且显式公共端口13384时列6项，执行数0。 |
| 独立保留证明 | 上述13项通过，不是UI或实库验收。 |

收集共12个配置全部完成。收集器使用只读哨兵禁止产品/系统进程、私有材料和网络；仅放行工具链Node平台探测、编译器及Vitest收集worker。Vite可选的网络盘映射查询被拒绝并走失败回调，没有查询系统映射。没有Electron、SSH、Docker或数据库执行。该哨兵属于收集环境限制，不替代真实平台验收。

作者证据：原33及legacy作者说明中的纯检查、资料依据和默认关闭准备，保留其各自固定源码及范围。混合证据：员工2的27项原生产方法/接线回归；本次完整3893项包含它们。独立证据：员工4当前组合的完整单元/类型/构建/实际收集和13项保留核对。任何作者或替身结果都不累计成实际200写入、原生焦点/IME、真实网络故障、跨重启或安装验收。

当前仍有原D04非阻断显示边界：成功自动选行会使“已到达第X页”提示因修订号变化而隐藏；选择正确、空页和失败提示保持。未在机械组合中改变该语义。连接版本先于React effect变化时旧页数据提交窗口已在旧基线存在，跨页自动选择会失效；同样未借组装修改。

原始JSON和日志位于员工4忽略缓存 `.cache/v019-candidate-assembly/`：`unit-results.json`（首跑）、`unit-results-confirmed.json`、`typecheck.log`、`build.log`、`collection-results.json`、各收集日志、`preservation-proof.json`。这些缓存未提交；代码和本文可从专用分支审阅。

## ROOT后续实库/GUI清单（均未执行）

1. D04正式入口使用 `tests/e2e/record-cross-page.spec.ts`，须同时显式开启 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_RECORD_CROSS_PAGE_UI=1`。先核13384、严格TLS13484；若宣称六组合覆盖，再分别补其余四组。按10个逻辑标题核正反首末UUID、筛选排序、六类草稿/非法JSON、实际空页、真实读取失败、迟到回包切标签、忙态和零自动preview/apply。额外核原生焦点、IME及成功到达提示，不能把SSR/纯端口当这些验收。
2. legacy新核心使用 `tests/integration/engine-table-auto-increment-legacy-019.integration.test.ts`，新UI使用 `tests/e2e/table-auto-increment-legacy-019.spec.ts`；须同时显式开启 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_AUTO_INCREMENT_LEGACY_019_TEST=1`。新文件不加载.env，不创建管理账号，UI保持 `--trace=off`。
3. legacy逐核13357 MySQL5.7.44、13310 MariaDB10.11.19、13311 MariaDB11.4.13；并回归13380 MySQL8.0.30及以上8.0分支、13384 MySQL8.4、13484严格TLS MySQL8.4。实际版本/方言/模式与端口匹配后才核写能力；13484必须保留同一批准CA与证书/主机校验，不能降级。
4. 核心6项覆盖真实计数返回类型/模式、大数单ALTER、无自增/整数上限、DML与修订冲突、同定义物理重建、原期限内实际唯一MDL等待再取消。UI3项覆盖两个入口、只读SQL预览、一次执行、无自增只读、降低/非规范值拒绝、返回编辑，以及5.7第四项未勾选不能执行。各批原退出、线程/目录清零和失败未知态独立留证；不得重放未知结果。
5. 本候选不进行服务器重启，5.7跨重启行为仍未验。新能力不重写0.18旧版本只读通过记录；实际验收新文件，旧0.18自增核心/UI仅按仍适用的MySQL8范围另作回归，不能将旧只读预期当作新能力证明。
6. 最后复核W03令牌/命中导航、四属性与O01三元终态、原D04输入保护，再由ROOT核定新候选范围、版本和发行工作。当前没有安装包、正式发布或main合并结论。
