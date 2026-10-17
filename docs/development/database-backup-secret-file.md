# B01 敏感客户端临时文件协议

本片在 `cbca7c82fcbcd1e78b893f1424751cea1442104c` 上只新增敏感文件模块、专属 RAM 测试和本文。没有修改 options、ZIP、AtomicFile、共享合同、IPC 或依赖。模块实现文件生命周期及权限证明协议，所有真实 IO 和操作系统证据由 Root 私有端口提供；本片没有真实文件或 ACL 验收。

## 接 Scope 的接口

Root 为服务持有一个 `DatabaseBackupSecretFileOwners`，在创建 Scope 时同步构造：

```ts
const secretFile = new DatabaseBackupSecretFile(owner, {
  platform: 'win32', parentDirectory, directoryName, currentUserSid,
}, privatePorts, sharedOwners);
// 同步保存到Scope；此时登记已完成，尚未分配任何文件/目录句柄。
await secretFile.open(nativeOptions.clientOptions);
const clientPath = secretFile.privateClientPath(); // 仅Root内部接原生工具
// 原生进程及流真实关闭、原open操作已离开后：
const end = await secretFile.cleanup(); // { owner, state: 'confirmed' | 'unknown' }
```

POSIX 配置使用 `platform: 'posix'` 和 Root 已取得的数值 `uid`。父目录是已有的私有目录，由 Root 预先准备；本模块只在其中创建名为 `directoryName` 的独占子目录及固定 `client.cnf`。父目录只关闭原句柄，永远不删除、不改 ACL。Windows 路径须为规范 ASCII 本地盘路径，完整文件路径不超过 240 字符；POSIX 路径须为可无损 UTF-8 的规范绝对路径。目录名只接受有界 ASCII 字母、数字、下划线和减号。

构造同步登记 owner、父/子目录和文件槽位；账本中的任务号永久占位，即使成功清理也不重用。相同任务号再次登记会使原项永久停链，Owner 字段观察到变化后即使改回也不能恢复。Root 必须复用原账本和原实例，不得通过新建账本/任务对象重分配或恢复未知句柄。账本容量有界，达到上限阻断，由 Root 管理服务生命周期。

`open(source)` 只能调用一次。每次分配前先登记开始和 pending，再调用端口；异步返回先保存原句柄，随后检查 owner/取消。迟到返回不会被丢弃。分配 reject 不能证明未分配：没有回执的原槽位保留为 unknown，清理不会再调用 open/create。父/子/文件句柄或身份别名会被隔离，避免将别人的目录当新资源或双重关闭。

## 权限先于秘密

父、子目录及文件均通过 Root 端口 `inspect()` 返回 `DatabaseBackupSecretStamp`。`identity` 是原句柄的稳定身份，`entryIdentity` 是当前具名入口身份；两者必须一致，且后续始终匹配原身份。`unsafeLink` 必须为 false，Root 应将符号链接、junction、重解析点和任何不能证明的入口标记为不安全。身份应包含卷/设备及文件 ID 等足够区分的信息，不能只用路径、mtime 或长度。

POSIX 的 `mode` 是不含文件类型位的权限位，目录必须精确 `0700`，文件精确 `0600`，uid 必须等于配置中已核当前用户。`createDirectory(name, 0700)` 须为独占创建，不能递归 mkdir 或把 EEXIST 当成功。`openFile('client.cnf', { flags: 'wx', mode: 0600 })` 须独占新文件且不跟链接。

Windows 必须提供 `windows.readDirectory`、`protectDirectory` 和 `protectFile`。父目录仅检查，子目录和文件才能实施保护。端口须从操作系统读回并证明：原资源身份匹配，Owner 为 Root 核定的当前用户 SID，继承已关闭，DACL 恰含当前用户与 SYSTEM (`S-1-5-18`) 两条显式允许完整控制 ACE；目录 ACE 带对象/容器继承，文件 ACE 不带。不能省略其他 ACE、隐藏 deny、仅回传期望值或将 chmod 0600 当成 ACL。SYSTEM 本身作为运行用户的组合未纳入本片。

未提供保护端口、证明缺字段、继承/Owner/SID/权限/身份不符均在取文本前阻断。即使 `protectDirectory` 返回成功，也只在 Root 确实实现了 OS 写入和读回时才有实际效力。RAM 假端口不构成 Windows ACL 已保护的证据。本片没有调用或内置自行启动的 PowerShell；Root 可自行实现原生/固定脚本适配器，不能将密码或动态脚本片段拼进命令。

## 写入、取消和内存

目录与文件权限均已证明，并再次检查原入口/句柄身份后，才调用一次 `source.takeText()`。内容须以 `[client]` 段开头、无 NUL、可无损 UTF-8，编码后上限 64KiB，超出不截断。选项语法仍由前片 NativeOptions 生成，本片没有任意 SQL 或 flags 入口。文本仅为方法局部变量，不保存到实例属性；实例配置也只保留白名单字段。

原字节 Buffer 完整消费短写，每次 write 不超过 64KiB，拒绝零、负数、非整数或超额计数。所有写入完成后依次 sync 和原文件 close，关闭确认才进入 ready。Root 必须原样传递这些字节，不能提前从端口返回并继续持有未完成的原生写入。Buffer 在方法离开时清零；在途写入未完成前保留缓冲，避免取消 ACK 提前清零导致迟到写入损坏。

`finally` 只做 RAM 清零和活动计数结算，没有关闭、unlink、rmdir 或新分配。取消、写入、sync、close 失败均停链，保留原句柄和各操作事实，交给 Root 在正确终态调用 cleanup。JavaScript 字符串不能保证由 GC 安全擦除；Root 不能记录原文本、原生驱动错误、认证文件路径或将其发到 IPC/任务事件。

## 清理证明与未知边界

原 open 或任何端口操作仍在途时，`cleanup()` 立即返回 unknown，不排队伪装已清理，也不取得许可。操作真正离开后，首次实际 cleanup 永久复用同一个 Promise，阻断再 open；许可或任一步骤 unknown 后不会重试同一句柄或删除操作。

Root 的私有 `cleanupPermit(owner)` 必须返回相同 owner 对象，并分别证明 `originalOperationLeft`、`nativeClosed`、`streamsClosed` 都为 true。cancel ACK、发出 kill、destroy 请求、超时或等待器返回不能代替这些事实。许可签发后原 Scope 不得再次启动工具或读取该路径。

清理再次核父/子目录和具名文件身份，最多关闭每个原句柄一次。只调用子目录的 `removeFile('client.cnf', 原文件身份)`，待确认后关闭子目录，再由原父目录 `removeEmptyDirectory(本次目录名, 原目录身份)`，最后关闭父目录。Root 删除端口必须保护具名入口和期望身份，使用不跟链接且非递归的受控删除，并返回实际删除的原身份。不能用“先 stat 后无条件 unlink”的不受控竞态或把 ENOENT/ENOTEMPTY 自动视为成功；无法确认则拒绝/unknown。

文件或目录换绑、分配没有句柄回执、close 未确认、删除回执身份错误、目录非空、Owner ABA 都保持 unknown。即使某一步已真实完成，也保留其事实，不继续删除其他未知资源，不重试。Root 的人工/真实未知恢复独占后续处理，本模块不会自行重开文件或伪造关闭回执。

`snapshot()` 只含白名单布尔和本地槽位/计数：无密码、内容、原路径、owner 令牌、文件身份串或原错误。JSON 和 Node inspect 同样脱敏；完整路径只由 `privateClientPath()` 在 ready 状态交给 Root。Root 在实际启动工具前仍须做权限、身份与租约连续性验证，getter 本身不证明调用之后路径未变化。

本片 31 项纯 RAM 专项覆盖权限、迟到分配/close、短写、取消、预算、所有权和安全清理。没有真实认证文件、OS 进程、数据库、GUI、网络下载、私料、clipboard 或 full/build；没有创建长期密钥或证书，也不涉及真实凭据备份。整库备份、真实 ACL、资源释放及恢复尚须 Root 接线验收。
