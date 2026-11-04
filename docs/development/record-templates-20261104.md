# 记录模板实现与验收

日期：2026-11-04。基线为 main `5daa2bfe`，保持 Electron／React／TypeScript 独立客户端架构。本批作为 D04 高频新增记录工作流继续推进；不标记完整 D04 或 Navicat 目标完成，不创建正式发行、标签、安装包或部署。

## 使用与边界

MySQL／MariaDB 可编辑表页通过「更多 → 数据编辑 → 记录模板」打开；SQLite 可编辑表底部直接打开。来源是当前选中记录的已载入值及已暂存修改；没有当前记录时仍可使用已有模板。表单及单元格输入需先暂存。

字段默认全部不选，搜索只过滤捕获列表，已选字段保持。保存新模板、明确覆盖、改名及明确删除都只操作本机配置。模板按准确连接、数据库、表隔离；同名或大小写不同对象不借用其它目标。模板含真实记录值，列表 IPC 只返回名称、字段和来源概要，只有明确预览才返回原值。

预览整份通过当前字段元数据后，可生成 1～100 条新增草稿；整批最多10000格、2 MiB。每次生成是一条撤销操作，保留已有修改和前批新增，未选字段完全省略。MySQL 自增列及两种驱动的生成列无捕获入口；SQLite 标识列没有自增元数据，需自行取消选择，不宣称自动识别自增列。NULL、空串、默认值省略、文本大数、重复成员 JSON 原文、NUL、负零及二进制均按原驱动类型处理。生成仅改本页草稿，仍须走原 SQL 预览及明确集中提交。

字段删除、类型／可空／生成属性等签名变化时整份拒绝，不自动映射或丢列。连接来源变更后保留不可使用的概要；改名不会使旧值恢复可读，核对新来源后可明确覆盖。标签、活动页、连接、加载页、草稿代次、异步任务或其它模态变化会使原回调永久失效，即使状态恢复也不能复活。

## 实现

新增共享受限契约与五个 IPC：`record.templates.list/save/rename/delete/read`。Main 校验准确主文档、来源令牌、修订、目标和连接摘要；令牌最多256个，单调有效期10分钟。落盘前后及 IPC 发布再次检查归属与 CAS。已保存但发布失败明确要求刷新核对，不自动重试。记录值不写到设置、任务概要、执行历史或普通日志。

配置库增加可选 `record_templates` 元数据表，保持现有 user_version=9；连接删除一起清除对应模板。打开及迁移前校验全部模板，未知版本或损坏记录不自动重写。上限为每表20项、本机200项目标／200条目／8 MiB，单项512 KiB、最多1024字段。写入复用原原子落盘与失败回滚，未访问目标数据库或解密凭据。

MySQL 父页复用原粘贴新增计划、唯一键保护和草稿历史；SQLite 父页复用原 typed `appendRows` 与集中事务。编辑账本增加不透明代次，识别 undo／redo 返回相同内容的 ABA。模态具有唯一 owner 标识，外来模态即使在同一观察批次内移除仍撤权；双击、旧渲染按钮及卸载后的迟到回包不重复发布。

## 验证环境与原始失败

实际为 macOS arm64、Node.js 24.17.0（项目 `.tools` 的官方校验副本）、pnpm 12.11.2、Electron 44.7.0。系统默认 Node 24.14.0 未修改。WIN11-TEST 原测试会话无法连接，本轮未派发远程任务，按 AGENTS 的回退约定串行使用 Mac。只读 SSH 已核 `server-200` 实际主机名 `Server-200`，本批没有运行 Docker、实库测试或修改服务器。

保留以下首轮失败，不以复验覆盖原件：

- 界面夹具首次漏安装菜单 DOM 端口，随后重复渲染同一个 ReactElement 导致未触发新渲染；补齐测试端口后原要求通过。
- MySQL 父页夹具的 VM 对象跨上下文与普通自有属性守卫不一致；改为加载真实模板 helper 并提供 RAM DOM 端口。撤销历史会重建数组，内容保持应逐项比较，新增 UUID 另有精确核验。
- 原生首轮已完成三条新增的明确提交和重启恢复，但收尾将整个任务列表要求为完全相同，忽略正常恢复新增的只读 tablePage 任务。修正为逐项核对原任务，并仅接受一条成功的只读分页任务；写任务数量、原件和重放检查保持。原轮退出码1、profile和原始附件保留，已独立核对该 Electron PID 54982 终止后才重新运行。

完整单元初验为1272套件、26550通过／12失败／10跳过，退出码1（447.26秒）。其中11项属于三份旧夹具：schema7还原时须移除新可选表，再验证原11表不变及迁移后模板表为空；两份抽取表达式夹具补齐空templateDialog。另1项真实TLS半开测试因沙箱拒绝监听127.0.0.1而EPERM，未修改或跳过该断言；复验使用允许本机受控TLS监听的执行环境。原初验日志与JSON均单独保留。

## 本批结果

修正后的6份定向套件94项全部通过，包含原真实TLS监听断言。最终完整单元1272套件全部通过，26562项通过、10项条件跳过、0失败，退出码0（455.12秒）。跳过项属于原有Windows专属tar进程验证，本批未新增跳过项。

最终严格类型检查与构建已通过（构建14.20秒，沿用现有大分块和第三方PURE注释提示）。MySQL 完整父页37项通过；新增模型、真实配置库和React模态测试覆盖来源隔离、显式预览、字段搜索、精确值、CAS管理、落盘失败回滚、过期、导航、发布失败、非法数量、迟到回包及双击。

Mac 真实 SQLite Electron 整例1项通过（最终构建终验4.8秒，单次上限120秒、单worker、零重试、trace关闭）：真实连接表单，仅将本例 Main 文件chooser返回固定到独占合成文件；真实组件、正式 Main IPC、utility worker、磁盘事务和退出流程全部运行。原2行逐项保持；先生成2条，撤销／重做，再生成1条，撤销只移除后一批。暂存及 SQL 预览期间独立磁盘观察零写入；明确提交后恰好3条新增，整数主键由数据库生成、未选字段使用真实 DEFAULT、生成列引用新ID，TEXT字节／NULL／BLOB／空串均逐项对照。

保存模板后重命名，第一次正常退出，再在同profile重启，读回同模板ID、名称及完整typed字段。重启未重放预览或写任务，执行历史为空。两个 owner 正常退出码0，worker零kill且全部正常退出、帧ACK及closeAck逐项核验，原fixture确认独占目录删除。原生截图已人工查看，模板选择、字段搜索、类型预览和新增数量区可见。

实际命令（用项目 Node 24.17.0 置于 PATH 首位；日志均保留退出事实）：

```sh
node node_modules/vitest/vitest.mjs run tests/unit/record-templates.test.ts tests/unit/record-templates-storage.test.ts tests/unit/draft-history.test.ts tests/unit/sqlite-table-editor-append.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run tests/unit/record-templates-ui.test.tsx --maxWorkers=1
node node_modules/vitest/vitest.mjs run tests/unit/draft-history-table-tab.test.ts --maxWorkers=1
node scripts/typecheck.mjs
NODE_OPTIONS=--max-old-space-size=2048 node scripts/build.mjs
node scripts/sqlite-workspace-ci.mjs record-templates
DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=default --reporter=json --outputFile=.cache/record-templates-20261104/完整单元终验.json
git diff --check
```

原始单元及构建日志在 `.cache/record-templates-20261104/`，成功原生 JSON／截图在 `test-results/record-templates/`；失败原生原件另存缓存子目录，不重用成功轮计数。

## 交付与未验范围

交付源码、报告、当前用户指南、原始结果及截图保留在项目 `.local/交付/2026-11-04-记录模板-v1/`，并备份到 `/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-记录模板-v1/`，附来源说明、文件清单及 SHA-256 核对。源文件与交付快照、项目归档与备份均逐文件核对SHA-256，准确文件数量与摘要见随附清单。

MySQL／MariaDB 本增量实库与原生窗口、Windows 本增量窗口、Mac Intel、正式安装包、实体输入法及人工辅助技术未验；只读表无模板写入入口，PostgreSQL／SQL Server 等驱动模板后续实现。未测试OS文件对话框输入及系统剪贴板。原生整例没有把模板覆盖／删除当成已验证窗口流程，相关生命周期目前由真实配置库和React测试覆盖。D04 的跨页记录表单、关联树、批量表单及其它完整能力仍需继续推进。
