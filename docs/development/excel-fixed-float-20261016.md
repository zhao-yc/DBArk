# 定标 FLOAT/DOUBLE 导入预检修复

日期：2026-10-16。起点 `8c215ea6d54d61a511bdc027488c20c0f9606dd6`，本次只追加定标浮点运行修复、单元回归和本说明；真实引擎集成测试仍单独准备。

复审已指出 `FLOAT(5,1)` / `DOUBLE(5,1)` 的 `1.375` 会被旧预检放行，不能依赖 INSERT 的零警告证明无损。复审引用的 [MySQL 浮点类型说明](https://dev.mysql.com/doc/refman/8.4/en/floating-point-types.html) 与 [8.4 服务端 field.cc](https://raw.githubusercontent.com/mysql/mysql-server/8.4/sql/field.cc) 支持定标舍入可能不产生警告的行为推导；员工4本轮没有连接服务器或复验服务端源码运行。

## 修复行为

- 浮点分支先完整解析已知声明，再检查 M、D 范围。定标采用已确认的 M=1～255、D=0～30 且 D≤M；单参数或不能可靠解释的定标声明保守拒绝。`REAL(M,D)` 无法单凭声明确认实际存储精度，保守拒绝。
- 有效数字和十进制指数从原始文本规范化得到；非零小数位不得超出 D，整数位不得超出 M-D。此步在 `Number(value)` 之前，不拿已经舍入的 JS 数值反推尺度。等值尾零和前导零不计为被舍弃的有效数字。
- 随后保留原有普通 FLOAT/DOUBLE 的可往返检查、FLOAT 二进制精度检查及 unsigned 门禁；检查不改写实际参数。
- 普通 `FLOAT` 的 `0.1` 继续保守拒绝，普通 `DOUBLE` 和 `DOUBLE(5,1)` 的 `0.1` 可接受；定标 `FLOAT(5,1)` 不借此放宽既有二进制精度政策。`1.5000` 等二进制可表示且符合 D 的原文仍以字符串原样传入。
- 警告非零拒绝策略不变。没有修改统筹正在修复的共用 BIT 占位符表达式。

## 本轮证据与边界

本地专项覆盖两个定标类型的 `1.375`、正负数、整数容量、极近舍入原文、指数、等值尾零、unsigned、旧版普通浮点 `0.1` 政策及无法解释的声明。真实 Engine 单元入口确认有损值在 INSERT 前拒绝，零 warning 的驱动边界也不会得到写入；合法尾零仍原样绑定。这些是实际生产校验器和引擎控制流的本地验证，不是真实内核写入结果。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/lossless-import.test.ts tests/unit/excel-engine.test.ts --maxWorkers=2 --reporter=json --outputFile=.cache/f02-excel/fixed-float-core.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

本轮核心 **110/110 通过**，类型检查和完整构建通过。测试报告 `.cache/f02-excel/fixed-float-core.json`，构建日志 `.cache/f02-excel/fixed-float-build.log`。MySQL/MariaDB 实际内核定标行为、OK 警告、200 六实例和安装包仍未在员工4本轮运行；由统筹注入后执行随后单独提交的专项。
