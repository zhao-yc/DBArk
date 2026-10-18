# 已返回结果INSERT SQL导出实施与验证

2026-10-18。固定基线`50626ec69cc20df699c9073a29640510ef6bf36c`，独立普通clone与分支`codex/employee1-query-result-insert-export-20261018`。版本仍为0.27.0，本任务不改覆盖总表，不改Root、主目录、他人目录或原新表分支。

## 公开参数与信任边界

原`ResultExportData`保持：只含`columns[{key,name}]`、`rows`、`truncated`，不传查询文本、连接、会话或路径。SQL使用原CellValue合同，不从查询列类型或别名推断目标表。

```ts
// files.previewResultSql：只处理快照，没有文件IO或数据库能力。
{ result, encoding, target: { database, table, columns: [{ key, name }] } }
// 返回最多20行/4MiB的实际SQL、shownRows、totalRows、previewId及expiresAt。
// files.choose：原生保存选择绑定明确预览。
{ purpose: 'export', format: 'sql', resultSqlPreviewId: previewId }
// files.exportResult：原命令加SQL专属确认，仍不允许传入filePath/SQL正文。
{ fileToken, taskId, format: 'sql', encoding, result,
  sql: { target, previewId, confirmation: database + '.' + table, acknowledged: true } }
// files.releaseResultSql：精确释放本主文档的预览及关联文件选择。
{ previewId }
```

目标库、表和每列目标名均须用户明确填写。映射源键与快照逐项同序、数量一致；目标名经NFC及小写归一化后不能重复。空名、未知源键、缺列、额外字段、任意SQL/路径/会话、错误确认和CSV/JSON夹带SQL选项均拒绝。这里的“未知映射”指不属于快照的源键；目标是否真实存在及服务器列类型不通过猜测补证。

预览、SQL文件选择和提交由真实Electron事件捕获窗口、主frame及主文档身份，复用原Main归属校验。原生选择等待期间及文件路径预约等待后再次核归属。文件选择使用私有`result-sql-export`用途；通用表导出/查询保存不能借用该令牌，SQL结果导出也不能借用普通export、import、query等令牌。

Main只缓存最多8条摘要，两分钟过期，不缓存全量快照或完整SQL。摘要逐单元格更新，绑定完整列信息、顺序、类型和值、截断事实、目标映射和编码。新主文档撤销旧主文档能力。开始重新选择即撤销旧文件；格式、编码、映射变化和预览过期均撤销旧预览及其选择。迟到响应只释放自身，不清掉其他新预览。

提交在第一次路径等待前同步消费预览及文件令牌；后续错误、取消或重复task不能重放。UI的busy、代次及消费标记也在第一次await前更新，旧闭包不能借A→B→A或快速双击写入。关闭在写任务完成前被阻止，其他关闭先等待精确能力释放；释放失败保留重试责任。

## 字面量与SQL模式论证

复用现有`src/engine/sql.ts`的`exportLiteral`，新增预览与流式写出共用`resultSqlRowWriter`：

| 来源CellValue | 文件表达式 | 保留范围 |
| --- | --- | --- |
| `null` | `NULL` | 与空文本、文字NULL分离 |
| 文本 | `_utf8mb4 X'UTF8字节十六进制'` | 空串、Unicode、JSON、日期小数、精确BIGINT/DECIMAL字符串、引号/反斜线/零字节均不重解释 |
| 二进制对象 | `X'原字节十六进制'` | 空BLOB及00/FF等字节不经文本解码 |
| boolean | `1`或`0` | 保留原布尔值语义 |
| 有限且原合同允许的number | 规范数值文字 | 不通过Number处理精确数值字符串 |

十六进制正文只有0至9、a至f，文本带明确utf8mb4引入符，不依赖会话是否启用NO_BACKSLASH_ESCAPES，也不需要假设SQL字符串的反斜线转义。文字CURRENT_TIMESTAMP等仍是十六进制文本。孤立代理项、负零、非规范Base64填充位额外拒绝，避免UTF-8替换或宽松解码丢失来源信息。

标识符与值分别处理。库、表分别用`qualified`引用，列用`identifier`引用，反引号双写；无会话上下文时保守拒绝标识符里的反斜线、控制符、尾部空白、代理项及超过64字符名称。允许的Unicode名称不通过SQL表达式通道。

这是文件内容保真，不是目标服务器执行结果保证：本功能不读取目标字段、自增、字符集、约束或会话设置，不保证后续目标类型转换无损。无服务器连接、无SQL执行、无重新查询。

## 有界内存、文件与取消

沿原快照上限：100000行、1024列、2000000单元格、256KiB单字段、1MiB单行、32MiB总输入。只增加有界目标映射和摘要；样例最多20行、4MiB。SQL不整份join，按原列序逐行调用同一生成器，单行仍由原预算约束。

实际写入复用`ResultFileTasks`→`AtomicFile`，保留短写循环、64KiB缓冲、编码往返校验、目标预约、sync前后取消检查、关闭后原子rename及临时文件清理。SQL文件单独限制编码后最多512MiB，CSV/JSON路径原预算保持。UTF-16LE沿原BOM行为；UTF-8和GB18030保持原文件协议。

Main准备阶段取消或原归属失效时零Engine投递；Engine独立文件任务不调用connect或execute。同步等待阶段取消保原目标，错误不自动重试；rename已开始后的迟到取消按原模型结算真实保存结果，不承诺撤销已提交文件。

## 实际验证与原始日志

运行目录：`D:\svn\DBArk\.cache\parallel-20261015\employee1-query-result-insert-export-20261018`。只读复用`D:/svn/DBArk/node_modules`。Node运行时为`C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe`。

- 最终九个必要测试文件共115项通过；其中新增合同22项、真实文件/Main/Engine12项、真实React到文件10项，其余71项为原CSV/JSON、勾选投影、列布局及Main准备取消回归。日志`.cache/result-insert-export/targeted-delivery.log`。
- 真实文件测试含UTF-8/UTF-16LE/GB18030实际字节与手工SQL常量对照、NULL/空串/BLOB、精确大数/小数、日期小数/JSON/Unicode、短写、sync取消、rename/write错误、250行进度取消及关闭清理。Main测试执行产品派发函数原文，仅替换真实原生选择、窗口归属和broker端口；UI测试执行实际React、严格IPC、Main授权及Engine实际文件写入，网格显示和原生端口为RAM替身。驱动spy证明没有连接或SQL执行。
- 首轮文件验证5失败、26通过：Windows沙箱系统TEMP目录rename返回EPERM，另有VM异常类别端口未注入导致原错误被遮盖。改用本独立目录TEMP/TMP并补齐测试端口后31项通过；没有放宽产品原子替换。原日志`core-first.log`和`core-after-temp.log`保留。
- UI首轮3个失败属于测试仍按选择前按钮文字定位，选完后实际显示文件名；已修定位。必要旧UI回归另发现重复选择相同CSV格式只增加代次而React不重绘，旧按钮失效；已改为相同格式/编码不触发变更。原红`ui-first.log`、`ui-and-regression.log`和修后`ui-after-same-format-fix.log`保留。
- TypeScript全项目`tsc --noEmit`通过，日志`type-delivery.log`；先前类型收窄及测试字面量类型错误日志保留。最终差异检查通过。

复验命令：

```powershell
$env:TEMP = (Resolve-Path .cache/result-insert-export/tmp).Path
$env:TMP = $env:TEMP
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/result-sql-contract.test.ts tests/unit/result-sql-file.test.ts tests/unit/result-sql-ui.test.tsx tests/unit/result-export.test.ts tests/unit/result-selected-export.test.ts tests/unit/result-file-tasks.test.ts tests/unit/main-preparing-tasks.test.ts tests/unit/query-result-columns-ui.test.tsx tests/unit/result-selected-dialog.test.tsx --reporter=verbose
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

未跑旧全套、原生GUI、安装、真实数据库、Docker、服务、端口、系统剪贴板、新CI、构建或打包。原生文件选择、完整Electron来源生命周期和服务器上执行导出文件仍待Root独立验收；不能将RAM端口或本地文件字节证明称为原生或实库验收。用户说明见`docs/query-result-insert-sql.md`。
