# B01 私有源检查会话

普通独立克隆分支 `codex/employee3-backup-source-session-20261018`，基线 Root `6326e943ca94a09689ceb9d8407ea0cf2ba43bfb`。只新增 `databaseBackupSourceSession.ts`、专项RAM组合及本文档，不改Reader、Source、Plan、共享合同、main或驱动退出。Root旧克隆的未提交改动没有复制或修改。

## 实际组合与接线

```ts
const session = new DatabaseBackupSourceSession(structureContext, owner, sourceBinding, {
  checkOwner: (boundOwner, boundSource) => sourceScope.assertCurrent(boundOwner, boundSource),
  register: registered => { sourceScope.retainSourceSession(registered); },
  requestStop: (operation, reason) => { sourceScope.requestOriginalCommandStop(operation, reason); },
});
const inspection = session.inspection;      // 已存在的稳定私有Promise
session.start(owner);                       // 同一个Promise；只能领取一次
const sourceReport = await inspection;      // 显式私有SourceInspection
```

示例中的登记与停止方法由Root现有源scope提供，不能用常量布尔或只发取消ACK替代实际终态。session调用真实 `new DatabaseBackupSourceReader(...)` 和 `inspectDatabaseBackupSource(...)`，没有另写模拟检查器。每条固定SQL由真实Reader.start发送到Root已登记的原StructureTaskContext.managed.connection；本模块没有连接工厂、close/destroy、spawn、CLI、文件、DNS或任意SQL入口。

owner使用Reader同款 `{taskId,connectionId,connectionRevision,sourceLease,threadId}`。sourceBinding的对应ID/修订/租约/threadId必须一致，并捕获database、准确实例及Root能力声明。绑定只接受有界普通数据描述符，拒绝getter、代理和未知顶层字段；先复制冻结，后续每条读前后及发布前对原入参复核，嵌套换绑或Root钩子内同步变更均封存。Root还须在全局register/checkOwner中拒绝重复会话、同physical并行复用及已撤销租约，不得让多个实例共享同一在途StructureTaskContext。持锁复检必须使用Root新明确登记的会话和租约，不重用旧inspection承诺。

构造不运行检查。start先同步register同一session及稳定inspection Promise，再创建Reader并开始完整Source检查。重复或重入start拒绝；register内取消不发送SQL。原managed、connection、signal和真实threadId持续核对，Root原checkCancelled及租约任一失效均永久停链，无重新领取、自动重放或更换物理连接。

## 双终态与有界保留

每个原Reader operation在发送前保留；读结果与nativeTerminal分别观察。只有以下事实同时成立才返回该条行集给Source并继续下一句：result成功且complete=true、原nativeTerminal严格为query-end、原Query非空、Reader未报error/记账失败、Root commandStarted的原结束回调同步成功返回并标left，且原租约/物理绑定仍有效。query-error、connection事件或未知记账均不能替代query-end。

结束函数抛错或返回异步回执时保留accounting=unknown，不以finally无条件清零。读取拒绝会立即封存可见inspection；原chain仍等待同一个native Promise，未知操作不逐条删除、不TTL驱逐。Root可通过显式retained读取原operation/query/result/nativeTerminal、记账与停止记录及原chain；诊断候选与成功发布分开，取消/失败候选不能拿去执行备份。

原Source仍守总计10000对象（含数据库/未知对象）和2 MiB元数据；Reader仍守每条实际接收行/字节预算，本模块不扩大或截断它们。正常操作记录上限10015：最多10000条SHOW CREATE，加MySQL准确版本下15次前后事实、授权及目录查询。达到上限时拒绝整批，不挪走旧未知记录腾容量。未来固定语句增加时须由Root同步校准上限，不能临时放宽证明。

会话只保留原操作和Promise，没有另建授权、定义或行缓存。但原Reader.result Promise的成功值本身包含私有RAM行，故同scope保留原Promise时，原始授权/定义可能随其生命周期留在RAM；不声称已将Promise内部值或字符串GC擦除。Root须让这些记录留在私有scope，不写持久化缓存、历史、日志或renderer；待自身确认资源终态后按全局账本释放scope引用。

## 取消与结果边界

cancel或signal失效只作用于原operation.cancel及Root requestStop钩子；每个原操作最多登记一次停止请求。若owner字段或租约已失效导致Reader.cancel拒绝，仍用已保存的原operation向Root登记原命令停止，不借新值创建任何资源。停止钩子异常只记失败计数，不输出原错误。取消ACK不会修改native、记账或服务器终态。

清理接口接受原登记owner对象引用，允许字段被换绑后仍读取本实例旧句柄及取消原操作；返回的owner/binding是最初冻结副本。新造同值对象不能取得或取消这些句柄。恢复字段/租约不能恢复已停链，必须Root另建明确会话。

Source检查正常返回的私有report保留全部visibility、权限、definers/unclassified、blockers及定义摘要，actualLockHeld始终false；completed只表示本次检查完整结束，不表示备份可执行。Root lockCapability仅照原Source作为能力声明处理，不把能力声明变成已持锁或独立恢复证明。任何原生读失败都会封存本会话，不能靠Source的可选读取兜底继续发新SQL或发布部分检查。

本模块不自建/关闭连接，不做KILL或服务器线程消失判断；Root继续负责原命令、控制连接、物理会话和附属资源的真实终态。inspection拒绝、native query-end、本地记账left与资源释放是不同事实，没有serverClosed输出。

## 隐私与验证

运行数据全部置于JS #字段，包括绑定、Reader、原操作、Promise容器、候选和原上下文。inspection为非枚举原型getter，显式retained只供Root。snapshot、toJSON、util.inspect.custom仅返回状态、固定原因和计数；关闭customInspect也没有可枚举运行字段。普通序列化不触发读取、租约回调或资源动作，不带binding、SQL、GRANTS、definers、路径或原错误。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupSourceSession.test.ts --reporter=default --reporter=json --outputFile=.cache/database-backup-source-session/session-tests.json
node node_modules/typescript/bin/tsc --noEmit
```

7组RAM组合使用锁定mysql2原Query/Execute命令类和EventEmitter Connection替身，覆盖完整17句顺序及原句柄、取消/晚事件、owner/sourceBinding/physical/signal/租约失效、10000对象/2 MiB整批拒绝、记账unknown阻断、通用序列化和登记期取消。没有真实Connection/端口、数据库、CLI、产品OS/文件/GUI/剪贴板操作；未跑full/build或旧套件。Root后续真实源会话与持锁新会话验收仍须单独执行。

最终7组专项全部通过，`tsc --noEmit`退出码0。JSON报告在忽略目录 `.cache/database-backup-source-session/session-tests.json`，SHA256为 `eee91986d887aefa993394f57be55cdb95deb08b5e3b29f90c7e7859c4c51dc6`。固定本地提交交Root独审/整合，不发起外部推送。
