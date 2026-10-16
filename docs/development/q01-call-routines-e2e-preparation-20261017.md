# Q01 CALL两项真实E2E准备（2026-10-17）

状态：仅定义、四组合列表及类型检查完成，实际GUI/200/数据库/系统剪贴板读取/手动CI均为0。父版为已冻结的9298b3add79e0a3a09abd23ab2174c68f354fbfd；本笔仅新增sql-completion-call-routines.spec.ts及本说明，产品、9298旧测试、输入/隔离/诊断帮助器均未修改，不rebase或改Root冻结树。

## 两项定义

1. 当前库CALL：在随机本例库创建q01_call_marker一行(id=1,hits=0)，以及无参数过程q01_rebuild_current。其单条UPDATE副作用为hits+1。真实输入CALL q01_re|suffix，Ctrl+Space，要求focused建议含真实过程名；普通Enter接受后全文必须为CALL `q01_rebuild_current`，再真实撤销回完整原suffix。
2. 显式限定库/引用名：本例过程真实名称为q01.re$build`quoted，含点号、美元符号及反引号，两个IN参数。输入CALL `本例库`.`q01.re|suffix`(1, 7)，接受后的名称必须完整编码为`q01.re$build``quoted`，限定库和(1, 7)原文保持；真实撤销必须完整恢复原文。误执行该过程会令标记hits+7。

每例setup之后读取独立before，再在接受与撤销后分别严格比较tasks、history及标记行均未变。没有执行CALL来准备或校准预期，不因结果为空跳过断言；不mock目录响应、注入候选、设置Monaco模型或直接调用补全IPC。

## 原有路径与权限

复用live-helpers.isolatedDatabase、openDatabaseQuery及其原生应用夹具。旁观连接仅在本例随机dbark_e2e_库内创建标记表/行和过程、读取两列最多两行；过程SQL SECURITY INVOKER，无自建用户、GRANT、global或PROCESS。setup中的GUI创建库及结束时既有精确DROP DATABASE沿原帮助器，不能把补全过程零执行说成整例只读。

复用既有tableDefaultEncodingTarget的六组合纯目标/TLS门（函数名沿用旧专项），不新建策略框架。仅192.168.31.200/deve-server.yinzon.com及13357、13380、13384、13310、13311、13484；13484须显式严格TLS及Root现存CA，不降级。连接保存后再次核对实际profile目标和严格TLS。实际端口、既有账户权限、CA/路径与执行来源由Root本轮确认，代码不保存凭据或读取其它实例。

产品目录仍是既有metadata objects/procedure路径，未替换目录或查询实际参数签名。实际权限不足、过程DDL失败、目录不可见、无建议、接受/撤销/副作用失败必须按失败保留，不能改断言或换用户规避。

## 门、期限与列表短路

两门均为1才可运行：DBARK_INTEGRATION_ENABLED和DBARK_Q01_CALL_ROUTINES_UI。文件先判断--list，列表即使双门为1也只注册基础test，不加载desktop-fixture、live-helpers、monaco-caret或诊断运行模块；类型import不产生运行时加载。不开门的实际运行静态skip，不启动桌面夹具。列表不读取私网env文件或CA。

每例固定150000ms，retries=0；trace、自动截图、video关闭。不新增timeout覆写、延时、输入fallback或重试。沿用positionMonacoCaret的原生focus/全选/删除/insertText、原5秒全文准备断言、真实Ctrl+Space同步只读光标证明及原共享13秒补全余量；Enter和撤销均为真实键盘，全文核对只用原余量内的5000上限。公共隔离帮助器原有失败live-failure.png显式截图仍存在，没有把自动截图关闭误认为零截图。

## 剪贴板范围

原positionMonacoCaret会在每次定位前/后完整读取并比较系统剪贴板所有可读格式及纯文本，零写入，不使用粘贴fallback或恢复覆盖。两例各定位1次，共4个采集阶段；若完整走完至少8次clipboard.read/readText调用，另有所有类型的getType物化。输入失败也可能进入finally读取。

原两项覆盖许可已耗尽，不是本轮许可。上述计数只说明后续实际读取范围，不授权执行；Root另行决定窗口、实例/端口、输入来源及剪贴板读取范围。本员工未运行任何用例体或剪贴板API。

## 复用诊断及限制

只在真实prepare/completion原失败时登记上下文，原错误原样抛回。afterEach复用710的attachMonacoCaretDiagnostic，使用已完成duration、固定白名单、原共享500ms及实际JSON/path附件，不新增框架、采样轮询或任务，不输出SQL/账号/路径。成功和未启用时零诊断IO。

live-helpers会在测试体返回前先退出应用并清库；因此afterEach诊断可能只能返回page-unavailable和model/main unknown。不会伪造模型长度或把该JSON当失败当刻现场；文件历史名称仍为offline-completion-cold-0-diagnostic.json，实际是否实库以本CALL用例目录为准。没有为采样延迟退出或给运行中duration填0。清理及诊断错误沿现有帮助器边界，不将其冒充CALL根因。

## 本轮验证与后续交接

四种门00/01/10/11分别执行--list，均退出0并准确列出2定义。额外列表加载守卫拒绝desktop/live/caret模块、私有文件/网络/原生进程，四次未触发；类型检查退出0。未重复纯测试、产品构建或任何实际UI。

本轮命令：

node --require ./.cache/q01-call-e2e/list-guard.cjs node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-call-routines.spec.ts --list --reporter=list
node --require ./.cache/q01-call-routines/guard-compiler.cjs node_modules/typescript/bin/tsc --noEmit

仅供Root之后另行授权并固定构建来源后执行（本轮未执行）：

pnpm exec playwright test tests/e2e/sql-completion-call-routines.spec.ts --workers=1 --retries=0 --trace=off

Root在对应固定产品源码/产物上加载新增定义。DBARK_EXECUTABLE_PATH未设时原fixture启动当前工程dist；设定时加载指定安装产物，不混计来源。两例在六组合理论12次，必须逐次以Root actual记录为准，不填通过率。证据与清单在本克隆.cache/q01-call-e2e。
