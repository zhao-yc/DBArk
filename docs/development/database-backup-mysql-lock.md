# Root私有MySQL8.4.11全局读锁原语

本片基线为 `05cce0e9d2571f3f1e355ce11a0a415dbcd35c10`，只新增 `databaseBackupMysqlLock.ts`、专属RAM测试和本文。首片仅接受MySQL `8.4.11`、Community GPL或Enterprise Commercial版本说明、两条不同的已登记原mysql2连接、可完整读取当前PFS锁与仪表的组合。不创建/重连/关闭连接，不执行KILL、授权、仪表设置或恢复；没有备份任务、main/shared/session/source/reader/executor接线。

## Root接线与返回

构造参数 `source` 和 `control` 是 `StructureTaskContext` 的 `managed/checkCancelled/commandStarted` 子集，直接使用其原 `managed.connection.query/execute`，没有SQL回调stub作为生产默认。Root先建立、登记并保留两条专属连接和actor，复用同一 `DatabaseBackupMysqlLockOwners` 防任务号ABA，然后调用：

```ts
const primitive = new DatabaseBackupMysqlLock(owner, source, control, {
  checkLease: (bound, allowed) => scope.assertOriginalExclusivePair(bound, allowed),
  registerOperation: operation => { scope.lockOperations.push(operation); },
  registerCommand: command => { scope.lockCommands.push(command); },
  requestStop: (operation, command, reason) => { scope.requestOriginalStop(operation, command, reason); },
  releasePermit: owner => scope.synchronousFinalDumpPermit(owner),
}, sharedLockOwners, { budgetMs: 10000 });
scope.retainLockPrimitive(primitive);
const acquiring = primitive.acquire(owner); // 稳定操作和结果Promise同步登记，首SQL在下一microtask。
const observation = await acquiring.wait(); // 只给{state:'observed', observation:1}。
// Root在完整备份窗口内维持原source/control专属，按阶段调用有限次数observe。
// Root已证明原dump/流/服务器操作结束（或从未启动dump）后才可调用release。
const released = await primitive.release(owner).wait();
// 原连接与Query的最终收尾、强制恢复仍由Root按原账本完成。
```

以上是Root组合接口示意，不是本片提供的Scope实现。注册、lease和停止钩子必须同步返回undefined；异步返回/抛错即未知。`commandStarted`原记账回调必须同步离开；异常后保留未知槽位，不重试。`checkLease`必须逐次核当前任务/连接修订/两条lease与专属原连接、无外部命令、无业务事务，且只允许传入的本原命令占用命令账本。禁止其它代码在两连接上执行UNLOCK、重获锁、RESET、CHANGE USER、事务或查询。只核调用方自报的字符串不足以实现此钩子。

`wait()`在异步交付时再核当前健康状态，过去的观察结果不可在新观察或释放后重新取作当前证据。`retained(owner)`是Root显式私有出口：actor保留原上下文、原Managed、原connection、UUID/session/thread、原始两行元数据、全部稳定操作/Query和Promise；不能发往IPC、任务事件、日志。即使上下文换绑，原连接仍可取回。JSON、默认及禁用自定义的inspect只含状态/计数，不含SQL、owner、账号、线程ID、tuple或原驱动异常。错误只返回固定中文消息。

## 获取和独立观察

固定SQL常量只含六种读取及FTWRL/UNLOCK；研究第七条等待者SQL属于Root实验，不在本原语发送范围。有参数的threads/metadata_locks读取使用原mysql2.execute绑定十进制字符串；其它语句用原query，无任意SQL入口。驱动无回调行事件模式，结果最多3行，每个字段字符串最多512字符、单行8KiB，只有固定字段顺序/结果集0；ACK独立验证零字段、零影响行、零warning、无业务事务状态。原驱动配置debug/queryFormat/自定义typeCast或mysql2诊断订阅不足以保证隐私时阻断，不修改它们。

获取前先完成一轮独立control观察，要求原source没有GLOBAL/COMMIT行。source实际发送一次 `FLUSH TABLES WITH READ LOCK`，原Query成功end且原命令记账真正离开之后，control再做完整观察；只有同时具备下列条件才返回observed：

- source/control均读回准确版本/UUID/CONNECTION_ID，两ID不同，匹配原mysql2 threadId；UUID固定但不是启动世代。
- control按原source的PROCESSLIST_ID映射恰一条FOREGROUND THREAD_ID；之后两ID均固定，所有PFS IDs/内存地址/事件ID均按十进制字符串处理，不经JS Number。
- performance_schema开启、准确MDL instrument ENABLED=YES、global_instrumentation=YES，实际读取权限完整；TIMED、thread_instrumentation和thread.INSTRUMENTED允许YES/NO，不把它们NO误称无物理锁。
- metadata/thread lost计数都为零，前后采样Uptime不下降；零历史lost是本片保守策略，非MySQL关于锁不存在的定理。
- 原THREAD_ID与session_id的行恰好GLOBAL和COMMIT各一条，均为SHARED/EXPLICIT/GRANTED；缺一、重复、PENDING、错实例/线程或字段未知均停链。OBJECT_SCHEMA/NAME仅有界保留原值，不虚构尚未实测的NULL格式保证。

每轮在锁读取前后再核仪表、lost、映射及身份。`OBJECT_INSTANCE_BEGIN`是内存地址，不能作防ABA世代；前后两次同样行也不能证明中间没有解锁/重获。原会话的独占、准确命令账本及全备份窗口无外部命令、没有连接替换，必须由Root组合Scope保证。本片不返回 `allObjectsFrozen:true`，不把七类DDL的准确tag源码推论当作已验能力，也不覆盖日志表、临时表、NDB其它节点、FEDERATED/外部修改或物理页冻结。

## 释放、未知和预算

release仅允许已观察状态，且Root同步许可必须是同一原owner、`originalOperationLeft=true`和`serverOperationsEnded=true`，并满足二者之一：明确 `dumpNeverStarted=true`；或 `dumpNeverStarted=false`且原dump进程及其流实际关闭。许可为Root不可逆Scope事实，签发后不得再启动dump或相关服务器操作。取消ACK、仅本地exit或超时不能签发许可。

许可后先重核原两锁，再由同一原source发送唯一固定 `UNLOCK TABLES`；必须原Query成功end、原记账离开，且control在仪表、映射、身份仍完整时实际观察两锁均消失，才返回released。ACK不等于锁已消失；读取不足/空映射不能当锁释放。成功返回不代替Root后续连接/SSH资源终态核验。

所有失败/取消/超时永久unknown；仅同步请求Root停止原命令/作业，不自动解锁、KILL、关闭或重连。Query返回、Query error、Query end和记账离开分开记录；error/connection-end/取消不能结算记账，原end晚到时才尝试原leave一次。原Query、未完成的nativeEnd/accountingEnd/结果Promise和资源仍在原实例；原end及迟到error继续记录，不能恢复成功。若本原语已unknown，即使Root随后具备释放条件，也不从这里自动恢复；Root按准确自有线程/原连接执行专门恢复并确认服务器终态。

默认总预算10秒，上限30秒，覆盖获取、持有、阶段观察和释放；到期只停链并请求Root停止。最多128个命令、4次成功观察（含首次）、6个操作、32个永久owner（容量最高64）、总保留结果默认256KiB（最高1MiB）。一个实例仅一个操作/命令在途；成功释放后清除预算计时，禁止复用。首次FLUSH只有GLOBAL阶段时也可能已经影响全实例写入，不能把失败解释为没有锁。

## 证据与验收边界

研究来源是员工5只读交付 `employee5-ftwrl-observation-20261018`，handoff SHA-256 `d8043f3993d084bdc98da7b8469ec809fabc8c70d9deffd1e997a25bfb0b2efa`。官方依据：[FLUSH/FTWRL说明](https://dev.mysql.com/doc/refman/8.4/en/flush.html)、[metadata_locks当前状态表](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-metadata-locks-table.html)、[8.4.11获取两锁调用链](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_reload.cc#L259-L275)、[GLOBAL/COMMIT锁实现](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/lock.cc#L965-L1046)。当前状态采样与全窗口连续性是不同证据。

本片只运行专属13项RAM组合及类型检查，包含最后同步记账钩子使释放许可失效后不得发送UNLOCK的反例。未申请真实锁、建立数据库连接、访问200、运行OS业务、旧套件、full/build或打包，没有密钥/私料操作。Root仍需独审固定提交，随后在200专用隔离MySQL8.4.11实例按准确原连接/仪表/权限/源身份验证本原语；七类DDL及各数据引擎、COMMIT和完整备份组合验收均未完成，不能由RAM结果推导。

## Root整合检查点

作者固定 `92f22b65f537b7bad4fd9ee958ca2fa9b35b3cc6`，Root 整合 `eac6de8`。Root 13 项专项及类型检查终态退出码 0。员工5另写五组独立 RAM 组合全部通过，没有重跑作者套件：验证旧 control 迟到事件不结算当前 source、UNLOCK 后仍等待原控制 Query-end、后置仪表／实例失效、租约撤销与通用序列化，以及成功后原连接迟到 end。独审 handoff SHA-256：`815b756c6ca9e9e237932f540e998678de630648572198ad95de21503c181a79`。

本检查点没有实际申请 FTWRL 或执行 UNLOCK，不放开 lockCapability。Root 专属租约、完整窗口命令账本、真实 MDL、七类 DDL 阻断、原服务器释放和完整备份仍分别待验。
