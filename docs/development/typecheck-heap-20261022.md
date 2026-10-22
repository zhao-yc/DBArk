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
