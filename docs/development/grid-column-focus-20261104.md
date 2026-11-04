# 列名搜索与单列内容适宽验收

日期：2026-11-04。由 Mac 接续 `codex/macos-handoff-20261104`（起点 `1785e83f`），完成交接中的列布局增量。长期目标继续进行，本批不创建正式 Release、发行标签或部署。

## 功能与使用

- 表列偏好和 SQLite 列布局支持搜索列名，忽略大小写及两端空格。搜索只过滤设置列表，前移、后移仍使用完整列顺序；无匹配时显示提示。
- 表格与查询结果的可见列旁提供「适应内容」，复用现有抽样测量，最多读取 64 条已载入记录，自动宽度为 64～640 像素。
- 单列适宽保留其它列的宽度草稿、隐藏列尺寸、列顺序及冻结边界。查询结果的同名列按唯一内部键及原序号区分；非法宽度仍阻止应用，取消不发布草稿。
- 表格布局即时生效，仍需明确保存；查询结果仍需点击「应用列布局」。这两个动作不重新执行 SQL。

## 环境与失败定位

实际平台为 macOS arm64，Node.js 24.14.0、pnpm 12.11.2、Electron 44.7.0；Xcode、`cc` 与 `codesign` 已核。重新安装锁定依赖并生成 SQLite 双架构原生模块，没有使用本机 Docker。

按 `AGENTS.md` 查询 WIN11-TEST 测试会话时，远程主机不可达。本轮没有向其派发测试，按既有回退规则在 Mac 串行验证；不引用历史 Windows 通过数作为本批验收。

首次原定 7 个套件：96 项通过、4 项失败、9 项因套件初始化失败跳过，退出码 1。冻结查询夹具只替换了 SqlEditor，漏掉 QueryTab 直接导入的 Monaco 标记端口；冻结表夹具缺少行高受控下拉框需要的选项集合。分别补齐测试端口后原断言全部通过。交接中查询列套件的 10 秒初始化超时在本机未复现；保持原超时及资源保护，没有扩大时限。

新增两项 UI 回归，覆盖搜索后的完整顺序、同名列隔离、隐藏列和未失焦草稿、冻结边界、过期与 pending 回调、取消不发布。测量只替换字体和 canvas 端口，布局与范围计算执行产品代码；真实测量另由原生窗口验证。

## 本批验证

| 验证 | 结果 |
| --- | --- |
| 定向单元 7 套件 | 111 项通过、0 失败、0 跳过，退出码 0 |
| 严格类型与构建 | `pnpm build` 通过；类型入口保留原 4096 MiB 堆预算，构建进程使用 2048 MiB；现有大分块提示保留 |
| SQLite 表浏览真实 Electron 窗口 | 1 项通过，26.2 秒，原单次 120 秒及资源门不变；搜索、单列适宽、隐藏、顺序、冻结、保存与重启恢复均通过 |
| 查询结果列宽真实 Electron 窗口 | 1 项通过，3.2 秒；真实拖动、同名首列单独适宽、其它列保持、批量设置、默认宽度及重新执行重置通过 |
| 两个 Swift 辅助程序编译 | `macos-mode-keeper.swift`、`v028-probe-macos-display.swift` 编译为 arm64；未运行显示模式变更程序，编译器有沙箱宏加载警告但退出码均为 0 |
| Git 差异检查 | `git diff --check` 通过 |

表浏览原始附件已独立读回：34 行原值逐项相同，零用户 SQL／事务、零系统剪贴板操作，两次准确 owner 正常退出码均为 0，专用 profile 与 SQLite 目录已清理。查询原例检查两次明确执行的历史、真实宽度、行高及空页面错误列表。两个原生用例均单 worker、零重试、关闭 trace。

实际命令（pnpm 经 `COREPACK_HOME=/private/tmp/tabrelio-corepack corepack pnpm` 调用，固定 12.11.2）：

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm exec vitest run tests/unit/grid-column-fit.test.ts tests/unit/table-preferences.test.ts tests/unit/frozen-column-model.test.ts tests/unit/frozen-query-ui.test.tsx tests/unit/frozen-table-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-ui.test.tsx --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=2048 pnpm build
DBARK_INTEGRATION_ENABLED=0 node scripts/sqlite-workspace-ci.mjs table
DBARK_INTEGRATION_ENABLED=0 PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/query-result-widths/report.json pnpm exec playwright test tests/e2e/query-result-widths.spec.ts --workers=1 --retries=0 --trace=off --reporter=list,json --output=test-results/query-result-widths
xcrun swiftc -module-cache-path .cache/grid-column-focus-macos-20261104/swift-cache scripts/macos-mode-keeper.swift -o .cache/grid-column-focus-macos-20261104/macos-mode-keeper
xcrun swiftc -module-cache-path .cache/grid-column-focus-macos-20261104/swift-cache scripts/v028-probe-macos-display.swift -o .cache/grid-column-focus-macos-20261104/macos-display-probe
git diff --check
```

原始日志与截图在本项目 `.cache/grid-column-focus-macos-20261104/`；原生 JSON 报告在 `test-results/sqlite-table-browse/report.json`、`test-results/query-result-widths/report.json`。交付归档包含本记录、当前用户手册、原始日志／报告和两张功能截图，源文件继续保留于项目，SHA-256 清单随归档保存。备份位置为 `/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-列名搜索与单列适宽-v1/`。

本批未运行全量单元、MySQL／MariaDB 实库窗口、Windows 本增量窗口、Mac Intel 程序、升级后钥匙串读取、正式安装包及系统剪贴板验收。两架构 SQLite 模块编译不等于两架构客户端实际验收。不增加完整 Navicat 工作包或公开发行计数，后续继续按使用频率推进。
