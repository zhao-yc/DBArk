# 本地优先开发检查

日常修改先在任务自己的普通克隆中验证，使用 Node.js 24 和 pnpm 12.11.2；首次执行 `pnpm install --frozen-lockfile`。不要把整个 `node_modules` 连接到其它候选目录，也不要在冻结发行目录试改。

## 日常命令

```sh
# 一次类型检查，再运行明确指定的单元测试
pnpm check:local -- tests/unit/local-check.test.ts

# 确实需要检查打包结果时，追加一次普通构建
pnpm check:local -- --build tests/unit/local-check.test.ts tests/unit/sql-keyword-case.test.ts

# 已安装依赖但 Corepack 缓存或网络不可用时，直接使用同一入口
node scripts/check-local.mjs --build tests/unit/local-check.test.ts
```

从仓库目录执行。根据实际修改显式增加相关测试文件，支持 `.test.ts`、`.test.tsx`，含空格的路径加引号；不接受目录、通配符、集成/E2E 文件或无文件参数。重复文件会去重。`--help` 只显示用法。

入口顺序调用本克隆的 TypeScript、Vitest 和已有 `scripts/build.mjs`。类型检查始终只运行一次；构建直接复用现有脚本，不再套用含第二次类型检查的 `pnpm build`。任一阶段失败即停止并返回原非零退出码，不自动重试。终端输出每阶段及总耗时；它不创建检查清单或验收服务。

`--build` 会写入当前克隆的 `dist/`，属于普通开发构建，不形成安装包、冻结候选或发行证明。此入口的测试也不代替完整单元回归；重要整合前仍按改动范围使用 `pnpm test` 和既有平台验收。

## 客户端、实库与 GitHub 的分工

- 本机界面调试沿用 `pnpm dev`；先检查并复用端口 `127.0.0.1:5186`，主进程/引擎修改后重启，关闭客户端或 Ctrl+C 停止。真实 GUI、Windows 构建及安装继续使用原有脚本和资源保护规则。
- 实库仅在核对过身份的 `server-200` 隔离环境执行；此入口不会主动运行集成测试、Docker、Electron 或系统输入。源码、真实安装、数据库和系统快捷键分别报告。
- 当前 GitHub 工作流已分流：普通任务分支保留后台 Linux 检查；PR、main、明确的 native-checkpoint 和发行标签保留原生/安装门。此次不改变触发条件，不新增工作流，不用本地通过替代公开发行后验。
- 原生未知退出及失败现场继续保留；不借本地迁移续跑旧 nonce、补按快捷键、强停或补清。

## 本次检查范围

本地流程分支从 `4a87a4787b0cab154787a69a45662f1c724edb2c` 建立，独立于 0.28 冻结候选。本次仅修改开发入口、说明及入口测试；不修改产品 `src/` 或依赖版本，不导入封存的 0.29 功能。耗时为本轮单次实际运行记录，不宣称相对于其它机器或 GitHub 的提速倍数。

2026-10-20 在 Windows x64、Node 24.17.0、pnpm 12.11.2 上实际执行：

```sh
pnpm check:local -- --build tests/unit/local-check.test.ts tests/unit/sql-keyword-case.test.ts
```

| 阶段 | 实际结果 | 耗时 |
| --- | --- | --- |
| 独立克隆按锁安装依赖 | 572 个包；依赖下载 0；成功 | 18.86 秒，不计入口总时长 |
| 类型检查 | 一次 `tsc --noEmit`，成功 | 45.95 秒 |
| 定向单元测试 | 两文件、35 项通过：入口 6 项、SQL 格式化 29 项 | 7.92 秒 |
| 普通构建 | 主进程/preload/worker 与 Vite 构建成功 | 41.77 秒 |
| 入口总计 | 退出码 0 | 95.65 秒 |

另核 `node --check scripts/check-local.mjs`、帮助入口及 `git diff --check`。默认沙箱的 Corepack 缓存不可用且 DNS 受限，本轮安装和代表性检查在已获准的本机执行环境完成；上述直接 Node 入口可复用已安装依赖。未运行 GUI、安装、实库或系统输入，未增加平台验收结论。收口克隆仍为原干净 `4a87a47`，冻结的源码、package 和锁文件三个对象保持原身份。

后台固定提交 `4000fc2782de175fad99883d9bd99b4f34aa8b03` 的 [CI 39286562944](https://github.com/zhao-yc/DBArk/actions/runs/39286562944)、job `118174584033` 已结束成功。原日志核得 564 个文件、10686 项通过、10 项条件跳过，包含新增入口 6 项；类型检查与普通构建通过。该结果属于准确 Linux 源码检查，平台、安装及发行作业未执行，不扩大上述本机证据范围；本段后续文档提交也不冒充新的代码验收头。
