# D06：当前页查找替换与表列偏好验收

## 当前状态

2026-10-14：0.6 开发源码二轮验收为 **4 项离线、6 项实库 UI 全部通过**；随后同一构建单独验证新增 CSV 原型表头导入 **1/1 通过**。两次成功运行均为 0 失败、0 跳过、0 flaky，不能表述为一次连续执行全部 7 项。首轮实库 3 通过/3 失败原始证据完整保留。实库套件为 `tests/e2e/table-grid-preferences.spec.ts`。

准备检查：`node node_modules/typescript/bin/tsc --noEmit` 通过；首轮 `--list` 列出 6 项，追加 CSV 回归后最新 `node node_modules/@playwright/test/cli.js test tests/e2e/table-grid-preferences.spec.ts --list` 实际列出 7 项。列表命令未执行任何测试。

本批次在 0.5 源码冻结提交 `84a829b` 之后开发；不属于已冻结 0.5 安装包或公开版本的验证结论。三平台安装包、完整回归及最终发布文件验收均待主智能体统一安排。本文件不修改之前 Q05 或 0.4/0.5 的成功、失败和诊断证据。

## 实际契约与验收范围

- 查找扫描当前已加载页的可见列，包含未提交草稿、排除待删除行；不自动访问其他页。文字按完整原值查找，支持区分大小写和整格匹配；SQL NULL、未填写 DEFAULT 与同名文字分开处理。二进制不参与文字查找，精确数值只按完整字符串查找。
- 替换只针对具备可靠键的 InnoDB 表中非生成 CHAR/VARCHAR/TEXT 列。预览不修改草稿，确认先一次形成草稿，另经普通表格 SQL 预览及集中提交才写数据库。数值、JSON、日期、NULL、DEFAULT、二进制不属于文字替换对象。
- 列偏好按连接 ID、数据库名、表名保存；数组顺序决定展示顺序，每项包括列名、隐藏状态和可选宽度。网格、勾选行复制、矩阵粘贴和查找共用可见列顺序。完整行草稿及隐藏主键/旧值不能因此丢失。
- 结构调和保留仍存在的列偏好，移除已删除列，追加新增列。布局可即时应用到当前标签，但只有界面明确保存后才能作为持久化成功。

## 用例与判定依据

| 用例 | 实际操作与断言 | 当前结果 |
| --- | --- | --- |
| 当前页与虚拟导航 | 125 行、28 个业务列，界面明确选取每页 100 行。远行远列唯一值起初不在 DOM，点击“下一处”后核验真实活动格、行列 aria 坐标、行 DOM 数量有界。第二页独有值在第一页匹配 0；用户明确翻页后才匹配 1。 | 二轮通过；首轮初始化错误见下文 |
| 草稿与值类型 | 分别查文字 NULL、SQL NULL、空字符串所在行、新增行未填写 DEFAULT；BLOB 十六进制/文字不混为文本命中。核验大小写/整格选项，BIGINT UNSIGNED、DECIMAL 精确字符串、`__proto__`/`constructor` 原型同名列。修改草稿可被查到，观察连接仍读原值；待删除行不再命中。数字替换明确拒绝。 | 两轮通过 |
| 替换预览与冲突 | 两行、四个文字单元格，替换值含字面 `$&`。预览和确认形成草稿后分别核验任务列表不变、数据库原值不变；形成 2 条待提交修改。观察连接在第二行制造并发变化，真实集中提交只能出现一次失败任务，第一行必须回滚、第二行只保留外部修改，草稿保留。 | 二轮全部通过，包含真实整批回滚 |
| 布局后的数据身份 | 隐藏主键及备注列，重排原型同名列；真实剪贴板事件按可见顺序做两行矩阵粘贴和勾选行复制。提交后独立读取真实 ID、FK、隐藏备注和可见文本。原活动 FK 在重排后仍读取正确父记录，选普通列或隐藏活动 FK 后不能串列导航。 | 二轮全部通过，包含原型列真实提交 |
| 真实持久化与结构调和 | 通过界面保存列隐藏、顺序、宽度，关闭表再打开，并真正退出/重启同一 userData 再打开。核验真实 IPC 存储及实际列宽/顺序；另一表保持默认。外部 ALTER 删除旧列、添加新列，刷新后核验调和和保存；界面恢复默认须使该条持久化记录消失。 | 两轮通过 |
| 快捷键及模态保护 | 网格活动单元格 Ctrl/⌘F 聚焦查找输入，真实键入查找词后草稿/数据库仍原值；已开面板再按 F/H 重新聚焦查找/替换框，NULL/DEFAULT 时聚焦类型选择。编辑器、列偏好模态不被抢焦点；替换预览期间 Ctrl/⌘Enter 不触发后台集中提交，任务不增加、数据库不变；取消预览保留既有草稿。 | 两轮 Windows 通过；未外推 macOS |
| 原型表头真实 CSV 导入 | 文件表头 `__proto__/constructor/id/note` 与数据库列顺序不同；字段必填、ID 唯一。真实原生文件选择授权、预览、手工切换映射、一次开始导入，经 files.import/worker 写库。观察连接逐行核 Unicode、逗号、引号、换行、行数及唯一成功任务；保存列偏好后检查行内容不落布局/SQLite。 | 第三轮定向 1/1 通过，实际保存 2 行 |

布局存储预算、非法参数、磁盘失败、目标身份变更/连接删除及独立 IPC 重启覆盖由 `tests/e2e/table-preferences.spec.ts` 和对应单元测试负责；它们的实际结果须独立记录，不能由本文件的 UI 结果推断。当前 6 项 UI 并未声称穷尽 JSON/日期等所有排除类型、全部数据库版本或多平台输入行为。

## 运行与证据约定

1. 仅在 `DBARK_INTEGRATION_ENABLED=1` 时启用实库套件，默认 CI 跳过。凭据从已忽略 `.cache/dbark-test.env` 静默读取，不打印、不提交；禁止在 Playwright trace 中记录真实连接表单。
2. 使用已核对的 Server-200 / `192.168.31.200:13384` 专用 MySQL 8.4 实例，不使用本机 Docker。本测试不调用 Docker，也不接触业务库、其他 agent 的随机测试库或用户已有表。
3. 每例通过真实连接表单和对象树创建独立 `dbark_e2e_*` 随机库。服务器造数及并发外部修改由独立观察连接完成；被测连接、读取、编辑、替换和集中提交不模拟 IPC 或数据库响应。
4. 剪贴板覆盖使用真实 DOM `ClipboardEvent` 和 `DataTransfer`，走 RDG 复制/粘贴处理；这是应用事件链路验收，不能表述为已验证所有操作系统剪贴板互通。
5. 布局读取使用只读 `table.preferences.get` 观察保存结果，不通过 IPC 写入布局绕过界面。所有动作采用真实 DOM 就绪条件，不用固定 sleep、force click 或写入自动重试。
6. `isolatedDatabase` 在 `finally` 中先真实退出 Electron、核对本次子进程结束，再精确 DROP 当前唯一随机库并查询 `information_schema.SCHEMATA` 确认 0。夹具仅删除本次创建的 userData 临时目录。退出时允许放弃本例故意保留的草稿，不以此伪造保存成功。
7. 凭据加密不可用的平台，重启时只通过真实编辑连接表单重新输入本例密码；列偏好仍须实际持久化恢复，不能因为密码仅会话保存而跳过布局断言。
8. 统一冻结和构建后，在专用 `.cache/p0-grid-preferences-*` 前缀保留日志、JSON 结果和截图。若出现失败，保留首轮证据，区分运行时缺陷、测试输入/定位问题和未支持边界；任何修复后另记新轮次，不覆盖失败。

计划截图包括虚拟远行远列、类型/草稿、替换预览、并发冲突、隐藏键和可见顺序、重启及结构调和、快捷键模态保护。实际截图路径、运行命令、数据库版本、构建输入、耗时、通过/失败/跳过数量及清理结果将在真实执行后追加。

## 首轮源码实测（保留失败）

运行前通过既有 SSH 只读确认 `hostname=Server-200`、地址包含 `192.168.31.200`、当前用户为 `root`；没有执行 Docker 命令。项目目录内没有遗留 DBArk/Electron 进程。

- 类型检查：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 构建：`node .cache/run-p0-grid-preferences.mjs build run01-build`，2026-10-13 22:12:11.979 UTC 开始，26,182 ms，退出码 0。
- 离线：`node .cache/run-p0-grid-preferences.mjs offline run01-offline`，Playwright JSON 为 **4 通过、0 失败、0 跳过、0 flaky，9,590.452 ms**。真实 SQLite、IPC、重启、磁盘失败和迁移覆盖，没有连接数据库。
- 实库：`node .cache/run-p0-grid-preferences.mjs live run01-live`，Playwright JSON 为 **3 通过、3 失败、0 跳过、0 flaky，47,757.376 ms**。测试重试数 0。基本数据仍只在随机隔离库中。

源码和产物 SHA256、字节数及 mtime 全清单位于 `.cache/p0-grid-preferences/run01-build/source-files.json` 和 `build-files.json`。关键输入 `PageFindPanel.tsx` 的 mtime 为 22:10:26.925 UTC，`TableTab.tsx` 为 22:10:29.087 UTC，均早于本次构建，包含快捷键焦点修复。

| 构建产物 | SHA256 |
| --- | --- |
| `dist/main/index.cjs` | `2ef59deddbb322de6e35d73eac68ddb7453a7c6ec73fee6c470e52a76c60e889` |
| `dist/main/worker.cjs` | `298fa2fba47c9940606f9364fa90b32d283ba139793fa10e5828deb2bc37c065` |
| `dist/renderer/assets/index-Dqt_YJmN.js` | `ba3a3a4dd5205304bf273c77fd274c218f7373c51872dc7a1af9b855f968cd3a` |

### 失败诊断与修复边界

1. 第 1 项错误假设新配置默认每页为 100，真实 DOM 和 `src/main/storage.ts` 显示默认为 200，因此在查找操作前即失败。测试已改成用户通过每页行数选择器明确选择 100，再等待真实加载完成；仍保留跨页不命中、远行远列和 DOM 有界断言。此修正未更改运行时代码，首轮失败不覆盖。
2. 第 3、4 项均在 `TableTab.makePreview → invoke('table.preview', { ...base, changes })` 报“缺少完整原始行：__proto__，请刷新数据后重试”，无法打开 SQL 集中预览。替换草稿或普通矩阵粘贴在 DOM 中均显示正确原型同名列值，观察连接仍为原值；普通粘贴也复现，因此不是替换专属缺陷，而是本批揭示的通用表格提交路径问题。当前真实证据没有逐段捕获 IPC 入站/出站 payload，不能仅凭报错宣称已确认字段在哪一层丢失。已将最小 fixture 和 `z.record` 候选入口交给后端负责人确认；不会删除原型字段或弱化提交/冲突断言以通过验收。

所有原始证据保存在 `.cache/p0-grid-preferences/run01-live/` 的 `live.log`、`results.json`、`summary.json`、`output/**/error-context.md` 和 `live-failure.png`。已实际查看原型缺失失败 PNG 及重启/结构调和成功 PNG。成功截图包括 `grid-find-types-draft.png`、`grid-layout-restart-schema-reconcile.png`、`grid-modal-editor-shortcut-guard.png`；替换零写阶段的 `grid-replace-preview-no-write.png` 不能冒充后半提交成功。

后端随后以独立探针确认：旧 `z.record` 将输入中自有的 `__proto__` 字段过滤，`constructor` 和普通字段仍保留；行数据及导入字段映射均受影响。证据分别为 `.cache/d06-proto-zod-evidence.json`、`.cache/d06-proto-import-mapping-evidence.json`。修复改为逐自有字段校验并以 `Object.fromEntries` 安全重建，继续拒绝非法值、继承字段、访问器以及真正缺少原始字段的修改；不改变引擎旧值比较和事务逻辑。后端报告新增 7 项单元覆盖（含实际 `collectChanges → validateCommand → buildChanges`），全量 402 项及类型检查通过。UI 必须使用包含此修复的新构建实际复验，不能把上述探针或单元结果代替真实集中提交结论。

22:15:05.804 UTC 的 `.cache/p0-grid-preferences/run01-cleanup.json` 只读复核六个专用端口：匹配本批 E2E/流式测试命名的随机库、临时用户和服务器线程全部为 0，新测试临时目录为 0，13 个旧目录保留。`.cache/p0-grid-preferences/run01-processes.json` 同时证明本项目 Electron/DBArk 进程为 0。容器、卷、网络保留供后续公开包验证，未在本批删除。

## 二轮源码完整定向复验

修复冻结后重新构建，未复用第一轮主进程产物。`run02-build/source-files.json` 记录 `src/shared/validation.ts` 为 2026-10-13 22:17:25.375 UTC、SHA256 `1bc6f3273ce2938ff8f7f7fb3855d20a43fab9e9c3b793f2695ea37945b8518d`；构建在 22:18:37.941 UTC 开始，25,910 ms 后成功。

| 二轮范围 | 实际结果及 Playwright 时长 | 证据 |
| --- | --- | --- |
| `table-preferences.spec.ts` | 4 通过，0 失败/跳过/flaky，8,652.232 ms | `.cache/p0-grid-preferences/run02-offline/{offline.log,results.json,summary.json}` |
| 当时 6 项 `table-grid-preferences.spec.ts` | 6 通过，0 失败/跳过/flaky，39,243.556 ms | `.cache/p0-grid-preferences/run02-live/{live.log,results.json,summary.json}` |

两轮均为真实 Windows Electron 源码运行，保持 sandbox，0 自动重试。第二轮执行的 6 项测试源码 SHA256 为 `6a3c316f572310461a8050f5a1f3d837a9e43c5d93b1135fabcf76671a535020`；之后追加的 CSV 第 7 项不在本次统计中。

二轮 `dist/main/index.cjs` 为 83,500 字节，mtime 22:18:38.343 UTC，SHA256 `03afc9bf3a54034857c678b9215b8ff6f0cec8a20dec5987b6088955662a194f`。worker 与 renderer 字节哈希与第一轮相同，但均由本轮重新构建生成；完整产物清单保存在 `run02-build/build-files.json`。

原型字段现在真正经过界面草稿、IPC、引擎预览与提交：第 3 项只出现一条失败的 `table.apply`，观察连接确认第一行回滚、第二行仅保留外部并发修改、DECIMAL 不变；第 4 项正常提交 2 行，观察连接确认 `__proto__` 和标题逐行更新、隐藏 ID/FK/备注原值完整。不能把前者的预期冲突失败任务计成 E2E 失败，也不能把后者的成功提示替代观察连接校验。

已实际查看以下二轮 PNG（均位于 `run02-live/output/` 下对应中文用例目录）：

- `grid-find-virtual-current-page.png`：网格已横向定位到第 28 个业务列、纵向定位到远行；第一页查第二页独有值为 0。
- `grid-replace-conflict-rollback.png`：预览包含原型字段的参数化 UPDATE，界面明确报告整批回滚，观察连接断言同时通过。
- `grid-visible-order-and-hidden-key.png`：提交后的原型值/标题正确，主键和 FK 隐藏后活动格仍为正确可见列。

另外保留类型草稿、替换零写、重启/结构调和和快捷键保护 PNG，供独立复核。22:20:15.101 UTC 的 `run02-cleanup.json` 核对六端口匹配测试库、临时用户、服务器线程均为 0，新临时目录为 0；22:20:15.502 UTC 的 `run02-processes.json` 记录项目 Electron/DBArk 进程为 0。13 个旧目录及专用容器/卷/网络保留，没有扩大清理范围。桌面已交还主智能体进行 0.5 公开包验收。

二轮结束时，第 7 项 CSV 回归仅完成类型检查和测试列表发现；获主智能体单独授权后才执行下述第三轮。0.6 完整源码/安装包回归及三平台验证仍待统一执行，本文件不提前填入成功结果。

## 第三轮：新增 CSV 原型映射单例

主智能体完成 0.5 公开包验收并释放桌面后，仅运行新增第 7 项，未重复前 10 项、未重新构建或打包。执行前逐个核对 `run02-build` 中全部源码和产物 SHA256，`run03-input-verification.json` 记录差异为空；实际测试源码 SHA256 为 `a99dbdffc407f7b5122a6d48cc4464ee4cdd83aff0da42f07543f923e4a3579a`。

实际命令为 `node .cache/run-p0-grid-preferences.mjs live run03-proto-import "真实 CSV 原型表头映射"`。Playwright JSON 开始时间为 2026-10-13 22:27:43.064 UTC，结果 **1 通过、0 失败/跳过/flaky，5,498.033 ms，0 重试**。证据位于 `.cache/p0-grid-preferences/run03-proto-import/{live.log,results.json,summary.json,output/}`。

本例操作真实 Electron UI 的导入按钮、格式/编码、文件选择按钮、字段映射及单次“开始导入”。**仅 `dialog.showOpenDialog` 返回的路径被测试替换**；没有人工操作原生操作系统文件选择器，因此不能声称验证了系统选择器交互。主进程文件授权令牌、预览、手工映射构建、`files.import` IPC、worker 文件读取和 MySQL 写入均保持真实，没有模拟 SQL/worker/文件 IO。

预览阶段任务列表和服务器空表未变化。单次开始后只有一条新增的成功 `files.import` 任务，观察连接实际读取恰好 2 行，并逐字段验证原型同名列、Unicode、逗号、引号及换行；可靠主键防止把重复写入误认为成功。刷新表页也读回导入值。最后通过界面隐藏备注并保存偏好，真实偏好内容和 SQLite 字节均不包含两条虚构单元格标记。源 CSV 原件保留在该用例输出目录，不含真实业务或数据库凭据。

已实际查看 `grid-prototype-import-mapping.png` 和 `grid-prototype-import-completed.png`。22:27:59.903 UTC 的 `run03-cleanup.json` 复核六个端口的匹配随机库、临时用户和服务器线程均为 0，新测试临时目录为 0；`run03-processes.json` 确认本项目 Electron/DBArk 进程为 0。13 个旧目录、专用容器/卷/网络继续保留，桌面已再次释放。

## 独立旧版本配置结构兼容性证据

主智能体另以冻结 0.5 提交 `84a829b77d5be7613ad30f4a9374afe1ea85d8c2` 的真实旧 `storage.ts` 单独编译，生成 schema 2 配置，再用当前 reader 迁移到 schema 3。`.cache/d06-schema-reader-compatibility.json` 记录旧七表字段全部保留、测试凭据可读；旧 reader 打开新库的独立副本明确拒绝，副本与迁移源 SHA256 均未改变，临时目录已删除。

该探针使用合成凭据保护器，是实际旧源码结构兼容性测试；`systemEncryptionTested=false`，不能表述为 0.5 NSIS 升级或操作系统加密验收。它与上述真实 Electron 离线 4 项相互补充，证据边界分别保留。

## 本机 Windows NSIS 完整回归

主智能体在上述源码及第7例通过后，保持全部运行代码冻结、使用 build02 的既有 dist（run03已逐SHA确认无变）构建 NSIS。本机包 `DBArk-0.6.0-win-x64-unsigned.exe` 为 137478265 字节，SHA256 `d50df296b3d26d0ae7c378797cd385e11907d59a4e571104271acddeff421153`；`.cache/local-v0.6.0-build.log` 保存构建结果。

完整实际安装 **49/49 通过，300938.433ms**，0失败/跳过/flaky/重试，包含本批11项及旧38项、百万行UI，进入真实系统加密分支。安装开始UTC `2026-10-13T22:33:32.034Z`，结束 `22:38:46.527Z`；独立目录 `dbark-package-e2e-cqS1Za` 真实卸载并删除，注册0。结果 `.cache/local-v0.6.0-install-validation{.json,.log,-results.json}` 保留，未修改用例或重放失败写SQL。

UTC `22:39:45.963` 的 `.cache/local-v0.6.0-cleanup.json` 额外只读确认六实例本批随机库、用户、线程，本机项目进程和本批临时目录均0，13历史目录保持，没有删除专用容器/卷/网络。本机包不代替后续公开下载；三平台原生及公开安装在实际执行后另记。
