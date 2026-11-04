# 记录模板原五基线实库与真实窗口验收

日期：2026-11-04。产品源码基线为 main `893b5350`；本批只新增受限实库窗口、环境门、相关测试及文档，未修改产品代码。继续推进 D04 记录工作流，不标记完整 Navicat 目标完成，暂不正式发布。

## 实际环境与范围

实际使用 macOS arm64、项目官方 Node.js 24.17.0、Electron 44.7.0 和已构建的 `893b5350` 客户端。开始前 main 工作区干净，fetch／快进核对与远端一致。WIN11-TEST 原测试会话仍不可达，本批未派发远程测试，按 AGENTS 的既有回退授权使用 Mac。

所有数据库均在 `ssh server-200` 对应实际主机 `Server-200` 的原有专用测试容器。每次 Docker 检查之前核实际服务器；只读检查容器名称、ID、镜像、运行状态与准确端口，不新建或停止容器、不使用本机 Docker。没有访问共享3306服务或其它项目数据库。

每轮用新的 `dbark_templates_<12位随机值>` 库及32位随机owner，仅预置 `__owner`、`items` 两张合成表和两条记录。正式窗口之前独立核服务器版本、主机名、MySQL适用UUID、唯一归属及准确目录；完整原件保存实际ID，本文不记录凭据或根密码。认证只经内存和子进程环境传递，不使用命令参数或秘密文件；新建连接取消记住密码，退出后配置库 secrets 表确认为空。

## 五基线结果

| 基线 | 实测版本 | 专用端口 | 原生完整单例耗时 | 结果 |
| --- | --- | --- | --- | --- |
| MySQL 5.7 | 5.7.44 | 13357 | 7.56秒 | 1通过、0跳过、0重试 |
| MySQL 8.0 | 8.0.46 | 13380 | 6.80秒 | 1通过、0跳过、0重试 |
| MySQL 8.4 | 8.4.11 | 13384 | 5.41秒 | 1通过、0跳过、0重试 |
| MariaDB 10.11 | 10.11.19-MariaDB-ubu2204 | 13310 | 6.62秒 | 1通过、0跳过、0重试 |
| MariaDB 11.4 | 11.4.13-MariaDB-ubu2404 | 13311 | 6.48秒 | 1通过、0跳过、0重试 |

每个成功单例保持120秒上限、单worker、零重试、关闭trace／自动截图／视频，使用原独占桌面资源及准确正常退出门。仅在模板已显示后显式保存一张截图，未拍摄凭据表单。首个 MySQL 8.4 定位失败单列，不计入以上成功数，也不以复验替换原件。

五轮均真实验证：

- 从连接表单及对象树打开准确目标，使用正式表格组件与 Main／引擎透传。Main观察器只允许本例连接／表的声明命令，拒绝任意用户SQL、其它表、剪贴板、文件导出及第二次apply；观察连接只有固定SELECT／SHOW。
- 自增主键及生成列无模板捕获入口。明确选择八字段，保存与概要列表无原值，显式预览才返回完整值。BIGINT UNSIGNED最大值、DECIMAL尾随零、微秒时间、NUL与Unicode文本、重复成员JSON原文、NULL、空字符串及BLOB均逐项保真。
- 先生成两条新增草稿，撤销／重做，再生成一条，撤销只移除后一批；前批草稿保留。此时没有table.preview或table.apply请求，独立观察原库仍为两行。
- 第一次SQL预览取消后仍保留三条草稿、原库不变。重新预览并点击“确认提交”才发一次table.apply，真实事务新增恰好三行。原两行逐项保持，新ID由数据库生成、未选字段使用真实DEFAULT，生成列由数据库计算；定义除自增计数外不变。
- 模板改名、显式重读与完整typed值相符。原窗口正常退出后，以只读配置库观察确认模板ID／名称／来源／字段值已落盘，secrets表为空。没有为冷重启保存数据库密码，本轮不宣称MySQL／MariaDB冷重启窗口已验收；SQLite同profile冷重启在[上一批](record-templates-20261104.md)另有原件。
- 执行历史为空，任务概要不含原值，页面错误为空。每轮原owner退出码0，原fixture确认独占profile目录删除；原观察socket严格QUIT并确认原流物理关闭。外层再次核同实例、owner、准确两表、五行及零活动连接后精确DROP本轮库，确认不存在并严格关闭管理连接。每轮两条管理socket均闭合，没有创建测试用户或修改权限。

## 首轮失败与修正

最初 MySQL 8.4 窗口在打开“记录模板”时失败。测试脚本误将SQLite的 `.toolbar` 范围用于MySQL表页，当前MySQL采用 `AdaptiveToolbar`；定位器没有找到菜单，原30000毫秒动作超时，进程退出码1。未修改产品、预览或写入断言，也没有延长超时。

脚本改为使用已有 `navigationMenuItem` 从准确表页展开真实分组菜单；undo／redo也通过真实菜单，不要求旧按钮常驻。失败诊断先读回原Main审计，再登记保留，避免保留墓碑阻止诊断读取。独立确认原Electron PID 79073 不存在后，用新随机库复验，没有复用原失败现场。

原失败日志、JSON、profile路径及错误上下文保留。成功轮完成后，对原失败库重新核原容器ID／UUID、owner、准确两表、原两条记录、零连接及原PID不存在，保存完整只读行值／定义／归属快照和SHA-256，再精确删除原失败库。失败原因及原始记录仍可审阅，未留下运行中的测试库或进程；原失败profile目录保留，不冒称其经过原正常退出门。

首次类型检查发现环境门的驱动字符串未被TypeScript收窄，补充明确枚举检查后通过；保留原退出码2日志。此项仅修改测试环境门。

## 单元、类型与命令

本轮5份相关套件107项通过、0失败、0跳过，退出码0；其中新增实库门36项，覆盖五个端口／版本配对、身份必填、危险环境、固定CLI、来源ABA撤权，以及真实spec默认和list不加载桌面／数据库。其余为原模板模型、配置存储、React模态与完整MySQL父页回归。本轮不将前一提交的全量26562通过数当成本轮完整回归；产品代码未变，当前变更采用相关回归和严格类型检查。

```sh
# 使用项目Node 24.17.0置于PATH首位；不在命令行提供认证值
node node_modules/vitest/vitest.mjs run tests/unit/record-templates-live-gate.test.ts tests/unit/record-templates.test.ts tests/unit/record-templates-storage.test.ts tests/unit/record-templates-ui.test.tsx tests/unit/draft-history-table-tab.test.ts --maxWorkers=1
node scripts/typecheck.mjs
DBARK_INTEGRATION_ENABLED=0 node node_modules/@playwright/test/cli.js test tests/e2e/record-templates-live.spec.ts --list --workers=1 --retries=0 --trace=off
# 外层完成实例核对／预置后，仅通过受限进程环境注入本轮认证与目标
node node_modules/@playwright/test/cli.js test tests/e2e/record-templates-live.spec.ts --workers=1 --retries=0 --trace=off --reporter=list,json --output=<本轮独占输出目录>
git diff --check
```

实跑须显式 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_RECORD_TEMPLATES_LIVE=1`，以及测试连接、本轮数据库、owner、精确版本、主机名、适用UUID和驱动。`record-templates-live-gate.ts`只消费外层准备好的准确库，不建库、读取密码文件或扩大权限。外层操作脚本作为交付附件保存，包含每次Docker前的实际主机核验、预置、逐轮命令、独立收尾及原失败库快照流程；脚本本身不含密码。

原始证据在 `.cache/record-templates-live-20261104/`：各基线独立目录分别保存范围与身份、Playwright JSON／截图、命令日志和完整收尾。单元／类型／默认列举日志单独保存；所有成功原生报告和收尾JSON已独立读回，截图另作视觉检查。

## 交付和剩余范围

本项目归档：`.local/交付/2026-11-04-记录模板实库验收-v1/`。备份：`/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-记录模板实库验收-v1/`。归档包含可编辑报告、当前手册、测试源码／补丁、操作附件、逐轮原始结果及截图，逐文件核对SHA-256，不覆盖上一批记录模板v1。

本批是 Mac arm64 源码客户端对五个Linux数据库基线的直连验收。Windows本增量、Mac Intel、正式安装包、SSH／TLS传输、MySQL／MariaDB冷重启窗口、模板覆盖／删除的原生窗口流程、人工辅助技术与实体输入法仍需后续验收。PostgreSQL／SQL Server等其它驱动的记录模板和D04完整跨页、关联树、批量表单等能力继续推进，不增加完整工作包或发行计数。
