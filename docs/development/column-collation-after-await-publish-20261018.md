# 后核投影 await 恢复后的发布门

起点 `26d14b0be94468524bf8f12a67bf01cbea1683ae`；本片只在 `tableColumnPatchTasks.ts` 的投影 await 返回后、发布 `output.after/definitionVerified` 前补原 context 取消、signal.aborted 和 broken 检查。检查失败沿原后核 catch 保留已收到的 DDL OK，返回已完成但未核验、人工核对，不重放令牌。

员工3原交接目录为 `D:/svn/DBArk/.cache/parallel-20261015/employee3-review-projection-cancel-26d14b0-20261018`，handoff SHA256 `1684dcd6c256b31f75df3dde4773d7cb08db77d2761f5bbfce7814bb414df033`。原件只读，复制后的夹具和证据逐字节核对，存于本人的忽略目录 `D:/svn/DBArk/.cache/parallel-20261015/employee2-after-projection-await-fix-20261018`。

同字节 `reviewer.test.ts` 的“后核投影Promise完成至apply await恢复前取消，不发布definitionVerified”在修改前 1 红、5 未选，修改后 1 绿、5 未选。真实投影、候选、readers、execution 及提取的原 Engine 宿主方法均运行，仅以 then 观察原 Promise 完成点，queueMicrotask 中止本次真实 AbortController。此人为构造的 RAM 顺序不证明自然 IPC 时序或外部可达性。

新增永久对照“后核投影完成后恢复前…”四项：原 checkCancelled 抛取消、checkCancelled 未抛但 signal 已中止、连接 broken、正常未中止。修复前 3 红/1 绿、46 未选；修复后 4 绿、46 未选。分别验证原 OK 完成事实、无 after/verified 假成功、原 progress、单次 ALTER 与令牌不重放。

只跑原独审红例、四项必要对照和类型检查；未重跑 52/67/161 或完整套件。未改 Root、execution/v1、Main/shared/UI，未访问实库、GUI、网络、认证或剪贴板，未推送。

`tsc --noEmit` 最终退出码 0，差异检查通过。

原件复验命令使用上述本地复制目录为 `--root`，原 `vitest.config.ts`，`-t 后核投影Promise`。永久对照命令：`node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-tasks.test.ts -t 后核投影完成后恢复前 --maxWorkers=1 --minWorkers=1 --pool=threads --reporter=json --outputFile=.cache/column-collation-after-await-publish/after-controls.json`。
