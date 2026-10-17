# 列排序规则投影协作取消窄修

本片基于 Tasks `aa8d972447f974dd6dc7d10cdfb28b1d1b885fd4`，保留已叠加的 execution 预算修复依赖（原作者 `13cbc6e5091c3f07e57586d5e99c069c390efd4d`，本 clone 重放 `aadcadf2fab67803b8dca4383a6d32ac20a8f783`）。Root 仅取本片新增修复提交，不重放该依赖；未改 execution、原 v1、Main、shared 或 UI。

原 `columnCollationTaskViews` 同步逐列调用纯候选构造器，每次可重解析完整定义。即使循环内同步检查 AbortSignal，已排队的取消事件仍无法运行，get 可能先登记令牌。

投影现在返回 Promise，新增最后一个参数为同一真实 `StructureTaskContext`。开始、每四列及不足四列的尾批用 Node `timers/promises.setImmediate` 真正让出事件循环；每列前后及每次让出前后检查原 `checkCancelled`、managed broken 和原 AbortSignal。终态检查在纯候选资格 catch 之外，不把取消变成单列只读。current、候选硬门、列数/顺序和旧七属性投影保持。

get 与后核处均 await。后核先完成异步投影，才发布 `definitionVerified`；等待期间取消仍保留 `ddlSubmitted/ddlCompleted=true`，但不伪报核验通过，不重放 ALTER。

## 定向 RAM 验证

- 原实现定向 8 红、44 未选：Node 已排队取消、批次中取消、尾批取消、正常事件循环让出、broken/aborted 检查、get 不登记令牌、后核取消不伪核验。
- 修复后相关两文件合计 52 通过、0 红。使用真实 Node 事件循环和 AbortController，未使用 fake timers；候选构造器实际运行，spy 仅观察次数及排队取消。
- 测试先构造小型完整多列 RAM 定义及目录，不代表真实数据库。首轮类型检查只发现测试夹具调用 ReadonlyMap 的 clear/set；改为等值 Map 构造，原断言未变。最初测试源码与首轮报告保留于忽略目录。
- Map 构造补齐元组类型标注后，最终 `tsc --noEmit` 退出码 0，差异检查通过。
- 本片未重跑 161 全套，未访问实库、认证、GUI、Docker、网络或剪贴板；未推送。

让出策略不减少整表重解析次数，也不能抢占单次同步候选构造。这里只验证协作取消，不宣称完成 4096 列或大定义的性能验收。

测试命令：`node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-projection-cancel.test.ts tests/unit/table-column-collation-tasks.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads --reporter=json --outputFile=.cache/column-collation-projection-cancel/after-results.json`。类型命令：`node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`。

## 原 Engine RAM 单红供 Root 补齐端口

原件：本 clone `.cache/column-collation-tasks-review/legacy-engine-port-results.json`，SHA256 `c023aaa562771256894492de7c913f8a6756486e6b9eb5cf4b518dbd3694673c`。

受影响单项：`tests/unit/engine-column-patches.test.ts:119` 的“读取与预览各自关闭连接，不发送 ALTER；只提供可信字段引用与受控当前类型”。当次 1 红、72 未选，不是 73 项全套结果。

原 RAM 驱动没有登记新增固定查询：

```sql
SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2
```

因此返回默认空数组，物理 reader 返回 server 阶段 invalid-catalog，TaskRead 拒绝：“列排序规则物理身份目录缺失、歧义或格式未知；请重新读取”。正式原端口应由 Root 补充准确目录观测或明确权限拒绝，不能放宽产品接受空目录。本片没有修改或重跑该旧端口，原报告和先前派生端口六绿仍原样保留。
