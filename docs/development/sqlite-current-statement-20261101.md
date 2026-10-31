# SQLite 执行当前语句

## 使用

在 SQLite 查询标签中将光标放在目标语句内，通过执行下拉菜单的“执行当前语句”，或 `Ctrl/⌘ + Shift + Enter` 执行。原 `Ctrl/⌘ + Enter` 继续执行选区／脚本，不改变全文或选区的含义。

输入仍是准确 Monaco 模型的完整正文及 UTF-16 光标。SQLite 专用扫描器按引号、注释和语句边界选择原文片段，支持 CREATE TRIGGER 的完整多语句体；不会预执行前面的 BEGIN、PRAGMA、DDL 或 DML。SQLite 不解释 MySQL 的 DELIMITER 指令。

光标不属于有效语句、偏移位于 CRLF／代理对内部、全文引用或触发器不完整时拒绝执行，不回退全文或跨空白寻找相邻语句。SQLite 的反斜杠和 `--` 按其自身规则解释，不借用 MySQL 会话模式。

完整原文保持 20MiB 预算，扫描时只保留当前命中的范围，不为所有短语句分配长期对象。显式范围目录辅助接口另限 1,000 项，这个目录限制不阻止在更大脚本中选择一条当前语句。

## 正确性边界

- 沿用原查询标签的物理会话、事务、结果预算、取消与退出协议，不开替代会话，不自动重连或重放。
- 模型、正文版本、光标、连接修订、标签、会话或模态上下文失效后，原意图永久作废。文件操作或关闭期间不能通过旧菜单／快捷键继续投递。
- 只向 driver 发送所选片段，并使用现有“只允许一条完整参数语句”约束，以空参数列表在任何 step 前再次由 SQLite 原生 prepare 确认单语句；不是将全文传给执行器再跳过结果。
- 事件、结果和历史只使用原生确认的实际语句。语法错误在 prepare 阶段拒绝、尚未产生语句头时不新增 SQL 历史；错误范围可以标记所选语句在原全文中的准确范围，不冒充原生错误列号。
- SQLite 参数执行、MySQL 警告采集及遇错继续仍保持各自接入边界，不因开放当前语句而暗中启用。
- 空白只按 SQLite 原生规则处理：NBSP、EM SPACE 和垂直制表符不会被 JavaScript trim 删除后变成另一条可执行语句；BOM 在标识符内部或末尾也保留。原 worker 的 trivia 识别同步停止跳过非法 VT。

## 验证

本轮 WIN11-TEST 不可达，未派发新任务；按既有授权回退本机 Windows，串行使用独占合成 SQLite 和全新配置，不访问外部数据库、已安装配置或剪贴板。macOS 两架构及安装包分别验收；不创建 Release。

- `pnpm build` 通过，包含严格类型检查。相关 UI 5 文件 99 项、后端与原 MySQL 当前语句 4 文件 155 项通过。
- 测试观察器修正后再运行最终 `pnpm typecheck`，退出 0；产品源码沿用上述已验构建，未为测试增加专用产品接口。
- `pnpm test --maxWorkers=4`：1,019 文件、20,957 项通过；1 个 POSIX 文件权限用例因 Windows 平台跳过。保持原超时，没有重试。
- `node scripts/sqlite-workspace-ci.mjs current`：Windows 真实 Electron 专项单次通过，8 次当前语句加 1 次原普通执行；真实菜单及 Ctrl+Shift+Enter、完整触发器、原会话 BEGIN／写／ROLLBACK、独立只读连接和语法错误定位通过。原生 prepare 拒绝的两次查询没有伪造 SQL 历史，7 条实际历史和 9 个任务一致。
- Root 独审原 JSON 附件及实际请求：两条提交行保留，事务中的第三行回滚，触发器恰好产生两行，前后哨兵和恢复草稿均零写入；两个原进程正常退出、同配置重启零查询，准确临时目录已删除。
- 同一构建再串行运行 `workspace`、`table`、`export`、`edit`、`schema-export`，五项 Windows 窗口回归各单次通过；分别核原事实附件、十个正常退出进程及五份准确目录删除，不把测试摘要替代安装包验收。
- 模型正文、CRLF 和 UTF-16 光标通过官方 Monaco 模型 API 设置；执行经过产品真实菜单／按键。文件 chooser 仅替换本例两次准确路径；不冒称实体文字输入或系统文件框验收。

首轮窗口失败原件保留在私有 `.cache/sqlite-current-20261101/native-current05-results/`：测试白名单漏记现有 `query.completionState` 缓存读取，使观察器停链；首个实际 INSERT 成功不等于整例通过。后续只增加这条准确会话、单字段的缓存读观察，未修改产品以绕过验收；原 120 秒、零重试、九次 SQL 和退出清理门保持。

本轮主要私有原件为同目录下 `build04.log`、`unit-ui01.log`、`unit-core03.log`、`unit-full06.log`、`native-current07.log`、五份 `native-*08.log` 及 `native-current07-audit.json`／`native-regression08-audit.json`；Playwright 各专项 `test-results/*/report.json` 保存原附件。日志、合成库和产物不入仓。

前轮 `7dce0736` 的 SQLite 专项 CI `41227686026` 已在 Windows、Mac arm64／x64 三平台完成，各平台五个专项步骤成功，包含短路径编辑修复及结构导出。当前语句另走新候选 CI；公开日志下载 403 原响应保留，不将 API 步骤状态冒充逐份报告独审。
