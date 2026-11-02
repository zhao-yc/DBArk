# MySQL／MariaDB 本文声明跳转

## 使用与边界

在 SQL 查询正文的关系限定段或 CTE 引用上按 F12，或按住 Ctrl 点击，跳到本文声明。macOS 对应 Command 点击，尚待实际平台验证。

```sql
SELECT s.id FROM subject AS s; -- 限定段 s 跳到 AS s
WITH c(id) AS (SELECT 1) SELECT * FROM c; -- FROM c 跳到 WITH c
SELECT d.id FROM (SELECT 1 AS id) AS d; -- d 跳到派生表别名
```

支持显式／隐式别名、闭合反引号、已确认 ANSI_QUOTES 的双引号、WHERE／JOIN ON、相关子查询遮蔽、递归 CTE、UNION 各分支，以及明确数据库限定下的同名表。名称按原文精确匹配，不推测服务器大小写规则。

字段末段、函数、变量、schema 段、表头、字符串／注释、同层重名、前向／非法自引用及不完整语句不猜测目标。当前 MySQL 解析库拒绝嵌套 WITH，该形态暂不导航。这里只定位当前文本，不打开物理对象定义，不替代查找引用、诊断或重命名。

## 实现与保护

- 复用原 MySQL AST、词法及作用域边界，声明位置由规范化 token 映射回原 UTF16 范围；普通补全与悬停输出保持。
- 固定 `definition` 意图只返回原文范围；回包核完整同名词、范围及字段白名单。链接 URI 只能取当前 Monaco 模型，不能由 Worker 指定文件或命令。
- 每次导航独占分析 Worker；原 8 秒启动／2 秒解析预算保持，完成、取消或卸载均终止所属线程，不与键盘补全抢占线程。
- 无会话草稿只使用已缓存连接事实；已有会话仅前后读取 `query.completionState` 缓存，核模式、版本、库和对象代次，不新增目录读取、会话或 SQL。
- 模型版本、活动连接作用域、模态、取消和卸载均使迟到结果失效。共享渲染层 provider 同时服务 SQLite，SQLite 仍使用自己的解析器和线程。
- 不改变 IPC 协议、配置、凭据或数据库写协议。

## 验证记录

WIN11-TEST 本轮读取不可达，未派发测试；按既有授权回退本机 Windows。

- 相关回归 10 文件、187 项通过，含真实 Worker bundle、原补全、悬停、会话上下文及 SQLite 导航。
- 最终四份定向 84 项通过，另增表头误跳保护；与前轮有重叠，不累加作为独立用例数。
- 初轮 AST 收集器只在投影保留列，导致限定段及 WHERE／ON 断言失败；已改用完整 AST 作用域和排除表头／函数的限定链核对，原失败记录保留。嵌套 WITH 按真实解析器限制列为不支持。
- 新原生测试观察器的 `postMessage` 签名曾不满足官方重载，已修正，严格类型及源码构建通过。
- Windows 原生单轮 4.768 秒通过：三次真实 F12、一次 Ctrl 点击；原模型 URI、正文、版本、撤销／重做状态全部保持。四个导航 Worker 均 ready／reply／terminate 各一次，数据库请求、会话、任务与执行历史为零。保留每例 120 秒、worker1、retry0，截图已审。
- 原生首轮在“新建查询”对话框的既有自动建连请求处被离线守卫拦下；该轮仍判失败，保留原件及临时目录，后核无客户端进程，但不追认正常退出。最终轮用真实 `settings.save` 在独占 fixture 准备空草稿并由原恢复入口打开，不放行建连，不修改产品、业务断言或期限。
- 最终客户端取得正常退出回执，准确 App PID 及临时目录经独立 CIM／路径核对不存在；旧失败目录保留，不做强停或范围清理。

本轮原件保存在私有 `.cache/mysql-definition-20261103/`。macOS、安装包、已连接实库的界面及全部 SQL 形态仍待验；O05 保持部分，不增加完整功能包或发行计数，暂不发布。

## 复验入口

源码构建后，在不含数据库／SSH 认证、`NODE_PATH`、`NODE_OPTIONS` 或自定义用户资料路径的干净进程中运行；守卫拒绝的环境不能直接放行。

```powershell
$env:DBARK_INTEGRATION_ENABLED = '0'
$env:DBARK_MYSQL_DEFINITION_NATIVE_TEST = '1'
node node_modules/@playwright/test/cli.js test tests/e2e/mysql-definition-native.spec.ts --workers=1 --retries=0 --trace=off
```

默认和 `--list` 只注册跳过项，不加载桌面或认证文件。失败保留原窗口／profile及报告，确认原任务终态后才可另开一轮，不自动重试或强停。
