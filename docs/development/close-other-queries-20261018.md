# 受控关闭其他查询队列（员工3，2026-10-18）

## 范围与入口

固定基线：`8200537a2ff6fe85f317df2d2323a1a1f96e4f17`。普通独立克隆，分支 `codex/employee3-close-other-queries-20261018`，未使用工作树，未修改 Root 或他人目录。

App 命令栏新增“关闭其他查询”，具有同名 aria-label 和解释性 title。仅当前活动标签是 query 且还有其它 query 时可用。入口捕获当时保留的 query、其它 query 的对象身份、ID 和顺序，所有 table 及随后新开的标签都不纳入。本片不增加关闭全部、右侧、表标签或历史恢复入口。

新 `QueryCloseQueue` 仅维护窗口内存中的串行队列。每项继续调用 App 原 `closeTab`，等待该原请求对象明确回执后才推进。空草稿走原同步关闭；非空查询沿既有 `QueryCloseRequests / QueryCloseDialog / QuerySaveCloseIntent / saveQuery` 路径。活动作业拒绝、事务确认、三选取消、保存异常或最终守卫拒绝都会停止批次，不主动取消 SQL、COMMIT、ROLLBACK 或丢弃草稿。

取消或失败后已经关闭的查询不重新创建，其余 SQL 保留。第一次保存失败粘性停止批次；原保存弹窗仍能手动重试，但成功只完成当前单次请求，不再恢复队列。二次触发、旧请求回包、外部移除、同 ID 重建、对象替换、连接或修订变化均不能接管下一项。卸载撤销队列且保留原请求归属墓碑，迟到回包不能退回普通单次关闭路径。终态释放订阅及快照，队列不持久化、不跨重启。

## 新增接口合同

`QueryCloseRequest` 保留 `tabId`，只增加两个可选的窗口内存钩子，普通单次请求不提供它们：

- `failed?: () => void`：绑定原请求所属的队列实例。`saveAndClose` 捕获请求后，将同一对象沿保存流程传递；异常只通知这个原对象一次，不重新读取新请求来通知。因此迟到旧失败不会停错新请求。
- `mutate?: (before: WorkspaceTab, patch: Partial<WorkspaceTab>, update: () => void) => void`：仅包裹保存自身的同步更新。必须持有当前准确目标对象和请求，只接受 `title / sourceBinding / database / databaseContext`，下一次 store 通知必须准确等于 `before + patch`。SQL、ID、kind、连接和任意外部对象替换不在授权范围内。闭包返回后授权立即清除。

`QueryCloseRequests.begin(tabId, hooks?)` 可附加这些钩子；新增只读 `pending` 防止队列抢占原单次关闭请求。请求对象身份消费规则保持不变。

QueryTab 修改仅限原保存与 closeRequest 相关路径：`rememberDatabase` 可接受原请求以同步交接明确上下文；`saveQuery` 第四个可选参数传递捕获的原请求并交接标题/来源更新；`saveAndClose` 给原请求异常通知。结果区、执行、结果详情及选择逻辑未修改。Root 已确认允许这部分窄接口调整，员工5的结果详情区域不在本片范围。

App `closeTab(id, queue?)` 返回原请求或同步布尔回执，原单次调用方可以继续忽略返回值。队列通过 `remove` 包裹原 `current.closeTab`，没有另写 store filter 或并行关闭实现。`finishQueryClose` 先消费原请求、再核活动作业和事务，只有准确所属的队列目标才移除并继续下一项。

## 定向验证

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/query-close-queue.test.ts tests/unit/ui-query-close-queue.test.ts tests/unit/ui-query-close-guards.test.ts tests/unit/ui-query-close.test.tsx tests/unit/ui-current-statement.test.ts tests/unit/query-close-intent.test.ts tests/unit/query-close-busy.test.ts --reporter=json --outputFile=.cache/query-close-queue/tests.json
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

93 项通过：新队列 RAM 12 项、真实 App 函数/入口 AST 与受控工作区回包 9 项、原 App 关闭守卫 9 项、真实 QueryTab/BindingDialog/store 23 项、原保存租约 17 项、作业占用 4 项、当前语句 AST 回归 19 项。覆盖空闲关闭、保存/放弃/取消/失败、忙碌与事务、合法保存交接、旧回包、新增移除重建、二次触发、卸载和一半取消保留 SQL。类型检查退出码 0，差异格式检查通过。

原 VM 夹具适配清单只有 `tests/unit/ui-query-close-guards.test.ts`：补入 `otherQueryClose: { current: null }` 作为新队列 ref 的默认环境；原断言全部保留。Root 本轮已修的 `ui-current-statement.test.ts` 中 `duplicateIntent` 默认 ref 不做修改，19 项原断言直接通过。新增 `ui-query-close-queue.test.ts` 从真实 App 提取入口及三个方法，只替换 RAM 工作区、React setter、确认和回包端口，不复制生产关闭实现。

本轮仅 RAM、组件、源码 AST 与静态类型证据。未执行 full/build、GUI、系统剪贴板、真实数据库、凭据、SSH、Docker 或服务器操作；不将组件回包当作实际会话、事务或原生退出验收。

## Git

仅暂存本任务文件；远端已核对为 `https://github.com/zhao-yc/DBArk.git`，使用独立员工任务分支。开始于 Root 指定的固定基线，推送前 fetch 核对远端任务分支及全部待推送提交，不把其它分支或新来的 Root 提交混入本次改动。代码推送不包含生产部署授权。
