# CSV 导出分隔符

基线：`581cce8d3a6baec87d06ab475805a45d94eca179`。仅扩展表 CSV 导出及已返回/勾选结果 CSV 导出，开放逗号（默认）、分号、制表符（Tab）。不改版本、工作流、完整查询流式导出或 CSV ZIP 的参数。

## 合同与输出

- `files.export`、`files.exportResult` 的可选 `csvDelimiter` 严格限定为 `,`、`;`、`\t`，拒绝未知字段、非法值、显式 `undefined` 及 JSON/SQL 夹带。缺项保持逗号；界面默认逗号继续省略字段。
- 数据转换保留 NULL 的 `\N`、反斜线转义、空字符串 `""`、二进制 `base64:`、精确数值字符串。仅按所选分隔符调整字段引用和连接，标题不采用数据的反斜线协议。
- 表导出复用既有投影目录、列顺序、SELECT 和只读快照。结果导出继续只写入打开时固定的已返回/勾选可见快照，不传 SQL、连接或会话。
- 编码、CRLF、流式缓冲、短写、进度、取消及原子替换沿原流程。共用 CSV 函数的单参调用默认逗号，完整查询流式 CSV 不扩展参数。

## 界面失效规则

两个入口共用三选项及中文文案。分隔符变化同步递增配置代次并撤销文件选择，A→B→A 不能接纳迟到的文件选择或旧执行回调；重新选择文件后只能由新回调启动。结果入口复用既有预览撤销规则。表入口的字段目录和顺序不依赖分隔符，继续复用，不额外读取数据库目录。显示的字段顺序及结果样例展示原字段/值，不作为 CSV 字节预览。

## 验证

新增 `csv-export-delimiter.test.ts` 21 项：严格 IPC 正反例、两个入口的三分隔符乘三编码真实文件字节、NULL/空串/反斜线/BLOB/精度/引号/换行/尾空列、缺省字节、大字段跨 64 KiB 缓冲与 113 字节短写、sync 等待期间取消保留原目标。字节期望手写，不用被测导出函数生成答案。表测试运行正式 Engine、字段投影与真实文件，仅驱动及元数据使用 RAM 边界，独立断言全部 SELECT/事务控制语句。

新增 `csv-export-delimiter-ui.test.tsx` 10 项：真实 React 表单在内存 DOM 中验证三个枚举、两入口文件失效、迟到选择、ABA 旧执行、重新选择后的默认字段省略、字段/勾选范围和非 CSV 不夹带。只有 IPC 使用 RAM 端口。内存 DOM 不支持 CSS 类选择器，测试通过标准 class 属性准确定位按钮。

本轮窄回归 14 文件、196 项通过，TypeScript 检查通过。命令在当前克隆执行：

```powershell
$env:TEMP = (Resolve-Path '.cache/csv-export-delimiter/tmp').Path
$env:TMP = $env:TEMP
node node_modules/vitest/vitest.mjs run tests/unit/csv-export-delimiter.test.ts tests/unit/csv-export-delimiter-ui.test.tsx tests/unit/engine-files.test.ts tests/unit/engine-csv-export-fields.test.ts tests/unit/engine-csv-export-commit.test.ts tests/unit/result-file-tasks.test.ts tests/unit/result-export.test.ts tests/unit/result-selected-export.test.ts tests/unit/result-sql-contract.test.ts tests/unit/result-sql-file.test.ts tests/unit/result-sql-ui.test.tsx tests/unit/transfer-csv-export-fields.test.tsx tests/unit/transfer-csv-import-delimiter.test.tsx tests/unit/query-stream-file.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

日志及 SHA-256 位于本克隆 `.cache/csv-export-delimiter/handoff.json`。没有启动 GUI、Electron、数据库、SSH、Docker、端口或 CI；尚未做真实桌面保存交互或实库验收。未引入依赖或构建安装包。

## 整合边界

本任务修改 `src/shared/contracts.ts`、`src/shared/validation.ts`、`src/engine/index.ts`、`src/engine/files.ts`、`src/engine/resultFileTasks.ts`、`src/renderer/components/TransferDialog.tsx`、`src/renderer/components/ResultExportDialog.tsx` 及用户指南。完整查询流式 SQL 任务可能同时修改合同、校验、Engine、CSV 共用函数或用户指南；整合应以固定基线三方核对，保留两个任务的独立语义，不以整文件覆盖。
