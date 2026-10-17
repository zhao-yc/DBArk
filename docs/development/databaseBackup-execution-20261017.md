# B01 执行状态机与零写入恢复预检

基线 `fb4db474c453bac2bc98a35fa50cf3f9cca90232`，普通独立分支 `codex/employee3-database-backup-execution-20261017`。只新增 execution、restore 私有模块及专项测试；前片计划器、共享契约、App、main、engine/index.ts、connection.ts 和 OS 工具不修改。

## Root 可直接接线的端口

`DatabaseBackupExecutor` 注入 `DatabaseBackupExecutionPorts`：

| 端口 | 归属与语义 |
| --- | --- |
| `bindings(planToken)` | 取前片私有绑定；必须属于当前窗口/调用者，不从 renderer 接收证据对象 |
| `reserve(owner,binding)` | 同步登记目标占用，基于 Root 已归一化的输出租约；不能解除另一 owner 的占用 |
| `createScope(owner,binding)` | 同步返回稳定资源 scope，任何网络、子进程、控制连接和迟到资源都须在分配前登记归属 |
| `allocateArchive(owner,binding,target,hooks)` | 同步登记归档 owner；实际 open、写入、提交和 abort 均经该稳定句柄，不能异步失败后丢失句柄 |

scope 按顺序提供 `confirmLeases → acquireLock → inspectLocked → startDump → confirmContinuity`；清理分别为 `closeDump`、`unlock`、`closeTools`。每份回执的 `owner` 必须是同一个对象，只有相同 task 字符串不成立。`snapshot()` 中的 true 必须来自真实关闭/释放证据，不可直接借用 native.closed、取消请求返回、EOF 或进程 exit 属性。

`confirmLeases` 核源连接修订/源租约、工具完整套件及注册修订、输出令牌授权/目标修订。Root 端口必须真实重查并固定对应资源，不能把准备阶段声明重新包装成 true。实际锁回执含 lockId、准确 profile、源租约和本 owner 时钟下的 acquiredAt；`inspectLocked` 才重读完整对象、定义、权限、实例/版本、工具套件和依赖。`confirmContinuity` 须证明从采集到 dump 结束没有锁间隙，不能只看结束时又有锁。

Root 原生适配器负责固定 `shell=false`、可信套件路径/哈希、凭据传递及资源观察；argv、env、日志不含明文密码，不记录原始 SQL。scope 的停止/关闭函数必须只针对原 owner，合并重复动作并保留迟到分配，不建立新业务连接或重放 dump/DDL。

## 真实执行顺序

1. 首个 await 前消费计划令牌及任务号并占容量。有效令牌不能重放；只回收已确认终态且原计划过期的记录，未知记录不会按时间驱逐。
2. 固定计划格式/期限/预算，同 owner 登记目标、scope、归档句柄，先核源/工具/输出租约，再获取实际锁。
3. 锁内复核全部类别可见性、权限、源/连接修订、精确家族版本、工具套件和注册修订，要求对象与定义和原计划一致；缺失或变化直接失败，不改成部分导出。
4. dump 只接受有界 Uint8Array。每个输入片段最多 1 MiB，并拆成至多 64 KiB 的写入片段，逐次 await 后才读下一段。独立增量计算原始字节数及 SHA256，不解码、不改写、不加载完整 SQL。空 stdout 即使 exit=0 也失败。
5. 等待明确 exit=0 且没有 signal，核锁连续性；分别确认 dump close、unlock、工具关闭和全部未决工作结算。主错误及每项清理副错误都保留，清理不会因为已有主错误而被跳过，也不会在同一次失败自动重复 close。
6. 只有实际资源终态确认后才生成 `resourcesConfirmed=true`、`restoreVerified=false` 的 manifest。源证据和传给归档端口的 manifest 使用隔离副本，防止端口通过可变别名篡改已核准范围。
7. 调用归档 finish，核独立 dump 字节摘要、最终归档摘要/预算以及返回 manifest 的源、工具、范围与一致性字段，然后才进入 AtomicFile 提交边界。提交后的取消不回报假取消，也不删除已提交文件。
8. 文件终态及全部资源确认后释放目标占用。未知时保留准确 scope/archive/target 与未决异步工作；`retained(taskId)` 是 Root 私有诊断，含原错误对象，不能直接发 renderer 或原样日志输出。

默认容量 2 个活动 run、8 个有效/保留记录；每阶段最多 30 秒、每项清理最多 1 秒，实际持锁不超过计划预算。超时不是释放证明。提交 Promise 超时后不 abort 仍可能 rename 的归档；状态查询活读晚到的 fileCommitted，目标继续保留。显式 `recover(taskId)` 只观察/清理同一 owner 的原句柄，不重新取计划、加锁、启动 dump 或执行 SQL；仍未决或 owner 错乱时不放行。

## 员工4归档模块的适配

本模块不重复实现 ZIP。私有 `DatabaseBackupExecutionArchive` 包装员工4的 writer：

```text
open()                  Root/归档包装层登记后创建 AtomicFile 和 writer
writeDump(Uint8Array)    每片 <= 64 KiB 且 await
finish(manifest)        返回 {dump, archive:{bytes,sha256}, manifest}
commit()                经 Root 校验的同一输出授权及 AtomicFile 边界发布
abort()/snapshot()      返回所属 owner、实际文件提交及资源终态
```

`finish` 可以由底层注入 dump 字段；本执行器传入自己计算的字段并要求完全一致。archive 的 bytes/sha256 指整个 ZIP，manifest.dump 指原始 SQL。两个固定条目、STORE/ZIP64、CRC、随机读取及流式解析由归档模块负责，不能把本测试中的 RAM 容器当作 ZIP 验收。

## 恢复预检：容器、语义与隔离分开

`DatabaseBackupRestorePreflight.prepareRestore({fileToken,targetConnectionId,taskId})` 只检查，不写库。端口是严格 `inspectArchive`、原始 SQL 的 `inspectSql`、隔离目标的 `inspectTarget`；同 owner、archiveIdentity 和文件修订必须一致。

严格归档检查只证明字节与容器。私有运行时清单 schema 继续核字段真实类型、准确版本、SHA/字节数、时间、对象数量及重复/缺失定义，字符串 `"false"` 不能冒充布尔值。源范围/锁/资源字段仍是文件声明，不能单凭合法 ZIP 或哈希就认定真实发生。

SQL 分析端口须从同一有修订绑定的原始 dump 流完整分析条件注释、DELIMITER、过程/函数/触发器/事件等，证明唯一数据库及对象与 manifest 一致，列出全部 DEFINER 和外部依赖；未知/不支持必须返回 unknown。不能用普通分句器、正则改库名、删头或修改 raw SQL 假装已完成分析。**本片实现的是这些证据的严格接纳与恢复决策，不包含该原生 SQL 分析端口本身。**

目标必须证明同家族、同准确版本、同名且为空/不存在的新建隔离库，并排除原实例。创建/写入所需语句权限、原始 DEFINER 账号、Root 注册的准确恢复客户端及完整套件哈希/租约都须确认。事件存在时需已确认隔离目标事件调度关闭；预检不会改设置、创建账号或自动 grant。源码含可执行业务程序，实际恢复须另行明确授权，并继续核隔离运行环境。

有阻断的预检也可返回查看令牌，但 `bindings()` 禁止交给实际恢复执行器。预检记录最多 8 个、同时检查最多 2 个、期限 120 秒；超时仍未结束的端口继续占容量，晚到不能发布计划。Root 私有端口必须保留和关闭真实检查资源，不能因预检返回超时就释放外部资源归属。

本片没有实际 `runRestore`，没有声称恢复成功。真正恢复还须单次领取预检、重新核归档/客户端/目标修订与权限，明确执行原始 SQL，失败记录部分状态，不自动 DROP/补偿/重放；恢复后比较对象定义/数量、行数和精度/BLOB/NULL 等数据完整性证据后才能 `restoreVerified=true`。

## 最小验证与实际边界

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/databaseBackupExecution.test.ts tests/unit/databaseBackupRestorePreflight.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

执行状态机 14 项、恢复预检 14 项，共 28 项通过；最终类型检查退出码 0。覆盖顺序、单次领取、容量、锁内范围、主副错误、EOF/exit 与 close 区别、64 KiB 背压、取消 ACK、提交边界/超时/晚到事实、外来 owner、未知 abort、空 dump、manifest 及其可变别名篡改；恢复侧覆盖准确组合、完整清单类型、SQL范围、DEFINER、隔离目标、客户端、事件及未决超时容量。专项报告 `.cache/database-backup-execution/execution-tests.json` 的 SHA256 为 `49914abffa56876945c3232f47d1ad6b1c191f5ac03e52c6d0fa4bb282d41afc`。

首轮类型检查发现 RAM fixture 的 true 被推断为 boolean，补充字面量类型后重验；没有放宽生产证明类型。未重跑前片 22 项、M02、全套或构建。本轮产品 OS spawn、数据库、GUI、网络、工具探测/下载/安装、凭据读取、剪贴板、Docker 均为 0；测试工具链、Git 同步/推送及只读提交 CI 查询单列，不冒充产品执行。Root 实际工具分发和其它分支验收状态不纳入本片结果。
