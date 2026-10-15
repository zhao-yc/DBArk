# 真实引擎文件导入专项准备

日期：2026-10-16。测试文件：`tests/integration/engine-file-import-precision.integration.test.ts`。本说明是准备和离线检查记录，**不是实库验收结果**。

## 执行门禁与范围

两个开关必须同时为 `1` 才运行：`DBARK_INTEGRATION_ENABLED`、`DBARK_FILE_IMPORT_PRECISION_INTEGRATION_ENABLED`。任一未启用时整套跳过；不会读取 `.cache/dbark-test.env` 或根目录凭据文件。

运行前由统筹核对 Server-200 身份及已有隔离实例，并通过进程环境注入 `DBARK_TEST_HOST/PORT/USER/PASSWORD`；仅接受真实目标 `192.168.31.200` 与 `13357/13380/13384/13310/13311/13484`，默认端口为白名单内的 13384，未提供明确账号则失败。13484 必须显式启用严格 TLS，CA、SSH 私钥和主机指纹等仅由统筹通过既有 `DBARK_TEST_*` 环境变量注入，不复制、不输出。测试不执行 Docker，不创建用户，不扩权。

数据库固定为当前进程生成的唯一 `dbark_file_import_<12位随机十六进制>`；所有表都在固定白名单内。DDL、写入和 DROP 前再次核对目标。文件只允许当前克隆 `.cache/engine-file-import-precision/<本轮随机ID>/` 内独占创建并登记的 XLSX/CSV/JSON；实际父目录不能解析到克隆外，链接目录拒绝使用。清理不用递归删除，未知文件保留并使收尾失败。

当前测试仅依赖原有 Engine、真实 mysql2、ExcelJS 和文件模块。统筹应先集成 `3e32062` 定标浮点修复，以及统筹自己负责的 BIT 十进制占位符修复后再运行；员工4没有重复修改共用 `sql.ts`，也没有降低 BIT64 最大样本。

## 27 项用例

- XLSX、CSV、JSON 分别在真实专用非严格会话中验证 DECIMAL 非零超尺度、DECIMAL 溢出、VARCHAR 截断、无符号整数溢出，以及 FLOAT(5,1)/DOUBLE(5,1) 的 1.375。共 18 项。要求真实 Engine 返回失败、INSERT 数量为零、没有 COMMIT、独立旁观连接读取零行。
- 1 项 DATETIME 微秒缩减预拒绝，不以服务器 warning=0 作为放行依据。
- 3 项通过真实 Engine 导出再导入，旁观者逐字段核对 BIGINT 最大相邻值、DECIMAL(40,18)、微秒、BLOB、NULL、空串、公式外观文字及反斜线。
- 3 项 BIT64：原始最大十进制文本 `18446744073709551615` 导入后必须 `HEX=FFFFFFFFFFFFFFFF`；再由真实 Engine 导出，独立检查 XLSX 的 DBArk 二进制标记、CSV 的 base64 标记或 JSON 二进制包装，回导后必须相同。没有改成较小整数，也不允许非零 warning 继续提交。
- 1 项创建合法 BEFORE INSERT 触发器，对 id=501 执行 `SIGNAL SQLSTATE '01000' SET MYSQL_ERRNO=1265`。用真实专用预处理会话探测原始 OK 警告及紧接着的 SHOW WARNINGS，输出实际 warningStatus、诊断代码和版本能力。若某版本未给出可识别 OK 标志，如实记录事实。
- 1 项依赖上述实际能力：502 行真实文件导入，第 501 行警告后的下一条 SQL 必须是 SHOW WARNINGS，之后只能 ROLLBACK；实际 INSERT 恰好 501 次、前一批 COMMIT 恰好一次、独立旁观者只看到前 500 行。若合法触发器未暴露可识别 OK 警告，此项明确跳过并说明未覆盖，不能计作警告保护通过；触发器语法或其它错误不会被任意跳过。

## 真实驱动旁观与模式范围

`mysql.createConnection` 旁观包装仍调用原始工厂，query/execute 包装原样转发 SQL、参数与真实回调结果；不伪造目录、网络、OK 包或警告。每次调用只记录 SQL 顺序、OK 警告数和诊断代码，不记录参数值或认证配置。

仅当真实连接配置中的 database 精确等于本轮随机库，才为该专用连接排入 `SET SESSION sql_mode='',sql_notes=1,max_error_count=64`，并在生产连接初始化的实际 SELECT 结果中核对空模式。引擎文件任务、原生能力探针均使用这些专用会话。管理、旁观连接不借此修改模式；不执行 SET GLOBAL，结束后独立读取全局 sql_mode 确认没有变化。

## 收尾保证

引擎、原生探针、管理连接分别关闭；旁观者先检查正常关闭后的真实 threadId 残留，不能用兜底清理掩盖产品泄漏。然后逐驱动严格释放本地流；需要兜底 KILL 时，只允许本轮实际记录的线程 ID。仍有残留、关闭失败、partial 残件或未知文件均保留失败标记。

随后精确 DROP 当前随机库并独立确认不存在；逐个删除已登记文件及可精确归属的 partial，再删除本轮目录。公共 cache 父目录保留。每个收尾步骤独立收集失败，前项失败不能跳过其它文件、连接、数据库清理；旁观连接最后严格关闭，真实工厂和方法旁观器恢复。全部具备实际 threadId 的连接均按 ID 核对，未取得 ID 的失败建连仍严格清理本地流，不虚称测得其服务端线程编号。

## 离线检查与统筹运行

本轮只做类型检查与默认跳过收集：27 项全部收集、0 执行、27 跳过。单独开启任一个开关也保持 27 项跳过。没有连接 200、读根凭据、制造新凭据或运行安装包；更不能把这些跳过当作内核通过。

```powershell
node node_modules/typescript/bin/tsc --noEmit
$env:DBARK_INTEGRATION_ENABLED = '0'
$env:DBARK_FILE_IMPORT_PRECISION_INTEGRATION_ENABLED = '0'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-file-import-precision.integration.test.ts --reporter=json --outputFile=.cache/f02-excel/import-precision-offline-final.json
```

统筹核对服务器、完成所需共用修复并注入目标环境后，在各已授权端口逐次运行：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$env:DBARK_FILE_IMPORT_PRECISION_INTEGRATION_ENABLED = '1'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-file-import-precision.integration.test.ts --reporter=json --outputFile=.cache/f02-excel/import-precision-live.json
```

尚未执行实际内核、六端口矩阵、TLS/SSH、元数据锁取消、网络断开或安装包验收。本轮先完成精度与警告路径的可运行准备，没有新增元数据锁取消用例。
