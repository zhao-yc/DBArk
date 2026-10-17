# 列排序规则 Tasks 独立接入

固定起点：Root `101fbb4019026e6dee0a3e9976d53ea7bd1856a4`。仅修改 `tableColumnPatchTasks.ts`，新增 `tableColumnCollationTaskRead.ts`、独立 RAM 测试及本文。shared、main、UI、Engine 入口、旧 v1 preparation/纯候选模块均不改。

## 真实读取及能力投影

get 在既有规范短会话保留首次完整定义、原始模式及随机列引用。新 TaskRead 使用真实物理 reader 前后夹读 `readColumnCollationFacts`，两个原生 TABLE_ID、服务器身份和精确名称映射必须相同；索引引用沿用已有稳定映射。未知驱动错误、取消、断线、身份漂移和目录缺失/歧义均失败，不能吞成普通 get 成功。准确不支持或明确权限缺失可关闭新能力；既有底层 reader 自身预算错误继续抛出。

私有事实、Map 原始条目、实际目录、公开整表一次候选及逐列能力投影计入原缓存总预算。基础容量检查失败仍报错；只有新增附加数据放不下时才整份移除新能力及私有事实，保留旧基础 get。关闭返回后再次检查共享容量。preview 还计量当前重读事实和 execution 计划实际持有的证据，不只给 SQL 或摘要收费。

current 只取真实有效列编码，不从表默认值猜测；可编辑性由实际同字符集不同候选通过原纯候选范围门决定。目标索引/FK、未知定义/EXTRA、权限等原限制保留。公开目录和 current 均复制，不能由公开对象修改内存中的私有证明。

## 四个既有 RPC

- get：仅在 host 严格关闭成功后入原 snapshot scope；在途 get 使用内部登记，`release(connectionId)` 可使关闭期间的晚回包失效。旧基础投影及七属性能力保持。
- preview：共享严格单列单属性校验后，在旧 planner 前分流。重新读取完整 base、原事实和物理身份，与 get 同一；真实 execution builder 才产生一条 MODIFY。私有 Preview 使用 legacy/collation 联合，原成功 IPC 形状不扩。关闭后再次核 snapshot、TTL，再登记原 preview scope。
- apply：先消费令牌，再核修订、四项 ACK；新结构会话重读原事实和同一物理 ID，重新生成并比对专用计划，最后核 TTL/取消后单次发送。原 host `executionTarget`、进度、命令生命周期及关闭流程继续使用。
- release：保留原 token API，精确删除 snapshot 及其未领取的 preview。已领取的执行仍依原 task 取消及宿主资源结算，不以 release 冒充数据库终态。

ACK 为 `ddl-implicit-commit`、`external-ddl-window`、`column-collation-semantics`、`column-collation-default-algorithm`。预览说明比较/排序/分组/连接及外部程序语义变化，以及默认算法可能重建、锁等待、磁盘及读写影响；不增加全局依赖负证明。

收到 OK 后保留 completed；有警告时先执行 SHOW WARNINGS，再读取后定义和物理事实。新路径只调用真实 `verifyColumnCollationExecution`，不调用旧 verifyAfter，也不豁免旧编码检查。后 TABLE_ID 可以改变，但须完成约定定义/目录范围后核。已完成后的后核失败、取消或关闭未知不能重放 SQL。

## 合并及验收边界

execution 模块由员工3单独交付。本 clone 已从本地引入固定真实提交 `3431b73620fd7f448fc507bad05eb18466610e66` 作为父提交，然后运行联合测试及类型检查；没有产品占位模块。Root 只需 cherry-pick 本片后续独立 Tasks 提交，execution 依赖由 Root 单独整合，不能将其误计为本片作者修改。

本片只运行合成目录/RAM 驱动事件与类型检查，不访问网络、实库、账号认证、SSH、Docker、GUI 或剪贴板。普通本地 clone，只有本地任务 commit，交 Root 独审并统一推送。

main 的窗口归属、可信 revision 返回后核验、退出时纯释放规则及真实严格关闭证明仍由 Root 整合。这里的 release 防晚回包检查不能替代 main/Engine 对窗口、修订和实际资源的最终核验。

## 定向验证

- 新 `table-column-collation-tasks.test.ts`：44 项通过。完整定义及旧索引准备 reader 仅提供合成目录；真实物理 reader、共用查询、新 TaskRead、Tasks 和 execution 包装器实际联用，没有永久 mock 新执行函数。
- 联合五文件：新 Tasks、真实 execution、旧列 SQL 计划器、冻结合同、共享结构缓存，154 项通过。报告 `.cache/column-collation-tasks-review/joint-results.json`。
- `node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit` 退出码 0；`git diff --check` 通过。未跑 full/build。
- 原 `engine-column-patches.test.ts` 中“读取与预览各自关闭连接”定向 1 红、72 未选：旧 RAM 驱动未登记新物理版本 SELECT，默认空数组，新 TaskRead 按未知目录拒绝。原件 `legacy-engine-port-results.json` 保留；没有修改产品去接受该空目录。
- 忽略目录 `legacy-engine-extended.test.ts` 保留原断言/载荷，仅重定位导入并为准确新增版本 SELECT 返回明确 1142 权限拒绝。选定旧读取/预览、单次 ALTER、ON UPDATE、TTL/释放、类型继承、警告顺序六项全部通过，67 项未选；不是原 73 项全绿。原件 `legacy-extended-results.json`，原/派生源码摘要 `legacy-port-source.json`。Root 整合时需在原正式 Engine RAM 端口补齐新目录返回或明确权限拒绝，再形成正式回归结果。

实际联合命令：`node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-tasks.test.ts tests/unit/table-column-collation-execution.test.ts tests/unit/table-column-patch-sql.test.ts tests/unit/table-column-collation-contract.test.ts tests/unit/structure-patch-cache.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads --reporter=json --outputFile=.cache/column-collation-tasks-review/joint-results.json`。
