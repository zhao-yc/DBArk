# B01 私有源检查会话

初版普通独立克隆分支 `codex/employee3-backup-source-session-20261018`，基线 Root `6326e943ca94a09689ceb9d8407ea0cf2ba43bfb`。本次迟到事件窄修在新普通克隆分支 `codex/employee3-backup-source-session-late-fix-20261018`，基于固定 `31ef0e6e8c362849930def85aff3bcd5c9c31254`，只改SourceSession、专属RAM组合及本文档，不改Reader、Source、Plan、共享合同、main或驱动退出，旧候选及Root未提交现场保持原样。

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

每个已登记原Query另保留一个error观察器，包含已经过门的历史Query；同一物理连接只登记一组error/end观察器，不在每条Query上重复增加连接监听。观察器不接纳原错误正文，O(1)设置永久失效标记；运行中立即拒绝inspection、取消当前原operation并只向Root登记原停止请求。旧Query的首nativeEvent、Promise与accounting不被回写，晚事件及原记录仍保留。停止请求用同一有界Map定位原记录，不因历史条数增多线性搜索。

单条接纳只核该条活快照，后续热路径只查失效标记及原绑定，不全量扫描历史。最终发布前统一做一次O(n)活快照复核，防止缓存fulfilled/query-end/left与旧Query当前错误标志矛盾。每条Query观察器最多一个，最多10015条，重复旧错只计一次；不删未知记录或撤监听来规避失效。

**时间边界：已resolve的inspection是发布时刻的历史快照，Promise不能伪装可撤回。** 发布后的旧错、物理连接结束或取消仍更新snapshot.invalidated/invalidationReason，并保留原结果和原记录；state=completed仅说明历史发布已发生，不能独立说明当前仍可消费。Root在消费历史检查前须同步复核真实registry中的owner/源租约/修订/准确绑定，并确认未观察到失效；不能仅凭invalidated=false当作服务器或有效租约证明。真正备份的持锁检查仍须另建Root明确的新源会话，不复用历史承诺。

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

初版7组专项全部通过，`tsc --noEmit`退出码0。旧克隆JSON报告在忽略目录 `.cache/database-backup-source-session/session-tests.json`，SHA256为 `eee91986d887aefa993394f57be55cdb95deb08b5e3b29f90c7e7859c4c51dc6`；该结果不覆盖随后独审发现的运行中历史Query迟到错未停链问题。固定本地提交交Root独审/整合，不发起外部推送。

## 迟到错误原红与窄验证

员工1原件目录 `.cache/review-backup-source-session-31ef0e6-20261018/`：independent.test.ts SHA256 `a3ca881651381492ed072d3052ee8d6f362d49d7679037fdb0fb955fc788e8a3`，原results `63806688aa82bb8568161c9b6f3498260543ba3be626a9213b5b6adfb2d92630`，review.json `607c8573c61a3eeac2b4983699f0bd8fdf9f447063eb1938d15578bf450af9ad`。本克隆同字节复制原测试到忽略目录 `.cache/source-session-late-fix/`，先单跑Q3复现检查尚在运行时第一读旧错后仍发16句并completed，保留baseline-red.json；修后仅跑原Q1/Q3及新增一组迟到时间边界对照，不重作者7组、旧套件、全套、构建或实际环境。

最终原Q1/Q3两组通过（Q2/Q4过滤），新增窄对照单组通过（作者7组过滤），`tsc --noEmit`退出码0。旧31ef候选工作区仍干净。报告均位于本克隆 `.cache/source-session-late-fix/`：

| 报告 | SHA256 |
| --- | --- |
| baseline-red.json | `f10b61f488a889a7de15c4b4a4fa0d3d625da0ded14a6491986183bd6c25decc` |
| fixed-original.json | `40d7b26bd5f844d3380d8770e0b08d32b5bd5cb91237d2a14470a73ee0ea4dd9` |
| focused-control.json | `739c7fd154a72540961959d3a548ec3f045c9b9d44cb00747e5988bcd50ca558` |
