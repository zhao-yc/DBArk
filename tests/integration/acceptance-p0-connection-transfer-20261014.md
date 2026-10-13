# C03 连接概要复制与迁移验收

当前状态：**0.7.0 Windows 开发源码的 6 项离线用例、1 项实库用例已分别完成通过。** 离线首轮为 5 通过/1 定位失败，修正后第 6 项定向通过；实库前三轮为测试定位或等待失败，第四轮完整通过。不能表述为首次连续执行 7 项全部通过。所有原始日志和失败截图保留，运行时及构建产物始终未改。

`node node_modules/typescript/bin/tsc --noEmit` 与差异检查通过；Playwright `--list` 实际列出 7 项。后端与主智能体独立全量单元检查为 42 文件、418 项通过，见 `.cache/c03-root-unit.log`、`.cache/c03-root-typecheck.log`；它们与本文件的 Electron 结果分开记录。0.6 固定标签与公开包的历史证据仍由原验收材料管理，不使用本批次源码结果替代。

## 范围与执行边界

- 独立用例文件：`tests/e2e/connection-transfer.spec.ts`。只复用现有真实 Electron 夹具，不修改旧用例、共享夹具、运行时代码或依赖。
- 交换文件为 `DBArk-connections`、版本 `1` 的 UTF-8 JSON，最多 2 MiB、500 个来源概要。来源 ID 只参与候选识别；确认新增必须生成全新 ID。
- 第一批只支持新增和跳过，不替换已有连接。密码、秘密存在标记、会话、表偏好及本机有效认证文件路径均不继承。文件名提示不是本机文件访问授权。
- 导入预览绑定已经校验的不可变快照，原文件后续改动不能改变本次预览内容；本地连接配置修订变化则必须拒绝旧预览。令牌具有时限且每次确认后消费，失败不能隐式重试。
- 只替换原生文件选择器返回的路径或取消回答。授权令牌、IPC 校验、SQLite、文件 IO 和数据库 worker 保持真实；不声称覆盖操作系统文件对话框本身的交互。
- 离线测试配置指向本例独占的真实本地 TCP 监听器，记录连接次数并立即关闭来访 socket，不返回模拟 MySQL 报文。结合真实任务和 SQL 历史为空，只证明本例目标没有收到连接，不能扩大成系统级网络抓包结论。
- 每例独立 userData；退出通过应用真实保存握手，夹具核对子进程结束及绝对临时目录范围后清理。实际运行前已通过 SSH 只读核对 `Server-200 / 192.168.31.200`，项目桌面进程为 0；本批次没有调用 Docker，也没有构建 NSIS。

## 用例覆盖与当前结果

| 用例 | 关键断言 | 当前结果 |
| --- | --- | --- |
| UI 复制 | 新 ID、明确副本名；三种秘密与存在标记不继承；认证文件去除；原连接和原表偏好保留；副本偏好为空；真实重启 | 首轮通过；实际系统加密可用，源三种秘密重启后仍存在，副本均无 |
| JSON 导出 | 实际文件逐字段白名单、来源 ID 仅用于识别；不含虚构密码、路径或秘密标记；取消保留原件；错用途 token 拒绝；双击仍产生完整合法文件，无临时残件 | 首轮通过 |
| 预览新增/跳过 | 同 ID/名称/目标候选；明确新增/跳过及全部跳过；预览后原文件改动不改变本批；模态快捷键不执行后台任务；双击仅一个批次；原表偏好不继承；重启保持 | 首轮通过，混合与全部跳过后原侧栏完整 |
| 非法文件 | 未知版本/字段、秘密字段、绝对路径、重复来源 ID、501 个概要、超过 2 MiB 均在预览拒绝且配置不变 | 首轮通过 |
| 旧预览和磁盘失败 | UI 预览后实际修改现有配置，确认拒绝；新真实 IPC 预览在 SQLite 临时目标目录冲突时整批回滚；失败 token 不重用；后续设置保存和重启不偷偷提交 | 首轮通过，真实失败后两条批次记录均未落盘 |
| 本机认证与模式隔离 | SSH/TLS 开关和验证策略不降级；四类 pendingFiles 持久化；未重选本机文件的 test/open 拒绝；手输路径不能解除标记；实际文件选择授权后未保存仍不能测试；保存后路径/清除标记跨重启保留；mode 切换清空原授权/预览；取消不改变配置 | 首轮短标签定位失败；仅修测试后完整定向通过 |
| 可选真实会话保护 | `DBARK_INTEGRATION_ENABLED=1` 且目标为 `192.168.31.200:13384` 才执行；只读取 `information_schema` 与 `performance_schema`，比较目标、旧会话编号和事务；复制/导出/导入期间历史任务和标签不变 | 第四轮通过；两个实际会话编号前后一致，随后均显式回滚 |

## 尚不能声称的覆盖

当前只验证 Windows 开发源码，尚未执行 C03 安装包、完整旧功能回归或 macOS 本批次用例。实际 `app.info` 报告 `version=0.7.0`、`platform=win32`、`encryptionAvailable=true`，证据为首轮复制用例的 `credential-storage-branch.json`。测试中三种固定密码都是虚构验收数据，不能把独立 schema 探针中的合成保护器算作系统加密。

实库项不创建表或数据库、不执行 DML/DDL；它只验证真实只读事务、连接身份和工作区保留，不冒充“未提交写入仍保留”的实证。离线批次磁盘失败用真实目录占据 `dbark.sqlite.tmp`，由文件系统产生写入失败；仅该负例在清除目录后再次递交同一已消费 token 以断言拒绝，不对数据库写入重试。

认证文件重选使用真实存在的虚构文本文件，且仅原生路径选择结果被替换，令牌与保存校验真实。此步骤证明“必须重选并保存”的门槛，不会尝试用虚构文本建立认证连接，不称 SSH/TLS 握手已成功。

首次 Playwright `--list` 发现 `trace` 不能在 describe 层改变 worker 配置；已移至文件级关闭以避免实库凭据进入轨迹。发现期间没有启动 Electron、没有执行测试；后续发现列表结果单独记录。

准备期间静态复核发现后端 `importApply` 返回“仅新增列表”、前端却当作“完整连接列表”替换侧栏的接口歧义，已交两个 owner 在本批构建前修正。首轮实际验证混合新增与全部跳过都保留原侧栏。此发现发生于静态准备阶段，不记作 Electron 运行时失败结果。

## 实际构建与逐轮结果

后端于北京时间 2026-10-14 06:59:12 确认冻结。统一构建从 UTC `2026-10-13T23:00:30.478Z` 开始，用时 **27766 ms**。构建命令为 `node .cache/run-p0-connection-transfer.mjs build run01-build`，内部执行 `node scripts/build.mjs`。`source-files.json` 记录全源码、package、锁文件及当时测试的 SHA256/字节数/mtime；`build-files.json` 记录全部 dist。

| 原始证据目录（均在 `.cache/p0-connection-transfer/`） | 实际结果 | Playwright duration |
| --- | --- | --- |
| `run01-offline` | 5 通过、1 失败；第 6 项把实际名称“私钥文件 选择 SSH 私钥”误写为短名称。错误上下文明确记录 ARIA；只改测试文件输入定位。 | 25056.411 ms |
| `run02-auth-corrected` | 第 6 项定向 1/1 通过；四类文件完整重选、未保存拒测试、保存/重启保持。 | 6895.314 ms |
| `run01-live` | 0 通过、1 失败；新建查询的数据库输入具有 datalist/combobox 角色，测试误用 textbox，尚未进入查询。实际失败 PNG 保留。 | 32378.966 ms |
| `run02-live-corrected` | 0 通过、1 失败；复制与迁移已执行，原基线读取早于第二个标签防抖保存，错误比较一标签基线与两标签结果。补两标签 ID 和活动连接实际持久化等待。 | 5457.571 ms |
| `run03-live-persisted` | 0 通过、1 失败；标签/任务/历史前后严格相等已过，末尾重复 SELECT 在网格重绘瞬间读空。失败截图随后显示原会话 9015 和事务进行中；未改运行时。 | 5530.699 ms |
| `run04-live-fresh-results` | 1/1 通过；等唯一新增任务真实 completed，并用每次递增 `probe_sequence` 确认本次新结果已绘制，再严格比较原会话编号。没有 sleep、force click、DML 或写入重放。 | 8846.389 ms |

每轮均 `workers=1`、`retries=0`，上述执行没有 skip 或 flaky。不能把失败阶段改写成一次全绿，最终覆盖为“首轮 5 项通过 + 认证定向 1 项通过 + 只读实库定向 1 项通过”。实库成功轮的 `information_schema` 和 `performance_schema` 会话分别为 **9069、9078**，复制/导出/导入后保持相同编号，随后明确回滚。

汇总 `.cache/p0-connection-transfer/run01-evidence-summary.json` 在 UTC `23:07:35.166Z` 对比构建时与当前文件，`sourceDrift=[]`、`buildDrift=[]`；只有验收测试发生了上述定位和等待修正。最终测试 SHA256 为 `5f1e9d0161aa86c78a790d9c01c51c952ab865103805f803d7974374ce30a7a9`。

| 文件 | SHA256 | mtime（UTC） |
| --- | --- | --- |
| `package.json` | `905192f26c7401a4a17392cedd1caaa32ed9d8acfe79f859ab829fddc378dd85` | 2026-10-13 22:49:49.786 |
| `pnpm-lock.yaml` | `6ae2ecfb7faf913185e8b3460ead8f8a2fb6cec691c0c4203e74a90a5f9bc3b6` | 2026-10-13 18:21:37.795 |
| `dist/main/index.cjs` | `d9aae6fd3be89a4f9c0107b8afbc714b76472610897c30f2374f26787aa08c72` | 2026-10-13 23:00:30.931 |
| `dist/main/worker.cjs` | `401e004450f4a509af9f3531329b7cbf3f53e6db13a97768e19febcd895861c4` | 2026-10-13 23:00:30.932 |
| `dist/renderer/assets/index-DaH2fuOP.js` | `cd4e19761f6a4743333f878db73cc7279585a465aac2adb0f2db633047e1e970` | 2026-10-13 23:00:57.849 |

## 截图、独立迁移与资源结果

各轮 `output` 目录保留实际截图，完整路径清单见 `run01-evidence-summary.json`。已查看并核对导出完成、重复候选预览、认证文件待补阻止连接、只读会话成功四张 PNG；文本和确认按钮可见，无全白或遮挡导致无法操作。

- 首轮 `connection-export-whitelist.png`：真实导出成功及完成后禁用按钮。
- 首轮 `connection-import-duplicate-preview.png`：候选原因、明确新增和暂存确认。
- 认证复验 `connection-import-auth-pending.png`：TLS 仍启用、服务器证书验证仍启用、缺文件测试被拒。
- 实库成功轮 `connection-transfer-live-sessions-retained.png`：第二库实际会话 9078、递增探针 4、事务已回滚。
- 第一轮离线失败保存 `error-context.md`，其余三轮实库失败各保存 `failure.png` 与错误日志；没有覆盖任何 0.6 发布证据。

主智能体独立执行真实旧 reader 兼容探针：从冻结 0.6 标签 `8625c629cdae60f30bb203cb9f02c6a3e383cb8b` 的存储源码及依赖生成 schema3，使用当前 reader 迁移到 schema4。原 8 个表全部字段保持、合成凭据可读，真实持久化 `tlsCa` 待补标记且无有效路径；冻结旧 reader 打开独立 schema4 副本明确拒绝，源和副本 SHA 不变，探针临时目录已清。证据 `.cache/c03-schema-reader-compatibility.json`，UTC `2026-10-13T23:00:25.260Z`。该探针 `systemEncryptionTested=false`，不是 NSIS 或系统加密验证。

主智能体同时把旧 `table-preferences.spec.ts` 的当前迁移门槛从 schema3 更新至 schema4，只改标题和版本断言；0.6 标签仍使用自身的 schema3 断言。冻结 0.7 build01 上定向实际桌面 **1/1 通过，3.0 秒**，保留原字段全量比对和无网络断言，没有重新构建或改变运行代码。日志 `.cache/c03-root-schema4-e2e.log`、JSON `.cache/c03-root-schema4-e2e-results.json` 保留，临时目录由原真实夹具退出并清理。

UTC `2026-10-13T23:06:57Z` 完成只读清理复核：

- `run01-cleanup.json`：13357、13380、13384、13310、13311、13484 六实例的明确验收前缀库、临时用户、相关线程均为 0；本批新临时目录 0；**13 个旧目录保持不动**。
- `run01-session-cleanup.json`：本批三个实库阶段实际记录的 6 个 MySQL 会话编号已逐 ID 查询 PROCESSLIST，全部不存在；不靠“窗口消失”代替服务器释放证据。
- `run01-after-processes.json`：项目 DBArk/Electron 进程为 0；桌面交还主智能体。六实例容器、卷、网络仍保留供后续正式验收，没有额外 DROP 或 Docker 操作。

重现时使用新的 `runNN-*` 目录，runner 拒绝覆盖已有轮次。凭据仍静默读取忽略的 `.cache/dbark-test.env`，不要复制到可提交文件；本批没有生成需长期备份的真实密钥或证书。
