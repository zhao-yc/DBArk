# 批量复制新增草稿：默认关闭正式GUI验收准备

固定基底 `4e647642dfba47a1bfa8f39f23b30f7b99876bde`，员工4普通 clone、独立分支 `codex/employee4-batch-duplicate-ui-20261018`。Root继续推进不改变本片来源。初始 `224489c` 新增专用spec/live、RAM目标绑定及生命周期、两份纯测试和本文；后续按Root明确授权，在共享desktop-fixture增加仅提供准备hook的strict接缝，见下文独审窄修。不改生产、旧单行spec、旧导出lifecycle或默认退出/强停/清理逻辑，没有工作树。

## 三个正式身份

入口 `tests/e2e/table-record-duplicate-batch.spec.ts`，注册以下三例：

1. 批量复制精确值与暂存值，整批一步撤销重做且不自动写入：已有note编辑、一个旧新增草稿、逆序勾选两条原记录；按网格顺序追加两副本，保持NULL/空串、BIGINT/DECIMAL/微秒、JSON服务器原文及空/非空二进制。自增和生成列DEFAULT，保留唯一键；复制及Redo后分别核全部值，一步Undo仅撤本批，原草稿/编辑/勾选/活动格保持。
2. 勾选含新增草稿时整批拒绝且不增加历史：自然GUI勾一条有效原记录和一条新稿，点击后整批拒绝、不偷追加；Undo直接撤原新增操作，Redo仅恢复该一条。
3. 批量副本唯一键冲突先拒绝，改键后只读预览并返回编辑：整批Undo/Redo后原唯一code冲突，不出现预览；手工改两副本code后打开原集中预览，核两条变化、INSERT文字及两个新键，随后仅“返回编辑”。不点击确认应用。

所有操作走真实对象树、网格checkbox、编辑输入、批量按钮和历史/预览按钮。不调用生产处理器，不改store/rows，不伪造服务回包、源资格或计数端口，不碰剪贴板。定位沿既有单行正式入口的aria列坐标方式；原生窗口布局、列虚拟化、实际按钮定位和严格退出均尚未实跑，不能用本片纯测试宣称真实GUI通过。

## 默认关闭门与资源参数

只有显式 `DBARK_INTEGRATION_ENABLED=1` 和 **新增** `DBARK_D02_BATCH_DUPLICATE_RECORD_UI=1` 同时满足且不是 `--list`/`--list=...` 时，才加载目标helper及正式live模块。默认/列表仅登记3个skip身份，不导入owner、mysql2或live-helpers，不读.env或认证。本片不在现有原生CI自动开启此门。

实际必须由Root本轮RAM明确提供以下自有字符串，raw/helper逐值一致；观察到漂移后永久失效，恢复原值也不复活：

| 参数 | 范围 |
| --- | --- |
| DBARK_TEST_HOST / PORT / TLS | 精确 `192.168.31.200` / `13384` / `0` |
| DBARK_TEST_USER / PASSWORD | 既有账号，密码即使为空也必须显式存在；不读私有文件或创建用户 |
| DBARK_TEST_EXPECTED_SERVER_UUID | 本轮准确实例UUID；每个观察连接均实际核8.4.11/Linux/名称模式0/UUID |
| DBARK_BATCH_DUPLICATE_DATABASE / TABLE | Root分配的既有 `dbark_` 前缀ASCII隔离库、ASCII表名；不自动发现、接管或创建 |
| DBARK_BATCH_DUPLICATE_DDL_SHA256 | 原SHOW CREATE字符串UTF-8的SHA256；前后分别核对 |
| DBARK_BATCH_DUPLICATE_ROWS_SHA256 | 下述固定投影返回行数组的JSON.stringify UTF-8 SHA256，按数值原id升序；前后核对，数值/JSON字段均为字符串 |

拒绝非空默认库参数DBARK_TEST_DATABASE、SSH或CA，拒绝任何自有DBARK_DEV_URL。安装模式还必须显式绝对 `DBARK_EXECUTABLE_PATH`、`DBARK_BATCH_DUPLICATE_EXE_SHA256`、`DBARK_BATCH_DUPLICATE_ASAR_SHA256`；启动门及结算前只读核EXE与同目录resources/app.asar。源模式不能混入安装摘要，源构建/版本/测试身份由Root外层固定。0.21安装包不包含0.22新入口，不能复用为本功能安装证据。

仅一张普通InnoDB表、两条合成原记录。列名和SELECT序为：`id,code,note,big_value,amount,stamp,nullable_value,payload,doc,computed`。id自增可靠主键，code非自增唯一且源值不同、不与本例新键“本例副本唯一键0/1”相同；computed为生成列；没有INVISIBLE或缺列补取。note/code/doc宜为小文本，能在真实网格完整呈现。

固定观察投影将id/big_value/amount/computed CAST AS CHAR、stamp DATE_FORMAT至微秒、payload HEX、doc CAST AS CHAR CHARACTER SET utf8mb4，其他字段原读；按 `s.id` 数值排序，避免按输出文字别名误排。第一行big_value为 `18446744073709551615`，amount为 `12345678901234567890.120000`，stamp以 `.123456` 结尾，nullable_value为NULL、payload为00ff8000；第二行nullable_value为空串、payload为空字节。两行所有其他列也通过Root固定摘要绑定。JSON以服务器原文本为期望，不强加造数前JSON空格格式。

**没有资源时保持关闭，由Root另行安排资源准备；本用例无CREATE/DROP/GRANT/INSERT/UPDATE/DELETE路径。** 三例每次新owner/临时配置，但可复用这一只读表。成功后仍不清库，资源寿命由Root另行核归属和收尾。

## 所有权、期限和收尾

显式启用原 `preserveOnUnconfirmedExit:true` 和 `ownedDesktopLaunchGuard`。每例捕获同一TestInfo的page/application；每次UI/SQL await前后核绑定、owner及原120秒期限。使用单worker、serial、retry0；首败后后续例不运行。真实解析的trace/screenshot/video必须全off；即使CLI覆盖，也在认证表单及SQL前拒绝并保留，不能把test.use的默认配置当作实际采集状态。

新 `BatchDuplicateLifecycle` 不复用旧导出finish的“两查询一导出”条件：必须先完成定义/两行后核和观察原流严格关闭，再核真实持久任务列表为空，才调用原正常退出握手、真实close和累计所属PID不存在证明。afterEach只核既有完成事实，不新发退出/清理，不从body或helper重计120秒。观察连接在建连返回时即捕获原生connection/stream，关闭前后必须同一对象、同一原流，`closeMysqlConnection(...,true)`后stream.closed为true。

任何错误、超时、owner/配置漂移、动作仍在途或关闭未知，本地retain先落定再尽力通知共享fixture；通知失败也不解锁，不自动清理、重试或强停。Root保留原失败与所属资源再安排独立核对。本片不声称真实服务器线程/MDL终态已验。

每例显式观察SQL最小6条：独立预检身份1，正式观察身份1，前后SHOW CREATE各1，前后两行SELECT各1。三例18条/阶段，源码和安装各跑一次共36条；**不含产品建连测试、目录/表页内部SQL及Root独立线程核对**。复制/Undo/Redo合同零新增SQL；第三例的实际table.preview仍会读表元数据。当前没有GUI可观测零额外SQL端口，空tasks、原行不变或无预览模态都不能单独证明隐藏读取为零；该保证继续限定源码/RAM，不加全局日志或产品计数器。

## 224489c首片验证与保留结果

仅在envDir=false、拒绝网络/真实产品进程/私料/密钥生成的纯守卫中运行两份新测试。首轮43项为40通过、3失败：关闭门测试的`it.each`数组参数被框架展开，给VM的argv形状错误；原报告和3条失败保留。只修测试数据为具名argv对象，增加完整参数正例；关闭门7项通过。之后补充预览明确2条变化和新键断言、PromiseConnection原生端口类型，关闭门同7项再复核通过；未重跑目标/生命周期已绿37项。

最终有 **44个不同纯身份通过：目标/生命周期37、关闭门/注册7**。包含参数缺项/原型/访问器、raw/helper漂移、观察过ABA、缺TestInfo起点、原期限/时钟/owner变化、在途动作与afterEach、退出未闭合及通知抛错。关闭门只运行真实spec的VM声明，live只登记3个body，**没有执行真实Playwright、--list或任何body**。

首次TypeScript检查有4条新增验证端口类型诊断：mysql2公开PromiseConnection类型没有声明实际connection属性。只补本片实际端口的局部结构类型后，修复复核 `tsc --noEmit` 退出0；原诊断保留，不伪称只跑一次即绿。没有放宽任何生产或旧共享类型。

实际必要命令：

```powershell
node --require ./.cache/batch-duplicate-ui/outer-guard.cjs D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/batch-duplicate-ui/vitest.config.mjs --reporter=json --outputFile=.cache/batch-duplicate-ui/pure-report.json
node --require ./.cache/batch-duplicate-ui/outer-guard.cjs D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/batch-record-duplicate-gate.test.ts --config .cache/batch-duplicate-ui/vitest.config.mjs --reporter=json --outputFile=.cache/batch-duplicate-ui/gate-fixed-report.json
node --require ./.cache/batch-duplicate-ui/outer-guard.cjs D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/batch-record-duplicate-gate.test.ts --config .cache/batch-duplicate-ui/vitest.config.mjs --reporter=json --outputFile=.cache/batch-duplicate-ui/gate-final-report.json
node --require ./.cache/batch-duplicate-ui/outer-guard.cjs D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

类型命令首次原输出 `type-output.txt`、修复输出 `type-fixed-output.txt` 分开。纯守卫每次仅允许esbuild编译工具链，拒绝可选net use而不实际执行；网络、私有读取、密钥生成及产品原生模块加载均0，worker没有guard-blocks文件。未运行full/build、GUI、实库、SSH/Docker、剪贴板、安装或发布，未读取.env或实际认证。仅本地commit，不push；Root独审整合后再安排关闭态/list和实际验收。

## 原两项P2独审与窄修

员工5对固定224489c独立10项为8绿2红，原交接SHA256 `359a6c379d11c207e9e232b2a1e3e03e0e5108bef15b67be9c1dbe4429926e7e`。原代码/报告只读保留，本轮不改写或删除旧红，不重复原44或独审旧8绿。

第一项原红：自动fixture等待mkdtemp期间尚无body lifecycle；afterEach已保留且超时后，原guard只核参数/字节，晚目录仍能到达原生launch。Root补充授权新增 `ownedDesktopLaunchGuard.assertPreparation(info:TestInfo)` 可选端口。仅在显式strict并提供该hook时，原WeakMap登记后创建闭包包装，比较原TestInfo映射的同一state、active、retained，再调用新准备门及原参数/字节门；耗时字节核对后再核原墓碑和期限。该包装在目录await前、内外两层恢复后，以及原launchDesktop的原生launch前guard调用链生效；共享dataDir赋值也必须晚于外层恢复门，拒绝目录回包时不覆盖下一owner目录、不继续启动、不强停、不删除目录。

bulk使用按TestInfo键控的 `BatchDuplicatePreparation`，从原 `_startWallTime` 捕获120秒，核passed、原timeout、原起点不变及单调时钟。body开头再核同一准备门；body前afterEach或隐私门先将本地准备永久保留，再尽力通知共享fixture。包装读取共享真实内部墓碑，不接受客户端传入retained，未暴露可修改的state。

未提供新hook的旧strict仍按原时点调用原guard、原mkdtemp和原launch；default分支不改。共享正常退出、强停和清理逻辑原样保留，没有把120秒施加所有旧用例，也没有扩成新退出系统。

第二项原红：body在期限内finish/endBody后，afterEach未核时钟，跨原120秒仍返回成功。修复抽出独立 `assertDeadline`，afterEach即使active已false也核同一原起点、原timeout/status、截止时间及单调时钟；owner/close同步核对后再核一次。原期限过期、回退或起点变化永久保留，不调用要求active的整套主体门，不重计120秒或追认清理。

本轮窄复核16通过、48未选择：原A3/A5安全断言、A4/A6合法对照共4项；新增启动真实自动fixture、真实WeakMap retain/active/替换、框架仍passed但原期限到达、字节核对耗时到期、内外await间保留且不覆盖下一owner目录、无hook原两次guard调用兼容，以及body结束后的到期/回退/原起点和启动准备保留共12项。原A3适配件只给VM的真实helper依赖补 `BatchDuplicatePreparation` import/导出，原断言与调度不改；原文件、报告、适配差异与SHA均封存。A5/A6原同字节先有一次2通过检查，最终4项按当前源码另核，不累加身份。

仅运行 `vitest -t 'P2|A3|A4|A5|A6'` 的这些RAM端口和本轮一次类型检查；未执行真实Playwright、--list、Electron、GUI、端口、数据库、网络、.env或剪贴板。合法启动对照只到会立即拒绝的RAM原生端口，不称真实应用启动或退出已验。新的精确提交和type最终退出及全部原件摘要以本轮ignored `batch-duplicate-ui-fix/handoff.json` 为准，Root再交原审查者窄复核。
