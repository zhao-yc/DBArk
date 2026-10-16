# 0.19 第二轮候选集成准备

基点固定为 `d2ca1567ded39c760dc0205cf517a384e673a43e`，普通克隆为 `D:/svn/DBArk/.cache/parallel-20261015/w02-workbench`，分支为 `codex/employee1-019-round2-integration-20261016`。开始时工作区干净、HEAD 与上游一致，先完成 fetch，再从指定基点建普通分支；没有使用工作树或修改作者/ROOT 克隆。

本轮是源码候选准备，版本仍为 `0.18.0`。完整补取及其两个修正一起纳入；没有单独交付未修正的 `7660`，没有提升版本、合并主分支或触发发布。0.18 发布、最终集成和真实验收仍由 ROOT 负责。

## 精确来源与可逆映射

全部使用 `git cherry-pick -x`，正文保留完整来源。六笔顺序如下；没有重复挑入 ROOT 的 `db8487a`/`89b28db` 映射提交。

| 范围 | 原提交 | 本分支对应提交 |
| --- | --- | --- |
| 完整记录来源租约与只读补取 | `7660c4b6b37994af32be83aba9576802248346ed` | `9ca2ad4281ea70c3e7c66f855a7e11cb3d6ebe8a` |
| 目录/来源页竞态修正 | `7112152166b88f7a6379b8b7ad860abe17f0559c` | `2c8e4222c92a0b1e8955e1762630d5da87a94de2` |
| 正式替换测试依赖修正 | `8eb9775642a4dd247587b20420ccab1b360bafcb` | `e50db8f35869648790cfe1701d1110db8a1812bf` |
| Q01 独立正式 UI 准备 | `1f375ce1d03a31039a20b31e946a1dc78fc124f9` | `5c883b594d13efb398585311ff0b7eb2dc8dd66b` |
| 默认关闭组件 CI 入口 | `9205de93b4d707b1d0810cc89a92c9c7afcf70a4` | `1814bedd9a250314bc1c15bae82812348ab70e69` |
| 组件剪贴板恢复与 CI 参数修正 | `c3042eccdf9792b7b26ae160b1365f954521ae3e` | `e968e412dda85120a08db706d77ea36d14c4cfc5` |

挑入链末端为 `e968e41`；最终交接 SHA 再包含本文与下面两份正式测试适配，由分支日志和最终交接消息给出。恢复或撤销应按这些映射处理，不改写来源历史。

## 共享合并与测试适配

文本冲突只有 `TableTab.tsx`，共四处：`7660` 三处、`711` 一处。

- 加载前同时保留 D04 导航票据领取，以及复制读取失效、旧任务取消和新来源任务标识，全部发生在第一个 await 前。
- 成功加载只生成一次新行 UUID；保留 D04 页码/页大小核对与导航完成，同时发布同次来源页、完整目录身份和行引用。采用 `711` 的挂载/代次守卫与同页目录绑定，避免较早目录信息绕过来源校验。
- JSX 以基点 D04 布局为底，加入补取按钮条件、读取取消提示；保留网格点击撤销导航、RecordFormPanel 跨页属性、PageFind 与所有表工具接线。
- `711` 的 JSX 冲突只采用新的完整目录拒绝条件，保留已组合的其它布局和导航属性。

Engine、主进程、contracts、validation 自动合并后逐项核对：保留 Q02 当前语句执行及实际片段历史、legacy 自增第四确认、原任务和查询契约；只扩展显式来源页、只读补取与内存释放。连接关闭/配置保存前新增的租约清理采用 `711` 原实现。

首轮正式定向 471 项中 436 通过、35 失败，集中为双方测试端口缺少新依赖，没有修改产品行为来绕过失败。本轮仅适配两份正式测试：

- `record-copy-metadata.test.ts` 引用真实 D04 状态机与真实 `getRecordPageContext`，补全工作区/标签端口；原 23 项断言保持。另加两项实际处理器回放：补取占门时跨页/布局不变、重复取消一次；重新加载释放旧租约后，迟到回包不覆盖新页或自动重试。
- `record-cross-page-mixed-table-tab.test.tsx` 抽取真实复制失效/释放函数并补齐来源状态。新增来源任务先消耗一次 UUID，因此严格的新页行身份由旧测试的 1/3 调整为 2/5；仍核对真实新行身份及原筛选、排序和分页载荷，并新增 `copySource/taskId` 精确期待。完整本地复制正例提供生产要求的同页目录绑定。

两份组合测试最终 54 项通过，均是本分支的正式 tracked 测试。`8eb` 的 `page-replace-current.test.ts` 逐字保留，不使用缓存桥接冒充正式通过。

## 保留证明与本轮验证

Git 对象/AST 比对 661 项全部通过：

- 逐函数、逐命令核对旧实现及 `711` 明确扩展；主进程删除本轮两个复制分派后，原完整 dispatch 逐 AST 等于基点，包含 Q02 历史路径。
- D04 导航票据、页码核对、成功/失败提示及布局后选行保留；`load` 同时保留 `711` 全部实际语句和守卫。DataGrid、RecordFormPanel、PageFindPanel、App 表页属性保持。
- TaskRecord/TaskEvent、原 TablePage 字段及其它全部命令/校验保持，保留 Q02 和 legacy 约束。复制源核心、目录及完整性判断文件逐字等于 `711`。
- 原 W03 八项、D04 十项、Q02 五项、原四个补全/会话 spec、公共 caret helper、45 项 helper 纯回归及旧 SQL 文件保持。Q01 新 spec 等于 `1f375`；CI/组件五个关键文件逐 Git blob 等于 ROOT 已实测的 `c304`。
- 来源涉及 31 文件；25 文件逐 blob 等于最后来源，5 个共享产品组合文件及 1 个正式测试适配单列。额外适配另一份原 D04 测试；其余 1,098 个基点文件、60 份旧验收记录保持。额外文档只有本文。版本、锁文件、README、CHANGELOG、coverage 和既有发行材料不改。

| 检查 | 实际结果和边界 |
| --- | --- |
| 扩大正式单元 | 229 文件、4,473 个唯一用例完成验证；首轮 4,464 通过，9 项自建 junction 遇沙箱 EPERM；仅放开该文件操作限制后，同文件 34 项全部通过并覆盖原 9 项失败。原报告保留，不重复计数。 |
| 完整补取纯回归 | 6 份相关正式文件共 160 项通过，已包含在扩大单元中；组合两文件 54 项也包含在同套报告中。 |
| 明确排除 | `tls-credentials-engine.test.ts` 会生成内存临时私钥，按本轮限制未执行；不宣称完整无排除单元。其它断言和期限保留。 |
| 类型 | `tsc --noEmit` 退出 0。 |
| 构建 | `node scripts/build.mjs` 退出 0，Vite 33.31 秒，仅本克隆源码构建；保留大 chunk 提示。 |
| GUI 列表 | 317 项、错误 0、实际执行 0；含 Q01 新专用 5 项、完整复制 5 项。新增专项及实库总门关闭。 |
| 列表守卫 | 原生/子进程实际放行、网络、私有文件读取均 0；阻止一次 Node 平台探测，列表仍成功。 |

新构建共有 339 个 src 文件、108 个 dist 文件。精确清单和摘要保存于本员工忽略缓存 `.cache/019-round2-integration/final-src-manifest.json` 与 `final-dist-manifest.json`。原 run805 产品 dist 的 108 个文件在 `base-dist/` 备份并逐文件核对，`base-dist-manifest.json` 保留其原摘要；没有覆盖 ROOT 的旧失败现场或 31 项验收证据。

忽略缓存还保留 `targeted-initial-results.json`、`mixed-results.json`、`broad-initial-results.json`、`junction-retry-results.json`、`compatibility.json`、`preservation-proof.json`、`preparation-data.json`、`ui-list.json`、`collect-guard.jsonl`、`typecheck.log`、`build.log` 和两轮冲突原件。未提交运行环境、日志、产物或身份材料。

实际命令（工作目录为上述普通克隆）：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --config .cache/019-round2-integration/vitest-targeted.config.mts --reporter=json --outputFile=.cache/019-round2-integration/targeted-results.json
node node_modules/vitest/vitest.mjs run tests/unit/record-copy-metadata.test.ts tests/unit/record-cross-page-mixed-table-tab.test.tsx --config .cache/019-round2-integration/vitest-targeted.config.mts --reporter=json --outputFile=.cache/019-round2-integration/mixed-results.json
node node_modules/vitest/vitest.mjs run --config .cache/019-round2-integration/vitest-broad.config.mts --reporter=json --outputFile=.cache/019-round2-integration/broad-results.json
node node_modules/vitest/vitest.mjs run tests/unit/c02-ssh-paths.test.ts --config .cache/019-round2-integration/vitest-broad.config.mts --reporter=json --outputFile=.cache/019-round2-integration/junction-retry-results.json
node .cache/019-round2-integration/check-compatibility.mjs
node scripts/build.mjs
node --require ./.cache/019-round2-integration/collect-guard.cjs node_modules/@playwright/test/cli.js test --list --trace=off --reporter=json --output .cache/019-round2-integration/ui-output
```

Vitest 仅为本克隆位于 `.cache` 而调整发现路径，限定两个 worker、原期限和上述单个 TLS 排除。没有执行实际 GUI、200、私有 env/key、系统剪贴板或 Docker，没有手动触发或运行 CI。

## 尚未实测的界面与证据归属

- 完整记录补取的五项正式 UI：完整/INVISIBLE 源值、精确值、来源拒绝、取消、并发修改和补取后的预览提交，等待 ROOT 在当前新产品构建实测。
- Q01 五项独立正式 UI 内含六个正向和十个阻断场景，等待 ROOT 验真实 Worker、建议接受/撤销、隔离及任务/历史不变性；没有把内部场景数当成 Playwright 用例数。
- 共享表页加载已增加来源租约，D04 跨页、列布局、草稿、普通表工具及迟到回包组合的原生行为尚未在此新 SHA 实测。纯端口和保留比对不能代替这些验证。
- ROOT 原 31 项源码用例继续归属其原固定源码/构建，不自动转记为本轮候选通过。原失败批和 CLI 非零结果保持原样。
- ROOT 已验证的三平台 12 项组件 CI 与原 281 项计划保持原归属。本轮只保留对应文件的精确来源，不将其算成当前候选的新安装、跨平台或发布证明。

本轮最终只提交、推送专用分支并交固定 SHA，ROOT 再决定实际验收、后续合并、版本提升和发布。
