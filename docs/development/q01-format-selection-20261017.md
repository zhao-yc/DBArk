# Q01：选区格式化与单次撤销

基线为 `97a0ed085512c42e62d0e487644e9e3e873dd274`，独立普通克隆及分支 `codex/employee2-q01-format-selection-20261017`。没有调整版本、ColumnPatchDialog、Root dist、run1085 或任何冻结验收控制。

原查询工具栏直接通过 Zustand 替换整篇 SQL，没有使用选区或 Monaco 撤销事务。现在沿已有编辑器引用读取当前真实模型：非空单选区只处理该范围，没有选区则处理全文；只选空白时保持原样，不退回全文。多选区、只读编辑器、弹窗、非活动标签、后台作业和未同步的外部新草稿均拒绝修改。

所有排版计算及校验在修改模型之前完成。成功时调用一次 `executeEdits('dbark-sql-format', ...)`，两侧各一个 `pushUndoStop()`，选区使用逆向编辑范围跟踪排版后文本。正文继续由原 SqlEditor 的 onChange 写入草稿；没有 setValue，没有手写撤销栈，也无需扩展 SqlEditor 接口。来源绑定、结果、连接/会话、事务、任务及历史没有进入格式化路径。

复用现有 sql-formatter，无新依赖。为避免改写名称或模式敏感文本，格式化保留关键字、标识符、函数和类型的大小写，仅调整排版。选区两端原空白、选区外原文及模型换行风格保持。

格式化使用有界的等价检查，不把简化词法检查当作完整 SQL 解析器：

- 沿既有补全预算限制完整模型最多262144个UTF-16单位、16384个token、64层括号；格式化扩展后同样检查长度。
- ANSI_QUOTES 与 NO_BACKSLASH_ESCAPES 的四种组合都核对排版前后token原文、顺序和模式敏感的函数/参数/变量前缀空白。任何组合不确定即保守拒绝，不查询服务器猜测模式。
- 字符串、引用名及普通注释逐字核对；选区不能截断token或CRLF。DELIMITER、存储程序、可执行注释/提示器及SQL_MODE变更脚本保守拒绝。
- formatter异常只显示固定中文说明，不把可能携带SQL片段的库异常消息交给界面。所有计算失败都发生在编辑事务之前。

本轮验证：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/sql-formatting.test.ts tests/unit/ui-query-formatting.test.tsx
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

33项定向测试通过：22项格式化安全/原文测试，11项真实 QueryTab、ReactDOM、store 组件测试。组件测试仅替换 Monaco 外界端口，核对单次编辑事务、两侧undo stop、失败不触栈、来源/作业状态及零执行命令；它不是原生 Monaco 撤销验收。类型检查及独立克隆构建退出0；构建只有现有依赖注释及大包体提示。

新增 `tests/e2e/query-format-selection.spec.ts` 四项正式界面定义：选区外逐字保持与Unicode/注释/字符串、无选区全文、两项单次Undo/Redo及零执行快照、不安全分隔符脚本拒绝、formatter不支持语法失败不改模型。全部沿正式查询打开、工具栏、原生键盘和Monaco只读公开API；不写模型、不用系统剪贴板或私网帮助器。

定义需要同时显式设置 `DBARK_E2E=1` 与 `DBARK_Q01_FORMAT_UI=1`，并关闭trace、截图及视频。列表阶段始终先短路，不加载桌面夹具；四种开关组合下 `--list --reporter=json` 均退出0，均发现4项且results为空。原件在本克隆忽略目录 `.cache/q01-format-evidence/`。

本轮没有启动GUI、访问200、读写剪贴板、手动派发CI或执行以上四项界面用例。真实Monaco的选区焦点、一次撤销重做及安装层行为由Root后续实际验收；必须使用包含本提交产品代码的新候选，不能用旧5ab候选替代。
