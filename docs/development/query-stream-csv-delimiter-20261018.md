# 完整流式CSV及CSV ZIP分隔符

基于 `493dc2f94fb3d64f4f08ae516aa9aadbf4184801`，为一次新执行的单CSV及全部结果CSV ZIP增加逗号、分号和制表符三个选项。缺项仍使用逗号；JSON和完整INSERT请求禁止夹带 `csvDelimiter`，显式 `undefined` 也不属于有效IPC请求。

## 执行及文件边界

- Renderer复用现有受控枚举组件，仅在CSV/CSV ZIP显示。修改分隔符同步撤销文件、执行确认和旧渲染回调；恢复原值仍需重新选择文件和确认。选择在途、执行期间及完成后锁定配置，旧确认回调不能借新文件恢复确认。
- Engine只将枚举传入原文件写入器，保持同一 `queryStatements` / `consumeQueryFrames` 执行路径。选择文件和修改分隔符不调用执行端口，没有新增SQL、连接、字段目录查询或预扫描。
- 标题及数据使用同一分隔符；NULL、空字符串、首部反斜线、Base64、精度字符串和字段顺序保持既有协议。仅当前分隔符触发CSV引用，双引号及换行仍按原规则处理。
- ZIP的全部行结果使用同一分隔符，既有版本1清单的 `csv.delimiter` 记录实际字符。空行集仍有标题，状态包仍只记清单，不生成CSV。
- 保留现有帧校验、逐帧等待、预算、背压和原子提交。完整INSERT映射、确认令牌及归属保护未重写。

## 默认字节的独立对照

在修改写入器之前，用基线写出固定的空集、状态包、多行集及精度/NULL/空串/反斜线/字节样例，冻结六个完整文件SHA-256。正式夹具为 `tests/fixtures/stream-csv-delimiter-default-bytes.json`；修改后的缺项和显式逗号均逐字节摘要匹配。ZIP包含完整目录、CRC和清单，未忽略容器差异。

| 格式/编码 | 基线SHA-256 |
| --- | --- |
| CSV/UTF-8 | `4eb7c8dfa2f601a648912012e5007862e97a7fdf23ae2962cc066229deec78da` |
| ZIP/UTF-8 | `8252890b92fb23fa770b8547a11b5c9c24c87afb59bf7adfcb37283cb0a527b6` |
| CSV/UTF-16LE | `a7581deb2fcf3db0ee8ac0c190df874af33a69fda0c9f00b58d1d347efbb4c1a` |
| ZIP/UTF-16LE | `0eb594ef54ffc0925417ccba16f665e92f002347bbdf4f86eeada81447857609` |
| CSV/GB18030 | `28aaaf27af92714a23693a685653579e302a5507bcc5de8e3a35a9dc7dd421cf` |
| ZIP/GB18030 | `a2977a598fd38e05308e387bc6d07b1dd50d5776f3621c1f18a06255e0b410e1` |

## 窄验证

使用项目已有Vitest及TypeScript，未修改共享依赖。测试环境关闭实库集成和原生归档检查，临时文件放在本任务 `.cache/stream-csv-delimiter/tmp`。

```powershell
node D:\svn\DBArk\node_modules\vitest\vitest.mjs run tests/unit/stream-csv-delimiter.test.ts tests/unit/stream-csv-delimiter-ui.test.tsx tests/unit/engine-query-stream.test.ts tests/unit/query-stream-file.test.ts tests/unit/query-csv-archive.test.ts tests/unit/query-stream-protocol.test.ts tests/unit/ui-query-csv-archive.test.tsx tests/unit/ui-query-stream-export.test.ts tests/unit/query-insert-file.test.ts tests/unit/query-insert-atomic.test.ts tests/unit/query-insert-stream.test.ts tests/unit/query-insert-ui.test.tsx tests/unit/query-insert-ownership.test.ts
node D:\svn\DBArk\node_modules\typescript\bin\tsc --noEmit
```

13文件197项通过。新增文件层54项包括三编码×三分隔符×两格式、各自独立的标题/字段引用预期、ZIP目录/CRC/清单、跨64KiB缓冲和113字节短写、sync/rename期取消以及非法IPC。真实ReactDOM的12项新增测试验证重选文件、A→B→A旧回调、选择在途、busy/完成锁及JSON不夹带；Engine新增6项验证单次原执行路径。旧VM夹具只补入真实共用辅助函数，保留原断言。

本次未启动GUI、Electron、应用、数据库、SSH、端口、Docker或CI，没有执行真实SQL。以上是纯文件、RAM替身及类型证据；原生解包、真实数据库和产品界面验收由统筹另行安排。
