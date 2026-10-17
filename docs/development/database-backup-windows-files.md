# B01 Windows x64 敏感文件实际端口源码

本片基于 `88bf438f22cf843247be217558e407233d0fe960`，新增固定 C# helper、TypeScript 私有 pipe 客户端、RAM 测试和本文。源码包含真实 P/Invoke 文件/安全描述符操作，没有用 RAM proof 作为生产默认端口。**本轮未编译、启动 C# / PowerShell，也未创建真实认证文件；类型、RAM 与源码摘要通过不代表 Windows OS 已验收。**

## Root 接线与打包

Root 把固定 `src/engine/databaseBackupWindowsFiles.helper.cs` 原字节复制为只读发行资源 `resources/database-backup-windows/databaseBackupWindowsFiles.helper.cs`。当前 package/build 没有自动复制它，本片按分工未改 package/main；Root 须补发行资源规则，并同时验证开发路径、安装路径和打包后哈希。不得在运行时下载源码或信任 renderer 提供的路径。

固定源码的准确 SHA-256 在 `databaseBackupWindowsFilesSource` 中，并由专项读取仓库固定资源原字节核对。bootstrap 从专属 `DBARK_WF_SOURCE` 环境读取固定文件，先用共享只读 FileStream 有界读取（最多 64KiB），验证同一份内存字节哈希，再以 UTF-8 严格解码并 Add-Type；不会验证后另按路径重读代码。更新源码必须同时更新固定摘要，不能放宽为调用方自签摘要。

```ts
const files = new DatabaseBackupWindowsFiles(owner, {
  parentDirectory, directoryName, currentUserSid, systemRoot,
  sourcePath: fixedResourcePath, timeoutMs: 2500, startupTimeoutMs: 15000,
}, {
  spawn: databaseBackupWindowsFilesNodeSpawn(nodeSpawn),
  cleanupPermit: owner => rootScope.actualDumpEndPermit(owner),
  checkCancelled: () => rootScope.checkCancelled(),
}, sharedWindowsFilesOwners);
// 先同步把files保存在Root Scope，随后才调用start；首个await前留住原helper/三流。
files.start();
const secret = new DatabaseBackupSecretFile(owner, {
  platform: 'win32', parentDirectory, directoryName, currentUserSid,
}, files.ports(), sharedSecretFileOwners);
await secret.open(nativeOptions.clientOptions);
// Root准确套件客户端只读取这个原文件；不把文本/路径发到任务事件。
const path = secret.privateClientPath();
// Root先证明真实dump客户端与其流关闭、原操作离开，再清理：
const secretEnd = await secret.cleanup();
const helperEnd = await files.shutdown(2500);
// 只有SecretFile事实、guard/work计数、helper实际终态全部符合才能结算Scope。
```

父目录须由 Root 事先建立为当前用户/SYSTEM 专属的受保护目录，本 helper 只读检查父 ACL，不擅自修改或删除父目录。所有路径为规范 ASCII 本地盘路径，拒绝 UNC/设备/ADS/相对与含糊组件；父路径最多 180 字符、31 级，最终 client.cnf 路径最多 240 字符。实际 helper 限 Windows 10+ x64、NTFS 和非 SYSTEM 当前用户 SID；无法确认的组合阻断，不自动降级到 Node stat/unlink/chmod。

PowerShell 路径由已核 SystemRoot 派生为系统 x64 WindowsPowerShell v1.0/powershell.exe。Root 必须核实际宿主/系统二进制可信性与 Root 当前 SID；不接受任意 exe。使用 NoLogo/NoProfile/NonInteractive，cwd 为固定资源目录，环境只包含 SystemRoot、受控父目录 TEMP/TMP 和专属源码路径。没有密码、用户脚本或请求片段进入 argv/env。Add-Type 可能在受控 TEMP 产生固定源码编译临时文件；这些不含请求 payload，Root 须核本机策略与编译资源生命周期。没有运行 csc 或创建这些临时文件的本轮实证。

## 命令行与私有协议

完整 C# 源码转 UTF-16LE 再 Base64 会超过 CreateProcessW 的 32,767 字符（含终止 NUL）预算，因此不嵌入完整源码。EncodedCommand 仅为固定小 bootstrap，其余为固定开关；路径只在专属环境/私有 init 元数据中。源码以固定资源打包，由 Root 接线。本模块将 exe 与全部 argv 用保守 Windows 引号规则计入 UTF-16代码单元上界，再加 NUL，超预算直接阻断；不能按“32KiB脚本文本”估算，Base64 也不是加密。专项核算了完整源码超预算与小 bootstrap 留在预算内。

请求为 little-endian 帧：`bodyLength:u32 / seq:u32 / opcode:u8 / metadataLength:u32 / metadata:utf8 JSON / binaryPayload`。body 最多 70,000 字节，元数据最多 4,096，秘密二进制 payload 最多 65,536，仅 write opcode 可以有 payload。响应为 `length:u32 / utf8 JSON`，最多 16,384 字节，无秘密正文。只有一个 RPC 在途；固定 opcode、递增 seq 和本例随机 nonce 绑定原 pipe，句柄只为本次槽位 1（原父目录）、2（独占子目录）、3（client.cnf），不接受任意路径、任意脚本、任意删除命令或跨 owner 句柄。

Node write 回调和 drain 完成后才清零自有 frame，helper 同步 WriteFile 离开后清零请求体。超时不提前清零仍在使用的 frame，原 RPC/child/资源继续保留；实际 child/三流关闭后才可清零剩余在途内存。stderr 持续排空，仅保留 64KiB 饱和计数/overflow，禁止返回或日志原异常、路径、SID/nonce 元数据、正文或 payload。JS/CLR 字符串不声称由 GC 安全擦除。

## 原句柄、目录及文件创建

根的每级祖先都用 CreateFileW(OPEN_EXISTING) 打开，并带 BACKUP_SEMANTICS、OPEN_REPARSE_POINT，读取属性拒绝任何重解析点；所有祖先持续省略 FILE_SHARE_DELETE 防止持有期间改名。GetFinalPathName 仅为附加路径核对，不能代替原句柄/当前入口的卷号和 FileID 比较。

子目录与 client.cnf 由 NtCreateFile 从原父目录句柄以相对固定名称、FILE_CREATE 独占创建，要求实际 FILE_CREATED 回执；带 OBJ_DONT_REPARSE / FILE_OPEN_REPARSE_POINT，创建时即使用受保护安全描述符，避免“mkdir 后再跟路径打开”丢失创建身份。具体组合是否在目标 Windows/NTFS 接受，仍须 Root 实测；失败保留原句柄或未知槽位，不去掉标志重试。所有原句柄在后续检查前立即登记。

身份使用 GetFileInformationByHandleEx(FileIdInfo=18) 的完整 24 字节结构：64 位卷序列号＋128 位 FileID；文件还要求普通非目录、无重解析、hardlink 数为1。具名入口通过另一个有界元数据句柄核同一 FileID，不能按路径名或时间长度猜身份。临时核对句柄若无法关闭也保留，不能隐瞒。

目录创建的原 DELETE guard 持续拒绝共享 DELETE；另有同一原 FileObject 的 work duplicate。目录 close 实际 CloseHandle(work)，parent 保存的原 guard 不丢失，删除沿原 guard SetFileInformationByHandle，不能先 close 原绑定再按路径 unlink。

文件写句柄为 FILE_CREATE/wx，**初始无 DELETE 权限**，共享读/删除但不共享写。只读权限的同 FileObject guard 持续保留；file.close 实际关闭写句柄，guard 单独计数。在 Root 许可后通过 ReOpenFile(原 guard, DELETE…) 打开同一物理对象的删除句柄，再核 FileID/ACL/具名入口。不能把 my_win_sopen 的共享位当作默认配置读取的证据；官方 MySQL 8.4.11 普通 defaults 走 CRT fopen，最终共享兼容仍需 Root 用准确两 exe 和合成配置做无连接验证。

文件允许共享 DELETE，目录 guard 不能推导文件名永远不变。原句柄删除避免误删换入的另一文件，前后具名入口检查仍不等于对所有并发同 SID 修改的完整排除。Root 应在私有 Scope 内排除其他本方写入者，核工具运行前后的原文件身份，任何不连续均判未知；当前不能认定所有 TOCTOU 或真实客户端读取绑定已经解决。

## 实际 ACL 与写入

GetSecurityInfo(SE_FILE_OBJECT, OWNER|DACL) 直接按原句柄取得完整安全描述符，枚举全部 ACE，不过滤额外、deny、callback 或异常 flags 后再报告成功。严格要求 Owner 为实际 WindowsIdentity 当前 SID、DACL protected、非 NULL，恰好当前用户与 SYSTEM 两条显式 FullControl Allow；目录 flags 精确 OI|CI，文件精确0。不会把 chmod 0600 当作 ACL。

保护新目录/文件使用句柄 SetSecurityInfo，再 GetSecurityInfo 真正读回；父目录没有保护写入入口。每次秘密 WriteFile 前再核父/子/文件实际 ACL 与原具名文件身份。写入只接受有界 payload 和连续 position，完整消费实际短写计数；FlushFileBuffers 及 CloseHandle 的真实结果分别回执，不以请求发出代替完成。

## 删除、guard 与 Scope 终态

清理许可仍来自 Root 私有 callback，必须同 owner，分别实际证明原操作离开、**dump客户端**与其流关闭；取消 ACK、kill、退出码或超时均不能替代。签发后禁止再用凭据。这个许可不要求 helper 已关闭，否则会与仍需 helper 删除文件的动作构成循环。helper 仅接受 Root 已核许可的转交，不自行将 nativeClosed 设为 true。

只有获得许可且对应 work handle 已关闭，才允许删除本次创建的原文件/空目录。使用标准 FileDispositionInfo=4、原生 **1字节 BOOLEAN**，不使用 Ex、POSIX 删除或忽略只读降级。SetFileInformationByHandle 成功只代表标记，随后逐个真实 CloseHandle，最后具名入口必须实际消失（FILE_NOT_FOUND）才返回 removed。若被另一文件替换、仍处删除等待、非空、只读、sharing violation、close 未确认或入口仍存在，则 unknown，不递归、不删除外国入口、不重新分配或重试原删除。

**work close 与 guard close 不是同一事实。** 原 SecretFile 的 file/directory close 在这里对应实际 work handle CloseHandle；guard 仍由 helper/root-parent 持有。其最终 `snapshot.closed` 只能连同 bridge 的 guard/work 计数与实际 helper 终态使用，不能单独当作工具全部关闭。正常 parent.close 还核所有受控 guard/work 已为0；Scope 最终需再等 helper child close、stdin/stdout/stderr close。helper exit、cancel ACK、删除标记或 writer close 都不能替代这些事实。

协议损坏/EOF 且仍有原句柄时，helper 不 finally 清理或自动退出，保持原进程等待 Root 明确未知恢复；本片没有全局杀进程、树杀或自动重启。客户端超时永久停链，原 pending 和晚回执仍属于原实例；账本默认32、上限64，无 TTL 驱逐，任务号 ABA/重用永久停链。Root 需保留原对象，并负责确切未知恢复。

## 官方依据与待验收项

- [CreateFileW共享/重解析/目录规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)、[NtCreateFile独占相对创建](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[OBJ_DONT_REPARSE](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)。
- [FileIdInfo](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)、[GetFinalPathName](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)。
- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)、[SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo)、[安全描述符自相对格式](https://learn.microsoft.com/en-us/windows/win32/secauthz/absolute-and-self-relative-security-descriptors)。
- [ReOpenFile共享兼容](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile)、[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[1字节BOOLEAN结构](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_disposition_info)。
- [CreateProcessW完整命令行限制](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)、[EncodedCommand编码](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1)。
- [MySQL8.4.11默认配置fopen路径](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/mysys/my_default.cc#L879)、[CRT fopen调用](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/mysys/my_winfile.cc#L616)。

本片13项 RAM/协议与固定资源摘要专项、TypeScript 类型检查不包括 C# 编译或 OS 验收。Root 仍须验证：准确 Windows x64/NTFS/PowerShell 环境编译；原句柄、FileID、ACL全量读回；合成 client.cnf 短写/同步/关闭/删除；准确 MySQL两exe配合合成配置及version开关的无连接读取；只读、非空、换绑、重解析、close失败和删除等待等反例；打包资源路径/hash和最后全部helper/流回收。未运行真实 helper、认证文件、数据库、GUI、clipboard、full/build，没有创建长期密钥或真实凭据备份。

## 06a7c26 独审后的健康门修复

合法回执只能证明该回执本身，不能撤销随后同一数据块中的协议错误。RPC 返回、原 facade、缓存 close、Root 清理许可及 shutdown 返回现在复核永久健康状态；独立失效 Promise 使“响应先 resolve、write 回调仍挂起”时也能立即拒绝上层调用，原 write、frame 和未完成响应继续留在原实例，不能因拒绝或取消而销账。

SecretFile 端口增加可选 `checkHealthy()`，与取消检查分离。Windows bridge 提供此门；SecretFile 在既有的所有归属检查中同步复核，失效后永久标记 `portUnknown`，撤销 `ready`/`closed`，拒绝私有路径，清理只返回 unknown，曾成功的清理缓存也不能继续发出 confirmed。未提供该门的既有端口保留原行为。快照仍只含布尔/计数，历史分配、删除、close 和 pending 事实保留。

单个 RPC 的完整响应后再出现任何字节，即使不足一个帧头也立即判 unknown。原 stdout 的残头、残体、意外 EOF/close，以及未收到正常 shutdown 回执时的原进程退出或原流终止均停链。正常 shutdown 回执必须实际报告零 guard/work；在解析该回执时登记正常终止许可，以允许 EOF/exit 早于调用方 await 返回。该许可不能代替原 child 和三流 close；协议已未知时，迟到 close 仍记物理事实，但不能恢复 confirmed。

新增 `database-backup-windows-health.test.ts` 前部保留员工5原五个同字节用例（原夹具 SHA-256 `5b486f6794d221fd7facb512cfc53b264f12f718e608743be066a38a7ccb458c`），随后增加回执、EOF、迟到事件和缓存等反例。该新专项共31项 RAM/协议检查，包含缓存清理 Promise 已取出、尚未 await 消费时失效的窗口；原清理 Promise 始终保留且不重新执行删除，健康端口仅另加异步结果交付检查。本次未重跑原13项、full/build，也未编译或运行 C#/PowerShell/实际 OS。固定 C# 原字节与内置摘要保持不变；真实 Windows 和打包验收边界不变。
