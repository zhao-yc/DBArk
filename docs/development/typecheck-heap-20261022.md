# 原生构建类型检查的堆预算

## 已证实的失败

主分支 `9d99819b` 的 [CI 39751448047](https://github.com/zhao-yc/DBArk/actions/runs/39751448047) Linux 检查成功；两个 macOS job 均在原生批准前的 `tsc --noEmit` 中堆耗尽，尚未构建、签发源码批准或进入该阶段界面测试。Intel 使用 Node24.19.0、arm64 使用 Node24.21.0，原 stderr 均明确显示约2048MiB堆与 `JavaScript heap out of memory`，不能只把外层“退出码null”当作超时或GUI问题。

原始 ZIP 仅含 `native-editor-ci/typecheck.stdout.log` 和 `.stderr.log`，stdout为空。Intel artifact12414166626，SHA256 `c67385f7b79e803237589fbefc26971e7cfd9383488b4bc938683be1490dd912`；arm64 artifact12413982061，SHA256 `e8814317df56e8424dc285768dcb9641214076d095ab3ecf4ec239eb20bd62c8`。已下载并校验，原件及条目摘要留在忽略目录 `.cache/native-ci-process-failure-20261022/`，不入仓库。

## 修复范围

`scripts/typecheck.mjs` 提供固定项目的共享编译器参数，显式使用4GiB旧生代预算及原 `--noEmit`。`pnpm typecheck`、`pnpm build`、`check:local` 和原生CI批准前编译共用此参数；只有 `tsc` 子进程获得该预算，不使用 `NODE_OPTIONS`，不改变 Vitest、Vite、Electron 或原生用例的环境和参数。

标准入口固定仓库、继承原输出，一次执行并保留原非零状态；未知退出或启动异常返回失败。本地定向检查仍先检查全部依赖，再按类型、指定单元、可选构建顺序运行。原生批准脚本直接观察原编译器，追加一次性 `.process.json` 保存原 `status/signal/errorCode`；失败不构建、不签清单、不重试，也不据未知状态停止其它进程。

## 本机证据与待验

WIN11-TEST 只读准备派单仍返回前次提交未确认，旧回合已确认 completed；本轮没有派发实库或GUI，按用户授权使用本机 Windows／Node24.17.0 后备。初版显式4GiB编译原进程13592、31.88秒／exit0；TypeScript扩展诊断自报2410文件、146134行TS、Memory used2424159K，此值不是操作系统峰值。六文件148项相关通过，仅作为初版证据。

共享入口最终开发检查：`node scripts/typecheck.mjs` 原进程9020、31.23秒／exit0；八文件165项相关原进程66132、exit0；`node scripts/build.mjs` 原进程62816、32.53秒／exit0。原Zod注释及大分块提示保留；26份封存位于 `.cache/native-ci-heap-expanded-initial-local-20261022/`。独立审查未发现入口顺序、参数或失败语义回归。

代码候选 `07af4a1102a8556d59f4106a1a3e974fcefe1984` 已推送独立检查分支，触发 [CI 39758650634](https://github.com/zhao-yc/DBArk/actions/runs/39758650634)，当前仍在运行，结果待记录。不能用本机通过代替macOS。原600秒显示租约、原生期限、断言、重试和资源保留规则保持；未发布或部署。

## 独立的Windows原生失败

同一旧CI的Windows job119732749279在legacy-source为79通过、338跳过、1失败、1未执行。失败发生在“关闭其他查询”首例的草稿准备：复制出的B持久化正文仍是A，尚未到批量关闭断言。原用例已核活动标签、正文桥就绪和输入框焦点，再使用真实Ctrl+A与insertText；缺少原模型／选区／EditContext事件证据，当前不认定为产品竞态或输入驱动缺陷。

Windows原件artifact12414716647，SHA256 `df21c83c7d16e5514e847aded47d1bca4729cadf7e46fe1b1177d9ac1ef49777`；原失败和未知退出保留。后续只读采集与原断言通过应分别记录，不能将增加观察后的成功追认为旧失败已修，也不放宽门槛或自动重跑。

新增诊断只在检查分支 `codex/native-checkpoint-typecheck-heap-20261022` 的source legacy开启，main及其它分支为0。开启时在每例零标签空App中唯一重载以暴露官方Monaco只读API；这项环境差异和 `originalFailureFixed:false` 明确入记录。原Ctrl+A、insertText、5000ms轮询、120秒期限和关闭断言均保持；四阶段采样及模型／DOM／EditContext事件被动、限量传回Node，失败只附已收到记录，不补读、不改首因。Main返回值明确为持久快照，不称即时renderer草稿。

诊断附加源码的类型检查原进程24492、32.21秒／exit0；默认列表36228／exit0，未启动GUI。实际spec声明的默认／列表关闭、非法值资源前拒绝及原观察契约共13项RAM通过，进程44268／exit0；这不是Windows原生复验。

## 固定提交复验进展

本机后备完整单元固定于 `9967545ae0529a08fd551efc6de5b76cb6a5d2e1`（仅比代码候选增加上述文档，src树仍为 `41c7b53b656d68011d080cacf9a700d8e1e3cfed`）：原PID51196，UTC09:55:00.9924404创建、10:00:09.5796625退出，exit0／308.607秒；699文件通过、1文件平台跳过，14057测试通过、1跳过。前后tracked干净、输入与dist哈希不变，10份封存保留在 `.cache/native-ci-heap-full-local-20261022/`。本轮新VM派单仍未确认，旧回合为completed；没有本轮VM进程、GUI、数据库或剪贴板操作。

候选 [CI 39758650634](https://github.com/zhao-yc/DBArk/actions/runs/39758650634) 的Linux job119756992713已成功：700文件、14048测试通过／10跳过，标准类型与构建成功。macOS x64 job119756992412和Windows job119756992879的源码批准、缩进／分栏及首次文件模型步骤成功；legacy-source仍在运行，不能提前宣称整体或安装包通过。

macOS arm64 job119756992704的原artifact12416713431（ZIP SHA256 `e03820a6fe3ebd2ec8ea4442c052ed3c88ce19fd4a7eb7ef05440f0d2c7139a6`）确认 `typecheck.process.json` 与 `build.process.json` 均为status0、无signal/errorCode，并产生本次源码批准；缩进专项accepted且两原owner正常退出。说明本次堆预算已越过原编译失败，但后续分栏专项仍失败，未执行安装验收。

分栏原几何附件显示屏幕1024×768、工作区高677；请求1400×1000客户区被系统夹成1400×645。14次准入采样最大值226，精确等于产品公式 `489−(37+44+18+35+33)−96`；保留原大于410断言和失败。检查分支未在既有显示租约的准确分支名单内（仅main及原筛选候选），因此这次没有启用租约；主分支控制轮将沿既有600秒租约，不新增显示工具、不扩大名单、不改变阈值或期限。不能把这次环境容量失败当作分栏后续拖动、取消或重启已验。

## 后续原件核查

同候选Windows原job119756992879已完成两轮legacy：源码81通过／338跳过（7.9分钟），打包目录81通过／338跳过（7.2分钟），两例关闭其他查询均通过；原生缩进、分栏及首次文件模型的source/installed accepted原件均在artifact12418830835。ZIP SHA256 `269537f9f20d8f514845075b85640006107e66f802eb546f6a149fede0a237d0`，保存在前述忽略目录。此处是`win-unpacked`候选运行，不等同于NSIS安装向导、发行或新表生成功能验收。

核查发现成功源码用例的`info.attach({body})`没有在list reporter下生成可归档文件；ZIP没有该输入事件原件，不能把这轮通过描述为已取得模型／选区历史，也不能追认旧失败修复。现补为`TestInfo.outputPath`内`writeFile(...,{flag:'wx'})`独占保存后再附路径；失败仅保留已有Node记录，写入冲突不覆盖、不重试、不替换原用例错误。两项原生临时文件回归及原门／围栏共15项通过（PID51944、exit0），仍不是补修后的GUI采集证明；后续准确启用门时另验。

主分支`5a6ff8ca`控制轮[CI39760479639](https://github.com/zhao-yc/DBArk/actions/runs/39760479639)已启用原arm64显示租约，三个架构完成源码批准及原专项后进入legacy；当前后续流程仍在运行。与检查分支的唯一重载诊断环境分开记账。
