# Excel 文件传输首批模块

当前实现提供真实 XLSX 流式文件引擎和服务注入式导入/导出对话框。尚未接入正式 IPC、数据库事务和 App 入口，不能据此宣布完整 F02 已完成。

## 已实现

- `exportExcelFile` 消费明确列元数据和 `AsyncIterable<CellValue[]>`，用 ExcelJS 4.4.0 生成 XLSX。固定版本的 `_openStream` 适配以 Node PassThrough 替代默认无背压缓冲，逐行等待工作表 drain，并限制单行与实际 XML 字节。
- `AtomicFile.writeBytes` 复用独占临时文件、短写消费、64 KiB 缓冲、预算、取消、fsync 及原子替换。复制调用方的字节；取消或错误时等待真实流和在途写入结束后清理，保留原文件。
- `listExcelSheets`、`previewExcelSheet` 和 `readExcelRows` 提供工作表选择、前 20 行预览和逐行数据读取。预览仍完整校验所选表，后部公式和合并不会被前 20 行截断掩盖。界面提供分页字段映射、协议选择和任务取消服务接口。
- 预览返回原始压缩文件的 SHA256 指纹。正式导入必须将请求的 `fingerprint` 传给 `readExcelRows.expectedFingerprint`，在第一条记录产出前拒绝预览后修改的文件。主引擎仍需验证来源/目标字段、生成列和重复映射，并沿用现有提交链路。
- `ExcelTransferLifecycle` 绑定任务提交时的上下文代次和取消服务。切换模式、目标或卸载后，旧任务成功/错误不会更新新界面；未提交的任务直接撤销，已提交的任务只取消自己拥有的编号。取消失败被观察，任务与取消 RPC 都收尾后才释放占位。按连接/库/表登记跨实例占位，实际重新打开的对话框只能等待旧任务，不能取消其它实例任务；等待者卸载立即移除监听，任务结束精确删除登记。

## 精度和单元格语义

所有数字都写为文本。BIGINT、DECIMAL、NUMERIC 要求驱动提供原始字符串；FLOAT/DOUBLE 使用可往返的文本表示，保留负零。日期时间按原始字符串保留微秒；JSON 文本不经数字解析。二进制使用规范 Base64。

DBArk 协议中 `\N` 表示 NULL、`\B:` 后接 Base64，普通反斜线开头文本增加一个反斜线转义；显式空字符串保持为空文本。外部文件默认使用普通 Excel 文本模式，不解释这些标记。只有显式选择 DBArk 协议才还原。标题保持原样，拒绝空或重复标题，支持 `__proto__` 等合法名称。

所有字符串写为 inlineStr，不生成公式。按 ST_Xstring 规则保护字面 `_xHHHH_` 和回车，防止 XML 换行归一化或二次转义改变内容。导入保留 XML 中的原始数值 token；Excel 保存前已经发生的精度丢失无法恢复。日期样式数值保留原始序列值，界面提示先在来源文件转成明确日期时间文本。空白格为 NULL，显式空文本为空串。

公式（包括缓存值）、外部链接、宏、嵌入对象、合并单元格和错误格均拒绝，不执行公式或访问外部资源。

## 文件预算与范围

格式限制为 1,048,576 行（含标题）、16,384 列和每格 32,767 UTF-16 代码单元。产品限制为 500 万格、单行 1 MiB、工作表 XML 256 MiB。

ZIP 读取只支持单磁盘 ZIP32 的 stored/deflate，拒绝加密和 ZIP64。限制压缩文件 256 MiB、单 entry 256 MiB、实际总展开 512 MiB、2,048 个 entry、4 MiB 目录。校验路径、重名、区段重叠、本地头与目录一致性、实际展开量、CRC32 和压缩输入消费长度。同一只读文件句柄贯穿读取；每个 entry 前后检测原地修改，提前结束后等待流资源释放。

共享字符串缓存最多 10 万项或 16 MiB；XML 外层限制单 token 256 KiB、深度 64、属性 64，并拒绝 DTD 和自定义实体。saxes 只解析通过外层预算的分块文本，不整本加载。当前支持常规 transitional SpreadsheetML 和 UTF-8 XML；Strict OOXML、UTF-16 XML 与 chartsheet 未支持。

## 已验证与待验证

2026-10-15 在独立任务 checkout 中运行四个专属 Vitest 文件，25 项通过：真实 ExcelJS 读写与保真往返、工作表选择、共享字符串、公式和外链拒绝、后部公式预检、指纹变动、ZIP/XML 恶意输入、字段映射、原子短写、缓冲复制、慢写背压、磁盘错误和取消清理。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/excel-files.test.ts tests/unit/excel-atomic-stream.test.ts tests/unit/excel-zip.test.ts tests/unit/excel-mapping.test.ts --reporter=json --outputFile=.cache/f02-excel/round9/results.json
```

慢写测试包含 400 行随机内容，观测 PassThrough 可读与可写缓冲合计峰值 132,922 字节，首次实际磁盘写入时生产了 17 行；取消后在途写入为零，原文件保持不变，无残留 partial。此数据不代表百万行性能验收。

随后补充 13 项生命周期专项并全部通过，覆盖上下文迟到响应、同步抛错、提交前取消、卸载、取消 RPC 拒绝、任务与取消双等待，以及跨实例同目标占位和监听清理。专项报告在 `.cache/f02-excel/lifecycle-round2/results.json`。

最终全量单元测试 **2,166 项通过、0 失败、0 跳过**，全量 `tsc --noEmit` 通过；`git diff --check` 通过。全量测试第一次因 Windows 沙箱 `AC\Temp` 的真实重命名操作返回 EPERM，68 项失败，原件保留在 `.cache/f02-excel/lifecycle-final/all-unit.json`。仅将本次测试进程的 `TEMP/TMP` 指向当前 checkout 的忽略缓存目录后重跑，全部通过，没有修改或降低文件内容、真实 rename、原子性断言。

```powershell
$env:TEMP = (Resolve-Path .cache/f02-excel/lifecycle-final/tmp).Path
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=.cache/f02-excel/lifecycle-final/all-unit-workspace-tmp.json
node node_modules/typescript/bin/tsc --noEmit
```

早期文件引擎专项报告在 `.cache/f02-excel/round9/results.json`，流观测值在 `.cache/f02-excel/stream-metrics.json`。UI 的实际浏览器交互仍未验收，生命周期由独立可控 Promise 单元测试覆盖。

正式 IPC/参数校验/文件令牌接线、数据库事务及导入提交、App 入口、原生 UI 交互、真实数据库往返、百万行 XLSX、完整构建与打包均未验收。未运行本机 Docker 或远程实库测试；这一批不应计作完整 F02。

## 依赖与依据

- `exceljs@4.4.0`，MIT；内部流适配包含版本/接口断言，升级时必须重新验证背压和销毁行为。
- `saxes@6.0.0`，ISC；解析器自身不限制 token，由外层预算补齐。
- [Microsoft Excel 规范与限制](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits)
- [Microsoft ST_Xstring 转义规范](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/d34ae755-c53f-4a44-a363-c6dd3ee018a4)
- [ExcelJS 官方仓库](https://github.com/exceljs/exceljs)
- [saxes 官方仓库](https://github.com/lddubeau/saxes)
