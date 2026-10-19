# 文件首次模型独立原生验收准备

本准备固定从产品切片`300fae79047107dc2d27c69ac4e8aae0fdde6403`开始，只新增测试。未构建、未启动GUI、未运行Playwright（包括list）、未连接端口/数据库、未执行CI、未安装依赖或推送。Root须在独审整合产品、新构建和完整封存后另行授权真实执行。门的合成RAM输入不是批准，默认关闭用例数也不是通过数。

独立声明文件为`tests/e2e/query-file-first-model-native.spec.ts`。它登记均匀LF/CRLF乘格式化按钮/快捷键共4个独立case。每个原TestInfo分别领取自己的私有目录、文件原写句柄身份、Main来源引用、OpenDialog nonce和两次应用启动。默认/list不加载live/runtime。执行需`DBARK_FILE_FIRST_MODEL_NATIVE_TEST=1`、`DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED=1`、`DBARK_INTEGRATION_ENABLED=0`及Root未来的绝对`DBARK_FILE_FIRST_MODEL_MANIFEST`与原`DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256`；拒绝旧门、认证、外部入口、预加载、别名和录制。Windows/macOS入口遵循原runtime的真实完整树身份校验。

两套完整SQL原文和格式化期望在helper中逐字手写，文件以UTF-8无BOM写入原run私有目录；不从formatter、模型结果或实际store制造答案。只通过正式文件对话框选该路径一次。任何编辑前，完整文件字节、Main raw正文、真实模型全文和`getEOL()`必须精确匹配；同时核真实来源、保存摘要及clean。四例须分别通过，不能把仅符合平台默认EOL的两例当成全部。只要求版本为有效正整数，不要求无关的版本字面值1。

随后以真实键盘在首位置输入普通字符x，真实一次Undo返回原文/clean；再首次使用本例格式化按钮或快捷键，检查完整手写golden、同editor/model和dirty；一次Undo回原文/clean，再Redo和Undo。以原生公开getter和被动内容事件核对严格递增版本、Undo/Redo标志、原EOL、完整正文和单次事件，Undo恢复原选区与alternativeVersion；Redo恢复先前实际格式化后的选区。不会按alternativeVersion相同跳过原生版本。事件溢出必须拒绝。

每个检查点分别读取Main settings、来源状态、连接概要、任务、SQL历史和查询库，并以原创建身份核读完整磁盘字节。除当前SQL正文外，完整上下文、来源revision/摘要和唯一completed的文件open任务保持；历史和查询库为空。原文件dev/ino、大小、摘要和完整字节保持。最终clean后调用原正常退出，不安装dirty提示应答器；若出现不应有的dirty提示，原15秒退出门失败并保留。原SQLite9完整tabs/active与独立应用重启后的raw/clean均须匹配，再正常退出并通过原PID/限定目录门。原runtime的37个await、52处guard、120秒用例和零重试保持，未新增退出/清理框架。

所有实际UI、SDK和Main RPC分别经过原`run.step`；自带父门的launch/close/stopped/finish继续沿原生命周期，避免嵌套busy。renderer evaluate每个最多一条Main RPC。失败只附父端已经取得的内存记录，不在catch/finally补读SDK、窗口、文件、PID或SQLite，不自动重试、强停、清理或回答未知提示。附件失败与原失败一并保留。

窄RAM只执行声明、独立门、golden/过渡断言、实际getter观察函数和原失败/晚回编排；原生、文件和SDK边界均为明确RAM端口。真实EOL-only与混合行尾防护仍保留原RAM，不冒称本4例覆盖。旧R1900源码、期待、原件和既有证据完全保持；这4例是新产品行为的待执行准备，不追认旧结果。
