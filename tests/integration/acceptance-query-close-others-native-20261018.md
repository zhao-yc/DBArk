# 关闭其他查询：正式离线原生E2E准备

本片仅新增默认关闭的正式spec、准备门静态测试和本说明，基线 `7142cb0c2a6a9b56f37523d8efc671b1310067e1`。不修改App、QueryTab、queue或共享desktop-fixture。Root应先整合经独审的产品修复，再在准确候选执行；不能因基线已知的弹窗推进错误跳过断言。

## 执行边界

- 员工4仅写文件、列出用例和执行定向静态门，不实际运行本spec、不启动GUI、数据库或网络、不读认证材料、不运行full/build。
- Root执行前先核本机 `127.0.0.1:1` 无监听；仅从真实连接表单新建该离线地址，用户offline，空密码、不保存密码、空默认库。不点测试连接。新查询表单的真实拒连必须出现，不伪造连接成功或会话状态。
- 显式设置 `DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST=1` 与 `DBARK_INTEGRATION_ENABLED=0`。拒绝继承实库、SSH、TLS或认证参数；`Object.hasOwn(env, 'DBARK_DEV_URL')` 成立即拒绝，空值或undefined也不得让离线App加载其它renderer。正式runner的 `DBARK_C02_EXECUTABLE_PATH` 仅在与 `DBARK_EXECUTABLE_PATH` 精确同值时允许。
- trace、screenshot、video全部off，CLI启用trace会在加载桌面前拒绝。列表和默认关闭不加载desktop-fixture，不导入live-helper或Clipboard。
- 两例串行、重试0；各自新建strict owner。首例失败即跳过后续例，停链保留当前资源，不重启旧owner、不强停、不在finally尝试未知清理。每例成功须正常退出、所属PID确认不存在，再由原夹具清理；afterAll再核配置目录不存在。

供Root执行的命令（本片不执行）：

```powershell
$env:DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST = '1'
$env:DBARK_INTEGRATION_ENABLED = '0'
node node_modules/@playwright/test/cli.js test tests/e2e/query-close-others-native.spec.ts --workers=1 --retries=0 --trace=off
```

准确EXE路径、端口核对、固定源码/产物身份及实际命令由Root在单次运行记录中填写；本片不更新runner或工作流，不预报三平台通过。

## 两个验收身份

每例均通过真实新查询表单、保存弹窗、键盘正文、两次“复制为新查询”建立A/B/C。A有保存来源且草稿已修改，B/C无来源且全文不同，当前C为保留目标。所有身份比较使用实际持久化tab ID和原始SQL；键盘首次输入仅按平台EOL规范化核文本，后续快照比较精确原字符串。

1. C保留，关闭其他先在A取消：A/B/C全文和来源记录全部保持。再发起，A直接关闭后必须真实出现B的关闭弹窗；B取消后仅剩B/C且与原快照完全一致，A不会复活，保存来源不变。
2. 仅一次合法本地 `queries.updateSource` 模拟另一编辑者更新A来源；不写store或当前tab绑定。A旧绑定尝试“保存到原查询”必须触发实际CAS冲突，原保存弹窗保留错误、名称和可用的“另存为新查询”。在该旧弹窗另存成功可以关闭A，但批次不恢复，B不出现关闭弹窗，B/C全文及来源状态保持，另一编辑者更新后的原记录逐字段不变，另存记录精确保存A原草稿。只读MutationObserver同时读取当前DOM与MutationRecord.addedNodes及子树，停止前收集takeRecords，补充同批插入后移除但原节点仍保留内容的弹窗见证。本轮窗口owner、testId/重试号、捕获的唯一A/B/C标题与tab ID绑定记录；DOM本身只提供dialog标签和可见标题，tab ID映射来自本例捕获值。未知同名dialog记录为未归属并使断言失败。观察器不修改DOM、业务函数或回调。后续真实B/C切换、两项tab数量及全文快照再核保持。

两例均通过只读 `history.list` 核SQL执行记录0，正常退出后出具终态附件。只读允许 `settings.get` 和 `queries.list`；唯一写IPC是第二例明确标注的本地CAS。未使用setValue、store写入、内部handler、queue推进、剪贴板或伪造document无modal。DOM等待均依赖真实可见/隐藏及持久化轮询，不使用定时器重试推进。

## 当前证据与尚待验收

本文件是准备说明，不能作为原生通过记录。不同tab ID仅证明前端草稿归属，不证明实库会话、事务或临时表隔离。员工4另一个独审clone的原7142报告与1468150窄复核保持独立封存，不能混入本spec验收。

员工4实际仅运行定向静态门（5项通过）和Playwright `--list`（列出2项）。守卫拒绝实际桌面及业务子进程、网络、认证材料读取和密钥生成，仅放行测试编译工具链。原生两例尚未执行，结果由Root在准确修后产品及产物上补录。

## 原生准备门追加窄修

原 `87b182d`、原静态5项报告与员工3独审材料保持不变。员工4先在原spec上运行两条新增RAM反例，分别复现显式DEV_URL未拒绝及同批插入/移除B漏记，均为原红。追加仅修改测试spec和说明，另增独立RAM契约测试，不改产品。

MutationRecord保存的是节点引用，不能恢复回调前已被清空或改写的历史全文，因此seen/matches不是完整DOM历史或单独的“B从未进入”证明。第二条仅是观察器合同反例，未证明真实GUI自然可达；原生验收仍须结合真实弹窗可见/隐藏、准确目标、保存冲突、B/C完整快照及后续界面切换。静态RAM与列表通过不等于Root固定安装的实际执行。

本次窄修后新增RAM契约6项通过；原静态门代码不改、另开新报告复核5项通过；Playwright列表仍为2项。原两红报告及旧5项报告保留，不追改历史运行。未运行实际E2E、GUI、数据库、网络或full/build。
