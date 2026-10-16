# Q01 CALL两项真实E2E准备（2026-10-17）

状态：定义、四组合列表、窄产物边界及fixture活导出纯验证、类型检查完成；本修复员工实际GUI/200/数据库/系统剪贴板读取/手动CI均为0。ROOT已实际执行run1091，结果1通过/1失败，不能计作整批通过，详见末节。初版94083d96d98a0c2a5006ae7d74f4dd8c6bc5fc02以已冻结9298b3add79e0a3a09abd23ab2174c68f354fbfd为父，仅新增两文件；后续边界修复从94083独立分支，增加仅CALL显式启用的输入断言/失败截图选项，默认路径保留。产品源码、作者克隆与Root冻结树不改，不rebase旧提交。

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

每例固定150000ms，retries=0；trace、自动截图、video关闭。不新增timeout覆写、延时、输入fallback或重试。沿用positionMonacoCaret的原生focus/全选/删除/insertText、原5秒全文准备断言、真实Ctrl+Space同步只读光标证明及原共享13秒补全余量；Enter和撤销均为真实键盘，全文核对只用原余量内的5000上限。公共隔离帮助器默认仍保留失败live-failure.png；本CALL用例现显式关闭这一已确认含SQL正文的截图分支，没有代理截图API。

## 剪贴板范围

原positionMonacoCaret会在每次定位前/后完整读取并比较系统剪贴板所有可读格式及纯文本，零写入，不使用粘贴fallback或恢复覆盖。两例各定位1次，共4个采集阶段；若完整走完至少8次clipboard.read/readText调用，另有所有类型的getType物化。输入失败也可能进入finally读取。

原两项覆盖许可已耗尽，不是本轮许可。上述计数只说明后续实际读取范围，不授权执行；Root另行决定窗口、实例/端口、输入来源及剪贴板读取范围。本员工未运行任何用例体或剪贴板API。

## 复用诊断及限制

只在真实prepare/completion失败时登记上下文，保留原异常传播；仅以下已证实会输出SQL的匹配器改为布尔结果和固定分类，没有全局吞异常。afterEach复用710的attachMonacoCaretDiagnostic，使用已完成duration、固定白名单、原共享500ms及实际JSON/path附件，不新增框架、采样轮询或任务。该专用JSON只带计数/布尔/枚举，不带SQL/账号/路径；这不等于所有Playwright原始产物都满足同一白名单。成功和未启用时零诊断IO。

live-helpers会在测试体返回前先退出应用并清库；因此afterEach诊断可能只能返回page-unavailable和model/main unknown。不会伪造模型长度或把该JSON当失败当刻现场；文件历史名称仍为offline-completion-cold-0-diagnostic.json，实际是否实库以本CALL用例目录为准。没有为采样延迟退出或给运行中duration填0。清理及诊断错误沿现有帮助器边界，不将其冒充CALL根因。

## 本轮验证与后续交接

四种门00/01/10/11分别执行--list，均退出0并准确列出2定义。额外列表加载守卫拒绝desktop/live/caret模块、私有文件/网络/原生进程，四次未触发；类型检查退出0。未重复纯测试、产品构建或任何实际UI。

本轮命令：

node --require ./.cache/q01-call-e2e/list-guard.cjs node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-call-routines.spec.ts --list --reporter=list
node --require ./.cache/q01-call-routines/guard-compiler.cjs node_modules/typescript/bin/tsc --noEmit

仅供Root之后另行授权并固定构建来源后执行（本轮未执行）：

pnpm exec playwright test tests/e2e/sql-completion-call-routines.spec.ts --workers=1 --retries=0 --trace=off

Root在对应固定产品源码/产物上加载新增定义。DBARK_EXECUTABLE_PATH未设时原fixture启动当前工程dist；设定时加载指定安装产物，不混计来源。两例在六组合理论12次，必须逐次以Root actual记录为准，不填通过率。证据与清单在本克隆.cache/q01-call-e2e。

## 94083之后的窄失败产物修复

员工1纯对抗证实：原savedSql及准备帮助器的`toBe(source)`失败消息会带期望/实际SQL；公共live-failure.png可保留编辑器中的参数。即便本例参数1/7为合成，仍按本轮窄产物约束修复。新改动只在测试层，不要求重建已冻结5ab产品。

- `positionMonacoCaret`新增可选`redactSqlAssertion`，仅本CALL显式true：完整正文仍在页面内与独立source精确比较，匹配器只接收布尔和固定中文分类；未传选项时保留原全文断言块及预算。原原生输入、光标移动、剪贴板完整只读比较、finally及异常传播不变。
- CALL的savedSql同样返回完整正文比较布尔，仍使用原`remainingCompletionTimeout(5000)`；不清空、不替换或补填实际SQL。
- 接受和撤销后的标记行、tasks、history完整快照通过Node内存严格深比较后，仅断言布尔；没有去掉字段、只比长度或省略任务/历史内容，意外自动执行产生的SQL不再进入这两处matcher差值。
- `isolatedDatabase`新增可选`captureFailureScreenshot`；默认或true保持原截图行为，仅本CALL显式false跳过公共失败图片。原异常仍抛回，退出应用、精确DROP本例库、observer.end及fixture进程/临时目录清理不变。没有代理或篡改page.screenshot。

窄纯验证只运行57项／2文件，0失败/跳过：原输入/剪贴板RAM回放连同新增3项共48项，另9项原声明纯对抗覆盖真实Playwright全文matcher、完整快照深比较、截图默认/true/false和原异常及精确清理。未重跑571项。四门组合list均准确列出2项、150秒/0重试且零live模块/私网文件/网络/子进程，类型检查退出0。所有系统剪贴板、GUI、200和实际用例体执行仍为0。原default helper与其它E2E用例没有启用新选项。

本修复只覆盖上述已证实的matcher和公共图片分支。未修改Playwright自动error-context、runner代码框、未捕获底层API异常、页面错误、外部CLI覆写trace或人工取证路径；这些仍可能包含正文，不能宣称“所有产物绝无SQL”。原始错误不做全局脱敏吞并，后续如要求整条runner产物白名单，ROOT须另定范围并审查；本次不借此扩展框架或权限。专用afterEach诊断schema和500ms预算保持原字节。

固定纯验证、类型、四组合list及默认路径核对原件位于员工1克隆忽略目录`.cache/call-e2e-boundary-fix-20261017`，只提交必要测试和本说明，不提交合成错误全文、实际参数或剪贴板内容。

## run1091旧page引用定位与最小测试修复

ROOT在冻结5ab产品、97a0ed085512c42e62d0e487644e9e3e873dd274测试头上实际执行两例：当前库例1通过，显式限定库例1失败，0retry，测试子进程退出1。原summary保持notAccepted，候选已卸载，ROOT前后1249源文件、12控制和11依赖核对保持、Native为0，run1101六实例资源为0。以上是ROOT已有实际记录，不是本修复重跑结果；1090源码及1091控制/输出均不修改，下一次真实复验必须新run由ROOT一次执行。

已有error-context只在内存中分类并提取行号，没有输出正文或认证。其指示97a源码第69行的profile核对，错误属于page-closed；该行位于补全try第75行之前，因而没有登记pending，也没有Monaco附件。该位置已经越过前面的CREATE PROCEDURE await，不应据先前猜测改过程名、参数、期望或SQL夹具。

原Playwright 1.64编译保留`await import('./desktop-fixture')`。该模块在当前CommonJS路径导出可变page、desktop和pageErrors；首例结束主动关闭应用，第二例自动fixture替换导出，而原生动态import的缓存命名空间仍持有首例page快照。caret内部命名导入经CommonJS编译后读取require对象的当前属性，所以它可以完成第二例前置准备；随后CALL测试自身却用旧namespace.page核profile而失败。

最小修复只把verifyCall内desktop入口改为同步require已注册fixture的live导出对象，并加中文注释。caret/live的稳定函数导入、双门、list先短路、原生输入/Enter/undo、过程名与参数、全部断言、150秒/0retry及5秒/13秒/500ms预算保持；无产品源码变更，也不增加重试、fallback或运行中诊断。

新增仅2项真实Node/Playwright编译回放：使用正式babelTransform，当前入口直接从正式verifyCall声明提取；RAM fixture只模拟导出替换与旧page关闭，真实Node子进程完成CommonJS与动态import互操作。旧入口反例中首代成功、次代旧page关闭，require仍能读取新代；修复入口两代均成功，page/desktop/pageErrors均为新代。它不是实际Electron/数据库复验，不复制完整应用逻辑，也未执行真实E2E主体。

本轮只运行上述2项、类型检查及四门list，全部通过；四门各列2身份且零live模块、私网文件、网络或原生子进程。未重跑57/571/5073，未实际GUI、200或系统剪贴板。纯回放临时目录只清理本例mkdtemp路径，删除前核对真实绝对父目录和前缀。验证原件在员工1克隆`.cache/call-fixture-live-fix-20261017`。静态检索另见page-find-replace-live.spec.ts:50同类desktop动态导入，仅报路径，不包含在本修复。
