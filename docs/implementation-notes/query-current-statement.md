# Q02：执行光标所在当前语句

本任务从冻结基线 `80b65746242190b9ca3ea22fdb2677c0a8046d0d` 的普通克隆专用分支开展。包含已独立复审的范围解析，以及按 ROOT 已批准契约完成的引擎、历史和真实 QueryTab 接线。没有修改 0.18 冻结工作区、发行物或运行器；保留原选区/全部/解释及 Ctrl/Cmd+Enter 行为。

## 已完成的解析部分

`SqlScriptScanner.pushRanges` 与原有 `push` 使用同一个词法消费过程，不另写分号切分器。范围按原文 UTF-16 代码单元计量，保留 SQL 正文起止、自定义分隔符起止和分隔符文本；正文只是源文本的连续首尾 trim 切片。不会用 `indexOf` 反查重复 SQL，也不通过重新拼接正文推算位置。

原有 `push` 保持文字结果与错误语义；范围入口在未知模式的所有候选中还要求精确偏移一致。流式消费、逐条 `maxStatements` 消费及边界后的真实模式更新均保持绝对偏移。DELIMITER 行不发送给服务器，过程体内部的分号不会被拆成独立片段。

`sqlStatementRanges` 和 `currentSqlStatement` 只接受调用方提供的实际会话模式，绝不执行或预演源脚本中前面的 SET、CALL 或其它语句。未知转义或 ANSI_QUOTES 时只接受所有可能模式下完全一致的边界；无法确定时明确拒绝。全源受现有 20 MiB 模板上限约束。

当前边界规则采用保守行为：SQL/附属注释正文和其终止分隔符内属于该语句；紧邻下一条 SQL 的共同边界属于下一句；分隔符后立即换行或文档末尾的光标归刚结束的语句。独立空白、只有注释的区段和 DELIMITER 控制行不跨区寻找其它 SQL，不回退执行全文。无终止分隔符的完整末句可执行。全源有未闭合引号/块注释时，本次整体拒绝，不执行前面的语句。CRLF 内部及 Unicode 代理对内部的非法光标偏移也拒绝。

纯测试覆盖原文范围、重复 SQL、CRLF、非 BMP 字符、引号/注释、可执行版本注释、自定义 DELIMITER 和过程体、空白/边界、无效输入、未知模式及单条消费模式更新。另通过安装版本 Monaco 的真实文本缓冲和模型原型检查 `getValue`、`getPositionAt`、`getOffsetAt`、`validateRange` 和 `getValueInRange` 往返；这不是 GUI 验收。

## 已批准并实现的最小契约

没有新增执行命令。现有 `query.execute` 增加可选 `currentStatement: { offset: number }`。`sql` 对此分支为点击时捕获的 Monaco 完整正文，`offset` 为同一模型的真实光标偏移。校验要求整数且处于正文范围内，嵌套对象严格拒绝未知字段；未带此字段时保持原选区/全部执行行为。其它查询命令不能带入此标记。

引擎在原 `withSession` 互斥及 `runTask` 生命周期内读取 `sqlMode(managed, task)`，只使用初始握手与后续协议包已有缓存；没有新增模式 SELECT。当前语句分支进入原调度器后直接 yield 已定位的完整片段一次，随后仍用原查询预算、结果流、任务编号、取消、事务状态和错误语义。过程体片段不再交默认分号扫描器，也不为了 DELIMITER 拼出新的用户 SQL。

`TaskEvent` 增加可选 `executionSql: string`，只在驱动已接收当前片段处报告一次实际 SQL。主进程为该分支建立空 SQL 的待定历史，并用独立 `executionSqlReceived` 布尔值记录是否已取得片段；只在取得实际片段后按原成功/失败路径落盘。定位拒绝、发送前取消和驱动同步拒绝投递时，没有全文或空 SQL 历史。已经发出后失败或取消仍保存真实片段；后续重复事件不能改写该片段。普通查询历史保持原路径。结果中的 `statement` 同样只使用真正发出的片段，沿用原有文本和结果预算。

QueryTab 新入口捕获真实 editor/model、模型版本、全源、UTF-16 光标、标签身份及连接修订；监听模型内容/模型切换/光标/销毁以及 workspace 上下文，使意图永久失效，撤销、切回标签或换回同一个模型也不能复活。编辑器实例被替换时立即撤销，即使旧实例尚未销毁也不能继续投递。workspace 草稿变化还防御 React 尚未把外部新正文送入 Monaco 的窗口。异步建连后绑定原会话，配置持久化后以及最终 invoke 前重新核对模型、版本、连接修订、会话、取消、模态和标签存在状态；失效时不发送用户 SQL。所有路径释放监听器。连接中断沿原错误处理，不自动重放。

新增独立“执行当前语句”按钮及 Ctrl/Cmd+Shift+Enter 动作。原 Ctrl/Cmd+Enter 和选区/全部/解释保持不变，新动作通过最新回调引用调用相同入口；没有当前执行回调的只读编辑器不注册新动作。按钮和快捷键均使用相同的忙碌与模态守卫。完整源草稿不修改；历史和结果只显示实际发送的 SQL。

## 验证范围与剩余验收

执行纯测试、类型检查和本普通克隆内构建；额外缓存差分脚本将固定 ROOT80 扫描器和当前扫描器分别编译到独立纯环境，对已知/未知模式及多种跨块方式比较实际文字结果和错误。未启动 GUI、未连接 200、未读取真实 env/key、未访问剪贴板、未执行 Docker 或手动 CI。

真实 UI 用例 5 项仅做列表检查，预期状态全部 skipped、实际执行 0。必须同时设置 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_Q02_CURRENT_STATEMENT_UI=1`，并限定 ROOT 已核对的 200/13384，才可由 ROOT 安排原生独占验收。私网帮助器只在获双门授权的用例体中动态导入，默认列表不读取真实 env/key。用例只用公开键盘定位，不使用模型写入或剪贴板；trace、截图和视频均关闭。列表通过不代表 GUI 或数据库验收通过。

第一阶段实测结果：新增范围解析 61 项、真实 Monaco 文本模型 5 项；连同原扫描器、调度器、结果流、参数与会话模式回归，8 个文件共 212 项全部通过。固定 ROOT80 对照差分 4,515 组无差异，另核对了 3,903 个原文范围。`tsc --noEmit` 通过，构建通过（32.20 秒）。初次范围测试有一个手算偏移期望少算了 CRLF 的一个代码单元，修正测试期望后通过；初始报告保留在本克隆忽略的缓存目录。

最终接线验证：20 个相关文件共 367 项全部通过，其中本切片新增 136 项。覆盖严格协议、实际引擎片段/过程体投递、模式缓存、发送前后取消、断线与同步投递失败、实际主进程历史函数、QueryTab 异步建连/落盘时序、编辑/撤销/模型及编辑器替换、光标和连接上下文失效、真实按钮/动作注册、原查询旁路及任务隐私。真实 Monaco 文本模型测试同时核对了生产意图对象捕获的正文和偏移。类型检查通过，最终构建通过（30.14 秒）。这些纯端口测试不等同原生键盘或真实数据库验收。

ROOT 仍需验收：真实按钮和新旧快捷键，UTF-16/CRLF 光标与源草稿保持；DELIMITER 过程体仅整体发送；实际会话模式与未知模式拒绝；ROW_COUNT/LAST_INSERT_ID、临时表及事务不被附加 SQL 干扰；真实错误、取消和断线后的片段历史及不重放。异步时序守卫还需在原生环境观察，不能据纯测试宣称已经实测通过。

实际命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/current-statement.test.ts tests/unit/current-statement-model.test.ts tests/unit/engine-sql.test.ts tests/unit/engine-runtime.test.ts tests/unit/engine-query-stream.test.ts tests/unit/query-parameters.test.ts tests/unit/session-state.test.ts tests/unit/completion-session.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```
