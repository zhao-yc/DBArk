# 开发与测试

## 目录

- `src/renderer`：工作台、连接、查询、表格、设计器及导入导出界面。
- `src/main`：窗口、受控 IPC、SQLite 存储、凭据和文件对话框。
- `src/engine`：数据库协议、SQL 脚本、元数据、查询和文件任务。
- `src/shared`：跨进程接口和参数校验。
- `tests/unit`、`tests/integration`、`tests/e2e`：不同边界的验证。

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

## 构建

Electron 主进程、preload 与数据库进程独立打包为 CommonJS；React 由 Vite 打包，运行时依赖和 SQLite WASM 随安装包分发。Windows 使用 NSIS，macOS 分别产出 arm64/x64 DMG 和 ZIP。

当前使用 JavaScript 驱动与 SQLite WASM，关闭安装包的原生依赖重建；ssh2 的可选 CPU/加密加速模块使用 JavaScript 回退，不依赖开发电脑生成的平台二进制。引入新的必需原生模块时须重新核对两种 macOS 架构和 Electron ABI。

界面文案集中在 `src/renderer/locales` 的简体中文模块，主语言包为 `zh-CN.ts`，SQL 文件文案为 `queryFiles.zh-CN.ts`，类型参数文案为 `queryParameters.zh-CN.ts`；新增文案应按模块管理，不能散落在组件中。关键实现保留中文注释。普通数据库错误保留服务器详细内容；参数查询的错误详情可能包含实际值，采用保护消息或安全错误代码，历史与任务记录不保存这些详情。

`pnpm exec install-electron` 下载锁定的 Electron 运行时。若网络下载失败，应修复官方源连接或使用同一官方产物并验证 npm 包内记录的 SHA256，不能跳过完整性检查。

当前 macOS 使用 ad-hoc 签名保持应用完整性，没有 Developer ID 身份及公证，仍标记为未发行签名的开发预览；发行证书接入后设置构建机密，并完成对应平台签名、公证和安装测试。长期保留的密钥、证书按项目要求备份至 `E:\BaiduSyncdisk\codex重要文件备份\DBArk`，附用途、有效期和恢复说明。签名行为参见 [electron-builder 26 官方说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)。

GitHub Actions 分别使用 Windows x64、macOS arm64 和 macOS Intel 构建机，完成源码回归后构建对应原生架构，再执行 `pnpm test:packaged` 验证随包的实际应用。架构标签依据 [GitHub 托管运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。

## 发布

普通提交只构建并上传附件。发布前更新 `package.json`、版本记录和 `docs/releases/v版本号.md`，核对实际验证记录，再推送同版本 `v*` 标签。工作流须通过类型检查、单元测试、三个原生平台的桌面及安装包验收，才会创建 GitHub 开发预览 Release。

仅修改 Markdown/文档的分支推送不会重新构建全部客户端；代码、测试及工作流变化仍运行检查，版本标签推送始终执行完整发布验收。路径筛选行为见 [GitHub 官方工作流说明](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)。

发布任务从经过检查的提交生成源码 ZIP，仅归档 Git 跟踪文件；汇总三个平台的安装包并生成 `SHA256SUMS.txt`。它使用该次工作流的短期 GitHub 凭据，没有新增长期发布密钥。发行签名、公证及自动更新需独立配置。
