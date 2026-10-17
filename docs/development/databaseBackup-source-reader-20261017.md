# B01 原生驱动源读取适配

初版普通独立克隆分支 `codex/employee3-backup-source-reader-20261017`，基线 `763ac689352aef7e15c7bfb5d7ce8f3f1b95a40a`。本次 P2 修订在新普通克隆分支 `codex/employee3-backup-source-reader-fix-20261017`，基于初版固定提交 `cb2b5eb782cff45eb374024d9922098162afd372`，只调整 Reader 隐私门、专属测试及本文档；未改已有 Source、执行器、StructureTaskContext、共享合同、main、engine/index 或连接退出，旧源码现场保持原样。

## 最小接线

```ts
// Root 提供原 StructureTaskContext 的同一私有 connection，不新建查询标签或控制连接。
const reader = new DatabaseBackupSourceReader(structureContext, owner, {
  checkOwner: bound => sourceLeases.assertCurrent(bound),
  register: operation => { sourceScope.registerRead(operation); },
  requestStop: (operation, reason) => { sourceScope.requestOriginalCommandStop(operation, reason); },
});
const inspection = await inspectDatabaseBackupSource(reader.context, sourceBinding);
```

示例中的三个登记/协调调用由 Root 现有源 scope 实现，并非本片新增的占位实现。`owner` 为 Root 已登记的 `{taskId,connectionId,connectionRevision,sourceLease,threadId}`。checkOwner 必须同步核当前租约，register 必须同步登记同一稳定操作句柄，requestStop 只同步登记原命令停止请求；三个钩子不得以异步返回或布尔值代替终态。钩子和绑定在构造/发送前捕获，原 owner 对象、逐字段绑定、原 managed/connection/signal 和真实 threadId 均受核对。

Root 需要单独驱动超时时，可用 `reader.start(owner, statement)` 返回的同一操作，调用 `operation.cancel(owner, 'timeout')`。Root 保留构造时原 owner；`operation.owner` 是冻结的私有绑定快照，不能拿另造同值对象冒充调用权限。reader.context 只暴露 Source 所需 read/checkCancelled，不扩大既有 StructureTaskContext。

## 实际发送与行预算

- 直接调用原 `managed.connection.execute(options, params)` 或 `query(options)`，均不传回调，不经过会提前因 abort 拒绝的普通 execute 包装。有目录值时走真实预处理协议；无参数事实及 SHOW CREATE/GRANTS 走文本 Query。没有失败回退或重发。
- 输入限于 Source 导出的固定语句和经既有 identifier 规范引用的 SHOW CREATE；不接收任意 SQL、USE、SET、DDL。SQL、参数和每次预算在 register 前复制，禁止输入异步换库。发送前先进入同步重入门，再登记稳定操作和 commandStarted 编号；Root 钩子及输入 getter 均不能重入发送。
- 使用 mysql2 原 Query 的 fields/result/end/error 事件。文本 fields 没有结果集 index，Execute 的 fields 带 0；二者均要求单个字段集，result 必须属于第 0 个结果集。无回调模式下驱动逐行发 result，不汇总整批行。本片不创建 Readable，因此不把其本地 end/close 当协议完成。
- 每个 result 在保存前检查行数及剩余字节：键名和字符串按 UTF-8、Buffer 按长度、Date 按32字节、null/number/boolean 按16字节，与 Source 接纳计量一致；Buffer/Date 复制防别名。第 maxRows+1 行或字节超限立即清空已保存行、拒绝整批，后续行只忽略、不保留。Source 继续守全次2 MiB及10000对象的累计预算。
- 该上限约束已经由 mysql2 解码并送达的行及本模块保留数据。驱动必须先解析单个协议包/单行，故本片不能声称在解码之前限制一个超大包的瞬时内存；Root 专用连接还须按实际驱动/服务器能力配置包上限。

## 停止读取、原生事件与资源退出

`operation.result` 和 `operation.nativeTerminal` 为两个独立观察面。result 只有在真正 Query end、字段集有效、全部行未截断、未取消、前后租约仍有效及命令记账未失败时返回 complete=true。超限/取消/Root超时/租约失效立即拒绝 result，封存 reader，调用 Root 停止钩子一次；不因此结算命令编号、完成 nativeTerminal 或释放资源。

nativeTerminal 只记录首个 not-submitted、query-end/error 或 connection-end/error 原生事件；query/connection 的 error 也可能是本地或传输故障，**不是服务器取消确认**。commandStarted 返回的结束函数只结算一次。Root 仍须分别协调原服务器命令、native Query、停止控制会话、物理连接/SSH退出等事实；不能拿 nativeTerminal、停止请求返回或读取 Promise 拒绝直接填写 resourcesConfirmed。记账函数抛错也阻断 complete。

操作含原 Query getter、只读 snapshot 和两个 Promise。取消后保留 Query 及迟到 error/end 监听，不自动 destroy、close、KILL、重新连接或释放 owner。snapshot 区分 reading/submission/nativeEvent、迟到 Query 事件、停止请求失败及记账失败，不含行、SQL、授权或原始错误。同步发送抛错保守标为 submission=unknown，保留连接事件观察；直到有真实原生事件才结算，不假定未发送。若能确定尚未尝试驱动发送，则明确 not-submitted，不发无对象的停止请求。

同一 reader 只允许串行成功读取；失败后封存，不能用旧 scope 自动恢复或继续发 SQL。同步钩子返回异步对象会被拒绝并吸收其拒绝事件，Root 仍须自行保留钩子分配的资源。主线程无内置超时计时器，由 Root 对原操作施加超时/取消并保留未知状态。

## 敏感内容与验证边界

SHOW GRANTS/SHOW CREATE 原文只经过本次行数组与 Source 的 RAM 解析，不写查询历史、日志、renderer 或文件，不保存原始驱动错误或 cause。原 Query 本身含 SQL/参数，必须留在 Root 私有 scope。发送前拒绝 mysql2 debug、自定义 queryFormat 及现有 mysql2 query/execute 诊断订阅。mysql2 3.24.5 的 typeCast=true 仍会继承连接级函数，不能作为回调隔离；隐私门明确拒绝函数型 typeCast、相关 getter/代理配置、配置对象换绑和 typeCast 值的注册期变更，不调用这些 getter，也不修改全局 config。undefined/布尔默认配置仍可使用。首次检查、注册后 commandStarted 前检查及真正发送前检查分别保留；若命令登记钩子自身事后换绑，则只结算已登记的未发送编号，绝不发 SQL。Root 必须保证专用连接配置在整个操作中不被外部改写，不额外挂日志/转发监听。

专项测试使用已安装 mysql2 的真实 Query 构造器和 row 方法，加纯 RAM Connection 替身；没有创建真实 Connection。覆盖参数协议、原生逐行不缓存、行/字节界限、取消/超时与晚到事件、同 owner/租约/物理连接、发送前重入/换绑、同步发送异常、记账/停止钩子异常、隐私门及 Source→Reader 串行组合。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupSourceReader.test.ts --reporter=default --reporter=json --outputFile=.cache/database-backup-source-reader/reader-tests.json
node node_modules/typescript/bin/tsc --noEmit
```

只运行本片专项和类型检查；不运行 full/build，也未访问真实数据库、服务器、产品 OS/文件端口、网络、GUI、凭据或剪贴板。RAM 组合不构成真实数据库读取、服务器取消、锁覆盖或资源退出验收。Root 后续实际接线和验收仍是交付边界。

初版结果：38项专项全部通过，`tsc --noEmit` 退出码0。初版JSON报告位于旧克隆忽略目录 `.cache/database-backup-source-reader/reader-tests.json`，SHA256 为 `dda28015e485bedb1e52de7459c3446897ef29bed4496d7a2cd2c594534b25a2`。该结果不覆盖随后独审发现的连接级 typeCast 回退缺陷。

## P2 原件与窄验证

独审固定报告位于员工1克隆 `.cache/review-backup-source-reader-cb2b5eb-20261017/review.json`，SHA256 `e486608c1c5817c008f84b43f415bd787742b2f019dd553f84ce3547135980bc`。同字节原测试 SHA256 `1a544fc29403df1ce3be521bfae72e0b98f7560d9436e4bf1950673cc18c4282`，复制到本克隆忽略目录 `.cache/source-reader-typecast-fix/independent.test.ts`，原文未改。基线先单跑 S5，文本/二进制模式均复现发送一次、外部回调一次，原红保留为 baseline-red.json。

本轮只跑原件 S5 与 S1 安全默认对照，以及新增的一组隐私门定向验证：两协议下函数、getter、代理及注册期配置换绑/布尔变更均零 commandStarted/零发送/零外部回调，安全 undefined/true/false 默认路径仍成功。未重跑初版38项、全套、构建或实际环境。

验证结果：原件 S1/S5 两组通过（其余3组过滤），新增定向组通过（初版38项过滤），最终 `tsc --noEmit` 退出码0。报告位于本克隆 `.cache/source-reader-typecast-fix/`：

| 报告 | SHA256 |
| --- | --- |
| baseline-red.json | `0ed9bccd4c4049e25b7a9c398438654568de44286ef4210cec42783cf6c65a85` |
| fixed-original.json | `93e8846a2a66486788bbdee29f3dc583c32915f2070a490a96789213f6dfc5cb` |
| focused-variants.json | `b17ca8c1fb76574ca2888a6c61c6ced640eb284b33fdb5657a8b4558f3649948` |

不重试已被自动审批拒绝的外部推送；固定本地提交交 Root 按既定方式统一处理。
