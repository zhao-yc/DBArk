# 时间戳与生成列真实 OK 警告夹具准备

日期：2026-10-16。本文件记录待统筹运行的测试改动，**不是200实际通过报告**。产品源码没有变化；根正在修复的 `afterAll` 两处 `expect.poll` 不在本提交范围。

## 替代探测

保留原 BEFORE INSERT / SIGNAL 01000 探测及其原始 `warningStatus`、诊断代码和 OK/ERR 结果；不会把原先未传播警告改写成通过。新增独立表 `warning_generated_rows`，与原触发器表分开，DDL 为：

```sql
CREATE TABLE 本轮随机库.warning_generated_rows (
  id INT PRIMARY KEY,
  value VARCHAR(30),
  warning_guard TINYINT GENERATED ALWAYS AS
    (CASE WHEN id=501 THEN 128 ELSE 1 END) STORED
) ENGINE=InnoDB;
```

夹具假设是：专用非严格会话中，生成列有符号 TINYINT 越界可能产生真实 OK 警告。该假设必须逐内核实测，不能从类型声明推断服务器必然传播 warning。

探针复用本轮已有专用真实连接；不建连、不读凭据、不设置 GLOBAL 或 SESSION。入口要求连接的 host、端口、database 与现有200隔离规则一致，并实际查询当前 SESSION sql_mode 必须为空。

每次探测最多写两行，均位于同一事务且最终 ROLLBACK：

1. id=500 的正常行须真实 affectedRows=1、warningStatus=0，立即 SHOW WARNINGS 为空。
2. id=501 用原 execute/预处理 INSERT，不伪造驱动回包；下一条 SQL 立即执行 `SHOW WARNINGS LIMIT 32`。
3. 只有原始 OK 的正整数 warningStatus、真实诊断1264，以及随后事务内查询到 warning_guard='127' 同时成立，才认定 `okWarning=true`。
4. 预期越界 ERR（errno=1264、SQLSTATE=22003）单独记录为 `overflow-error`，不认作 OK。断网、权限、DDL语法和其它错误继续失败，不任意跳过。
5. 事务内实际正常行为1；OK路径应有两行，ERR路径只有正常行。探针最终回滚、严格关闭连接，再由独立旁观者确认零行。

## 原文件批次断言

另新增 `timestamp_warning_rows(id INT PRIMARY KEY, value TIMESTAMP(6) NULL)`；它没有触发器或生成列。正常值为 `2026-10-16 10:20:30.123456`，风险值为 `9999-01-01 00:00:00.000000`。后者日历与微秒格式有效，实际存储范围及返回方式仍由真实服务器判定，不修改生产预检来制造路径。

时间戳探针同样只写500/501两行、下一条立即 SHOW WARNINGS，记录真实 OK 的 warningStatus、1264/1292范围诊断，以及事务内实际存储值。仅正警告数、相应诊断、实际值已不同于9999原文同时成立时可用于批次验收。预期1264/22003或1292/22007 ERR单独记录，不能认作OK；其它错误失败。正常2026行必须无警告且实际值完全一致。探测最终回滚、严格关闭，再独立确认零行。

原专项从27项增至29项。新增两个探测始终独立运行；批次用例优先使用普通 TIMESTAMP 的真实范围警告，其次生成列，最后才是原触发器。三者都不支持时，批次项继续明确跳过并报告未覆盖，不能冒称警告回滚通过。

真实 XLSX 导入502行仍须满足：返回已提交500行和一条错误；实际 INSERT 恰好501次；第501条 OK 有警告，其后立即 SHOW WARNINGS（对应实际探针观察到的1264/1292或1265），随后只有 ROLLBACK；先前 COMMIT 恰好一次。独立旁观者逐行核对只存在1到500及对应 value；时间戳路径前500及502均为合法2026，仅501为9999；生成列路径另外要求已提交行的 warning_guard 只有1。

没有降低批次大小，没有把ERR当OK，没有用故意超限的导入字段绕过产品预拒绝。警告来自未映射、不可写的生成列计算；导入字段 id 和 value 本身均合法。

## 交付与验证边界

修改文件：

- `tests/integration/file-import-generated-warning.fixture.ts`：有界真实探针及固定DDL。
- `tests/integration/file-import-timestamp-warning.fixture.ts`：优先使用的普通时间戳有界真实探针及固定DDL。
- `tests/integration/engine-file-import-precision.integration.test.ts`：登记新表、增加探测、选择实际可用夹具，原收尾逻辑未改。
- 本说明。

员工4只运行类型检查与默认/单开关跳过检查，不访问200或凭据。根应在包含既有BIT修复、定标浮点修复及 `afterAll` 上下文修复的集成状态下，按原两个执行开关和六端口规则运行。旧27项原始报告继续保留；新一轮应报告29项实际通过/跳过及hook状态。

本地实际结果：`tsc --noEmit` 通过；双开关0/0、1/0、0/1三组均收集29项、0执行、29跳过、0失败。未使用替代网络或模拟 OK 包验证服务器行为。

```powershell
node node_modules/typescript/bin/tsc --noEmit
$env:DBARK_INTEGRATION_ENABLED = '0'
$env:DBARK_FILE_IMPORT_PRECISION_INTEGRATION_ENABLED = '0'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-file-import-precision.integration.test.ts --reporter=json --outputFile=.cache/f02-excel/generated-warning-offline.json
```

当前明确不联网的委派范围内不再次访问Git远端；提交保留在员工4原任务分支，根可从员工4本机克隆按完整提交号取入，不需要修改或checkout根目录。
