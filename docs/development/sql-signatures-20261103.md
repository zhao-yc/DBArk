# SQL 内置函数参数提示

## 使用与范围

在查询编辑器输入常用函数的 `(` 或参数间的 `,`，显示函数签名并高亮当前参数。Windows 可用 `Ctrl+Shift+Space` 手动查看；macOS 对应 `Command+Shift+Space`，实际平台另验。提示不修改正文、光标或撤销栈，不执行 SQL。

```sql
SELECT SUBSTR('中文,示例', 1, 2);
SELECT CONCAT('前缀', IFNULL(value, '空值'));
SELECT MAX(1, 2); -- SQLite 多参数标量形式
```

资料覆盖 MySQL／MariaDB 29 个、SQLite 23 个名称（含别名）：常用字符串、数值、NULL 和聚合函数。支持不同参数数量、可变参数、COUNT DISTINCT 的方言差异，以及嵌套调用、括号／子查询、注释和字符串中的逗号。SQLite 的 MIN／MAX 多参数形式与 MySQL 聚合形式分开处理。

这是一份常用内置函数的本地语法资料，不是服务器函数目录、版本可用性检查或 SQL 正确性诊断。限定名、带引号函数名、自定义／未知内层函数、专用 `FROM`／`FOR`／`ORDER`／`SEPARATOR` 语法及不明确引号模式不猜测提示；不承诺覆盖完整存储过程语法或 MariaDB 各兼容模式的函数语义。

## 实现与保护

- 固定签名和中文说明集中在 `src/renderer/locales/sqlSignatures.zh-CN.ts`，文档以普通文本展示，不包含用户 SQL、HTML、命令或外部 URI。
- 复用有界词法扫描，采用原 262,144 UTF16 单元、16,384 token 和 64 层括号限制；超预算、NUL 或代理字符中间位置拒绝。普通补全仍走原目标规则。
- MySQL／MariaDB 采用已知 ANSI_QUOTES／NO_BACKSLASH_ESCAPES；未知时四种词法结果一致才提示。SQLite 独立处理方括号、无反斜杠转义字符串、无需空白的 `--` 和普通块注释。
- 无会话草稿和 SQLite 只读本地正文；已有 MySQL 会话仅前后读取原 `query.completionState` 缓存，核模式、库、版本和对象代次。不创建连接／会话、读取元数据、启动数据库任务或执行 SQL。
- 绑定原模型、版本、已提交方言和连接作用域；编辑、取消、模型切换、模态／只读／焦点守卫失效及卸载均拒绝迟到结果。缓存对象原地变更和同步重入也不能发布旧提示。
- 使用 Monaco 原生参数提示控件和快捷键，不新增 IPC、凭据、配置存储或数据库写协议。

签名形态核对官方资料：[MySQL 字符串](https://dev.mysql.com/doc/refman/8.4/en/string-functions.html)、[流程控制](https://dev.mysql.com/doc/refman/8.4/en/flow-control-functions.html)、[聚合](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html)、[数值](https://dev.mysql.com/doc/refman/8.4/en/mathematical-functions.html)、[比较与 COALESCE](https://dev.mysql.com/doc/refman/8.4/en/comparison-operators.html)、[MariaDB SUBSTRING](https://mariadb.com/docs/server/reference/sql-functions/string-functions/substring)、[SQLite 核心函数](https://www.sqlite.org/lang_corefunc.html)、[SQLite 聚合](https://www.sqlite.org/lang_aggfunc.html)。数据库的版本、模式及类型语义仍以实际服务器为准。

## 验证记录

本轮 WIN11-TEST 不可达且未派发，按既有授权回退本机 Windows。相关六文件 198 项单元通过，包含原词法、补全、SQLite／MySQL 声明导航和新参数生命周期。首轮类型检查发现新增测试夹具未标注完整 Monaco Position 类型，修正夹具后继续验证，保留原失败日志，不降低断言或期限。

- 严格类型和源码构建通过；构建后仅修正新增原生测试的两处夹具问题，生产源码与产物逐文件保持，最终类型、默认关闭和列举复验通过。
- Windows 完整客户端最终单轮 7.895 秒通过，原 120 秒、worker1、retry0 保持。真实表单保存 MySQL／MariaDB 离线连接与 SQLite 本例文件；三种草稿均验证开括号、逗号、第三参数高亮及快捷键不改模型，另验两种网络方言的嵌套调用返回外层、SQLite MAX 多参数形式。
- 原模型 URI、正文、版本、光标、撤销／重做状态在手动提示前后完全相同；查询、元数据、会话、SQLite 请求和 utility 启动均为零，任务／执行历史为空。独占 SQLite 文件逐字节保持。
- 原生首轮因测试预期漏算 Monaco 自动右括号失败；第二轮业务和正常退出检查已走完，但报告读取已关闭 Playwright 对象失败。分别修正精确正文预期和启动进程句柄保存，两轮原日志保留，不追认整轮通过；未修改产品、断言门槛或超时。首轮目录保留且准确 PID 核无；第二轮所属资源已正常收尾。
- 最终窗口正常退出，捕获的原进程退出码为 0；所属进程由 fixture 核清，另用准确 PID／配置路径独立核无，成功临时目录不存在。三份方言截图保留，MySQL／SQLite 截图已审阅。

原件位于私有 `.cache/sql-signatures-20261103/`，不进入仓库。完整 SQL 语义辅助、macOS、安装包及已连接实库的界面另验；O05 保持部分，不增加完整功能包或发行计数，暂不发布。

## 复验入口

先构建源码；在不含数据库／SSH 认证、`NODE_PATH`、`NODE_OPTIONS` 或用户配置覆盖项的干净进程中运行：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '0'
$env:DBARK_SQL_SIGNATURE_NATIVE_TEST = '1'
node node_modules/@playwright/test/cli.js test tests/e2e/sql-signature-native.spec.ts --workers=1 --retries=0 --trace=off
```

默认和 `--list` 不加载桌面／SQLite。专项以独占配置保存离线连接，通过真实设置协议准备空草稿，再走原布局恢复和真实键盘；不模拟产品查询入口或 provider。唯一文件选择适配只返回本例合成 SQLite 文件，不证明系统文件选择器输入。失败保留所属窗口／profile／原日志，先核原任务终态，再另开新轮；不自动重试或强停。
