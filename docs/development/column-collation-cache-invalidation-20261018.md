# DDL 收尾撤销同连接在途读取

本片在 await 发布门独立提交 `327aa54ca08ffb1793a265241c8d3d5566df36c4` 后实施，保留此前预算依赖，不改 Root 或其它模块。

原 apply 仅在正常收尾调用共享 `cache.release(connectionId)`，没有撤销本类 pendingReads。旧 get 即使已读完执行前定义，只要还在等待宿主关闭，仍可在自身 DDL 清缓存后重新登记旧快照。

本片将失效处理放入 DDL 尝试阶段的 finally；仅当原 `progress.ddlSubmitted` 已为 true 时，先调用本类 `release(connectionId)` 撤销在途读取及 columns 令牌，再保留原共享 `cache.release(connectionId)` 清理同连接所有结构 scope。成功、后核失败、发送错误或不可确认响应均收尾失效；前核/ACK/TTL 在发送前失败不触发此 finally 的清理。严格关闭在宿主中继续原职责。

没有改变已领取 apply 的普通 release 语义，没有新增 KILL/取消或重放。已收到 OK 的 completed/outcome 继续保留，未知发送结果也仍为 unknown；其它连接的 pendingReads、令牌及共享 scope 不误撤销。

## 原反例与定向验证

员工4固定交接：`D:/svn/DBArk/.cache/parallel-20261015/employee4-review-collation-tasks-aa8d972-20261018/.cache/collation-tasks-review/handoff-followup.json`，SHA256 `ad360fba8aaeaf561d94b5ae29b4e3418cb0efe81a2f4bee2da31d952136338f`。原件只读复制并逐字节封存，本片没有改原报告或旧 RAM 端口。

- 同字节 followup 原例“在途旧get关闭回包不应在同连接成功apply清缓存后重新登记旧快照”：修改前 1 红/3 未选，修改后 1 绿/3 未选。
- 新增六项必要对照：正常成功、后核读取失败、驱动发送错误、ACK 不可识别、严格关闭失败，均拒绝晚旧 get 并清同连接其它结构 scope；另一连接在途 get 和共享 scope 保持。修改前 5 红/1 绿、50 未选，修改后 6 绿、50 未选。
- TypeScript `--noEmit` 退出码 0，差异检查通过。没有重跑原七绿、161、完整套件或 GUI。

这只验证 Tasks 缓存失效合同，不证明自然 GUI 并发可达、绕过 preview fresh read 或真实错误 DDL。独立原例及永久对照均为 RAM 目录/驱动和受控 host；未访问网络、实库、认证、Docker 或剪贴板，未推送。

原例复制及报告位于本 clone `.cache/column-collation-cache-invalidation`。实际定向命令为原例 `--config .cache/column-collation-cache-invalidation/review.config.mjs -t 在途旧get关闭回包`；永久对照为 `tests/unit/table-column-collation-tasks.test.ts -t '撤销同连接在途旧get|只撤销本连接pendingReads'`。
