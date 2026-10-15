# Q05 同次新执行的多CSV容器

日期：2026-10-16。基准：`8199bf6ff914e3694206c8dfc93d5f0d43a5237e`。普通克隆任务分支：`task/parallel-q05-multi-csv-20261016`。没有修改根目录、创建工作树或合并主分支。

## 容器与文件边界

在已有“新执行并完整导出”窗口增加“CSV ZIP：全部行集与执行状态清单”。它明确在当前查询标签的同一物理会话中新执行一次捕获的SQL；选择文件、切换格式或填写参数都不执行SQL。格式、编码或参数变化会撤销确认；失败后再次执行仍需重新确认，不能作为仅重试文件写入的入口。JSON全部结果与单CSV指定行集继续保留。

选择标准ZIP64的STORE模式，不做压缩。每个行集从原驱动流中按顺序写入独立文件，最后追加UTF-8清单和中央目录；不把所有结果缓存在内存，不创建一组需要分别替换的输出文件，也不为取得第二行集重放SQL。使用ZIP64是为了保持已有10 GiB上限，不能悄悄退成ZIP32的4 GiB限制。已实际读取 [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) 的4.3.9数据描述符、4.3.12/4.3.14 ZIP64结束结构与4.5.3扩展信息规则；未知长度使用数据描述符，大小与偏移写入64位字段。

```text
用户选择的结果.zip
  results/rows-001.csv
  results/rows-002.csv
  ...
  manifest.json
```

所有CSV文件名预先由1～200序号生成并核对安全性和同名冲突，固定ASCII路径；用户SQL、库表名、列名均不参与路径。空行集占一个行集序号并保留标题行。非行集不伪造CSV，只在清单中保留原协议位置、语句序号、影响行数、精确插入编号和警告数。行集序号独立于包含状态包的结果序号。没有行集的脚本仍交付仅包含清单的有效ZIP。

清单示例：

```json
{
  "format": "DBArk-query-csv-archive",
  "version": 1,
  "encoding": "utf8",
  "csv": {"delimiter": ",", "recordDelimiter": "\r\n", "null": "\\N", "leadingBackslash": "double", "binary": "base64:", "header": "exportName", "columnOrder": "position"},
  "results": [
    {"kind": "rows", "resultOrdinal": 1, "statementOrdinal": 1, "rowResultOrdinal": 1, "file": "results/rows-001.csv", "columns": [{"position": 1, "name": "重复名", "exportName": "重复名", "type": "LONGLONG"}, {"position": 2, "name": "重复名", "exportName": "重复名 [2]", "type": "NEWDECIMAL"}], "rowsWritten": 0, "bytes": 25, "warningCount": 0},
    {"kind": "status", "resultOrdinal": 2, "statementOrdinal": 2, "affectedRows": 1, "insertId": "18446744073709551615", "warningCount": 0}
  ]
}
```

bytes按编码后完整CSV（含标题、换行和可选BOM）计数；例中UTF-8空集标题为25字节。重复或空标题沿用现有按位置生成唯一exportName的规则，同时保存原name和position；不使用JSON对象键重排CSV列。BIGINT/DECIMAL保留驱动提供的精度字符串，日期和微秒不经Date转换，CSV继续使用`\N`表示NULL、首部反斜线双写、字节`base64:`协议，空串与NULL不同。文本严格模式遇到FLOAT/DOUBLE仍失败，显式二进制仍需独立确认，不能为新格式放宽原诊断约定。UTF-16LE在每个CSV开头各写BOM；清单始终UTF-8。每段编码往返校验，无法无损编码时失败并保留旧文件。

## 预算、背压与原子提交

| 项目 | 本次口径 |
| --- | --- |
| SQL模板 | 沿用20 MiB |
| 结果数 | 沿用200，包含所有行集和非行集；最多200个CSV加1个清单 |
| 每结果列数 | 沿用1024 |
| 单字段/序列化单行 | 沿用8 MiB / 16 MiB；编码后的片段与既有文本写入相同，仍受总文件预算约束 |
| 驱动队列 | 沿用8行/1 MiB软阈值与独立大行硬限额；现有消费者逐行暂停，实测假驱动慢磁盘峰值1行 |
| 原子文件缓冲 | 沿用最多64 KiB待刷小片段，大行直接有界写入 |
| 预览 | 沿用每行集200行、所有结果共享16 MiB，预览不用于生成ZIP |
| 最终ZIP | 沿用10 GiB，包含CSV、清单、各头/描述符及中央目录的实际全部字节 |
| 清单 | 新容器明确的8 MiB序列化元数据预算；200结果与1024列上限也同时生效，极大列元数据组合可能先触发清单预算 |

内存仅与有界单行、固定写缓冲、至多201条ZIP目录、受限列元数据和既有预览有关，不随总行数增长。清单预算是序列化字节预算，不宣称JavaScript堆峰值为8 MiB。CRC32按片段累积，无须读回旧行。`consumeQueryFrames`必须等待`writer.write`，磁盘背压传回原驱动的pause/resume。

发送用户SQL之前检查固定包内命名空间、目标是否普通文件/不存在、真实父目录、同目标任务锁、取消与独占临时文件创建；目录、链接、缺失父目录或已占用目标提前拒绝。主进程原有ExportReservations与引擎AtomicFile锁均保留。主进程必须使用原生保存对话框取得ZIP导出令牌，CSV令牌不能授权此容器。

所有字节直接写在目标同目录的独占`.dbark-UUID.partial`文件中。全部语句和驱动终包完成、所有行集结束、清单写完、ZIP中央目录与结束记录完整、文件flush/sync/close成功之后，才进入原有不可取消的原子rename边界。进入rename前可取消；进入后依据真实替换结果报告成功或失败，晚到取消不能伪造文件已撤销。

写盘、编码、清单/文件预算、后续SQL、取消或断线失败时停止当前命令并等待实际收尾，不自动重连、重放或回滚用户事务；删除本任务未提交partial并释放自有锁，原目标不变。已经提交的数据库操作仍然存在。正常退出沿用Engine.closeAll的任务取消与finally清理。操作系统强杀进程可能留下未提交partial；该文件不视为成功包，不提供自动SQL续跑，核对无任务持有后可单独移走。恢复时优先保留原目标并核对数据库状态，不能从半包猜测需要重执行的SQL。

## 最小接线与改动范围

- `QueryStreamExportInput.format`增加`csv-zip`，沿用`resultSelection:{kind:'all'}`，不新增公开命令、执行通道或返回结果数组。
- 中央校验增加枚举与“容器必须全部结果”约束；`main/index.ts`仅把此格式的文件令牌类型映射为`zip`，真实路径仍由主进程注入。
- `engine/index.ts`仅扩展格式/选择校验，仍走同一个exportQueryStream、物理会话、任务进度、预览和事务状态流程；新ZIP实现位于查询导出专属`queryCsvZip.ts`，复用AtomicFile，不改通用写入器。
- 原`QueryStreamExportDialog`增加实际选项、ZIP文件选择、容器说明与包内文件名摘要；QueryTab复用现有入口和StreamExportOptions，无需修改。
- 不修改App导航、RecordJson、索引、completion、驱动或依赖锁文件。

## 验收与剩余边界

非GUI单元覆盖三种编码、重复/空/路径外观列名、精度字符串、NULL与字节、空集、状态包、200个行集、CRC损坏、超4 GiB头字段、目标冲突、准备取消、后续行集磁盘/编码失败、未结束边界、短写、原子替换失败、晚到取消及清单预算。真实生产帧消费者加假驱动和受控真实磁盘确认单次命令及背压；真实组件非GUI渲染/处理函数验证新选项、ZIP授权、确认失效、双击互斥与失败重确认。小型ZIP由独立目录解码加Node原生CRC检验，另用Python标准库zipfile/csv独立读取三种编码样本并核对CRC、精度与空集。这些均不等于真实驱动、Electron或安装包通过。

默认关闭的新增实库用例在`engine-query-stream.integration.test.ts`：单次CALL返回三个行集与最终状态，核对同物理会话ID、变量只递增一次、临时表、重复名、空集、精度/微秒/NULL/字节及未隐式提交事务；后续SQL失败核对旧ZIP、已提交写入、未执行尾SQL及partial清零。新增GUI用例在`query-stream-export.spec.ts`：实际下拉选项、选择ZIP、明确新执行和双击，读取真实落盘各CSV/清单并核对仅一次写入。统筹自行启用已核对的200实例后运行，本轮不访问200或启动Electron。

真实跨4 GiB/10 GiB文件、原生Windows解压器、macOS/Linux桌面、安装包及真实断线/退出矩阵仍待统筹验收；仅64位格式字段与小包外部解压已验证。Q05整体仍为部分完成，不能将此源码提交覆盖为旧公开安装包已支持。

本轮实际结果：完整单元151个文件、2784项通过（`--maxWorkers=2`，70.46秒）；类型检查和构建通过，构建仅保留既有第三方注释及大分块提示。实库套件21项默认跳过（本次新增2项），GUI套件仅列出9项（本次新增1项），没有运行Electron、操作剪贴板或访问200。三种编码的小型ZIP均经Python标准库真实解包、CRC和CSV值核对。日志和独立外部校验样本仅在本克隆忽略目录`.cache/q05-*`。

首轮全量与构建并发时，既有LATERAL Worker用例在5000毫秒超时，结果为2783通过、1超时；未修改该用例、解析逻辑或超时参数。保持源码后单独以两名测试工作进程复跑，151文件全部通过。原始日志`.cache/q05-multi-csv-unit.log`与复跑日志`.cache/q05-multi-csv-unit-bounded.log`均保留，构建日志为`.cache/q05-multi-csv-build.log`。

验证命令（本克隆目录执行；沙箱下临时文件放在本克隆）：

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache\q05-test-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=dot
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# 默认关闭，只收集实库用例；不要在未核对服务器时打开开关。
$env:DBARK_INTEGRATION_ENABLED = '0'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-query-stream.integration.test.ts
# 仅列出GUI用例，不启动Electron。
node node_modules/@playwright/test/cli.js test tests/e2e/query-stream-export.spec.ts --list
```
