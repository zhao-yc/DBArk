# SQL关联保存普通mode窄修及Windows设施清单

父提交：`b307e624b7412dc6526164e7ef7c4a1443473d4d`。本片只修改 `writeBoundQueryFile` 的普通mode保留，增加独立RAM对照和本说明。没有修改合同、renderer或Root，没有重跑127项、类型检查或完整套件。

## 修复与证据

父实现把原mode传给 `open(temporary,'wx',mode)`，POSIX的umask仍会过滤该值。新RAM对照在父提交复现0664经umask0022变为0644，见本clone `.cache/sql-file-mode-fix/parent-red.log`：原期待436（八进制0664），实际420（0644），1红、4未选择。

修复后对已有普通文件先完成所有暂存写入，再对同一暂存句柄 `chmod(expected.mode)`，随后sync、fstat检查普通权限低九位一致，最后关闭句柄并走原目标版本复核/替换/读回链。所有新增await返回后均重核原文档及取消；mode无法设置或无法读回证明时，在rename之前拒绝，`wrote=no`，不提交来源修订。资源清理仍只关闭及删除本次wx取得的暂存文件，原目标保持。

`.cache/sql-file-mode-fix/fixed-five.log`：独立5项全部通过。

| 对照 | 结果 |
| --- | --- |
| open受umask得到0644，写完chmod后fstat证明0664，再替换 | saved；目标普通mode0664、来源提交1次 |
| chmod拒绝 | blocked/io、wrote=no；原内容与mode不变、无来源提交 |
| fstat无法证明mode一致 | blocked/io、wrote=no；未进入rename |
| chmod await后文档取消 | blocked/document-changed、wrote=no；精确清理 |
| mode fstat await后文档取消 | blocked/document-changed、wrote=no；精确清理 |

全部通过实际 `QueryFileSources.save` 后台链及RAM文件端口核typed结果、任务终态、预约、句柄和暂存收尾；不只检查chmod调用。父红与修后绿为同一成功对照，未改期待。只测试普通mode（`0o777`）；未保留或承诺setuid/setgid/sticky、ACL、所有者、ADS、扩展属性。没有运行macOS/Linux原生文件操作或新的Windows文件实测；不能据RAM通过宣称平台元数据验收。

## 可复用的既有设施（只静态读取）

| 设施与证据 | 可复用点 | 现有边界 |
| --- | --- | --- |
| [ExportReservations](../../src/main/exportReservations.ts#L4)；[exportTargetKey](../../src/engine/atomicFile.ts#L35) | 主进程跨写入口目标预约、真实父目录归一化、Windows大小写键、幂等释放；本片已在用 | 应用内互斥，不是跨进程CAS或ACL证明 |
| [AtomicFile](../../src/engine/atomicFile.ts#L60)、commit第125行、dispose第133行 | 同目录wx、短写/背压、同步、关闭、替换边界及精确清理；可参考既有IO端口扩展方式 | 原生IO第14行仍为Node open/rename/rm；WritableFile第7—9行没有chmod/stat/ACL端口，不能直接视作元数据保留实现 |
| [DatabaseBackupAtomicArchive](../../src/engine/databaseBackupAtomicArchive.ts#L55) | 捕获原句柄/close promise、rename pending/confirmed/unknown、原owner结算和严格关闭证明 | 备份归档任务范围；不提供用户SQL文件ACL复制或Windows原生替换API |
| [Windows helper原生声明](../../src/engine/databaseBackupWindowsFiles.helper.cs#L22)，Acl第75行、RequireAcl第85行、Protect第89行 | 现有CreateFileW/NtCreateFile相对父句柄创建、GetFileInformationByHandle/Ex物理身份、GetFinalPathNameByHandleW路径核对，以及GetSecurityInfo/SetSecurityInfo真实Owner/DACL读写和读回证明；可复用原生资源固定摘要/私有RPC/owner绑定架构 | 当前保护策略专用于备份秘密client.cnf：Owner及SYSTEM两条非继承FullControl ACE。不能直接用来覆盖用户SQL文件原有所有者、组、DACL与继承策略 |
| [DatabaseBackupSecretWindowsProtection](../../src/engine/databaseBackupSecretFile.ts#L27) 与 [Windows端口](../../src/engine/databaseBackupWindowsFiles.ts#L165) | 真实identity/Owner/DACL/继承读回的typed证明；父目录只读核验，文件/新私有目录单独保护 | “保护为私有”与“保持任意现有用户文件元数据”是不同合同，后者尚未实现 |
| [旧SQL另存](../../src/main/queryFiles.ts#L71)；[LocalStore.flush](../../src/main/storage.ts#L101) | 已有临时写/同步/rename和配置回滚模式，可作行为参照 | 未提供通用ACL/所有者/ADS保存机制；配置库固定mode不适合作为用户文件元数据合同 |

对 `src` 与 `scripts` 精确检索 `ReplaceFileW`、`MoveFileExW`、`[IO.File]::Replace`、`File.Replace(`，本固定源码未命中。现有helper的SetFileInformationByHandle在第140行用于精确删除，不是通用替换。没有因此断言系统不支持这些API，只判定当前代码未接入这些入口。

Root后续若选择Windows保留元数据，应单独定义原目标/替换结果的Owner、DACL、继承、ADS及异常状态合同，再决定复用原生helper框架或增加替换端口，并核资源固定摘要及打包。该决策和平台执行未包含在本片；本次没有新增系统依赖或执行PowerShell/C# helper，没有访问真实用户文件或GUI。
