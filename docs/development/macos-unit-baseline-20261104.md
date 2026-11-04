# Mac 完整单元回归与开发运行时基线

日期：2026-11-04。接续 `main` 的 `3844749b`，完成首次 Mac 完整单元回归、开发运行时预检和遗留测试夹具修复。持续目标保持进行中，暂不正式发布。

## 运行时与日常命令

开发使用 Node.js **24.17.0 或更高的 24.x**、pnpm **12.11.2**。`.nvmrc` 固定 24.17.0，`package.json` 声明相同主版本范围。依赖安装后先运行：

```sh
pnpm check:runtime
pnpm check:local -- tests/unit/具体文件.test.ts
```

运行时预检只创建并关闭内存 SQLite，核对原生授权器、防御模式、事务状态及读取预算 API；同一预检在 Vitest 的全局准备阶段先于原生编译和套件收集执行。旧运行时给出中文要求后退出，不能通过跳过预算或改成弱保护方式运行 SQLite。

本机原 Node 24.14.0 没有 `DatabaseSync.limits`；[Node 官方 SQLite 文档](https://nodejs.org/download/release/v24.17.0/docs/api/sqlite.html#databaselimits)注明该 API 从 24.15.0 提供。本项目固定已有实测的 24.17.0 作为开发基线。本轮官方 arm64 归档按[官方摘要](https://nodejs.org/download/release/v24.17.0/SHASUMS256.txt)核对，SHA-256 为 `cf7e9152d7bd86c140f6eccf3577abfbaf8960be1ca49d9d900e8484984dcb9a`；运行时保存在项目忽略目录 `.tools/node/node-v24.17.0-darwin-arm64/`。

实际平台为 macOS arm64。本轮查询 WIN11-TEST 入口失败且未派发任务，按既有回退规则在 Mac 串行执行；SQLite 用例仅使用独占合成文件／内存库，实库开关为 0。Windows、Intel、真实数据库、原生窗口和安装包的验收范围分别保留。

## 修复内容

- `check:local` 按真实工程根生成测试相对路径，修复 macOS `/var` 与 `/private/var`、工程符号链接导致的错误参数；新增目录别名回归，保留明确选文件、目录限制、去重、原退出码与失败停链规则。
- 共享 Main 所有权夹具补入正式 `productName`，恢复实际 `createWindow` 与原 IPC／文档归属链；保留权限、提交、撤销及文件边界断言。
- 查询界面夹具补齐 Monaco 直接导入的标记端口、编辑器动作注册与释放，继续运行真实 QueryTab／store／对话框。
- 记录复制、跨页和计划查看夹具补齐正式页请求、末页读取、列宽及回调的初值，生产加载／选择方法仍从原文提取。
- 侧栏夹具将新增的 `uid` 导出接到真实生成器；真实组件、请求门和 IPC 时序保持。
- 部分执行结果夹具只从 QueryTab 本层提取声明，避免菜单闭包里的同名 `result` 覆盖真实结果声明。
- 完整 INSERT 导出的旧字符串匹配检查，改为执行正式 `runStreamExport` 函数：分别验证 SQL 保留原结果、CSV／JSON 清理并发布预览、首次 await 前状态及唯一 IPC 请求。已有 `setShowPinSql` 状态为对象或 null，测试不再硬编码旧的 false 状态。
- SQLite 文件授权夹具统一使用真实临时根，继续检查准确文件、来源、失效和成功后清理。

未扩大既有测试超时，没有跳过失败用例或放宽原生预算、数据精度、权限及资源终态门。完整回归的 10 项跳过均来自原有 `query-csv-native-check.test.ts` 的 Windows 专属 `System32/tar.exe` 控制流程；该文件的开关及平台门测试在 Mac 仍执行。

## 原始失败与最终验证

| 轮次 | 实际结果 |
| --- | --- |
| 首次完整诊断，Node 24.14.0 | 1,269 套件：72 失败、1,197 通过；926 项失败、25,196 通过、410 因套件加载失败等未执行；209 条未处理错误，退出 1。保留原日志及 JSON，不作为交付通过证明 |
| 原 72 个失败套件复验，Node 24.17.0 | 70 套件通过、2 失败；1,740 项通过、24 失败，退出 1。余下为关闭查询动作端口和计划网格属性缺项，继续修复 |
| 余下夹具复验 | 首次补齐后仍发现计划网格宽度回调缺项，保留原失败；补齐后原计划 5 项通过；关闭查询和本地检查已分别通过 |
| 最终完整回归，Node 24.17.0 | **1,269 套件全部通过；26,525 项通过、10 项原平台条件跳过；0 失败，退出 0**，447.11 秒；全部待交付代码的 SHA-256 在运行前后保持一致 |
| 严格类型和构建 | `pnpm build` 退出 0；类型检查保留原 4096 MiB 预算，普通构建进程使用 2048 MiB，Vite 12.72 秒 |
| 实际预检 | Node 24.17.0 退出 0；Node 24.14.0、18.20.4 均给中文版本要求并退出 1 |
| 差异检查 | `git diff --check` 通过 |

原有 React `act` 提示、SQLite 实验状态提示、Rollup 注解和大分块警告保留于日志，没有通过关闭输出把它们当作已解决。

本轮测试和构建的实际入口为：

```sh
# 本轮独立运行时；也可在使用.nvmrc选定相同版本后执行普通pnpm命令。
PATH="$PWD/.tools/node/node-v24.17.0-darwin-arm64/bin:$PATH" \
DBARK_INTEGRATION_ENABLED=0 \
.tools/node/node-v24.17.0-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run \
  --maxWorkers=1 --reporter=default --reporter=json \
  --outputFile=.cache/macos-baseline-20261104/最终完整单元.json

PATH="$PWD/.tools/node/node-v24.17.0-darwin-arm64/bin:$PATH" \
NODE_OPTIONS=--max-old-space-size=2048 COREPACK_HOME=/private/tmp/tabrelio-corepack \
corepack pnpm build
```

完整 stdout／stderr、JSON、预检回执及源码摘要位于 `.cache/macos-baseline-20261104/`。诊断期间修复逐步进行，首次诊断和各局部复验不冒称最终固定源码的完整结果；最终完整回归另存原件，并对本批源码摘要独立核对。

交付归档包含当前源码与文档、各轮原始记录及压缩包，项目原件继续保留。备份目录为 `/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-Mac完整回归-v1/`，逐项 SHA-256 清单及比对回执随归档保存，后续修订另存新版本。

本批完成的是 Mac 开发回归基线；完整 Navicat 功能、其它平台／实库／安装组合继续推进，不增加完整工作包或公开发行计数。
