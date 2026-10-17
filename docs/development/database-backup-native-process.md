# B01 原生 dump 子进程私有适配

本片基于 `7e786a5b5783e6560b82b81f3cac244d992a6397`，只新增进程模块、RAM 专项和本文。没有改执行器、main/index、共享合同、工具目录、已有源文件或依赖。运行端口可接真实 Node child_process，但本片只用 EventEmitter 与 RAM stream 验证，没有启动任何真实子进程。

## 接线与前置证据

Root 先核准确注册套件、平台、文件和插件目录身份，再写好 token 绑定的 defaults 文件，证明 ACL/uid/权限和具名入口连续性。模块只收 `NativeOptions.launch`，不收整个 NativeOptions、凭据或 `clientOptions` 文本。

```ts
// Root服务复用原账本；不能重新建账本绕过未知资源或任务号占位。
const process = new DatabaseBackupNativeProcess(
  owner, nativeOptions.launch,
  { owner, toolId: 'mysql-8.4.11-win32-x64', toolLease, defaultsFileLease,
    toolDirectory, defaultsFilePath, database },
  databaseBackupNativeNodeProcessPort(nodeSpawn), owners,
);
const dump = process.start(); // 同步，无await
for await (const chunk of dump.stdout) await archive.writeDump(chunk);
const exit = await dump.exit;
// Root在自己的预算内等待本地资源，并在允许提交前核本地输出：
const localEnd = await process.waitLocalClosed(2500);
process.assertLocalOutput();
// 另行核服务器会话、锁、对象、工具和文件租约；本模块不能代替这些证明。
```

`toolLease` 和 `defaultsFileLease` 是 Root 私有授权账本中已核的准确租约，不能把任意非空字符串当作真实证据，也不能从 renderer 收入。模块会核相同 owner、注册 ID、绝对路径与原固定 argv 的一致性，但没有访问 OS、工具文件或凭据文件的权限，无法自行重做租约/ACL 校验。Root 必须在调用 start 前保持实际证据和连续性；缺依赖时应阻断，不能用常量 true 或虚构租约补齐。

本片只接受 cbca 固定的 MySQL 8.4.11 Windows x64 dump 参数。argv 长度、字段、顺序和最终数据库严格匹配，禁止额外 flags/env、shell、任意插件路径或把 restore launch 套入。restore 的 stdin SQL 写入协议不在本片。固定策略发生变化时需联合更新校验，不自动接受更宽的任意参数。

原 `launch` 必须冻结，模块再复制其白名单数组值；不会保留多余数组属性或整个输入对象。spawn 使用绝对 `mysqldump.exe`、`shell:false`、`windowsVerbatimArguments:false`、`windowsHide:true`、`detached:false`、三个 pipe 和空 env，cwd 固定为已核可执行文件所在 bin 目录。禁止合并 process.env、拼接命令行、全局按名杀、树杀或自动重连。

## 原对象与 pending 归属

构造同步占用 owner/任务号及原 child 槽位，并保留 exit 与本地 close Promise，构造不调用 spawn。start 只能一次，首个 await 前调用注入端口并保存原 child 和三条流，绑定监听。Node 适配器在 Node spawn 返回后立即 capture；只定义或创建适配器不会自动启动进程。

私有 spawn 端口必须最多分配一个物理 child，并在分配后立即 capture，即使随后抛错也不能隐瞒。相同 child 的返回值与 capture 去重；迟到 capture 仍归原 owner，若此前已取消则只请求这个 child 一次。端口报告另一个不同 child 是协议违规，会隔离原对象并保持 unknown；Root 必须自行持有任何违规额外分配，不能指望模块用新进程替换原对象。生产 Node 适配器没有这类多分配入口。

spawn 抛错或 error 事件不证明没有分配，也不伪造 exit/close。若原事件在迟到 capture 前已经丢失，本模块保持 unknown，不能根据 destroyed、pid 消失或一个错误推导已关闭。Root 必须保留原 Scope/账本；账本默认最多 64 条，硬上限 128，不按 TTL 驱逐未知，也不重用已领取任务号。达到容量就阻断新登记。

Owner 引用和 taskId/planToken 均固定。观察到字段改变、ABA 或重复任务号后永久停链，晚事件仍记在原实例，不能转移给新 owner。快照保持未知，即使随后把字段改回。账本保留原实例、child、流和原 Promise，不能通过重启模块账本冒充恢复。

## stdout 背压与 stderr 脱敏

stdout 只有一个消费者，不添加 data 队列。每次 next 才根据可读长度调用 `read`，请求不超过 65536 字节；原生大 chunk 在 stream 层分片，每次只复制当前小片，避免消费者长期钉住一个大底层 Buffer。原字节不解码、不改换行、不解析整数或 BLOB，也不全量拼接。下游应 await archive.writeDump；消费者暂停时模块不预读下一片。

重复消费者或并发 next 会停链。提前 return 仅请求原 child 取消，不能冒充 stdout end。Root 应让本模块独占三条流的读取和生命周期监听，不得另加 stdout 消费者或擅自替换流。

stderr 一直以原字节排空，正文不进入返回值、错误、日志、任务事件或属性。只保存最大 65536 的饱和字节计数和 overflow 布尔，数据收到后即丢弃；错误事件的原 error 也不保存或转发。快照、JSON、Node inspect 仅输出白名单布尔与有界计数，没有 argv、原路径、密码、pid、owner 令牌或正文。模块不生成凭据，不持有 clientOptions 文本。

## 退出、取消与本地关闭

独立记录 spawn、exit、child close、stdin finish/close、stdout end/close、stderr end/close。exit Promise 只在实际 exit 事件返回 code/signal；error、取消、所有权或流错误使它以固定脱敏错误拒绝，并保留真实 exitSeen 等事实供后续观察。exit=0 不是所有资源已关闭，也不能覆盖之后的流错误。

`requestCancel()` 仅对已捕获的原 child 发一次 `kill('SIGTERM')`，不会查 pid 或重新 spawn。返回值、kill 成功/失败、abort、等待超时均不设置关闭事实。取消先于迟到 capture 时，晚到后仍只请求原 child 一次。未 start 的原槽位可封闭且永远不能再 start；没有发生过分配时才能据此确认本地无资源。

`waitLocalClosed(ms)` 上限 3000ms；超时仅返回 unknown，不改原 close Promise、不销毁或删除对象，晚到 close 仍可更新原事实。confirmed 至少要求原 child close 与 stdin/stdout/stderr close 全部实际观察到。stdout/stderr close 但未 end 可以证明本地句柄关闭，仍表示数据失败，不能通过 assertLocalOutput。

`assertLocalOutput()` 还要求 spawn、实际 exit=0、无取消/错误、stdout/stderr end 和完整本地 close。Root 必须在允许归档提交前调用，并在自己的提交边界内再核所有独立事实。它不证明 dump 的服务器连接已断开、服务器语句已停、全局读锁已释放、一致性已证或整库备份/恢复完成；本模块不输出这些字段。

本片 16 项 RAM 专项和类型检查只验证上述私有协议。没有真实进程、文件、凭据、网络、数据库、GUI、clipboard、full/build。实际 OS 进程事件、原生工具、服务器会话、锁及未知恢复仍由 Root 独占接线和验收。
