# Monaco 光标测试：原生输入、真实按键位置证明和剪贴板只读核对

基线为 `80b65746242190b9ca3ea22fdb2677c0a8046d0d`。本片只调整测试帮助器、四个调用模块、纯回归及本文档，不修改产品、Worker 协议、fixture 退出、版本或发布资料。原 run747 等失败记录不变。

## 问题与替代路径

原帮助器为粘贴正文和复制前缀而替换系统剪贴板，随后通过 Electron 44.7.0 新 API 恢复全部格式。任意可读格式不能因此认定可以逐字节回写；比较失败后删除 RAM 快照，以及 fixture 随后退出，都会使 helper 内保留快照的局部修正不足以保证恢复。现有现场也不能唯一证明 run747 由哪一种格式转换引起。

本片沿用 `live-helpers.writeSql` 已使用的真实输入路径：聚焦可见 textbox，Ctrl/Cmd+A，`keyboard.insertText`。随后仍用 Control+Home 或 Meta+ArrowUp 到文档首，并按前缀码点发送 ArrowRight。不调用 Monaco 模型设置、光标设置、执行编辑或替换正文的 IPC，不发送 Ctrl/Cmd+V、Ctrl/Cmd+C 或选择复制前缀。

`positionMonacoCaret` 只准备正文和键盘位置。原前缀复制所承担的位置证明由下一次现有真实 Control+Space 的捕获阶段公开只读 API 接替，不能只凭建议出现、空建议或可见正文判定位置正确。

## 真实按键时的当前模型证明

原提交 `dc48f67` 的发送序号方案存在阻断：请求在布防前已经 analyze/provider 创建，只是等待 Worker ready，在布防后才 send，仍会被认成新请求。其 34 项纯回归不足以覆盖这条路径。原提交和原结果保留，不再把 send 较晚宣称为本次 provider 创建或当前光标证明。

四个模块仍在 `test.beforeEach` 安装 `observeMonacoCaret`。初始化先只读取连接、标签、任务及历史数量，要求全零；再用 `page.addInitScript` 设置官方 `MonacoEnvironment.globalAPI=true`，reload 一次空工作台并确认 `monaco.editor.getEditors` 可用。已有数据时明确失败，不清理、不重试。Monaco 0.55.1 的官方初始化公开应用已加载的同一 API 与 editor registry，不动态导入第二份 Monaco，也不改产品代码。reload 是明确的测试初始化步骤，测试注册与总期限不变。

每个 `atCaret(marked)` 保留测试原始 `marked`。`triggerCompletion` 以它独立生成预期全文、前缀和逻辑行列，不能用帮助器返回值、当前正文或旧请求反填期望。在原有一次 Control+Space 之前设本次 generation、清空本次记录；只有该次真实、可信、非 repeat 的 Control+Space 捕获事件能够产生证明，事件数必须恰好一。监听器不 preventDefault、不 stopPropagation、不设置模型或光标、不再触发键盘，也不拦截 Worker。

- 通过 `editor.getEditors()` 筛出唯一仍连接 DOM、可见、位于可见 QueryTab 主 `.sql-editor-wrap` 内、包含事件 target 且 `hasTextFocus()` 的编辑器。旧模型、隐藏标签、同一 QueryTab 内的只读结果 SQL 或其它编辑器不能代替当前主编辑器。
- 捕获阶段同步读取 `getModel()`、`getValue()`、`getPosition()`、`getOffsetAt()`、`getEOL()`、`getSelections()` 及 `getVersionId()`；要求同一未销毁模型、读取前后版本和位置稳定，且仅一个折叠选区。
- 原 `marked` 先按 LF 独立计算逻辑行列；再以模型公开的 LF/CRLF EOL 展开预期正文和前缀，分别严格核对完整正文、行列及 UTF-16 offset。实际正文和 offset 不参与构造期望；同长度错误 SQL 不能通过。键盘 ArrowRight 仍按码点移动。
- 按键结束后立即核对该 generation 的安全布尔/计数，再解除布防及原始预期引用；没有额外的轮询等待。所有 getter 都在同一个同步事件处理器内执行，没有 await，不依赖 Worker 创建、ready 或发送时刻。

本片不查历史 `.some`、不借用旧回复，也不再要求出现新 Worker 发送来证明位置。缓存命中时，当前真实按键的模型状态仍可以独立核对；原建议、能力门和 Worker 终态断言继续检查产品行为。位置证明与原先首个产品断言仍共享 13 秒预算，产品的 8 秒启动和 2 秒解析限时不变，不增加触发、重试或期限。

| 调用模块 | 静态定位调用点 | 原测试注册数 | 补齐的位置证据 |
| --- | ---: | ---: | --- |
| `tests/e2e/sql-completion.spec.ts` | 16 | 9 | choose 及默认库未知的直接触发统一核对真实按键的当前全文/位置 |
| `tests/e2e/sql-completion-window.spec.ts` | 6 | 4 | 正向、输出别名隔离、集合与帧停止均接入；原 Worker 终态及零建议断言保留 |
| `tests/e2e/sql-completion-lateral.spec.ts` | 3 | 1 | 初始能力门、执行后补全、语法停止均接入；原能力/终态、IPC计数及执行结果断言保留 |
| `tests/e2e/session-objects.spec.ts` | 11 | 7 | 第四个原调用模块同步覆盖；正向及默认库未知、隐藏列无建议均接入 |

合计 36 个静态调用点，循环中的动态次数不作为新的用例数。四个文件的 21 个原测试注册、SQL 样本、接受/撤销、目录、事务、任务、历史、能力门及执行结果断言均保留。session-objects 的 CTAS 例中，第一次旧定位只为准备正文、随后读取结构，并没有触发补全；现改为 `writeSql` 准备同一去标记正文。该例后续真正补全的位置仍经过 `atCaret` 和新证明，避免保留一个没有位置证明的伪定位调用。

## 剪贴板合同

帮助器不调用 `clipboard.write`、`writeText`、`clear`，也不构造可写 ClipboardItem。前后只读物化全部可读条目的全部格式，冻结 Blob 字节及书签字段，并独立读取纯文本。只忽略 `types` 为空的空壳，保留有类型的零字节值、多个条目、web/raw、图片、富文本和书签；不规范化原剪贴板文本、图像或格式。

前后严格比较条目数、精确类型集合、全部字节/书签字段和独立纯文本。原断言 `原剪贴板全部可读格式与纯文本必须恢复` 原样保留，以完整状态未变满足原合同，额外新增格式也不能通过。如果外部程序修改剪贴板，明确失败，绝不写回旧内容覆盖新状态。

快照始终只在主进程 RAM，完成比较或只读失败后释放。因为本帮助器从未修改剪贴板，失败退出不会再使自身写入所需的恢复材料丢失；fixture 可以沿用原退出清理路径，不需要驻留备份进程、持久化用户载荷或延长期限。读取仍非原子快照，外部并发变化可能使严格断言失败，本片不承诺隔绝外部变化。

采集异常只报告前置/后置阶段，不把原生错误消息中的 MIME 原名、内容路径、原文、字节或摘要带回 Node，也不附原生异常 cause。原定位操作错误对象保持；操作与后置只读核对同时失败时，用 AggregateError 保留原操作为第一项及 cause，第二项为安全的核对异常。光标观察的诊断只含布尔值。

## 验证与边界

`tests/unit/monaco-caret-clipboard.test.ts` 在纯 VM 中执行整个正式帮助器、事件捕获回调及实际 `SqlEditor` provider 回调，使用实际 CompletionWorkerClient。DOM/公开 API 对象、键盘/模型、剪贴板、传输和轮询等待是受控边界，假传输只返回 blocked 来结束等待；没有实际解析线程、Monaco、系统键盘、GUI、系统剪贴板或数据库。不能把这些结果当作原生验收。

43 项纯回归中，20 项全格式只读回归原样保留；位置组按直接当前状态的合同替换，并补上实际 Client 的旧 pending/lateSend 反例、模型 CRLF/UTF-16、错误 offset、同长度错误 SQL、无本次事件、非可信事件、多聚焦/隐藏编辑器、非折叠选区、版本变化、同 SQL 旧请求不能替代当前错误位置、正确当前状态无需新 Worker 请求、空工作台初始化约束和共享预算。四个实际调用模块仍将原始 marked 独立接入；Worker.prototype 不再被此帮助器包装。原定位返回值被替换为不可信内容时，调用者仍提交原始 marked 作期望。

验证命令：

```text
node node_modules/vitest/vitest.mjs run tests/unit/monaco-caret-clipboard.test.ts --reporter=json --outputFile=.cache/monaco-caret-direct-api-review/unit-final.json
node node_modules/typescript/bin/tsc --noEmit
node --require ./.cache/monaco-caret-readonly-change/collection-guard.cjs node_modules/@playwright/test/cli.js test tests/e2e/sql-completion.spec.ts tests/e2e/sql-completion-window.spec.ts tests/e2e/sql-completion-lateral.spec.ts tests/e2e/session-objects.spec.ts --list --reporter=json
```

仅收集阶段显式设置 `DBARK_INTEGRATION_ENABLED=0`；守卫禁止原生启动、网络及私有 env/key/runtime 读取。21 项仅收集、执行 0，原生启动/网络/私有读取均为 0。缓存内保存完整 JSON、调用点行号、阶段日志和守卫记录；缓存不提交。

ROOT 已回报 run773/run775 的原安装资源只读可行性结果，单行与中文/emoji 的 LF/CRLF 样例可按公开 EOL 和逻辑行列核对，真实建议能够接受；原 run774 原始换行比较失败记录保留。这些只是可行性证据，不计四模块安装验收。

仍由 ROOT 负责：对修正后的固定测试头核定后，按既有身份和清理合同进行真实安装验收，确认原生输入、当前模型位置、接受/撤销及四个模块全部原断言。此员工未启动 GUI、读取真实剪贴板、访问200或运行真实E2E，未改 ROOT 或冻结候选，也未发布 0.18。
