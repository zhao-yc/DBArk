# tabrelio 的 Mac 开发交接

交接日期为 2026-11-04。长期目标是按使用频率完善对标 Navicat 的数据库客户端，架构为 Electron、React 和 TypeScript，支持 Windows/macOS。长期目标当前处于暂停状态，恢复开发后继续完成必要验证并交付到 `main`，暂不正式发布。

## 代码位置与当前状态

- 仓库为 `https://github.com/zhao-yc/DBArk.git`，产品名已改为 `tabrelio`。更名提交为 `97ca2f49`。
- `main` 包含已提交功能和本交接说明。`codex/macos-handoff-20261104` 保存暂停中的列名搜索和单列自动列宽改动，供换机接续，属于未完成代码。
- 交接分支与 `main` 的产品代码差异仅为下列 8 个文件。Windows 原目录仍保留同样的未提交内容。

```text
docs/user-guide.md
src/renderer/components/QueryResultColumnsDialog.tsx
src/renderer/components/TablePreferencesDialog.tsx
src/renderer/locales/gridColumnWidthBatch.zh-CN.ts
src/renderer/locales/tableGrid.zh-CN.ts
src/renderer/queryResultColumns.css
tests/e2e/query-result-widths.spec.ts
tests/e2e/sqlite-table-browse-native.spec.ts
```

开始前阅读根目录 `AGENTS.md`。已有 Mac 克隆先检查分支、未提交内容及上游，再 fetch。连续功能沿用交接分支，修复和验证后合入最新 `main` 并推送。

## Mac 首次准备

使用 Node.js 24 和 pnpm 12.11.2。先运行 `xcode-select -p` 检查 Command Line Tools，缺少时安装。SQLite 原生模块需要本机 `cc` 和 `codesign`，构建脚本会校验并下载固定公共头文件。

在新的本地目录接续可运行以下命令。

```sh
git clone https://github.com/zhao-yc/DBArk.git tabrelio
cd tabrelio
git switch --track origin/codex/macos-handoff-20261104
corepack enable
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

依赖、SQLite 原生模块及构建产物在 Mac 上重新生成。检查 `node -v`、`pnpm -v` 和 `uname -m`，记录实际架构。Apple Silicon 本机验证只证明该实际平台，Intel 验收仍需对应环境。

## 优先接续的未完成工作

目标是在表列偏好中按列名搜索，并在表格和查询结果列管理中只调整指定可见列的宽度。复用现有测量和布局保存流程，保持同名结果列身份、隐藏列宽度、完整列顺序、冻结边界及未提交数据。

暂停前单元测试退出码为 1，共 72 项通过、4 项失败、33 项跳过，另有两份套件加载失败。原始记录位于 Windows 的 `.cache/grid-column-focus-20261103/unit01/check/`。

- `frozen-query-ui.test.tsx` 加载 Monaco 时读取缺失的 `window.location.href`。
- `query-result-columns-ui.test.tsx` 初始化钩子超过原 10 秒限制。
- `frozen-table-ui.test.tsx` 的 4 项失败在 React `updateOptions` 中读取缺失的 `options.length`。

需分别复现并定位夹具和产品行为，保留原断言及超时。该轮在单元测试后停止，未继续类型检查、构建和原生窗口验收。

```sh
pnpm exec vitest run tests/unit/grid-column-fit.test.ts tests/unit/table-preferences.test.ts tests/unit/frozen-column-model.test.ts tests/unit/frozen-query-ui.test.tsx tests/unit/frozen-table-ui.test.tsx tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-ui.test.tsx --maxWorkers=1
pnpm typecheck
pnpm build
DBARK_INTEGRATION_ENABLED=0 node scripts/sqlite-workspace-ci.mjs table
DBARK_INTEGRATION_ENABLED=0 pnpm exec playwright test tests/e2e/query-result-widths.spec.ts --workers=1 --retries=0 --trace=off
```

## 更名验收与后续边界

更名专项的 153 项相关单元测试、严格类型、构建、Windows 源码和解包程序启动已通过，Windows x64 未签名安装包已生成。覆盖安装、macOS 更名后两架构程序及钥匙串密码读取仍待验证。上述更名专项使用独立源码快照，未包含暂停中的列布局改动。

对外名称为 `tabrelio`。为兼容已有安装和数据，应用 ID 仍为 `com.dbark.desktop`，配置仍使用 `DBArk/dbark.sqlite`，对象链接、环境变量及文件协议沿用原兼容标识。macOS 启动早期使用原名称初始化钥匙串身份，ready 后切换显示名，该路径需要实机升级验收。

## 测试环境和本地资料

数据库开发测试统一使用 `ssh server-200` 对应的 200 服务器，Docker 操作前先核服务器身份。Mac 需自行配置可用 SSH 别名和凭据，密码、私钥通过安全文件方式提供。既有临时资源的授权仅覆盖当时准确对象，新资源按当前授权处理。

Windows 验收优先交给 `WIN11-TEST` 的“dbark测试”会话，入口见 `AGENTS.md`。更名轮未派发到虚拟机，确认远程不可达后按已有授权在本机验证。接续时重新检查远程状态，避免重复运行已有任务。

原机 `.cache/` 和 `release/` 保留日志、截图及安装包，均为本地资料。Git 交接分支仅包含源码和文档。凭据备份位置见 `AGENTS.md`，跨系统复制配置后密码可能需要重新输入。
