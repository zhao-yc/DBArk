# Monaco 光标测试：原生输入、当次请求证明和剪贴板只读核对

基线为 `80b65746242190b9ca3ea22fdb2677c0a8046d0d`。本片只调整测试帮助器、四个调用模块、纯回归及本文档，不修改产品、Worker 协议、fixture 退出、版本或发布资料。原 run747 等失败记录不变。

## 问题与替代路径

原帮助器为粘贴正文和复制前缀而替换系统剪贴板，随后通过 Electron 44.7.0 新 API 恢复全部格式。任意可读格式不能因此认定可以逐字节回写；比较失败后删除 RAM 快照，以及 fixture 随后退出，都会使 helper 内保留快照的局部修正不足以保证恢复。现有现场也不能唯一证明 run747 由哪一种格式转换引起。

本片沿用 `live-helpers.writeSql` 已使用的真实输入路径：聚焦可见 textbox，Ctrl/Cmd+A，`keyboard.insertText`。随后仍用 Control+Home 或 Meta+ArrowUp 到文档首，并按前缀码点发送 ArrowRight。不调用 Monaco 模型设置、光标设置、执行编辑或替换正文的 IPC，不发送 Ctrl/Cmd+V、Ctrl/Cmd+C 或选择复制前缀。

`positionMonacoCaret` 只准备正文和键盘位置。原前缀复制所承担的位置证明由下一次现有真实补全触发后的独立请求核对接替，不能只凭建议出现、空建议或可见正文判定位置正确。

## 当次位置证明

四个模块均在 `test.beforeEach` 安装 `observeMonacoCaret`，早于创建编辑器及已有的窗口/LATERAL Worker 实例包装器。它包装原 `Worker.prototype.postMessage`，先用原接收者、原参数调用原方法，再只读观察成功发出的补全请求；不改请求、响应、能力、取消、线程或产品期限。

每个 `atCaret(marked)` 把测试原始 `marked` 单独保存在调用模块中。`triggerCompletion` 将这份原始输入交给 `triggerMonacoCompletion`，期望不来自定位帮助器返回的 source、实际请求或先前观察到的 offset。

在原有一次 Control+Space 之前，观察器截取单调发送序号作为边界并清除本次记录。随后必须观察到序号大于边界的新发送，并同时满足：

- 完整 source 等于原 `marked` 去掉标记并将 CRLF 转成 LF 后的预期全文；同长度错误 SQL 不能通过。
- offset 等于原 `marked` 标记之前前缀经相同换行处理后的 UTF-16 长度；键盘 ArrowRight 按码点移动，但 Worker offset 使用 UTF-16 单位。
- 本次范围中观察到的请求不能有 source 或 offset 不匹配；错误状态不会被稍后匹配结果抹掉。

本片不查全局历史 `.some` 来证明位置，也不靠旧回复满足本次断言。没有新发送时保守失败；不增加触发次数、清除产品缓存、重试或延长期限来制造新请求。位置证明和原先首个产品断言共享 13 秒预算，后者只使用 `remainingCompletionTimeout` 的剩余时间，不串联为两个 13 秒；产品的 8 秒启动和 2 秒解析限时不变。若实际 Monaco 合法缓存导致本次完全没有新发送，本片不声称已证明当前模型位置，须由统筹核定证据后再设计，不能用旧 SQL/旧 offset 放行。

| 调用模块 | 静态定位调用点 | 原测试注册数 | 补齐的位置证据 |
| --- | ---: | ---: | --- |
| `tests/e2e/sql-completion.spec.ts` | 16 | 9 | choose 及默认库未知的直接触发统一核对当次完整 source/offset |
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

`tests/unit/monaco-caret-clipboard.test.ts` 在纯 VM 中执行整个正式帮助器及实际 `SqlEditor` provider 回调，使用实际 CompletionWorkerClient。键盘/模型、剪贴板、传输和轮询等待是受控边界，假传输只返回 blocked 来结束等待；没有实际解析线程、Monaco、系统键盘、GUI、系统剪贴板或数据库。不能把这些结果当作原生验收。

34 项纯回归覆盖：零剪贴板写入、空壳与有类型零字节、全部格式、多条目、外部删除/新增类型/改字节/书签/纯文本/item数、异常关系与安全消息、两个平台、UTF-16/CRLF、错误 offset、同长度错误 SQL、无请求、同 SQL 旧请求重用失败、共享等待预算，以及四个实际调用模块的原始 marked 接线。原定位返回值被替换为不可信内容时，调用者仍提交原始 marked 作独立期望。现有 Worker 实例包装与共享观察器一起运行的纯例也通过。

验证命令：

```text
node node_modules/vitest/vitest.mjs run tests/unit/monaco-caret-clipboard.test.ts --reporter=json --outputFile=.cache/monaco-caret-readonly-change/unit-final.json
node node_modules/typescript/bin/tsc --noEmit
node --require ./.cache/monaco-caret-readonly-change/collection-guard.cjs node_modules/@playwright/test/cli.js test tests/e2e/sql-completion.spec.ts tests/e2e/sql-completion-window.spec.ts tests/e2e/sql-completion-lateral.spec.ts tests/e2e/session-objects.spec.ts --list --reporter=json
```

仅收集阶段显式设置 `DBARK_INTEGRATION_ENABLED=0`；守卫禁止原生启动、网络及私有 env/key/runtime 读取。21 项仅收集、执行 0，原生启动/网络/私有读取均为 0。缓存内保存完整 JSON、调用点行号、阶段日志和守卫记录；缓存不提交。

仍由 ROOT 负责：对新测试头核定后，按既有身份和清理合同进行真实安装验收，确认原生输入、实际光标、当次 Worker 请求、接受/撤销及四个模块全部原断言。此员工未启动 GUI、读取真实剪贴板、访问200或运行真实E2E，未改 ROOT 或冻结候选，也未发布 0.18。
