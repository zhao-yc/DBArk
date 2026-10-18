# 最近SQL与来源文件保存：最小离线原生准备

固定基线为Root28已推送提交 `16f4a5fc755e1ef7cb1de5243156d4f3c5842ca6`，作者使用新的普通clone与独立codex分支，不使用worktree、不改Root。创建前已核源仓库干净及固定HEAD，随后对GitHub指定提交执行禁用credential helper的fetch成功。原UI2作者目录及提交 `48b932500161e69e6ad571c244f2862e02245737` 保持干净。

本片只新增测试/helper/本文；不改产品、旧query-files四例、共享fixture、已有原生生命周期、依赖、版本或工作流。不加载旧query-files或会读实库环境的live-helpers。生命周期直接复用 `EditorIndentNativeRun`、原TestInfo/120000毫秒、真实Main/窗口来源、will-quit/close及全部原PID消失证明，以及同一私有profile的两次独立启动。不是新建另一套生命周期框架。

## 两例的确切界面范围

| 用例 | 正式UI操作 | 必须独立核对 |
| --- | --- | --- |
| 最近SQL | 打开自有SQL；“最近 SQL 文件”选择后关闭；再次选择并明确打开；原OpenDialog取消；自有文件改名导致最近路径失效；两次正常退出之间独立重启，再选择原最近ID并明确打开 | 原草稿、活动ID、全部正文和实际Monaco模型；只读Main来源状态；取消/失效不留占位标签或污染当前模型；重启恢复原活动标签和稳定最近记录，列表每次仍须明确选择 |
| 来源保存 | 打开自有UTF-16LE+BOM/CRLF文件；键盘修改；Ctrl/Cmd+S保存；再次编辑后由测试替换自己的同一路径文件；保存拒绝；点击“重读为新草稿”；独立重启 | 手写BOM及UTF16LE/CRLF字节；Main来源修订；外来文件字节/身份和原编辑草稿保留；重读副本是实际新模型且未关联，原标签只推进来源基线并保留原SQL；重启两份正文与活动ID保持 |

实际文案来自 `queryFiles.zh-CN.ts`，入口来自 `QueryFilesDialog`、`RecentQueryFilesDialog`、`useQueryFileSource` 和Main的 `queryFileSources`。不假设存在“自动覆盖外改”或“原标签直接重载”按钮。最近ID及来源引用只读取真实UI/Main元数据用于选择和核对，不伪造来源、调用写IPC或把displayPath作为权限。

实际输入只走Monaco键盘。`MonacoEnvironment.globalAPI` 仅开启官方getter观察模型及正文；不使用模型setter、Zustand写入、剪贴板或伪造任务结果。任务允许真实 `queryFileSources.*` 终态，禁止数据库执行任务、历史和遗留running任务。

## 文件、对话框与退出归属

所有合成文件只能位于原run新建的私有临时profile目录，路径计划及原目录dev/ino在首次文件写入前登记。创建使用原wx+写句柄，冻结dev/ino、大小、独立SHA256后关闭；后续验证不能将同字节新inode重签为该对象。独立读取限4KiB，核规范路径、单链接普通文件、原读句柄及路径的前后身份。首次保存的产品合法新文件仅在UI确认clean后作为独立字节检查点；外改替换必须先核这个已知检查点及自有incoming原身份。

失效路径的还原只属于第一例明确的正常步骤，失败finally不补还原、删除文件或强停。未知状态只保留原目录/句柄/PID元数据线索，关闭本例已取得的文件句柄；两次正常退出与原PID不存在后，先复核首次目录身份，再由既有run独占限定目录删除。没有清理旧资源或共享目录。

文件选择只替换一次原 `showOpenDialog` 的准确自有路径或取消回答，核原唯一窗口、原窗口参数、标题“打开SQL文件”和SQL过滤器后立即恢复；消费时再核一次调用及原函数已恢复。没有替换Main授权、IPC、文件读写、模型、最近列表或来源结果。保存快捷键和重读不替换任何系统选择。此范围不代表真人系统文件对话框验收；退出只允许下述两个既定owner的精确dirty确认，其他提示没有自动默认回答。

## 默认关闭及未来Root清单准入

默认及任何 `--list` 分支只登记上述两例，不加载live/owner/runtime，不读清单、凭据或执行端口预检。未来真实运行同时要求 `DBARK_SQL_FILES_NATIVE_TEST=1`、`DBARK_SQL_FILES_NATIVE_APPROVED=1`、`DBARK_INTEGRATION_ENABLED=0`，以及Root给出的 `DBARK_SQL_FILES_MANIFEST` 绝对路径和 `DBARK_SQL_FILES_MANIFEST_SHA256` 原摘要。拒绝其他DBARK环境、实库/认证参数、外部renderer/userData、预加载、别名和录制覆盖。

Root尚未提供本片的新构建清单，本片没有生成批准值，也不凭开关、文件名或版本字符串放行。真正启动仍调用原 `sealEditorIndentLaunchIdentity`：核Root清单原字节、完整dist/resources集合、每个文件摘要、实际Main executable/appPath/resources及原窗口来源，然后才原固定 `127.0.0.1:1` 拒连且原socket close预检、分配目录/启动。重启再次走原门。Main实际 `app.getVersion()` 必须为0.28.0，版本只作完整构建身份后的补充。

后续Root应先整合本片，再构建最终待验仓库或安装包并审批清单；不能拿作者clone未构建的dist、旧安装包或临时合成清单作准入依据。

## 本轮验证与剩余验收

新增29项窄RAM门、一次性原选择回答回调、独立编码字节及文件身份反例，复用原生命周期/期限、构建身份及原拒连脚本的98项RAM测试，共127项通过，`tsc --noEmit` 退出0。精确命令、日志摘要和保护文件证据记录在作者clone `.cache/sql-files-native-prep/handoff.json`。RAM虚拟文件和Socket均不触发实际文件或网络操作。

实际GUI/Electron/Playwright（含list）、DB、SSH、端口、剪贴板、CI、依赖安装和真实凭据读取均为0。清单审批、原生选择器/焦点、实际Main授权及Monaco模型、UTF16LE/CRLF保存、外改拒绝/重读、重启记录、真实正常退出/PID和限定目录清理、总120秒预算均尚未验收。代码只作中文本地 `[skip ci]` 提交，暂不推送。

## QFN-1：dirty原草稿的精确退出回答

员工4独审交接SHA256为 `eca34a7d237dfeb6f8225ad40f83601e2d80a45c7d232fd2f24577162b880bcc`。重读后的原来源标签仍持有 `draftSql`，与外来文件的保存基线不同；App确实发布dirty，Main原before-quit会等待标题“仍有待完成的工作”的原生提示。原e2f准备没有回答该提示，第二例的两次正常退出会被阻断。此项只修测试准备，不修改产品退出行为或把原草稿假置clean。

第二例第一次重启前及最后退出各独立捕获原owner/app/page、原BrowserWindow及webContents、Main PID和原TestInfo截止时间。只匹配原warning提示的准确标题、完整message、两个按钮“继续工作”“退出客户端”及defaultId/cancelId=0，选择准确response=1。原showMessageBox立即恢复；该提示暂时等待父进程看到原Main的本例nonce事件、复核原owner与原期限，确认消费后卸本例状态，才在下一任务恢复原before-quit等待。恢复回答前仍再次核原窗口/app/PID及期限，不能以迟到回执继续授权。

同一原应用禁止重装或重复消费。未知标题/文字/按钮（包括强制退出提示）、第二次原wrapper调用、窗口/contents/app漂移、原期限失效均保留；父进程漂移在消费RPC前停链。失败附录保留本owner的安装PID、提示/消费计数和失败阶段，不兜底回答未知提示，不调用退出API或改共享生命周期。消费回执不代替正常退出：仍须由原run取得真实will-quit/close及全部原PID不存在，两次完成后才按原目录门清理。原dirty模型、文档、来源及重启后的原编辑正文继续保持。

本次追加18项窄RAM反例，与原29项准备测试、原13项owner测试共60项通过，类型检查退出0。RAM直接执行原Main before-quit回调和本片原evaluate闭包，证明未确认时阻塞，确认后才沿原收尾推进且dirty/草稿事实未改变；不把它当作真实退出/PID验收。原e2f提交历史、`.cache/sql-files-native-prep` 原交接及127项日志保持，追加证据另存 `.cache/sql-files-dirty-exit-fix/handoff.json`。

## run1871：模型EOL比较前提

Root首次实际run1871在打开LF最近样本后失败：Main原文仍为LF，实际Monaco模型getter返回CRLF。报告SHA256为 `ed9dd8cbae67e6cf89af1a75b828cd1e7d6881387aa8a43ea72288e6802a68d3`，尚未进入dirty退出。这与原 `editorContentBridge.ts` 将受控props按实际 `model.getEOL()` 规范化且不回声Main的合同一致，不能因此修改全局EOL。

本次只调整测试模型比较：每个模型getter的EOL必须明确为LF或CRLF；活动模型必须仍对应原Main活动标签，仅将该标签原stored.sql按既有Monaco规则转换成该实际EOL后精确比较。实际model.sql不做替换，不默认EOL；未知EOL、文字差异、缺少末尾行、实际模型换行与其声明不符，以及本片未允许的存储正文混合换行/裸CR均拒绝。

Main的 `fileTab.sql === recentSql`、最近样本LF原文及独立字节、来源encoding/BOM/eol、模型对象/版本及前后完整快照、原dirty退出/窗口/PID与目录门继续保持；另明确核首个最近来源为UTF8/无BOM/LF。只补9项独立RAM正反例，与原29项准备回归共38项通过，类型检查以追加交接为准；不重跑GUI、网络、端口或全套，不触及Root另查的格式化入口比较。原失败报告、两份旧交接及原日志均保留，追加证据在 `.cache/sql-files-model-eol-fix/handoff.json`。
