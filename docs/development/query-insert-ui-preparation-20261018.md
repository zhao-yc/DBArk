# 完整流式INSERT真实界面及MySQL8.4专项准备

本片从已公开Root提交 `dafda329f2a6ba278dacc90959919ec2e031f1bd` 建普通独立clone，分支 `codex/employee4-insert-native-prep-20261018`。只加专项测试、私有helper及本文，不修改产品、共享fixture、原测试、版本、工作流或依赖。本轮仅RAM及类型检查，所有原生和网络运行均为0，不代表原生通过。

## 两例计划

两例各持有新的 `dbark_e2e_insert_<随机UUID>` 库、源表、目标表、所有权标记旁表和邻表，业务源数据仍为两行，覆盖NULL、空串、BIGINT、DECIMAL、JSON及BLOB。JSON首行原文为数值 `9007199254740993`，另一行为JSON null。观察连接只负责预检、准备、只读断言和本例资源清理；查询与导出执行必须从真实工具栏进入，不执行生成的INSERT文件。目标表先建为空，发布或取消后均须保持0行，源行的精确字符串、JSON文本和HEX也须保持原样。

先在真实查询标签设置会话变量为0，执行只读背景查询，记录会话ID及可见网格。随后仅用键盘输入两行源查询，打开工具栏“新执行并完整导出”，选SQL格式及UTF-8，明确填写目标库、表、全部字段位置，选择文件并确认新执行。打开窗口、选文件、编辑映射均不是执行入口。

等待确认时要求：样例全文与独立手写SQL常量逐字相等，完整行数2、样例行数2、暂存字节数和编码准确；磁盘仅有本例一个真实partial，内容也等于完整预期；原目标仍是本例预先写入的哨兵文本，后台网格保持原样。预期仅插入已校验的随机库名，不调用产品serializer、导入器或真实结果生成答案。

第一例先填错误库表名并确认发布按钮禁用，再填写准确 `随机库.insert_target`，核对并点击发布。同一路径只有发布后才观察到完整手写预期，partial已清理，原任务完成，没有第二个导出任务。

第二例在完整暂存并展示样例时点击取消，等待原任务cancelled及真实资源释放；原文件仍为哨兵文本，partial消失，不点击“再次新执行”。两例关闭导出窗口后均先比较原后台网格，再从真实UI连续三次读取原会话标记，证明会话仍可查询且没有自动重放。

## 一次执行的受控标记

原会话的 `@dbark_e2e_insert_runs` 只由固定源查询的WHERE赋值表达式递增。两行各求值一次时一次源执行应得到2；背景查询及后续只读观察不改变它。发布/取消后，UI必须仍读到相同CONNECTION_ID及计数2，不能变成4。任务列表只核任务身份和终态，不用history数量冒充服务器执行次数。

这是受控两行模板的会话求值标记；真实MySQL8.4优化器及协议行为仍待验。若实际求值次数与该假设不符必须失败保留，不能改用history次数或放宽断言宣称一次执行。目标表0行及源快照证明本次数据未被导出更改，不冒称实现了任意SQL审计。

## 原生保存回答的唯一替换边界

仅在捕获应用的Main进程临时替换 `dialog.showSaveDialog` 的一次回答：核原唯一BrowserWindow、原窗口参数、SQL过滤器及导出标题后，返回本例私有目录内的准确 `insert-native.sql` 路径，并立即恢复原函数。核对一次调用及已恢复后才删除本门记录。异常或未知归属保留门线索，不恢复未知函数。

这属于保存对话框回答替换，不能当成真人操作系统文件选择验收。preload、renderer IPC、Main原 `files.choose` / 文件cap及文档绑定、Engine、数据库协议和结果均未替换；保存令牌必须由原Main真实生成与使用。没有复制/粘贴或系统剪贴板操作。

## 双门、目标及资源生命周期

默认和list分支只登记准确两例；双门为 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_QUERY_INSERT_UI=1`，另须本轮 `DBARK_QUERY_INSERT_SERVER_VERIFIED=1`。要求显式自有字符串：host精确 `192.168.31.200`、port精确 `13384`、TLS为0、user/password及EXPECTED_SERVER_UUID精确为 `f568f70e-c730-11f1-8190-3e6c830dde01`；拒绝访问器、原型默认值、外部源入口、预加载、旧数据库/CA/SSH目标及大小写别名。运行时先核观察流实际peer及只读实际UUID、Linux、MySQL8.4.11、lower_case_table_names=0，之后才允许建随机库。这沿用Root后台专项的固定身份，不能用任意合法UUID替代。

目标绑定观察到漂移永久停链，恢复旧值不能复活。不导入会尝试读取旧 `.cache/dbark-test.env` 的live-helpers，不回填旧.env。凭据仅供本例RAM及真实表单使用，关闭“记住密码”，只做布尔断言，trace/screenshot/video全部off。

沿用 `BatchFillPreparation` 的原TestInfo起点及120000毫秒，原desktop-fixture的 `preserveOnUnconfirmedExit` 和launchGuard目录/启动两侧墓碑。私有scope额外核当前TestInfo、捕获app/page、目录及观察流，逐await两侧检查，拒绝并行动作及afterEach后迟到操作。失败只保留本例，不能借下一例资源恢复清理权。

成功路径先确认原任务终态及页面无错，再沿原fixture正常退出、确切原PID不存在证明；随后在原期限内核对原创建ACK、准确服务器与原观察流、nonce/caseHash标记、完整四表集合、原定义、源邻表以及无未知对象，才DROP本例随机库、读回确认消失、关闭原观察连接并核同一物理流closed。私有目录由原fixture在退出确认后删除，body附录明确写待fixture收尾，不先冒称删除成功。未知失败保留数据库/应用/目录/文件线索，不强杀、不删除旧资源、不用IF EXISTS认领旧库。

后续UI2窄修同时加强了原目标/partial文件身份和观察连接的分配顺序，详见[UI2所有权准备修正](query-insert-ui2-ownership-20261018.md)。原28项准备测试及旧abc黄金函数保持，实际live改用新增的手写大整数JSON黄金函数。

## 本轮执行与剩余边界

仅窄Vitest RAM与 `tsc --noEmit`，日志和精确计数见本clone `.cache/insert-ui-preparation/handoff.json`。RAM只核声明、目标/期限/owner失效、正式对话框回答回调及手写预期与纯消费者的对照；不替代真实MySQL字段类型、会话变量、界面选择器、Main cap授权、操作系统原子替换、正常退出或资源清理验收。

未启动GUI、Electron、实际Playwright（含list）、数据库连接、SSH、Docker、端口、剪贴板、CI或依赖安装。Root独审整合后再安排源模式原生窗口和服务器资源授权；本片只提交本地 `[skip ci]`，不推送。
