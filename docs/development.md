# 开发与测试

常用文件工作流新增[CSV／JSON导入提交方式](development/file-import-transaction-20261024.md)：默认每500行，另可整文件单事务提交，流式读取、实际事务位／MDL核验，提交与回滚未知不重放。类型／构建、550项相关、完整16774通过／1条件跳过及六实例54场景通过；独立读回排序修正后产品／配置／其它测试／原构建逐字不变，新类型和114项相关通过，Windows源码窗口0／500／2行及精确清理通过。原失败及统计边界分开保留；安装／macOS与真实ACK丢失另验，暂不发布。

常用文件工作流新增[保存并复用CSV／JSON导入配置](development/file-import-presets-20261024.md)：只存输入解释及完整字段映射，显式应用后新读元数据和文件；具名列重排、整份不兼容拒绝、持久CAS和取消选择保原映射。Windows本机类型、313项相关、16661项完整通过／1条件跳过、构建及1项真实源码窗口通过；独立核对两行导入、修订4的SQLite配置及资源清理。原失败保留；安装包、macOS、GUI重启及系统文件选择输入未验，暂不发布。

CSV 导入新增[首行字段名选项与无标题文件](development/csv-import-header-20261024.md)：默认保持有标题行为，无标题按列位置手动映射并保留首条数据；切换配置撤销旧预览和映射。类型／构建、548项相关、完整16561项通过／1平台跳过、六实例78组与3150行读回、Windows源码窗口准确两行导入和精确清理通过。普通与严格关闭、API文件选择与系统输入、安装／macOS等范围分别记录，暂不发布。

高频结果工作流新增[将已返回结果写入已有表](development/query-result-insert-20261024.md)：当前筛选排序全部行或勾选行冻结、字段映射、全量预检及独立整批事务；准确目标确认、一次性令牌、取消与未知结果不重放。类型／构建、307项定向、完整16457项通过／1平台跳过、六实例24行及60个原产品连接收尾通过；Windows源码窗口完成取消4行预览零写入、确认2行精确追加、父查询保持、正常退出与清理。原失败及输入等价证明另记；触发器等支持边界、安装／macOS及未验范围详见文档，暂不发布。

高频筛选工作流新增[从当前筛选生成 SELECT](development/table-filtered-select-20261024.md)：完整已应用条件树、停用状态、多列排序和自选字段顺序生成独立查询草稿；不带当前页OFFSET，打开不自动执行，父页及草稿保持。类型／构建、504项专项、完整16319项通过／1平台跳过、六实例384组及Windows正式源码窗口81行精确对照通过；原prepared的LIKE版本差异及原失败记录见专项文档。安装／macOS等未验范围分开记录，暂不发布。

Q03新增[执行历史预览与批量清理](development/history-delete-20261023.md)：单条、跨批次最多100条及已应用筛选全集，准确数量预览后一次性确认；坏索引／原文、修订变化及写盘失败整批拒绝或回滚。最终类型、423项相关、19项原失败复验及构建通过，完整16212项通过／1平台跳过；Windows正式源码窗口完成83条合成历史的取消、单删1、跨页3及全集37，最终42条原文独立读回、保存查询／片段保持并正常退出。原失败保留，安装／macOS及其它异常组合另验，暂不发布。

高频筛选工作流新增[导出全部服务器筛选行](development/table-filtered-export-20261023.md)：保留已应用完整分组、停用条件及多列排序，一次流式导出CSV／JSON／基本表INSERT SQL／XLSX；视图支持CSV／JSON／XLSX，父草稿保留，数据库严格关闭后原子发布。完整16101项通过／1平台跳过、六实例四格式各1105行及60个原非观察连接收尾通过；Windows正式源码窗口完成50行页上的1105行全量和Alpha筛选369行，实际JSON独立读回、正常退出及精确清理。原失败保留；安装、macOS、系统文件选择输入、SQL再导入、自然异常及百万行另验，暂不发布。

D01新增[从服务器不同值筛选](development/table-value-options-20261023.md)：按原服务器列分组与精确计数，500组／50分页、全范围LIKE搜索、包含／排除完整NULL补集，保留原OR／嵌套／停用条件及多列排序。准确a37b16aa的[完整单元／六实例／Windows源码窗口](../tests/integration/acceptance-table-value-options-20261023.md)通过15978项／1条件跳过、360个原非观察连接收尾、540组与首批之外10组搜索，711生产文件逐个绑定最终Git树。原失败及清理保留；完整测试退出0，外层新增验收Markdown差异另有独立等价证明。确认使用一次性Electron API回答适配器，系统按钮输入／安装／macOS等另验；完整D01和发行计数不增，暂不发布。

删除数据库的[实现及验收入口](development/database-drop-20261023.md)：专用类型化IPC、六类目录和完整定义重核、四项风险确认及原名校验、库级结构互斥和工作区保护。实库专项为 `tests/integration/database-drop.test.ts`，双门 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_DATABASE_DROP_TEST=1`；源码窗口为 `tests/e2e/database-drop.spec.ts`，另用 `DBARK_DATABASE_DROP_UI=1` 和独占输出目录。默认／列表不加载凭据或桌面。[本轮验收](../tests/integration/acceptance-database-drop-20261023.md)包含完整15740项／1平台跳过、六实例12次删除及94d272fd的Windows源码窗口；原生成功、失败和清理证据独立记账。安装、macOS和真实取消／部分失败组合另验，暂不发布。

结果筛选新增[从原不同值勾选](development/query-result-value-options-20261023.md)：次数、搜索及50项分页，完整NULL补集、只写条件草稿及原分组／启停保护。b283173a的[Windows源码实库窗口](../tests/integration/acceptance-query-value-options-b283173a-20261023.md)通过66原行／65种值、50+15分页、4／64／63行结果、两级排序／撤销重做和精确CSV／JSON独立读回；一次常量SQL、正常退出及原流关闭。完整15577通过／1平台跳过后仅补长值完整查看，最终328项／类型／新构建通过；两批字节范围分开，安装与macOS另验，暂不发布。

同库普通表[重命名旧版兼容](development/table-rename-compat-20261023.md)补齐MySQL5.7.44、MariaDB10.11.19及11.4.13；完整有界视图关系证明、原物理身份及确认代次保护保持。7f14cee4的[六实例及三个Windows源码窗口验收](../tests/integration/acceptance-table-rename-compat-7f14cee4-20261023.md)通过12成功／6真实MDL取消DDL、三窗口各一次往返、共6条成功RENAME及精确清理。完整15427通过／1平台跳过、构建和最终193项针对性检查通过；提交前候选、Git行尾规范化及未验范围分开记录，暂不发布。

索引设计器新增[参与查询优化器状态](development/index-optimizer-20261023.md)：MySQL可见性、MariaDB忽略状态独立预览与恢复，原生聚簇主键保护。类型、621项相关、完整15218通过／1条件跳过、构建与六实例实际Engine通过；准确347ab3a6的[Windows正式源码窗口](../tests/integration/acceptance-index-optimizer-347ab3a6-20261023.md)完成隐藏／恢复、原定义与全行保持和精确清理，暂不发布。

字段设计器新增[已有整数列自增启用与取消](development/column-auto-increment-20261023.md)：单项差异预览、保留零值的独立结构会话、COPY／排他锁和原属性后核；含生成列的表明确只读。类型、949项定向、完整15120项通过／1平台跳过、构建及实际Engine六实例通过；准确ccb7c42d的[Windows源码正式窗口](../tests/integration/acceptance-column-auto-increment-ccb7c42d-20261023.md)已通过启用／取消、原定义和全行保持／精确清理，暂不发布。

表数据页新增[按勾选原值筛选／排除](development/table-selected-filter-20261023.md)：完整NULL补集与原OR整体AND，预览后一次服务器分页，保留多列排序。准确源码及本机Windows实库范围见[fbc9e471验收](../tests/integration/acceptance-table-selected-filter-fbc9e471-20261023.md)。

表页SQL模板的[选列、字段顺序和宽表精简](development/table-query-template-columns-20261022.md)复用已有参数执行工作流；准确源码及本机Windows实库范围见[04891962验收](../tests/integration/acceptance-table-query-template-columns-04891962-20261022.md)。

查询结果新增[命名整理方案](development/query-result-presets-20261022.md)：完整筛选与多列排序按连接持久化，支持新建、覆盖、仅重命名、删除、预览与手动应用；字段及来源不匹配时整份拒绝，失败要求显式刷新。完整11921通过／1平台跳过，最后名称校验另有352项及构建通过；准确edd7bd57的[本机Windows实库窗口与独立导出读回](../tests/integration/acceptance-query-result-presets-edd7bd57-20261022.md)已通过，客户端重启／安装／macOS另验，暂不发布。

后继准确3270ebbb新增[Windows源码真实双客户端重启验收](../tests/integration/acceptance-query-result-presets-restart-3270ebbb-20261022.md)：第二代从原配置读出完整方案，通过真实UI应用与撤销重做；每代一次常量SQL、临时密码不落盘、两代正常退出。124项准备及类型通过，14封存／2143输入不变；产品源码和原编译字节保持，安装／macOS继续，暂不发布。

筛选应用／清除新增[完整排序联动](development/query-result-filter-preserve-sort-20261022.md)：保留多列优先级、NULL 和大小写，新筛选与原排序共同试算，失败不部分发布。类型／构建及两个Windows实库整例、独立导出读回通过；完整CI发现的复制旧行序断言已补准确矩阵，后继七文件383项通过。原失败与新完整CI分别记录，暂不发布。

所有占用电脑的测试优先在独立WIN11-TEST的“dbark测试”会话串行执行。用户已授权连接不稳定时在本机接续；先确认原测试未启动或已结束，记录实际平台与未验范围。当前[高频查询工作流整合](development/query-result-snippet-integration-20261020.md)接入七种文本筛选和片段JSON候选；各独立候选的通过不自动视为整合通过，固定整合提交仍须单独验证，暂不发布。

结果新增[暂存整理／应用暂存](development/query-result-memory-20261022.md)：标签内存保存完整筛选和多列排序，新查询后手动应用，完整元数据与预算核验后一次发布并接通原整理撤销。该临时槽独立于后续命名持久化方案，暂不发布。

日常改动优先使用 [本地定向检查](development/local-checks.md)：`pnpm check:local -- tests/unit/具体文件.test.ts`；需要普通构建时增加 `--build`。类型检查只执行一次，原生、实库和发行验收继续沿各自入口执行。

类型检查、普通构建和原生CI现在共用固定的[编译器堆预算](development/typecheck-heap-20261022.md)：仅给TypeScript子进程显式4GiB，避免部分macOS运行时默认约2GiB导致编译中止。失败仍停止后续步骤，不改原生时限、重试或显示租约；命令名称保持。

当前以开发为主，发行暂缓。查询结果已接入[复制（含列名）](development/query-result-header-copy-20261020.md)、[多列精确排序](query-result-sort.md)和[本地条件筛选](query-result-filter.md)。本轮[整合与操作说明](development/query-result-multisort-filter-20261020.md)记录本地证据，原生与安装验收分别记录。

Windows 源码客户端的[实库结果整理验收](../tests/integration/acceptance-query-result-organize-20261020.md)已补齐，包含实际发现并修复的连续导出筛选丢失；新窗口与 CSV/JSON 通过，旧失败现场保持。安装与其他平台范围继续单列。

后续[SQL 片段 JSON 导入导出](snippet-transfer-0.29.md)开发候选已接入差异预览、明确整批确认及原子文件发布，取消失败/退出等待缺口已修补。四条桌面用例 `tests/e2e/snippet-transfer.spec.ts` 已在VM运行、结果见下，只替换系统文件选择框回答；实际原生选择框和应用重启另列验收。新的 Windows 检查和桌面验收统一交 WIN11-TEST，候选推送不代表该虚拟机或安装包通过。

原导出终态后迟到取消的代次失效修复固定为 `f173f41`；VM已在16366df取得四项预期失败，修后同一断言／68项定向及类型／构建通过，完整576文件／10929通过／1平台跳过。桌面1通过／3失败，已定位外层与实际差异区域同名，整合分支修正区域名称后待原断言复验。[交接说明](development/snippet-transfer-vm-handoff-20261020.md)区分固定 SHA 和真实原生边界。

0.16 开发源码将配置库升级到 schema5，以保存查询默认库的已知、无库和未知状态。升级前退出所有实例并备份完整用户配置目录；旧客户端会拒读新版库，回退必须使用升级前的备份，不得手动修改版本号。第三检查点证据见[查询上下文验收](../tests/integration/acceptance-q03-query-context-20261015.md)。

## 目录

- `src/renderer`：工作台、连接、查询、表格、设计器及导入导出界面。
- `src/main`：窗口、受控 IPC、SQLite 存储、凭据和文件对话框。
- `src/engine`：数据库协议、SQL 脚本、元数据、查询和文件任务。
- `src/shared`：跨进程接口和参数校验。
- `tests/unit`、`tests/integration`、`tests/e2e`：不同边界的验证。

## 完整流式结果测试

`tests/integration/engine-query-stream.integration.test.ts` 验证同会话单次执行、事务/临时表/诊断、多结果编号、精度、文件保护、取消、断线及真正关闭引擎。`DBARK_TEST_MILLION=1` 启用逐行核对百万行；默认仅明确跳过该扩展，100001 行基础用例仍实际验证超过显示上限的完整文件。SSH 使用已验证的 `DBARK_TEST_SSH_*` 配置，严格 TLS 使用已验证 CA，不能因直连通过外推传输。

`tests/e2e/query-stream-export.spec.ts` 使用真实 Electron、SQL 和文件，包括双击、模态、参数隐私、浮点选择、读/写期取消、准备期真实路径 gate、实际 utility 结束和正常退出。受控路径 gate 仅调用本测试目录的真实 realpath 后暂停，未替换 IPC、SQL 或返回数据。运行前统一构建并核对源码/dist 版本；本机 NSIS、原生 CI 和公开归档各自使用对应实际文件，不能混用未来用例。

`query-stream-file`、`query-stream-protocol`、`engine-query-stream`、`main-preparing-tasks` 和 `task-privacy` 单元分别覆盖真实磁盘短写/取消/替换边界、有界事件消费、清理异常后事务状态、生产分派准备退出竞态及持久化脱敏。注入故障的测试不是自然 UI 行为或真实 ENOSPC 证明。实际各轮结果和失败诊断见 [Q05 记录](../tests/integration/acceptance-q05-query-stream-20261014.md)。

## 测试环境约束

不在开发电脑运行 Docker。真实测试库只能使用 `deve-server.yinzon.com` 对应的 200 服务器；任何 Docker 操作前先通过 SSH 核对主机名和实际地址。测试使用专门的空数据库和测试账号，不对已有业务库执行破坏性操作。

运行集成测试前设置以下环境变量。测试账号必须可以创建及删除独立的 `dbark_test_*` 测试库；套件每次使用随机库名并在结束时清理。密码通过本地环境设置，不写进脚本或公共日志。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$env:DBARK_TEST_HOST = '已核对的测试数据库地址'
$env:DBARK_TEST_PORT = '3306'
$env:DBARK_TEST_USER = '专用测试账号'
# DBARK_TEST_PASSWORD 通过本地安全方式设置。
pnpm test:integration
```

TLS 测试可设置 `DBARK_TEST_TLS=1` 和 `DBARK_TEST_CA=CA文件绝对路径`。未提供连接时，集成测试会跳过并在结果中标记，不能把跳过视为兼容性通过。测试失败后先核对残留数据库，不在业务库中手工清理。

完整的 SSH、严格 TLS、权限/断线和百万行开关见 [集成测试说明](../tests/integration/README.md)，本次真实结果见 [数据库验收记录](../tests/integration/acceptance-20261013.md)。真实数据库界面工作流及安装后执行方式见 [桌面测试说明](../tests/e2e/README.md)。

首版后的筛选、精确定位及已有表差异已在五个基线上执行，见 [2026-10-14 增量记录](../tests/integration/acceptance-20261014.md)。桌面实库已扩展到对象设计、各类定义、固定结果、筛选保护和百万行 UI，启用范围与资源清理说明见桌面测试文档。

## 验证策略

单元测试覆盖 SQL 分隔符、注释和字符串、精度、标识符、DDL、乐观锁定位、凭据隔离及配置迁移。端到端测试启动真正的 Electron，使用独立临时用户目录验证窗口、preload、IPC 和数据库执行进程。

0.3.0 已发布 SQL 片段与类型参数；旧 0.2.0 安装包不包含这些功能。`tests/unit/snippets.test.ts` 覆盖独立持久化、同名副本与按 ID 更新、schema 1→2 保留旧记录、迁移/保存/删除写盘失败回退、字段及 UTF-8 总预算和普通文本插入编辑。单元结果不能代替实际界面验收。`tests/e2e/snippets.spec.ts` 使用端口 1 的离线连接和真实 Electron/Monaco，设计验证分组搜索、编辑复制、删除确认、未保存修改保护、重启恢复、全选区及光标插入、撤销、模态快捷键和深浅主题；它还核对未建立 SQL 执行任务、历史或保存查询。

类型参数对应 `tests/unit/query-parameters.test.ts` 和 `tests/integration/engine-parameters.integration.test.ts`。需要对 MySQL/MariaDB 基线实际验收九种类型、重复名、注释/引号/可执行版本注释、精确数值与日期边界、`NO_BACKSLASH_ESCAPES`/`ANSI_QUOTES` 切换、静态预校验及动态脚本已提交部分保留、累计展开预算、会话事务、临时表、取消和断线，并检查模板历史/任务不保存实际值。已建立会话的 `ROW_COUNT()`、`FOUND_ROWS()` 和 `SHOW WARNINGS` 必须在参数识别和逐条执行前后实测，不能仅凭协议缓存实现推断通过。参数 UI 还应验证识别期间关闭/重试、慢响应、双击执行、识别失败后的再次执行以及后台查询互斥，确认没有重复发送 SQL 或提前丢失已有结果。

本批真实环境及验收进展单独记在 [Q06 验收记录](../tests/integration/acceptance-p0-parameters-20261014.md)，以记录中完成的测试为准；创建测试环境、只读连接检查、单元通过或增加测试文件都不等同于功能实库验收。统一构建后的离线片段 UI 可用 `pnpm exec playwright test tests/e2e/snippets.spec.ts` 定向运行，前提是构建产物与当前源码一致。

SQL 片段迁移写入 schema 2 后，旧 0.2.0 拒绝读取。开发与回退测试先退出所有使用该目录的应用实例，备份完整用户配置目录；每个测试使用独立临时目录，不删除用户新库或修改 `user_version` 来适配旧客户端。回退必须使用升级前完整备份，并单独保留升级后的目录。

外键相关边界由 `references`、`engine-references`、`reference-metadata`、`connection-abort`、`bit-changes` 与 `ui-reference-changes` 单元套件覆盖。实库 `engine-references.integration.test.ts` 需要五个基线及 SSH/TLS 分别启用；23 项包含真实锁等待取消、低权限源定义、BIT 位宽、FLOAT 相邻键及 CSV/JSON/SQL 往返，不用 mock 结果替代。真实桌面 `references.spec.ts` 五项包含草稿/父行变化、复合键整组提交、模态快捷键、真实线程释放和低权清空。首轮失败和最终复验分别记录在 [D05 记录](../tests/integration/acceptance-p0-references-20261014.md)，全平台和安装证据必须独立提供。

百万行场景需要记录页大小、结果上限、内存占用、查询取消及导出完成情况。SSH/TLS、连接中断和低权限账号都必须使用真实服务验证，不能由单元测试代替。

## 索引与主键差异验证

`tests/integration/engine-index-patches.integration.test.ts` 使用真实产品命令，验证复合列序、前缀单位、DESC 能力、注释、原生改名、DROP/ADD、主键、自增/FK、外部依赖漂移、事务/临时表隔离、元数据锁取消及特殊旧键保留。My8 的表达式/不可见索引和 GIPK 用例在其它版本明确跳过。SSH 下连续四次结构修改的单个用例有 120 秒总限，生产连接和取消超时保持原值，不能用总限掩盖资源释放失败。

最小权限与字段共用 `engine-column-permissions.integration.test.ts` 的随机 `dbark_colperm_*` / `cp_*` 夹具，仅在已获授权的隔离实例运行；仅对 `subject` 表授予约定权限，密码只在内存。真实权限不足、无 LOCK TABLES、目录 partial、约束保留和清理分别断言，不为测试失败追加授权。

`tests/e2e/table-index-patches.spec.ts` 验证双入口、实际表单、只读预览、双击、复合前缀、数据/结构草稿、取消、约束删除后可靠键刷新及退出保护；禁用含密码追踪，仅替换原生对话框回答。纯解析/目录/依赖/计划/后核验、引擎和主进程用途隔离均有独立单元。当前结果与首轮失败见 [索引验收](../tests/integration/acceptance-o01-indexes-20261014.md)。

## 外键差异开发者验收

以下命令在仓库根目录运行，直接使用已安装的本地测试工具。每轮使用新的报告名，保留首次失败及后续复验，不覆盖旧证据；命令清单本身不代表已经通过验收。纯单元与类型检查不访问数据库，实库及真实 Electron 需要分别启用和记录。

### 单元与类型检查

PowerShell 用文件通配符枚举外键单元文件，再传给 Vitest，避免把未展开的星号误当作测试名称过滤器。该组包含定义解析、目录交叉核对、名称空间证据及分页读取、纯计划、结构读取、任务令牌、IPC 和界面模型；共享的执行互斥及取消生命周期仍需随全量单元回归。

```powershell
$foreignKeyRun = Get-Date -Format 'yyyyMMdd-HHmmss'
$foreignKeyUnitFiles = @(Get-ChildItem -LiteralPath tests/unit -Filter '*foreign-key*.test.ts' | ForEach-Object { $_.FullName })
if ($foreignKeyUnitFiles.Count -eq 0) { throw '未找到外键单元测试文件' }
node node_modules/vitest/vitest.mjs run @foreignKeyUnitFiles --reporter=json --outputFile=".cache/foreign-key-unit-$foreignKeyRun.json"
node node_modules/typescript/bin/tsc --noEmit
```

排查单个边界时可只运行相应脚本，例如任务生命周期或界面草稿模型：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/table-foreign-key-tasks.test.ts
node node_modules/vitest/vitest.mjs run tests/unit/foreign-key-patches-ui.test.ts
```

检查报告中的实际测试总数、通过数、失败数和命令退出码。零测试、模块加载失败或全部跳过不能登记为单元通过；异步 mock 回归也不替代真实元数据锁、权限或窗口操作证据。

### 引擎实库与真实桌面

只使用已经核对身份的 `deve-server.yinzon.com` 对应 200 服务器隔离实例，不在开发电脑运行 Docker；每次 Docker 操作前重新核对实际连接的服务器。运行前在本机安全环境提供 `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_USER` 和 `DBARK_TEST_PASSWORD`，确认端口对应本轮已授权的精确基线。本文不记录实际秘密、证书内容或临时用户密码。SSH、严格 TLS 需另用已经授权并核对的环境配置单独运行，不能从直连结果推断通过。

`tests/integration/engine-foreign-key-patches.integration.test.ts` 通过真实 Engine 命令验证非空名称空间、复合有序映射、跨库父表、自引用、异名替换、引用动作、孤儿错误、父表及名称空间漂移、单次令牌、元数据锁取消与其他查询会话的事务/临时表保留。它使用 `DBARK_TEST_PORT`，每轮创建自己的 `dbark_fkpatch_*` 隔离库。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$foreignKeyRun = Get-Date -Format 'yyyyMMdd-HHmmss'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-foreign-key-patches.integration.test.ts --reporter=json --outputFile=".cache/foreign-key-engine-$foreignKeyRun.json"
```

`tests/e2e/table-foreign-key-patches.spec.ts` 启动真实 Electron，验证对象树/表页双入口、表单与固定 SQL、双击单次应用、跨库父表弃稿确认、有序映射、父子表数据草稿保护、迟到响应令牌释放、真实锁等待取消及自引用。迟到响应 gate 在真实 IPC 已完成后暂缓交付，用于验证取消竞态，不伪造数据库结果；它与自然锁等待分别记录。套件关闭含密码的追踪，不应通过启动参数重新开启。

桌面运行前先统一构建，并核对 `dist` 与待验源码一致；验证安装产物时通过 `DBARK_EXECUTABLE_PATH` 选择该次实际安装的可执行文件，不能用当前源码结果代替安装包。`DBARK_FOREIGN_KEY_TEST_PORT` 优先于 `DBARK_TEST_PORT`，应显式设置，避免落入默认端口。当前桌面脚本只接受 200 服务器的五个普通基线端口 `13357`、`13380`、`13384`、`13310`、`13311`；不以改环境变量扩大到其他服务器或传输实例。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
# DBARK_TEST_PORT 已在本轮核对并授权，桌面测试显式使用同一实例。
if (-not $env:DBARK_TEST_PORT) { throw '请先设置已核对并授权的测试端口' }
$env:DBARK_FOREIGN_KEY_TEST_PORT = $env:DBARK_TEST_PORT
$foreignKeyRun = Get-Date -Format 'yyyyMMdd-HHmmss'
node node_modules/@playwright/test/cli.js test tests/e2e/table-foreign-key-patches.spec.ts --workers=1 --output=".cache/foreign-key-ui-$foreignKeyRun"
```

每轮结束先等待本轮引擎、Electron 及其 utility 进程实际关闭，再逐一清理本轮登记的随机库和连接。桌面库前缀为 `dbark_e2e_fk_*`，跨库父目标也属于本例登记范围。清理必须按精确名称和已记录线程核对，不能按前缀批量删除其他轮次资源；异常中断后先确认所有者，再处理残留。保存脱敏失败诊断及清理结果，不以重跑掩盖未释放资源。未启用实库开关或缺少环境而跳过的测试不计为兼容性通过。

### 外键最小权限边界

外键权限测试复用 `tests/integration/engine-column-permissions.integration.test.ts`。它会创建临时用户并授予表级权限，必须取得独立的权限测试授权；普通集成开关、单元授权或能连接数据库均不构成授权。当前授权范围仅限该夹具生成的 `cp_*` 用户，以及对应 `dbark_colperm_*.subject` 表上的 `SELECT`，或 `SELECT ALTER CREATE INSERT` 四项权限。不得追加 `PROCESS`、`REFERENCES`、`LOCK TABLES`、全库/全局权限、可转授权，也不得为让预览成功而扩大权限。

获授权后按 describe 名称只筛选外键边界：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$foreignKeyRun = Get-Date -Format 'yyyyMMdd-HHmmss'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-column-permissions.integration.test.ts -t '真实外键差异最小权限边界' --reporter=json --outputFile=".cache/foreign-key-permissions-$foreignKeyRun.json"
```

当前筛选执行两个外键用例：自引用快照可读，但名称和入向目录不完整时新增预览应拒绝，任务事实应为未投递 DDL，原定义、数据和实际授权均保持。原有两个字段、两个索引用例因名称过滤显示跳过，这四项不算失败，也不算本轮已验收；若外键两个用例也因环境开关跳过，则本轮没有实库权限验收结果。

夹具为每个用例创建独立随机库、账号和内存密码，结束时先关闭引擎和低权连接，再精确删除本例账号及其授权、删除本例数据库，核对库、用户及已采样线程无残留。不要打印创建用户 SQL、认证哈希或密码；失败后只保留脱敏编号和精确清理状态，不能把临时账号扩权后再次冒充同一最小权限用例。

### 普通记录表单（0.11）

`recordViews.ts` 提供只读原因、行身份、稀疏输入、离开守卫和固定页面提交快照；`useRecordViews` 只持有输入及交互状态，`TableTab` 仍拥有唯一 `DraftRow[]`。`RecordFormPanel` 与旧单元格弹窗复用 `RecordValueEditor`。不要新增逐字段自动写接口、复制整页作为第二份真值，或在冲突后自动更新旧值重试。

`tests/unit/record-views.test.ts` 验证目标/代次/修订、原型同名列、精度与模式、预算和防重入。真实桌面套件 `tests/e2e/table-record-views.spec.ts` 使用既有隔离库，不新建权限用户，关闭含凭据的追踪；`DBARK_RECORD_VIEWS_TEST_PORT` 优先于 `DBARK_TEST_PORT`，只允许 200 的五个普通基线端口。先核服务器身份和当前构建，再显式设置实库开关运行：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
if (-not $env:DBARK_TEST_PORT) { throw '请先设置已核对并授权的测试端口' }
$env:DBARK_RECORD_VIEWS_TEST_PORT = $env:DBARK_TEST_PORT
$recordRun = Get-Date -Format 'yyyyMMdd-HHmmss'
node node_modules/@playwright/test/cli.js test tests/e2e/table-record-views.spec.ts --workers=1 --retries=0 --output=".cache/record-ui-$recordRun"
```

采集真实 IPC 时不伪造返回数据；原型同名键需要先在被观察进程 JSON 编码、Node 再解析，避免测试工具自身对象反序列化丢失 `__proto__`。原失败和修正后完整轮次分别保留。键盘 reported 组合标志不能替代实体输入法、自动 locator 不能替代人工辅助技术验收。当前状态见 [D04 普通表单验收](../tests/integration/acceptance-d04-record-forms-20261014.md)。

### 只读记录投影（0.12）

`jsonLexicalTree.ts`只生成完整有界词法树，数字保留原文范围，对象成员保存在有序数组；不把整个JSON交给`JSON.parse`再重建。`recordProjections.ts`负责实际单元格类型、身份、活动行缓存和最终转义字节预检；它的显示格式没有写回解码器。`recordProjectionView.ts`将已验证节点限制为32字段/480结构条目的窗口，`RecordReadonlyProjection`在身份变化、加载和失效时撤下缓存，不能持有旧页文本冒充新记录。

正式Vitest配置同时收集`.test.ts`和`.test.tsx`。三个新增单元文件覆盖词法、类型化/预算及真实React静态输出，不能由SSR通过推断浏览器交互。`table-record-projections.spec.ts`的七项真实界面和`table-record-projection-lifecycle.spec.ts`的两项生命周期分别运行；后者的门控在真实分页返回完成后只延迟交付，检查忙碌期间旧投影撤下，不替换数据。两套共九项均沿用五个普通隔离基线及关闭追踪要求，没有新增权限用户。见[计划](plans/record-projections.md)与[实际验收](../tests/integration/acceptance-d04-record-projections-20261014.md)。

### 整行输入（0.13）

`recordInputDocument.ts`只在显式打开整行编辑时构建完整输入格式，先按缩进及JSON转义后的字节预检，再序列化；`parseRecordInputDocumentTree`使用独立固定策略，不放宽原单JSON字段解析。完成词法重复成员检查后才解码封闭结构，验证完整字段集合及锁定占位，再交给原`stageRecordDraft`。输入模式和单字段解析语义保持一致，不新增IPC或数据库提交路径。

`useRecordViews`的字段Map和整行原文是互斥variant，dirty、离开、退出及暂存均使用同一同步引用。整行捕获额外包含行对象身份，删除撤销和原值引用变化不能恢复旧输入；只读展示之间保留字段Map，避免丢失展开状态。正式单元含完整格式、预算及行身份，九项真实界面通过五个普通隔离基线；原始夹具失败与实际展开回归分别保留。完整回归及发布阶段见[计划](plans/record-input.md)和[实际记录](../tests/integration/acceptance-d04-record-input-20261014.md)。

## 构建

0.6.0 的表偏好由 `tests/unit/table-preferences.test.ts` 验证精确复合键、原型名称、实际 SQLite 满额和 UTF-8 聚合预算、保存/删除/目标变更失败回退，以及 schema2 旧七表全部字段保持。`ui-page-find-replace`、`ui-table-column-preferences` 验证完整原值、Unicode 位置、字面替换、快照和预算、调和及可见列模型。`table-preferences.spec.ts` 的四项离线实际 IPC 与 `table-grid-preferences.spec.ts` 的六项实库 UI 分别运行，编写或列出测试不算实测通过；本批结果见 [D06 验收记录](../tests/integration/acceptance-p0-grid-preferences-20261014.md)。旧 reader 的独立结构探针使用冻结 0.5 源码和真实 SQLite 副本，不属于真实安装或系统加密验证。

Electron 主进程、preload 与数据库进程独立打包为 CommonJS；React 由 Vite 打包，运行时依赖和 SQLite WASM 随安装包分发。Windows 使用 NSIS，macOS 分别产出 arm64/x64 DMG 和 ZIP。

当前使用 JavaScript 驱动与 SQLite WASM，关闭安装包的原生依赖重建；ssh2 的可选 CPU/加密加速模块使用 JavaScript 回退，不依赖开发电脑生成的平台二进制。引入新的必需原生模块时须重新核对两种 macOS 架构和 Electron ABI。

界面文案集中在 `src/renderer/locales` 的简体中文模块，主语言包为 `zh-CN.ts`，SQL 文件文案为 `queryFiles.zh-CN.ts`，类型参数文案为 `queryParameters.zh-CN.ts`；新增文案应按模块管理，不能散落在组件中。关键实现保留中文注释。普通数据库错误保留服务器详细内容；参数查询的错误详情可能包含实际值，采用保护消息或安全错误代码，历史与任务记录不保存这些详情。

`pnpm exec install-electron` 下载锁定的 Electron 运行时。若网络下载失败，应修复官方源连接或使用同一官方产物并验证 npm 包内记录的 SHA256，不能跳过完整性检查。

当前 macOS 使用 ad-hoc 签名保持应用完整性，没有 Developer ID 身份及公证，仍标记为未发行签名的开发预览；发行证书接入后设置构建机密，并完成对应平台签名、公证和安装测试。长期保留的密钥、证书按项目要求备份至 `E:\BaiduSyncdisk\codex重要文件备份\DBArk`，附用途、有效期和恢复说明。签名行为参见 [electron-builder 26 官方说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)。

GitHub Actions 分别使用 Windows x64、macOS arm64 和 macOS Intel 构建机，完成源码回归后构建对应原生架构，再执行 `pnpm test:packaged` 验证随包的实际应用。架构标签依据 [GitHub 托管运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 发布

0.8 字段服务的单元覆盖定义解析、严格补丁预算、短连接与令牌、默认值保真边界、目录别名及真实传输退出。独立集成文件为 `engine-column-patches.integration.test.ts` 和 `engine-column-permissions.integration.test.ts`；后者会创建临时数据库用户并修改测试表级权限，必须有明确的测试资源授权，不能当作普通只读测试。现有夹具限定 200 专用实例，执行前核服务器身份，密码只在内存，每轮精确收尾并检查残留。

桌面字段流程为 `tests/e2e/table-column-patches.spec.ts`，须先完成当前运行源码构建，显式启用实库并用 `DBARK_COLUMN_PATCH_TEST_PORT` 选择五个普通基线。使用真实 IPC、SQL 与独立观察连接，不替换服务返回；原生确认框仅用于回答本例交互。截图、结果和实际构建摘要分别保留，禁止覆盖失败记录或用未来源码验收旧安装包。完整当前证据见 [O01 产品验收](../tests/integration/acceptance-o01-columns-20261014.md)。

普通提交只构建并上传附件。发布前更新 `package.json`、版本记录和 `docs/releases/v版本号.md`，核对实际验证记录，再推送同版本 `v*` 标签。工作流须通过类型检查、单元测试、三个原生平台的桌面及安装包验收，才会创建 GitHub 开发预览 Release。

仅修改 Markdown/文档的分支推送不会重新构建全部客户端；代码、测试及工作流变化仍运行检查，版本标签推送始终执行完整发布验收。路径筛选行为见 [GitHub 官方工作流说明](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)。

发布任务从经过检查的提交生成源码 ZIP，仅归档 Git 跟踪文件；汇总三个平台的安装包并生成 `SHA256SUMS.txt`。它使用该次工作流的短期 GitHub 凭据，没有新增长期发布密钥。发行签名、公证及自动更新需独立配置。

CI生成开发预览后，仍须独立下载全部资产并核GitHub摘要和SHA清单，源码逐Git blob核对固定标签；公开安装验收使用归档自身配置及原用例，不能借未来工作区替代。发标签前同步已验功能的指南版本标题；发布后仅向主分支文档和Release正文补记证据，不移动标签或替换原资产。

公开大资产传输异常时，保留原失败日志和诊断，只对同一发布标识的资产续传；完成后仍核完整GitHub摘要及独立SHA清单。HTTP范围成功或文件长度相符不能代替整文件摘要、源码逐blob或实际安装验收。

## 0.15 结构操作独立验收

1801正式单元、五数据库新增界面50次及Windows源码/本机NSIS/公开NSIS原完整各126项分别通过。主分支38596266062和固定标签38600087759三平台原生源码/真实安装各22离线通过、104私网跳过，不外推macOS私网。12资产和544源码blob核对一致，公开测试使用归档自身配置及原用例，通过相同锁祖先解析依赖，禁止为方便而创建或修改归档依赖链接。

每轮保留独立源/构建摘要、正式JSON、原日志和生命周期记录；原始失败或工具检查修正单列。公开安装实际加密、迁移、卸载、注册和六实例清理完成后才补发布正文，固定标签与资产不替换。具体范围与失败说明见[结构验收](../tests/integration/acceptance-d04-record-structure-input-20261015.md)。后续优先SQL语义与跨对象补全，保持原查询会话、词法模式和元数据身份隔离。
