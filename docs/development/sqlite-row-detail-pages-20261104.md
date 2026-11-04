# SQLite只读表及视图行详情跨页

日期：2026-11-04。源码基线main `ba6234df`。继续推进D04／R02记录浏览工作流，保持Electron／React／TypeScript独立客户端；不创建发行、安装包或部署，完整Navicat对标目标仍未完成。

## 使用

在SQLite只读表或视图的网格选中一行，从“更多”打开“行详情”。当前页内的“上一行／下一行”和行号跳转只使用已加载数据。到达本页首末行且存在相邻页时，按钮改为“上一页末行／下一页首行”；点击后沿当前已应用的筛选、排序和页长读取一次相邻页，自动打开新页的准确末行或首行。

尚未应用的筛选正文保持，但不会带入跨页请求。新页重新绑定全部字段和实际存储类型，包含隐藏列；字段搜索、展开和字段分页按新页重置，页内切行仍保留搜索。此功能不处理任意SQL查询结果跨页，也不把可编辑表快照当作只读详情；可编辑表整行表单沿用[上一批独立实现](sqlite-record-cross-page-20261104.md)。

读取中可使用原表页停止按钮。停止、读失败、空页、结构变化或来源失效后不自动打开旧详情，说明显示在原表页；空页不继续扫描，也不额外COUNT。可用原分页或明确刷新后重新选行。数据变化仍可能使OFFSET分页重复或遗漏，不提供数据库快照分页。

## 实现和来源保护

新增 `sqliteRowDetailPageNavigation.ts`，只保存内存中的准确原页及一次续读意图。源目标种类、连接／库／表、结构键、列元数据、页长、源偏移和边界行号均核对；只读表与视图分开绑定。意图只接受原Browser终态发布的准确新页，消费一次新页首末行号，不复制旧字段值、不根据同名键猜记录。

父页跨页前复核当前详情租约、原页、原连接配置及修订、原标签、活动状态、结构修订、已应用条件的引用与值及无外来模态／作业。同步工作区订阅与模态观察保留永久失效标记，连接／标签短暂切换后恢复也不能复活旧自动打开权。普通刷新／分页沿原 `dropEditor` 撤销意图；停止和晚回包仍由原Browser准确收尾，不借取消响应猜测读取已终止。

新的完整原结果由原 `QueryRowDetails` 绑定后才打开准确首末行，旧详情的翻行、跨页和关闭回调继续逐项校验。原查询结果侧栏未提供跨页能力，其页内只读行为保持。没有新增IPC、引擎接口、持久化格式或依赖，也不保存未完成意图。

## 验证

实际环境为macOS arm64、Node.js 24.17.0、Electron 44.7.0。WIN11-TEST本轮只读核对仍不可达，未派发任务，按仓库既有规则在Mac串行验证。只使用独占合成SQLite文件，不使用SSH、Docker、真实业务库或系统剪贴板。

- 首轮40项通过；新增父链和UI用例的第一轮51项通过、1项失败：新增独立UI夹具漏了afterEach设置保存所需的RAM端口，补齐明确的 `settings.save` 端口后复验。产品无须因此修改，失败日志／JSON保留。
- 最终8份相关测试文件130项通过，覆盖只读表及视图边界、原数据引用／精度、准确新页一次消费、页内与跨页入口、旧闭包、连接／标签／条件／结构／外来模态ABA，以及真实Browser停止、空页和读失败。
- 严格类型检查退出码0；最终构建通过（12.47秒），保留现有大分块／第三方PURE注释提示。默认 `--list` 只列举原1项用例，不启动桌面或加载合成数据库。
- 完整单元1277份测试文件全部通过：26650项通过、10项既有Windows专属tar平台条件跳过、0失败；退出码0，449.40秒。已独立解析完整JSON核对统计，分轮结果不相加。

Mac真实Electron原“SQLite表浏览”完整整例一次通过，24.5秒，120秒原单次期限、1worker、零重试、trace／自动截图／视频关闭。保留原全部类型筛选、排序、跳页、方案、布局、系统平台多列排序、重启及资源清理断言，新增：

- 只读物理表5行页：第5行跨到新页首行6，再回原页末行5，每次恰好1次原Main `sqlite.tablePage` 请求。
- 已应用 `id>=30`、降序、3行页：第二页首行31回第一页末行32，再到第二页首行31；未应用筛选正文999保持，正式请求仍是原30条件，完整mode／sort／limit核对。
- 真实视图2行页：30／31跨到32／33首行32，再回原页末行31；回包明确是原view，未借物理表结果。之后恢复原视图页长并继续原完整回归。
- 原INTEGER／TEXT同显示值、int64最大值、NULL、BLOB和隐藏字段详情断言保持；页内翻行零新读取。
- 原34条合成数据逐项与最终独立只读磁盘结果一致；应用无 `query.*`、`sessions.*`、`table.*`、`schema.*` 命令或写数据入口，历史为空。原Main观察器两轮pending=0、denied为空，页读取分别76／1次。
- 两个原owner均正常退出码0；原fixture确认独占profile／SQLite目录删除，另从文件系统核对目录确实不存在。截图已直接检查，跨页按钮和字段搜索在详情栏内可见，原表页分页仍可操作。

本批停止、空页、读失败及来源变化证据是模型／真实Browser父链单元；没有把它们描述为本轮原生窗口故障注入，也不代表真实磁盘IO运行中取消。原生chooser仅把本例Main返回值定向到独占文件，不代表OS文件对话框键鼠验收。Windows本增量、Mac Intel、安装包、实体输入法与人工辅助技术未验。

实际命令（使用项目Node24.17.0置于PATH首位）：

```sh
DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run tests/unit/sqlite-row-detail-page-navigation.test.ts tests/unit/sqlite-row-detail-page-parent.test.ts tests/unit/query-row-details-ui.test.tsx tests/unit/sqlite-record-page-parent.test.ts tests/unit/query-row-details.test.ts tests/unit/sqlite-table-browser-renderer.test.ts tests/unit/sqlite-table-header-parent.test.ts tests/unit/sqlite-record-page-navigation.test.ts --maxWorkers=1
node scripts/typecheck.mjs
NODE_OPTIONS=--max-old-space-size=2048 node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-table-browse-native.spec.ts --list
node scripts/sqlite-workspace-ci.mjs table
DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=default --reporter=json --outputFile=.cache/sqlite-row-detail-pages-20261104/完整单元.json
git diff --check
```

原始日志与独立核对原件：`.cache/sqlite-row-detail-pages-20261104/`。原生完整报告：`test-results/sqlite-table-browse/`。报告内含成功截图、Main请求与回包、原行／终态／退出／清理的附件；未将日志、合成库或构建产物入Git。

## 归档和后续

项目交付保留于 `.local/交付/2026-11-04-SQLite只读详情跨页-v1/`；自动备份于 `/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite只读详情跨页-v1/`。包含可编辑Markdown报告／使用指南、源码／补丁、逐轮原始日志、原生JSON及PNG，逐文件核对原件与归档、项目归档与备份SHA-256并校验交付ZIP，不覆盖历史版本。

多页编辑草稿、关联树和其它完整D04／R02能力仍需开发；本批继续部分覆盖，暂不正式发布。
