# Q02：执行光标所在当前语句

本任务从冻结基线 `80b65746242190b9ca3ea22fdb2677c0a8046d0d` 的普通克隆专用分支开展。第一阶段只实现独立范围解析和纯回归；执行契约待 ROOT 确认后再接引擎、主进程历史和真实 QueryTab。没有修改 0.18 冻结工作区、发行物、运行器或现有快捷键。

## 已完成的解析部分

`SqlScriptScanner.pushRanges` 与原有 `push` 使用同一个词法消费过程，不另写分号切分器。范围按原文 UTF-16 代码单元计量，保留 SQL 正文起止、自定义分隔符起止和分隔符文本；正文只是源文本的连续首尾 trim 切片。不会用 `indexOf` 反查重复 SQL，也不通过重新拼接正文推算位置。

原有 `push` 保持文字结果与错误语义；范围入口在未知模式的所有候选中还要求精确偏移一致。流式消费、逐条 `maxStatements` 消费及边界后的真实模式更新均保持绝对偏移。DELIMITER 行不发送给服务器，过程体内部的分号不会被拆成独立片段。

`sqlStatementRanges` 和 `currentSqlStatement` 只接受调用方提供的实际会话模式，绝不执行或预演源脚本中前面的 SET、CALL 或其它语句。未知转义或 ANSI_QUOTES 时只接受所有可能模式下完全一致的边界；无法确定时明确拒绝。全源受现有 20 MiB 模板上限约束。

当前边界规则采用保守行为：SQL/附属注释正文和其终止分隔符内属于该语句；紧邻下一条 SQL 的共同边界属于下一句；分隔符后立即换行或文档末尾的光标归刚结束的语句。独立空白、只有注释的区段和 DELIMITER 控制行不跨区寻找其它 SQL，不回退执行全文。无终止分隔符的完整末句可执行。全源有未闭合引号/块注释时，本次整体拒绝，不执行前面的语句。CRLF 内部及 Unicode 代理对内部的非法光标偏移也拒绝。

纯测试覆盖原文范围、重复 SQL、CRLF、非 BMP 字符、引号/注释、可执行版本注释、自定义 DELIMITER 和过程体、空白/边界、无效输入、未知模式及单条消费模式更新。另通过安装版本 Monaco 的真实文本缓冲和模型原型检查 `getValue`、`getPositionAt`、`getOffsetAt`、`validateRange` 和 `getValueInRange` 往返；这不是 GUI 验收。

## 待 ROOT 确认的最小契约

建议不新增执行命令，仅给现有 `query.execute` 增加可选 `currentStatement: { offset: number }`。`sql` 对此分支为点击时捕获的 Monaco 完整正文，`offset` 为同一模型的真实光标偏移。校验要求整数且处于正文范围内，嵌套对象严格拒绝未知字段；未带此字段时保持原选区/全部执行行为。

引擎必须在原 `withSession` 互斥及 `runTask` 生命周期内读取 `sqlMode(managed, task)`，只使用初始握手与后续协议包已有缓存；该方法目前不会额外发 SELECT。当前语句分支进入原调度器后直接 yield 已定位的完整片段一次，随后仍用原查询预算、结果流、任务编号、取消、事务状态和错误语义。不能把过程体片段再交默认分号扫描器，否则其内部语句会被误拆；也不能为了 DELIMITER 拼出新的用户 SQL。

建议给 `TaskEvent` 增加可选 `executionSql: string`，只在当前语句真正发送处报告实际片段。主进程为该分支建立空 SQL 的待定历史，取得实际片段后才按原成功/失败路径落盘；定位失败或发送前取消时没有全文历史。普通查询历史保持原路径。结果中的 `statement` 同样只使用真正发出的片段。仅从请求正文写历史会错误保存完整脚本，因此不能只改 QueryTab。

QueryTab 新入口捕获真实 editor/model、模型版本、全源、UTF-16 光标、标签身份及连接修订；监听模型内容/模型切换/销毁使意图永久失效，撤销或换回同一个模型也不能复活。异步建连、配置持久化后以及最终 invoke 前重新核对模型、版本、连接修订、会话、取消和标签存在状态；失效时不发送用户 SQL。连接中断沿原错误处理，不自动重放。

新增独立“执行当前语句”按钮及 Ctrl/Cmd+Shift+Enter 动作，原 Ctrl/Cmd+Enter 和选区/全部/解释保持不变。按钮和快捷键均使用相同的忙碌与模态守卫。完整源草稿不修改；历史和结果只显示实际发送的 SQL。

## 第一阶段验证范围

执行纯测试、类型检查和本普通克隆内构建；额外缓存差分脚本将固定 ROOT80 扫描器和当前扫描器分别编译到独立纯环境，对已知/未知模式及多种跨块方式比较实际文字结果和错误。未启动 GUI、未连接 200、未读取真实 env/key、未访问剪贴板、未执行 Docker 或手动 CI。

默认关闭的真实 UI 用例在确认契约并完成接线后补充并仅做列表检查；第一阶段没有把尚未实现的按钮测试伪报为已完成。

第一阶段实测结果：新增范围解析 61 项、真实 Monaco 文本模型 5 项；连同原扫描器、调度器、结果流、参数与会话模式回归，8 个文件共 212 项全部通过。固定 ROOT80 对照差分 4,515 组无差异，另核对了 3,903 个原文范围。`tsc --noEmit` 通过，构建通过（32.20 秒）。初次范围测试有一个手算偏移期望少算了 CRLF 的一个代码单元，修正测试期望后通过；初始报告保留在本克隆忽略的缓存目录。

实际命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/current-statement.test.ts tests/unit/current-statement-model.test.ts tests/unit/engine-sql.test.ts tests/unit/engine-runtime.test.ts tests/unit/engine-query-stream.test.ts tests/unit/query-parameters.test.ts tests/unit/session-state.test.ts tests/unit/completion-session.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```
