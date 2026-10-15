# F02 Excel 三项交叉复审修复

日期：2026-10-16。修复起点：`e51b0ebf7ba83740e1d20817ca3b9c3faa2cd37f`。仍只在 `task/parallel-f02-excel-20261015` 追加提交，不合入统筹分支。

## 1. 导入前校验与逐条 INSERT 诊断

新增 `engine/losslessImport.ts`，由共享文件导入链路逐个映射值调用：

- 整数用 BigInt 检查位宽及符号；DECIMAL 按目标精度/尺度验证普通十进制文本，非零小数位不得超出目标尺度。精确值不先转为 Number。
- FLOAT/DOUBLE 检查可往返文本与目标浮点精度；拒绝溢出、下溢和已不能往返的原文。保留实际传入参数，检查不修改值。
- VARCHAR/CHAR 以 Unicode 码点检查字符数；目录新增列自身的 `characterSet`，文本字节容量和编码往返按列检查，不套用表默认编码。CHAR 尾随空格、定长 BINARY 填充、非法 Base64、无效 Unicode 等有损情形明确拒绝。无法确认的字符集或含反斜线转义的枚举定义采取保守拒绝。
- 日期检查日历；时间检查目标非零小数精度和端点。枚举不允许数值索引暗中转换，SET 不允许服务器静默重排。NULL 只写入允许 NULL 的目标。
- 每条 INSERT 返回后立即核对 OK 包 `warningStatus`。非零或无法确认时，在下一条 INSERT/COMMIT 之前执行 `SHOW WARNINGS LIMIT 32`；只展示诊断代码并拒绝当前批，未知警告也不当作无损成功。诊断读取失败同样回滚，不自动重放写入。当前批计数包含已执行的警告行；先前明确 COMMIT 的 500 行批次保留。
- CSV/JSON 使用同一校验与警告策略，仍保留其原有无可靠键表的追加能力；BIT 参数复用现有类型化占位符，避免变回隐式整数转换。正常精确数值、日期文本及二进制协议兼容测试通过。

这是共同导入保护的收紧：可能被舍入、截断或不能证明无损的输入会报错，不再接受并宣称成功。精确整数/小数要求普通十进制文本；近似浮点允许可往返的指数文本。未增加依赖或修改锁文件。

依据：[MySQL 精确数值舍入](https://dev.mysql.com/doc/refman/8.4/en/precision-math-rounding.html)说明严格模式也可能只给出小数舍入诊断；[SHOW WARNINGS](https://dev.mysql.com/doc/refman/8.4/en/show-warnings.html)读取最近非诊断语句的诊断，不能先发下一条普通 SQL。另据[时间小数精度](https://dev.mysql.com/doc/refman/8.4/en/fractional-seconds.html)，时间舍入可能不产生任何警告，因此写前精度校验必须保留。[列字符集 latin1 说明](https://dev.mysql.com/doc/refman/8.4/en/charset-we-sets.html)支持采用 cp1252 映射；其它列编码仍须能在已有 iconv-lite 中原文往返。

## 2. 文件与目标元数据一起取消并等待收尾

正式服务移到 `renderer/excelTransferServices.ts`。`targetColumns(target, taskId)` 为 `metadata.table` 发送独立编号，不再与文件读取共用或漏传编号。

新增 `ExcelPreviewTasks` 持有批次内各任务、是否实际提交、实际 Promise 和取消 RPC。任一失败、显式取消、关闭、上下文变化或卸载会取消所有尚未结束的自有请求；任务及取消 RPC 都结束前不释放占位，后继批次也先等待旧批次。取消失败不会放弃实际任务 Promise。未提交请求不发无主取消，迟到响应继续受组件代次保护。关闭回调本身等待读取收尾，并核对仍属于发起关闭时的上下文。

带任务编号的 `metadata.table` 继续使用现有独立任务路线，绑定建连 AbortSignal；补充目录动作终态登记与严格连接关闭。运行中取消等待 KILL 后原动作终态及源连接、控制连接的清理，避免只收到 ACK 就释放。未带编号的旧短读入口保持原路由。

没有重复实现统筹分支的全局任务编号互斥，也没有改动 Q07 回退。

## 3. 总格数包括标题

导出按 `(数据行数 + 1) × 列数` 计算；导入/预览同时检查实际稀疏行与按标题补齐后的逻辑格数，口径都包含标题。界面同步说明“500 万格（含标题）”。

内核选项 `cellBudget` 只能收紧产品预算，公开 IPC 不接受它。用 2 列、2 条数据、预算 6 格验证导出后预览/读取正常；再加一行时导出失败并保留原文件，较高预算生成的文件也被低预算预览/读取拒绝。没有生成 500 万格文件。

## 本轮实际验证

- 最终全量单元 **2345/2345 通过，0 失败、0 跳过、0 失败套件**：`.cache/f02-excel/review-fixes-all-unit-final.json`。
- 最终 Excel 专项 **133/133 通过**：`.cache/f02-excel/review-fixes-targeted-final.json`，覆盖预校验、警告后 SQL 顺序、诊断缺失/失败、501 行告警部分成功、CSV/JSON、元数据建连取消与查询/关闭双等待、预览双任务及含标题预算。
- 类型检查、完整构建通过；构建日志 `.cache/f02-excel/review-fixes-build-final.log`，仅有已有 Zod 注释和大分块提示。
- 真实 Electron 离线入口 1 项通过，实库 1 项明确跳过；独立用户目录、实际预加载/IPC/文件引擎，原生文件对话框仅替换回答。检查文件与目标元数据使用不同任务编号，关闭后均无运行任务。输出：`.cache/f02-excel/review-fixes-e2e/`。
- 中间全量报告出现过“2343 项通过但套件失败”：新增服务测试误导入带 window 的 UI 状态模块。服务定义拆为独立模块后修复装载边界；没有伪造 window 或放宽断言，最终完整回归成功。一次 utf8mb3 补充平面断言发现 Unicode 正则检测错误，已改为码点范围，最终断言通过。原报告保留于忽略缓存，未将中间结果计作通过。

实际命令：

```powershell
$env:TEMP = (Resolve-Path .cache/f02-excel/review-fixes-tmp).Path
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/f02-excel/review-fixes-all-unit-final.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
$env:DBARK_INTEGRATION_ENABLED = '0'
node node_modules/@playwright/test/cli.js test tests/e2e/excel-transfer.spec.ts tests/e2e/excel-transfer-live.spec.ts --reporter=list --output=.cache/f02-excel/review-fixes-e2e
```

公共文件改动：`engine/index.ts` 的导入及可取消元数据分派、`engine/metadata.ts` 的列字符集目录、`shared/contracts.ts` 的可选 `ColumnInfo.characterSet`、`shared/excelTransfer.ts` 的目标元数据任务参数，以及 Excel 对话框/服务/文件模块。未修改主进程统一编号、版本、覆盖表、发行或安装策略。

## 未验范围

本轮没有连接 200、业务库或生产服务，没有新凭据、密钥或 Docker 操作。真实 MySQL 5.7/8.0/8.4 和 MariaDB 10.11/11.4 的非严格模式警告、存储字符集、元数据锁/KILL 延迟、实际网络断开、百万行性能和最终安装包仍由主对话统一安排。单元驱动边界模拟证明的是控制流和原文策略，不能代替服务器内核验收；触发器自行改值等业务语义也未通过读回验证。
