# 文件首次模型独立原生验收准备

Root后续已在新f27产品构建完成Windows源码四例，原run1918失败及各作者准备时的范围仍保留；本CI接线已只读兼容该准确原报告，尚未取得三平台CI／安装终态。当前分层状态见[Root实际记录](../../tests/integration/acceptance-query-file-first-model-root-20261019.md)。

Root独审补充发现失败分支尚未关闭已持有文件句柄；真实执行前已补finally，仅关闭自有FD，不重新核路径、不读文件、不退出未知owner或删除目录。原断言、附录失败及关闭失败全部保留，四种错误组合回放真实catch/finally验证；原无阻断审查结论须连同此补充读取，不能绕过该修正实跑。

本准备固定从产品切片`300fae79047107dc2d27c69ac4e8aae0fdde6403`开始，只新增测试。未构建、未启动GUI、未运行Playwright（包括list）、未连接端口/数据库、未执行CI、未安装依赖或推送。Root须在独审整合产品、新构建和完整封存后另行授权真实执行。门的合成RAM输入不是批准，默认关闭用例数也不是通过数。

独立声明文件为`tests/e2e/query-file-first-model-native.spec.ts`。它登记均匀LF/CRLF乘格式化按钮/快捷键共4个独立case。每个原TestInfo分别领取自己的私有目录、文件原写句柄身份、Main来源引用、OpenDialog nonce和两次应用启动。默认/list不加载live/runtime。执行需`DBARK_FILE_FIRST_MODEL_NATIVE_TEST=1`、`DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED=1`、`DBARK_INTEGRATION_ENABLED=0`及Root未来的绝对`DBARK_FILE_FIRST_MODEL_MANIFEST`与原`DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256`；拒绝旧门、认证、外部入口、预加载、别名和录制。Windows/macOS入口遵循原runtime的真实完整树身份校验。

两套完整SQL原文和格式化期望在helper中逐字手写，文件以UTF-8无BOM写入原run私有目录；不从formatter、模型结果或实际store制造答案。只通过正式文件对话框选该路径一次。任何编辑前，完整文件字节、Main raw正文、真实模型全文和`getEOL()`必须精确匹配；同时核真实来源、保存摘要及clean。四例须分别通过，不能把仅符合平台默认EOL的两例当成全部。只要求版本为有效正整数，不要求无关的版本字面值1。

随后以真实键盘在首位置输入普通字符x，真实一次Undo返回原文/clean；再首次使用本例格式化按钮或快捷键，检查完整手写golden、同editor/model和dirty；一次Undo回原文/clean，再Redo和Undo。以原生公开getter和被动内容事件核对严格递增版本、Undo/Redo标志、原EOL、完整正文和单次事件，Undo恢复原选区与alternativeVersion；Redo恢复先前实际格式化后的选区。不会按alternativeVersion相同跳过原生版本。事件溢出必须拒绝。

每个检查点分别读取Main settings、来源状态、连接概要、任务、SQL历史和查询库，并以原创建身份核读完整磁盘字节。除当前SQL正文外，完整上下文、来源revision/摘要和唯一completed的文件open任务保持；历史和查询库为空。原文件dev/ino、大小、摘要和完整字节保持。最终clean后调用原正常退出，不安装dirty提示应答器；若出现不应有的dirty提示，原15秒退出门失败并保留。原SQLite9完整tabs/active与独立应用重启后的raw/clean均须匹配，再正常退出并通过原PID/限定目录门。原runtime的37个await、52处guard、120秒用例和零重试保持，未新增退出/清理框架。

所有实际UI、SDK和Main RPC分别经过原`run.step`；自带父门的launch/close/stopped/finish继续沿原生命周期，避免嵌套busy。renderer evaluate每个最多一条Main RPC。失败只附父端已经取得的内存记录，不在catch/finally补读SDK、窗口、文件、PID或SQLite，不自动重试、强停、清理或回答未知提示。附件失败与原失败一并保留。

窄RAM只执行声明、独立门、golden/过渡断言、实际getter观察函数和原失败/晚回编排；原生、文件和SDK边界均为明确RAM端口。真实EOL-only与混合行尾防护仍保留原RAM，不冒称本4例覆盖。旧R1900源码、期待、原件和既有证据完全保持；这4例是新产品行为的待执行准备，不追认旧结果。

## 持续三平台源码与实际安装CI接线准备

新增`scripts/native-file-first-model-ci.mjs`只消费同job原`readApproval`、`ciContext`和indent清单，复核完整运行树，不build、不下载SDK、不改写或重签批准。原源码缩进/分栏producer成功输出批准后，工作流用独立step运行四例；实际安装由原`test-packaged.mjs`在原两专项成功后、legacy及清理之前调用。未启用原安装CI开关的独立调用保持原行为。

CLI只选择`query-file-first-model-native.spec.ts`，原JSON的四例则须来自正式`query-file-first-model-native-live.ts`（testDir短路径或精确仓库相对路径），不接受其他绝对同名路径、错spec、额外/重复标题或caseKey。四例必须各一次、零skip/retry/errors，并有完整`文件首次模型原生终态`：每例两个正常owner、SQLite9、目录移除、原文件身份与八个见证、普通编辑/格式化单次Undo，以及零剪贴板/SQL/查询库写入和未安装dirty应答。原四例行为断言不改。

报告与日志分别写入`test-results/native-file-first-model-ci/source`及`installed`；receipt绑定阶段、选择spec、正式live文件、四个case、原报告SHA、原批准SHA、原manifest和同job上下文。与`native-editor-ci`及`legacy-source/legacy-installed`隔离，原always上传涵盖新目录。非零/未知退出先于绿色JSON拒绝；任何新四例失败、终态未知或后续legacy失败，都不卸载、分离或删除安装根，不重试、强停或覆盖首个失败。

子进程只继承桌面所需环境，固定新双门、integration=0及原清单；安装入口仅从该原installed清单读取。认证、外部入口、录制、访问器及别名拒绝，其他CI控制不继承给专项。默认/list在读取批准或启动资源前拒绝。本接线及RAM报告不是四例真实通过；原run1918的格式化Redo选区失败和旧R9记录保留，须等产品修复、Root独审及新构建后另做真实三平台源码/实际安装验收。
