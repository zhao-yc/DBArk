# SQL文件来源绑定后台交接（0.24独立片）

基于固定 `457692009dbe4363acc7d61cc877c1063c5ea23d` 的普通clone，分支 `codex/employee4-sql-file-binding-backend-20261018`。独立合同提交 `0093242679b1b77fb7e075a8341eeecd866c3fab`，Root复核增量合同 `29b7de0c3d43eca68435923d6bc3666f26f087f9`；完整实现提交见员工4私有 `.cache/sql-file-binding/handoff.json`。没有修改0.22/0.23 Root，没有推送。

## 正式入口与renderer接缝

`CommandMap`、预加载白名单和共享校验声明六个命令：`queryFileSources.open/save/saveAs/status/release/cancel`。实际 Main IPC 对本前缀调用 `ColumnsMainCapabilities.capture`，绑定真实窗口、主frame对象、processId/frameToken及文档代次；文件操作在独立Main分支处理，不发送给数据库broker，不读取连接密码。每次异步返回及提交前重验窗口/查询文档/来源修订/取消，最终IPC发布再次核原窗口；所有小型文件操作复用 `queryFileOperations`，退出等待其结算。

renderer必须先把 query tab 经既有 settings.save 保存，再调用文件来源命令。`status({tabId})` 只读私有本地记录，重启时不会自动stat/read外部文件；显式保存/重读时重新捕获当前真实文档并访问原授权路径。`open` 无source弹原生框，有source则明确重读原关联路径。打开期间正文发生变化或tab关闭后同ID重建，旧打开结果被拒绝。打开成功在本地原子保存来源及读取正文；renderer应按同一打开意图接管模型，不能覆盖之后的新输入。

标签的 `fileSourceBinding` 仅为 `{id,revision}`。状态/打开/保存返回的 binding view 含 `ref/name/displayPath/encoding/bom/eol/savedSqlDigest`；displayPath仅供展示，六个命令均不接收路径。`savedSqlDigest` 是**点击时提交SQL完整合法UTF-8字节的SHA-256**，不先归一化EOL；打开时对应原始解码正文。文件原字节摘要另存于Main。共享 `queryFileSourceDigestPayload/queryFileSourceSqlDigest/queryFileSourceHasChanges` 给前后端同一算法：摘要前拒绝孤立代理项/NUL，正文中的U+FEFF保留，显式编码/BOM/EOL变化独立进入dirty。保存成功只推进该正文快照基线，不修改settings里后来编辑的SQL。renderer要比较实际模型和这一基线，不根据返回成功清空后来输入。

菜单仍发既有 `save-query` / `save-sql-file` / `open-sql-file` 事件，此片没有修改renderer或快捷键语义。员工3负责文件来源标签的Ctrl/Cmd+S、另存、保存失败提示、重读/另存/取消、混合换行选择、关闭保存三选及模型基线。两种有效主来源互斥：raw settings门、Zod和直接store拒绝同时携带 `sourceBinding/fileSourceBinding`。明确打开文件时Main原子切换主来源，旧本地查询条目本身保留。解除文件来源必须先精确release，再重建tab删除字段；显式undefined拒绝。复制标签不能借旧tab的ref授权新tab。

`open/save/saveAs`必传新UUID taskId，Main先保存固定任务概要，编号不得复用。使用现有 `dbark:task` 和任务列表，`queryFileSource`报告阶段、真实分块字节及可取消状态；数值进度是阶段展示，不是耗时或吞吐估算。`cancel({tabId,taskId})`只对同一真实文档的对应活动任务生效，等待物理收尾。原任务中心的 `query.cancel/tasks.cancelState`也仅对已登记的文件任务适配到同一门，不发送数据库broker；到替换提交点后为confirming，cancel返回false。取消期间为checking，终态为finished。原生模态框不能被本API强行中断，取消意图在框返回后阻止后续IO。任务概要不保存路径或SQL，并区分未写、已写和替换不确定。

## 私有存储及重启

- 配置库8→9在既有 `LocalStore.mutate` 事务/原子落盘中创建 `query_file_sources` 并更新user_version，未来10拒绝。原迁移之后的提交回执/旧任务恢复仍沿原多阶段流程，不把整个open描述为一个总事务。
- 私有表按tab_id唯一，记录来源ID/修订、connectionId文档归属、Main原生选择后解析的绝对路径、dev/ino/size/mtimeNs/ctimeNs、原始字节摘要、编码/BOM/EOL和SQL基线。主进程不透明引用之外的来源字段不放入settings，不进入连接导出/复制。
- settings.get从私有表投影权威引用；settings.save忽略renderer作为授权依据的来源字段，按tab_id/文档归属重新投影。因此旧settings回包不能把来源revision退回，也不能把一个tab的文件能力复制给另一tab。直接存储、原始IPC及Zod入口均拒绝table标签上的fileSourceBinding。
- 关闭/替换文档后精确删除可证明归属的来源；release只接受同tab/id/revision，等待同一在途操作结算后再释放。未知/坏记录不宽删，读取坏来源只撤去无效展示引用，SQL正文保持。窗口导航/崩溃取消在途意图，保留仍属于已保存查询文档的重启授权。
- 分块IO逐次核文档代次和来源，但不逐块重解析整份SQL：文档只读快照在任何本地事务成功或回滚后失效，正文更新、关闭与失败恢复都重取；文档token仅在真实关闭/替换时轮换。

## 文件读写政策

沿既有queryFiles的20MiB/2000万字符及utf8/utf16le/gb18030往返校验。读取前后比较句柄与路径的物理版本和大小；每个分块异步后检查文档。只允许单链接普通文件、非零inode，拒绝符号链接、硬链接及无法证明身份的文件，不以权限不足推断文件不存在。来源读取不把原始文件或系统错误透传到IPC。

保存沿当前来源编码/BOM及统一换行。**即使SQL摘要未变，也先读盘核对原物理版本/字节摘要**；外改、删除、替换及其他tab已存均先拒绝，不能提前报unchanged。混合换行正文未编辑且文件仍是所见版本时保持原文件字节；编辑后preserve拒绝，必须明确选LF/CRLF/CR。换行分类使用单遍扫描，不为每个行尾分配匹配数组。另存由原生框授权新目标，显式指定编码/BOM/EOL；其他已关联tab的目标拒绝覆盖。

整个保存占用既有ExportReservations目标预约。保存前比较原物理身份、版本及原字节SHA；同目录`wx`临时文件、分块写入、同步并关闭，替换前重新读取核对目标或确认新目标仍不存在，最后再核原文档及取消。rename前将写状态标为unknown，成功返回后标为yes，之后再次读回核对实际字节。任何失败都结算本次句柄、临时文件及预约。

`blocked.wrote=no/yes/unknown` 必须分别处理。文件已写、本地来源记录失败返回storage/yes；写后文档失效或读回不能确认时保留已写/不确定事实，不回滚文件、不重放。来源记录失败保持旧私有基线，下一次普通保存会先因文件版本变化拒绝；用户须核对后明确重读或另存。

文件比较与rename之间没有跨进程原子CAS；外部进程可能在最后检查后改动路径/父目录。当前保守物理身份检查及写后核对不能证明消灭该竞态。临时文件继承普通mode，但未证明Windows ACL/ADS、所有者、扩展属性、macOS文件保护/沙箱书签、网络文件系统及目录替换语义。以上须平台审查和实测，不能据本地单元结果称原生产品验收通过。

## 验证证据与原失败

证据位于本clone的 `.cache/sql-file-binding/evidence/`：

- `new-tests.log`：新合同3、真实Main函数/RAM分发3、初版后台14，共20项通过。
- `related-tests-local-temp.log`：13文件108项通过，含新增后台16项（新增暂存后取消及rename后取消）及92项受影响旧回归。加上未重复身份的合同/Main共**15文件114个不同检查点通过**，不将重复运行累加。
- `typecheck-once.log`：按最初授权只运行一次全项目 `tsc --noEmit`，初版退出0。此后有EOL/绝对路径补修和Root要求的来源互斥/共享摘要/任务取消增量；未再次type，**此结果不能作为最终头的类型通过证据**，最终头需Root统一类型检查。该时点在handoff单列。
- `eol-scan-followup.log`：上述EOL专项1通过、15未选择，不新增通过身份。
- `final-source-tests.log`：单遍扫描与绝对路径校验补齐后，新合同/Main/后台三个文件22项最终通过；其中重复身份不再累加。旧92项相关回归来源仍为上一条108项日志。
- `contract-increment.log`：增量合同5项通过，新增精确UTF-8摘要/非法Unicode及显式格式dirty。
- `root-increment-first.log`：互斥/新任务接线后3文件31项通过；`root-increment-narrow.log`补任务中心后11通过/1失败/16未选择，失败为真实Main分发VM缺少原有structureTokens/sessions/connectionConfig端口。`task-center-fixture-fix.log`补端口后该1项通过，原期望未改；`cancel-final-narrow.log`是最终取消/提交点/任务中心3项通过、25未选择。没有重跑无关92项旧绿。
- `close-and-commit-final.log`关闭/提交点2项通过；`document-cache-final.log`分块文档缓存/关闭/取消3项通过。其余为未选择身份，没有重跑原相关旧绿。
- 汇总为**15文件127个不同检查点曾通过**：新合同5、后台22、真实Main/RAM8、原相关回归92。各自源码时点及增量复验范围如上，不把重复执行累加，不称为最终头完整套件通过。
- `first-run.json` 和 `backend-test-before-fixture-fix.ts` 保留初轮16绿1红：夹具把原文件移走再移回改变ctime，却仍期待旧版本保存；只调整测试顺序，先核重启直接保存，再移走文件证status无外部IO。物理版本保护未放宽。
- `related-tests.log` 保留默认沙箱临时目录rename的30个EPERM失败；改用本clone的TEMP/TMP后原相关断言通过。初次依赖目录联接失败后，经批准建立本地依赖联接，没有联网安装。

9个旧测试文件仅更新配置库当前/未来版本常数与对应描述；分栏旧schema7夹具另移除新来源表以保持真实旧11张表，原数据/失败/回滚断言保留。断言调用数对照在handoff中，不把版本常数适配解释为降低期待。

未执行GUI、Playwright（含list）、构建、端口/网络、Docker、真实用户文件、.env/凭据、外部数据库、剪贴板、发布或推送。测试文件只在本clone的专属目录，本地配置用sql.js夹具；首轮旧测试自动使用的沙箱临时目录错误单列保留，后续已限定为本clone。没有新增密钥或证书，无需重要文件备份。

剩余验收：Root合同/安全与回归复核、员工3完整renderer链、Windows/macOS原生授权与权限/异常/退出/同文件并发/安装验证，以及上述文件系统竞态与元数据策略核准。本提交是后台交付，不是0.24完整产品或发行完成。
