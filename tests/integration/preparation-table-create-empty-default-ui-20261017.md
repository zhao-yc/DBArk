# 新建表显式空字符串默认值：Windows/MySQL 8.4.11 正式场景准备

本文件只记录默认关闭的独立正式定义及本地纯验证。基线为 `cd827a52f901c48d4bc7cb26fc7de12f9fed0540`，任务分支为 `codex/employee1-empty-default-ui-20261017`，使用独立普通克隆。未修改生产代码、共享 `desktop-fixture.ts`、共享 `live-helpers.ts` 或已有用例标题、超时和安装验收记录。

## 唯一正式场景

入口：`tests/e2e/table-create-empty-default.spec.ts`；专用实现：`table-create-empty-default-live.ts`；纯辅助：`tests/helpers/tableCreateEmptyDefault.ts`。

默认以及 `--list` 只注册一个默认关闭占位身份。双门开启且非列表模式才加载专用 live；先验证显式 raw/helper 配置一致，再加载桌面与驱动。专用 live 不导入共享 live-helpers，没有 `.env`、证书、密钥或账号默认值后备读取。

正式定义只有一个用例，继承原 `45000ms`，`retries=0`，禁止重复执行；不修改原安装计数。只允许 Windows 已安装 `.exe`、`192.168.31.200:13384`、TLS=`0`，开发 URL 和 `ELECTRON_RUN_AS_NODE` 必须不存在。实际 trace、screenshot、video 必须均为 `off`。

Root 后续显式注入以下 RAM 字段；本文件不保存认证值或可执行授权：

- `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_CREATE_EMPTY_DEFAULT_UI=1`。
- `DBARK_EXECUTABLE_PATH`：Root 核定安装包对应的 Windows exe；另行核定安装三 SHA、源码及资源窗口。
- `DBARK_TEST_HOST`、`DBARK_TEST_PORT`、`DBARK_TEST_TLS`：上述固定明文隔离目标。
- `DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`：本轮明确既有账号；显式空密码允许，缺失不允许。
- `DBARK_TEST_EXPECTED_SERVER_UUID`：本轮实际实例 UUID，不从端口或历史记录推断。

## 真实流程与证据边界

1. 使用无默认库的独立只读观察连接，核准确 `8.4.11`、Linux、大小写模式、UUID、普通 SQL 模式、autocommit/严格 InnoDB/SHOW 引用/GIPK，以及 InnoDB 和 utf8mb4 能力。预检连接必须严格关闭同一原生流，才进入下一阶段；实际观察连接重复核对同一 RAM 指纹。
2. 准确随机名 `dbark_empty_<32位UUID十六进制>` 不存在且未占用后，隔离壳单次创建 utf8mb4/bin 库。数据库 ACK 明确成功后才记录该名称的本例归属。该隔离 DDL 不是产品新建表的被测行为。
3. 真实连接表单保存本轮连接，展开准确库节点，打开真实新表设计器。新表包含普通 INT 主键、`empty_text`、`literal_null`、`sql_null`、`note` 和 `unset_text`。
4. 勾选空串并预览；返回草稿取消空串并预览未设；返回后重新勾选、输入普通文字，确认勾选已清除；最终重新明确选择空串并预览。文字 NULL 使用原文字开关；SQL NULL 使用原输入约定；普通默认和 NOT NULL 未设列同时保留。
5. 每次预览均读取真实 Monaco 显示 SQL，核准确库表和各列默认；独立连接确认整个隔离库仍无表，同时任务内零结构 apply。该证据用于本用例的只读预览断言，不等同于采集了服务器全部语句日志。
6. 两个 DDL/单次创建知情勾选后，带尾空格的完整名称仍不可提交；填写准确 `库.表` 后只点击一次。要求成功状态、唯一已完成 `schema.tableCreate.apply` 和禁用的提交按钮；不双击、不自动重试或重放。
7. 独立连接读取 `SHOW CREATE TABLE` 与有序 `information_schema.COLUMNS`，逐项区分空串 `''`、文字 `'NULL'`、SQL NULL、普通文字和未设；核生成表达式/EXTRA 为空及表内无行。关闭确认后核原连接对象树已出现准确新表。

## 停链、退出与清理

专用 guard 的本地 retained 锁先于共享 retain 通知。通知自身抛错、raw/helper 变化、owner 变化、任务未知、异步拒绝、超时或迟到结果，都不能清除该锁。每个异步动作前后核同一 TestInfo 的 page/application；观察等待计数和主体活动门覆盖 afterEach。

单调截止在正式定义注册时建立，早于用例及自动桌面 fixture；截止为注册时刻加原 `45000ms`，不在进入测试主体时重新获得45秒。超过截止或 afterEach 发现主体仍活动，即使 ACK 随后返回也不能读取、退出、DROP 或重放。注册到执行的等待也占此保守窗口，Root 应只运行本独立入口。

成功收尾顺序固定为：任务终态 → 同一 owner 正常退出及真实 closed → 准确库名/库选项/唯一普通表/原 SHOW/COLUMNS/空表再次核对 → 单次 DROP 精确库 → 查询库不存在 → 同一观察原生流 strict QUIT 与真实 close → 关闭本地主体活动门。错误路径不进入兜底 finally DROP；任何未知均保留所属资源供 Root 只读处置。

预检或观察连接的 Promise `end()` 不作为关闭证明；缺原生连接、缺流、流被替换或仅 end 未 closed 都失败。预检阶段失败后也不会越过 sticky 锁继续动作，因此失败时可能保留预检连接。

首次 CREATE ACK 前，客户端仍不能证明新对象的服务器物理归属；名称未占用与 ACK 只构成本例名称级证据。重新核对原定义和准确库名不消灭检查与清理之间的竞争窗口。本实现没有新增物理 table ID 保证，也不声称解决了该归属窗口。

## 已完成的本地验证

- 新增纯测试：16项目标/模式/目录语义、真实 SQL 生成器对接、sticky、活动门、迟到、未知 CREATE、正常收尾及同流 strict close；12项真实入口转译的默认/list 短路。合计28项通过；全部为 RAM 端口，无驱动或桌面执行。
- 已有真实 React 链定向验证：选择空串、取消为未设、普通输入解除勾选，共3项通过；38项中的其余项未在本轮执行。
- 父红：ignored 隔离快照仅用 `24146f8^` 的 `SchemaDialog.tsx` 覆盖当前副本，其余保持基线；执行上述“新建明确选择空串”已有纯 React 测试，预期1项失败，准确报“缺少复选框：第1个字段：空字符串默认值”。这是父版该组件的定向反例，不是父版全套或真实 GUI 验收。
- `tsc --noEmit` 通过。
- 实际 Playwright `--list --trace=off --reporter=list` 在双门关闭与双门开启时，均只收集1个默认关闭占位身份；不导入 live、认证或桌面。

实际命令（使用现有共享依赖，未安装依赖）：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-create-empty-default.test.ts tests/unit/table-create-empty-default-list-guard.test.ts
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/ui-schema-empty-default.test.tsx -t '新建明确选择空串后|选择后取消回到未设置|空串选择后输入普通文字'
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/table-create-empty-default.spec.ts --list --trace=off --reporter=list
```

本轮实际 GUI、DB、SSH、CIM、200访问、系统剪贴板、CI、安装、Docker 以及私料读取均为 **0**。列表收集和 RAM React/SQL 断言不增加正式通过或安装验收数。真实 Windows/MySQL 8.4.11 场景由 Root 后续核对独占资源、安装来源和实际目标后另行安排；本文件不构成执行或生产部署授权。
