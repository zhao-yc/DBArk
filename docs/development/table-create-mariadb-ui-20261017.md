# MariaDB两准确版本的普通新建表源码UI定义

固定起点：`df086381e837f9eaaab7d646773b106ceb23b89e`。员工3使用普通独立克隆及 `codex/employee3-maria-table-create-ui-20261017` 分支。本片增加10.11.19、11.4.13的默认关闭正式源码UI入口；不修改共享engine接口、生产能力profile、现有generic创建或其它版本入口。

## 当前能力与实际修正

基线`TableCreateTasks`已经有Maria创建路径：只在MySQL方言读server_uuid，5.7准确能力同样只在MySQL触发；Maria默认值使用`mariaDefault`解码，完整后核组合SHOW、COLUMNS、表属性及STATISTICS。新增纯模型直接运行这份generic任务，核两版本的INT、文字NULL、普通文字默认和普通/唯一索引，并证明SQL NULL误回、ACK后SHOW错误不能变成完整核验成功，不重放或DROP。未将MySQL样本当作Maria实测。

实际发现的缺陷在真实设计器：输入`NULL`一律成为SQL空值，无法表达VARCHAR文字`NULL`。保留原NULL输入约定，新增显式“文字 NULL”复选框，仅当当前默认值为SQL NULL或同名文字时显示；勾选后草稿为字符串`'NULL'`，取消后为null。没有新协议字段，没有改SQL生成器或默认值解码器。

真实ReactDOM回归在父版本因缺少文字选择而失败；修正后同时核文字和SQL空值两种草稿进入真实确认服务的区别。父红来自同一固定基线加新反例，未执行GUI，原报告保留于本克隆ignored目录`.cache/maria-pure/parent-red.json`。本片不声称已完成真实窗口的外观或可访问性验收。

## 默认关闭入口及准确目标

两个入口分别为`tests/e2e/table-create-mariadb1011.spec.ts`、`table-create-mariadb114.spec.ts`，共享独立的`table-create-mariadb-live.ts`，每个只注册自己的一个准确版本用例。`--list`及`--list=...`先于任何认证环境读取短路；非list须同时满足`DBARK_INTEGRATION_ENABLED=1`和对应`DBARK_TABLE_CREATE_MARIADB1011_UI=1`或`DBARK_TABLE_CREATE_MARIADB114_UI=1`。缺门只注册skip，不导入helper、桌面或驱动。

真实注册前拒绝`.cache/dbark-test.env`回填文件。原始环境与helper环境的以下七键必须为自有字符串且逐值一致；缺键不补账号、密码、TLS或指纹。空密码须显式存在：

| 键 | 约束 |
| --- | --- |
| `DBARK_TEST_HOST` | `192.168.31.200` |
| `DBARK_TEST_PORT` | 10.11.19为`13310`；11.4.13为`13311` |
| `DBARK_TEST_TLS` | 显式`0`，不读CA或静默转TLS |
| `DBARK_TEST_USER` | 本轮显式非空账号 |
| `DBARK_TEST_PASSWORD` | 本轮显式字符串，空串合法 |
| `DBARK_TEST_EXPECTED_SERVER_HOSTNAME` | Root本轮取得的准确hostname，非空 |
| `DBARK_TEST_EXPECTED_SERVER_ID` | Root本轮准确server_id规范十进制字符串 |

绑定在首次await前固定，只留RAM；后续raw/helper任一变化、缺自有属性或双份ABA均永久失效。实际事实查询只用Maria已有的version、OS、名称映射、hostname/port/server_id、mode、autocommit、innodb_strict_mode及quoteShowCreate。版本必须准确带MariaDB发行标记，允许发行后缀和5.5.5兼容前缀；不从端口推断实际方言或补丁。另核InnoDB实际可用及utf8mb4目录。

这是**本轮已验目标指纹**，不称为持久全局实例oracle；不用server_uid、server_uuid、GIPK或partial_revokes，不伪造替代值。这个有界验收指纹不收缩或禁止generic产品能力，也不声称证明跨代理/克隆的全局身份。预检连接关闭后，观察连接再次核同一RAM事实；任何不一致停止。

模式仅允许本片列明的常见普通模式：STRICT_TRANS_TABLES、STRICT_ALL_TABLES、ERROR_FOR_DIVISION_BY_ZERO、NO_AUTO_CREATE_USER、NO_ENGINE_SUBSTITUTION、ONLY_FULL_GROUP_BY、NO_ZERO_DATE、NO_ZERO_IN_DATE、NO_BACKSLASH_ESCAPES。隐藏定义/模拟模式、未知词或空项均拒绝本验收入口；不SET GLOBAL或更改现有查询会话。这是准确样本的前置约束，不是新增生产默认封禁。

## 正式主体与资源终态

沿既有45秒预算、retries=0，每例独立严格桌面归属；trace/screenshot/video均off。先做无默认库的只读预检，再等待真实native QUIT写入和同一底层stream的close。缺native、缺流、流对象替换、close未知或raw/helper漂移不能进入隔离DDL。COM_QUIT没有服务器ACK，不把它当作DDL结果证明。

随后通过原`connectAndCreate`真实建库表单创建唯一`dbark_create_<32hex>`库，复用原设计器、准确预览和风险确认；不用SQL/IPC替代被测建库或建表操作。样本为INT非自增主键、两个VARCHAR，分别为文字NULL和普通中文默认；包括一个普通复合索引、一个唯一索引。预览前目标不存在；多一个空格的确认不能执行，准确确认双击只产生一次apply。SHOW、COLUMNS、STATISTICS及零行内容独立后核，专用任务恰一次，最后核原展开对象树刷新。无需改动任何原表数据。

保留标记先写本地再通知共享fixture，通知抛错也不能解除停链；afterEach可看到仍活动的主体。所有观察等待前后检查同一页面、应用和raw/helper绑定，超时后迟到结果不能恢复许可。DDL、观察或关闭未知均sticky retain，不自动DROP、重放、重连、取消或杀进程补救。

只有主体成功、建库/建表任务已明确完成、原归属应用确认退出后，才精确DROP本例随机库并核目录为空，最后严格关闭同一观察流。未知清理不重试。没有新增通用运行框架，没有改共享fixture/helper；两版本使用同一独立定义，参数准确限定。

## 本轮验证及剩余边界

只复用已有依赖，没有安装、构建或打包。ignored的Vitest配置设置`envDir:false`，只运行选定纯测试。新正式函数用VM执行实际注册和原建库表单，驱动/桌面端口全部合成；引擎任务用真实解析器和查询回调模型；界面用真实React和内存DOM。覆盖原始/helper漂移、继承值、事实缺失与错误版本、未知变量/查询、错误引擎/编码、QUIT早于close、同流替换、等待期间超时、通知设置前失败、DDL未知、退出/DROP/最终close未知与两入口list双门。

执行命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/maria-pure/vitest.config.mjs --reporter=json --outputFile=.cache/maria-pure/final-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/table-create-mariadb1011.spec.ts tests/e2e/table-create-mariadb114.spec.ts --list --reporter=json
```

选定6文件357项通过，TypeScript无发射检查通过；真实Playwright list只列出两个关闭定义。父红1项与修正后真实React绿结果分开保留，未把失败草稿当最终通过证据。没有读取实际认证、访问200、GUI、DB、SSH、clipboard、Docker、CI或安装程序，没有修改Root分支；代码推送不代表实际执行或生产部署授权。

Root后续须分别提供两实例本轮raw认证/指纹，独占实际执行，并另核六实例资源与各自真实SHOW/COLUMNS/STATISTICS形状。当前Maria目录样本均为合成，真实展示宽度、默认值引号、索引顺序、窗口刷新和实际strict close仍待Root验收；遇到差异应依据实际来源修正，不回填通过、不把研究层“不绝对唯一”当永久停止既有功能验收的理由。
