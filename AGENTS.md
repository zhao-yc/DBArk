# Repository Guidelines

## 项目结构

DBArk：MIT 开源 Electron/React/TypeScript 数据库客户端，支持 Windows/macOS。

- `src/main/`：窗口、文件、配置和凭据；`preload.ts` 暴露受限 IPC。
- `src/engine/`：utility process 中的数据库任务；`src/shared/`：跨进程契约和校验。
- `src/renderer/`：界面与状态；`components/` 放组件，`locales/` 集中文案。
- `tests/` 放测试，`scripts/` 放脚本，`build/` 放图标，`docs/` 放文档；`dist/`、`release/` 为产物。

## 安装、开发与构建

使用 Node.js 24、pnpm 12.11.2：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | 严格类型检查 |
| `pnpm test` | 单元测试 |
| `pnpm build` | 检查并构建 |
| `pnpm test:integration` | 实库测试 |
| `pnpm test:e2e` | 构建并运行 Electron 测试 |
| `pnpm test:packaged` | 安装包验收 |
| `pnpm dist:win` / `pnpm dist:mac` | 对应系统打包 |

## 编码与命名

两空格、单引号、分号；组件用 PascalCase，函数及辅助模块用 camelCase。方法和关键逻辑写中文注释，文案集中管理。无独立 lint/格式化脚本。

IPC 变更同步更新契约、校验及调用方；保持沙箱和上下文隔离。

## 测试与验收

Vitest：`tests/unit/`、`tests/integration/`，命名 `*.test.ts`，组件另用 `.tsx`；Playwright：`tests/e2e/*.spec.ts`。覆盖本次解析、精度、定位和迁移变更；配置见 `docs/development.md`。

实库配置专用连接及 `DBARK_INTEGRATION_ENABLED=1`。Docker 仅用 `ssh server-200`，每次核对主机；不用本机 Docker，仅操作授权隔离资源。

分别记录源码、安装包、实库结果及平台、跳过项；保留原生门槛和失败现场。文档修改运行 `git diff --check`。

## 提交与 Pull Request

修改前检查分支、工作区并 `git fetch`，干净时快进更新。分支如 `codex/query-history`；不用工作树，不覆盖他人修改，不强推。

中文动作式提交，如 `修复查询历史筛选状态`。验证后仅暂存本任务文件，检查后提交、推送，不自动合并主分支。PR 附行为变化、相关 issue、实测及未验范围；界面变化附截图。

## 凭据与配置安全

密码用 `safeStorage` 加密，不可用时仅存会话。凭据、测试数据、日志、产物、第三方程序及原始反编译文件不入库。密钥、证书备份至 `E:\BaiduSyncdisk\codex重要文件备份\DBArk`，附中文用途与恢复说明。
