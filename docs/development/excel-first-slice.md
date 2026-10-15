# Excel 文件传输首批模块

当前已接入表格实际导入/导出入口、文件令牌、白名单 IPC、参数校验、工具进程、分批事务和任务取消，完成 XLSX 首个实用切片。F02 仍为部分完成：200 服务器实库、百万行和最终安装产物由主对话统一验收。下文旧模块的历史测试数据保留为来源说明，不能视为本次实际验收。

2026-10-16 交叉复审的导入转换、预览元数据取消与标题预算三项修复，见 [本轮修复与验证](excel-review-fixes-20261016.md)。

## 本轮接线与实际验证（2026-10-15）

- 来源：复用 `903b883a8701e294e7844307811a26f68a55b8c7`，通过带 `-x` 的 cherry-pick 落为 `9abf996`，未改旧工作目录。
- 入口：打开表格标签 → 工具栏“导入”或“导出” → 文件格式“Excel 工作簿（XLSX）”。可返回其它文件格式。
- 导入：选择工作表、实际表头行（1～1000）、普通文本/DBArk 协议、字段映射；展示前 20 行。完整预检拒绝后部公式及文件变化，重新核对目标生成列和映射；只追加到有可靠键的 InnoDB 表，复用 `buildChanges` 类型化参数与文件导入每 500 行提交的事务。失败保留前批、回滚当前批，不自动重试或更新旧记录。
- 导出：默认“前 1000 行样本”，另可显式选择“整张表（流式）”。均不应用当前表格筛选；通过独立连接一致性快照、驱动背压和原子文件替换执行，整表超过 XLSX 预算会失败并保护原目标。流消费者失败也停止实际 SELECT，等待控制连接和文件清理。
- 主进程：`excel.sheets/preview/import/export` 接入预加载白名单，拒绝任意路径；严格要求原生对话框创建的 XLSX 指定用途令牌。导出复用全局路径目标锁，准备阶段取消不发送引擎任务。工作簿清单/预览也支持 `query.cancel` 和退出等待，切换参数、关闭或目标元数据失败会取消对应解析。Excel 数据任务在建连前占用编号并传入 AbortSignal；取消、断开和退出覆盖建连阶段，迟到建立的连接会关闭且不发送数据语句。任务摘要不持久化原始字段值与服务器错误。
- 依赖：沿用精确锁定 `exceljs@4.4.0`（本地 LICENSE 为 MIT）与 `saxes@6.0.0`（ISC）；未新增或升级其它依赖。当前读取与导出均仅支持 XLSX，旧二进制 XLS 不支持。
- 初轮全量单元 2267/2267 通过。补充建连取消和流取消后，最终全量单元：**2271/2271 通过，0 失败、0 跳过**，包括引擎接线、主进程原函数授权/锁、真实文件往返、分批失败、读取取消和原子保护。最终报告：`.cache/f02-excel/all-unit-host.json`。中间一轮沙箱回归有两项既有 SQLite 保存查询用例因真实 rename 返回 EPERM 失败，保留于 `.cache/f02-excel/all-unit-final.json`；同一套断言在宿主、独立临时目录、`--maxWorkers=2` 下全部通过，未修改存储代码或降低断言。
- `node node_modules/typescript/bin/tsc --noEmit`、`node scripts/build.mjs`、`git diff --check` 均通过；构建有现有 Zod 注释和大块提示。未制作安装包。
- 真实离线 Electron：`excel-transfer.spec.ts` **1/1 通过**；最终复验同样通过。使用本克隆独立配置目录，只替换系统文件对话框回答，正式预加载、IPC、文件 IO 和解析均真实。核对两个工作表、第二行表头、BIGINT 和公式外观文字、用途隔离、表格入口及范围选项。未连接数据库，目标不可用时不能提交导入。最终报告和截图位于 `.cache/f02-excel/e2e-final/`。第一次沙箱内 Electron 启动失败，获准在宿主重跑后通过，未降低断言。

```powershell
$env:TEMP = (Resolve-Path .cache/f02-excel/tmp).Path
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/f02-excel/all-unit-host.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/@playwright/test/cli.js test tests/e2e/excel-transfer.spec.ts --reporter=list --output=.cache/f02-excel/e2e
```

公共文件改动：`contracts.ts`、`commands.ts`、`validation.ts`、`main/index.ts`、`main/taskPrivacy.ts`、`engine/index.ts`、`TransferDialog.tsx`；其余为 Excel 独立模块、样式、文案和测试。原复用提交还改了 `atomicFile.ts`、`package.json` 与 `pnpm-lock.yaml`。未改 App、统一功能覆盖表、版本、发行或部署策略。

未验：200 上 MySQL/MariaDB 真正往返、日期/金额的服务器行为、BIT64、百万行性能、数据库断线及真实 KILL 延迟、最终 Windows 安装包、其它桌面平台。所需资源仅为主对话核对过的 200 隔离 MySQL/MariaDB 实例及随机 `dbark_e2e_*` 库，临时用户需要隔离库建表、读写、建删库及取消自己查询的权限；不需要业务库、Docker 新实例或长期密钥。

供主对话统一验收的 `tests/e2e/excel-transfer-live.spec.ts` 已添加，默认跳过。该用例仅建立随机隔离库，创建两张表和 1201 行夹具，通过真实界面分别导出 1000 行样本、1201 行完整工作簿，再选择 DBArk 协议并映射导入，最后独立比较 BIGINT、DECIMAL、微秒日期、NULL、空串、字面反斜线、二进制与 BIT64。它尚未连接真实服务器，不能视为实库通过证据。主对话核对服务器与授权范围后，向该进程注入临时 `DBARK_TEST_*` 环境变量即可运行；不复制主目录的秘密文件：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
node node_modules/@playwright/test/cli.js test tests/e2e/excel-transfer-live.spec.ts --reporter=list --output=.cache/f02-excel/live
```

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
