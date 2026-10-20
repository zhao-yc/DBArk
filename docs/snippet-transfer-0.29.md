# 用户片段 JSON 导入与导出（开发候选）

本轮以 `915d3dcb3ee44731c1a703bdb04179754d027b45` 为基线，在普通克隆、分支 `codex/snippet-transfer-20261020` 开发。仅提取封存 `fa5a47b` 的固定增量，不复制旧六份 dirty/untracked 文件；额外自主修补取消失败和退出等待缺口。文件名保留来源标识，当前不承诺版本号，不修改冻结 0.28、QueryTab 或 ResultsGrid，暂不发布。

在 SQL 片段弹窗选择“导出片段 JSON”或“导入片段 JSON”。导入先展示逐项名称、ID、分组、描述、SQL 和本地原内容。选择动作后点击“确认导入所选更改”才保存；预览、关闭文件选择和取消均不写片段库。已有未保存编辑须先按原弹窗流程确认丢弃。

## 文件合同与冲突

```json
{"format":"DBArk-snippets","version":1,"snippets":[{"id":"独立ID","name":"名称","group":"分组","description":"说明","sql":"SELECT 1;\r\n","updatedAt":""}]}
```

- 严格版本 1、UTF-8（允许整个文件开头的 BOM）、整个 JSON 最多 4 MiB、最多 500 条；未知字段、无效 UTF-8、重复 ID 均拒绝。读取同一原句柄并检查前后文件身份、大小和时间，按实际读取字节再次限额。
- 复用现有每条限制：ID 200 字符、名称和分组 100 字符、描述 2000 字符、SQL 65536 字符，SQL 总 UTF-8 字节不超过 4 MiB。名称/分组沿现有规则修剪两侧空白；SQL 不 trim、不插值、不归一化 CRLF/LF、不执行。
- 文件整体 4 MiB 限制包括 JSON 外壳、转义和说明。因此合法的满额本地库也可能不能导出；整体校验在打开保存框之前完成，失败不创建文件。
- ID 是唯一替换身份。同 ID 不同内容默认为跳过，可显式替换；内容相同只能跳过，更新时间不同不构成正文差异。
- 同名不同 ID 保留为独立记录，不按名称映射目标；文件内部同名也逐项提示。存在名称冲突的新增默认跳过，用户可逐项明确新增。预览显示 ID，并用 ID 区分同名动作控件。
- `builtin-` 开头的 ID 保留并拒绝导入；与内置模板同名提示为用户副本，默认跳过且不修改内置模板。导出仅取 LocalStore 用户记录，不添加 UI 内置模板。
- 文件只含用户片段白名单字段，不读取连接、凭据表或查询历史。SQL 是用户主动分享的原文，若用户在 SQL 字面量或注释中写入秘密，该原文仍会原样导出，不宣称内容脱敏。

## Main 能力与保存边界

新增五项专属受控 IPC，不扩展任意路径文件 API：

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `snippets.transferOpen` | 空对象 | `scopeId` |
| `snippets.transferPreview` | `scopeId` | 差异预览或取消的 `null` |
| `snippets.transferExport` | `scopeId` | 导出数量或取消的 `null` |
| `snippets.transferApply` | `scopeId, previewId, decisions[{id,action}]` | 当前用户片段及新增/替换/跳过数量 |
| `snippets.transferCancel` | `scopeId, close?` | `cancelled` |

`commands.ts` 增加五项预加载白名单，`contracts.ts` 增加类型，`validation.ts` 引入专属严格 schema。`main/index.ts` 为该前缀捕获真实 IPC owner，并在 dispatch 与回包前再次检查；Main 创建的文档对象不能由 renderer UUID 仿造。生产路径由 Main 的 JSON 原生打开/保存框选择，客户端不能回传路径或替换 SQL 正文。Root 应按这份增量接共享文件，不以本分支整文件覆盖其它员工更改。

预览快照只保留 Main 内存，10 分钟失效，最多 32 个当前文档 scope。确认从 Main 快照取 SQL，完整校验所有 ID/动作；首次进入有效 apply 即消费预览，失败不能复用。库的单调修订在成功保存/删除/整批导入后推进；即使内容改回原值，旧预览也失效。

LocalStore 的 `applySnippetBatch` 先验证合并后的总预算，再复用一次 `mutate`、事务、快照和原子配置文件替换；原发布失败恢复旧内存与修订，后续保存不夹带失败批次。预览及最终 current 检查失败均不留下部分批次。

导出复用真实 `AtomicFile`：同目录独占暂存、UTF-8、短写消费、同步、关闭、暂存及父目录身份复核、最后 rename。取消在 rename 发起前阻止发布；rename 发起是不可撤销的提交点，Main 对普通取消返回 `cancelled:false`，UI 等待真实结果。弹窗销毁释放 scope 不意味着已开始的完整文件发布能撤销。提交点后出现失效或异常须核对用户所选目标，绝不自动重试或声称撤销。原错误及关闭/清理错误同时存在时保留两者，清理只使用本次原句柄授予的能力。

React 的 generation/alive 防止卸载、取消或旧请求迟到后复活预览；迟到的 open 只释放能力。确认时禁取消/关闭，失败退出预览并保留错误；原 SQL 插入和保存快捷键隔离逻辑保留。取消 IPC 失败只显示错误，保留原 generation/scope/父锁，原传输真实成功或失败后才解锁；不能借取消失败再开第二次导出。Main 将片段分派 Promise 加入既有 `queryFileOperations`，原操作和清理结算前，退出流程继续等待，不提前关闭存储。

## 本轮验证范围

修前两文件为 9 通过/4 失败，修后同 13 项全部通过，四项原断言保持。修前报告 SHA256 `f723c00cfc4bb92fed2bc32ca3c092d96eefd2bc18b44cd5bd17d8a610da636e`，修后 `66e7417050eefeb5a7f6b1b2fd4e2019e5faf5eec12a47129656cf131ae93378`；均留在本克隆忽略目录。

本轮在测试迁移指令到达前已发起的 Windows 本地检查结算：类型检查、7 文件 64 项定向回归和普通构建通过，入口总耗时 84.66 秒。另含 4 项真正调用 LocalStore.open、SQLite/WASM、临时磁盘与 Main 传输协调器的验证：预览零保存、批次重开持久化、实际原子 JSON 导出、写盘受阻整批回退、最终归属失败和修订过期拒绝。发布受阻以专用临时库的 `.tmp` 空目录制造，不替换 SQLite 或文件实现，也不冒称自然磁盘故障。

已在运行的完整回归按原门结算：576 文件全部通过、10925 项通过、0 失败、1 Windows 不适用的 POSIX 条件跳过，141.10 秒；未修改测试或超时。报告 `.cache/snippet-transfer-full-unit.json`，SHA256 `c575fd94a9315c87b7f54ce40ff71210328a0b6afcc02a8f598c126fa2bd927d`。其余协调器、入口和 React 用例仍使用明确的内存边界，不等同 Electron 原生验收。

后续所有 Windows 类型/单元/构建、GUI/安装/输入测试改由 WIN11-TEST 执行；本机只继续产品开发和静态审阅，不再新开测试。虚拟机最小验证尚待协调确认，本候选标为待虚拟机验收。片段新原生文件选择、跨真实 IPC 的导入导出/退出、系统剪贴板及安装包尚未验证；不将候选推送或已结算的旧本机结果当作测试迁移完成。
