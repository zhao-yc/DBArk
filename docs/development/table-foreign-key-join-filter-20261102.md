# 外键 JOIN：双侧 WHERE 条件筛选

## 使用方式

MySQL／MariaDB 普通表的“按外键生成 JOIN 查询”明确读取父表结构后，可在“JOIN 条件筛选”中添加子表 c／父表 p 的字段条件，包括未输出字段。支持全部满足（AND）、任一满足（OR），以及等于、不等、大小比较、LIKE／NOT LIKE、IN／NOT IN、BETWEEN、IS NULL／IS NOT NULL，共 13 种运算符。

集合每行一个值，保留逗号、空格、重复值和空行；单独空字符串通过勾选明确加入。数值和区间按原字符串保留，不转换为 JavaScript 数字。可逐项启停、移除或全部清空，切换运算符保留其它输入；全部停用不生成 WHERE。同一外键重读保持草稿，切换外键清空条件和排序，不继承原表页筛选。

条件写在完整 ON 之后、ORDER BY 和 LIMIT 之前。LEFT JOIN 的父表 WHERE 条件可能排除未匹配子行；判断父表非键列 IS NULL，也可能命中存在父行但该字段为 NULL 的记录。窗口内提供说明，不把 WHERE 改成 ON，也不自动补偿 NULL。

仍须审阅预览，明确打开同连接独立查询后自行执行；不执行查询、不提交父页数据，也不改变全局结果上限。无效字段、数值或超预算输入会撤销可打开预览，不静默变成无条件查询。行数输入不再将七位非法值截成六位合法值，保留输入并报错。

## 编译、预算与来源保护

双方列名通过固定 c／p 身份限定，按真实元数据校验；条件形状、启停、集合、精确数字转换及模式无关的 UTF-8 十六进制文本字面量，复用表页筛选编译。不接受原始 SQL、表达式或回调作为用户输入，未新增 IPC 或配置格式。

最多 30 条条件、单集合 200 值、合计 1000 值、每值 4096 字符、值内容合计 1000000 字符；完整 JOIN SQL 仍受 256KiB 预算限制。隐藏草稿也计入界面字符预算，拒绝超量的新输入并保持旧草稿。未知属性、继承选项、访问器、空洞和损坏 Unicode 拒绝，不调用 getter 或截断 SQL。

预览冻结条件与组合模式。打开前沿原意图串行重读双方相关结构、重算同一条语句并一次性消费；未输出筛选列的类型变化同样使旧预览失效。忙态、旧回调、移除条目、换外键及来源变化的保护保持。

## 验证与资源

WIN11-TEST 本轮不可达，未派发任务；按既有授权回退本机 Windows。最终八份相关单元 **213 项通过**，覆盖精确值、同名与未输出字段、全部运算符、启停、集合与区间切换、输入预算、非法上限、迟到回调、忙态和预览失效；不是全仓测试结果。严格类型检查及构建通过，既有 Rollup 警告及内存组件 act 提示保留。

已核 SSH 主机为 Server-200，未执行 Docker。六个专用端点使用随机隔离库，每库只有 owner、父子三张表及十条合成数据，具有真实外键。测试从产品元数据接口读取双方普通表和准确外键，再用产品生成器及连接执行 **20 条向量 × 5 组会话模式 × 6 端点 = 600 次 SELECT**，全部结果逐值比较，每次检查警告，原测试线程关闭后由独立观察连接核零。

| 端点 | 实测版本 | 模式及结果 |
| --- | --- | --- |
| 13357 | MySQL 5.7.44 | 100 次通过 |
| 13380 | MySQL 8.0.46 | 100 次通过 |
| 13384 | MySQL 8.4.11 | 100 次通过 |
| 13310 | MariaDB 10.11.19 | 100 次通过 |
| 13311 | MariaDB 11.4.13 | 100 次通过 |
| 13484 | MySQL 8.4.11，严格 TLS | 100 次通过 |

五组模式为原模式、空模式、ANSI_QUOTES、NO_BACKSLASH_ESCAPES 及两者组合，独占会话设置后再次读回。覆盖 UINT64 最大值、超过 JS 安全边界的整数、高精度 DECIMAL、引号／反斜杠／NUL／中文／emoji、NULL、LIKE、AND／OR、排序及 LIMIT；未关闭优化器或外键检查。真实外键夹具两个无父行均用 NULL，未伪称此轮物理表覆盖遗留孤儿键。

没有创建用户或修改权限。完成后逐库核 owner、准确三表、完整行值、定义、内部外键、外部依赖和占用，再精确删除六库并核零。首次清理预核因服务器表名排序把 owner 表置后而停止，未执行 DROP；改为本地排序比较完全相同的准确集合后完成核验，原失败保留。

Windows 原生组件四例最终单轮通过：原排序深／浅主题 5.948／3.259 秒，新增筛选深／浅主题 3.622／5.442 秒；每例 120 秒、单 worker、零重试。真实 TableTab 菜单进入，校原全局上限和父页草稿保持、四次准确元数据读取、只新增一查询草稿、零数据库执行和零剪贴板操作。截图已实看，1024×680 逻辑视口无横向溢出，原应用均正常 exit 0；直接 Windows CIM 核四个准确 PID 不存在，四个通过用例临时目录已核零。

第一轮窗口验收为两过、一失败、一未启动：新增断言误把排序 NULL 分桶算作 WHERE 条件残留。原 SQL 已正确移除 WHERE 叶；修正测试仅检查 WHERE 段，并验证重新启用及原排序后完整复验。原报告和失败目录保留，没有延长超时或增加重试。

## 保留的失败与未验范围

初始派生表只读矩阵中，MySQL 5.7 的 100 次 SELECT 通过；MySQL 8.0 在 NO_BACKSLASH_ESCAPES 下的特殊字符等值向量报 ER_PARSE_ERROR。诊断确认发送的是完整十六进制字面量 SQL，仍能复现；四个后续端点未启动。原失败 SQL、会话模式、线程及退出码保留。原因未确证，不能将其计为通过或直接认定产品编码错误。后续真实普通表使用同一特殊字符、运算符和五组模式全部通过，无优化器规避；两类证据分别记录。

原生组件只替代数据库输入，创建草稿后用夹具只读展示 SQL；600 次真实 SELECT 为独立引擎证据，不能合并称产品主进程、完整查询编辑器与实库 GUI 已验。macOS 双架构、安装包、全量回归、嵌套条件组、分组聚合及任意多表构建另验或继续开发，不计完整 O04，暂不发布。

## 复验入口

```powershell
pnpm exec vitest run tests/unit/table-foreign-key-join.test.ts tests/unit/table-foreign-key-join-filters.test.ts tests/unit/table-foreign-key-join-intent.test.ts tests/unit/ui-table-foreign-key-join.test.tsx tests/unit/table-read-sql.test.ts tests/unit/table-filter-enabled.test.ts tests/unit/table-filter-groups.test.ts tests/unit/join-order-native-guard.test.ts
pnpm typecheck
pnpm build
```

原生专项清除认证与模块注入环境，设置 `DBARK_JOIN_ORDER_NATIVE=1`、`DBARK_INTEGRATION_ENABLED=0`，运行 `pnpm exec playwright test tests/e2e/table-foreign-key-join-order-native.spec.ts --workers=1 --retries=0 --trace=off`。

实库专项为 `tests/integration/table-foreign-key-join-filter.test.ts`，须显式 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_JOIN_FILTER_READONLY=1`，配置专用端点身份和安全凭据。真实表模式还需 `DBARK_JOIN_FILTER_PHYSICAL=1`、准确随机库名 `DBARK_JOIN_FILTER_DATABASE` 及 `DBARK_JOIN_FILTER_OWNER`；先单独预置并审核夹具，测试本身不创建或修改表。13484 必须严格 TLS，关闭或跳过不算通过。原始证据留本机 `.cache/join-filter-20261102/`，不提交凭据、测试数据、截图或日志。
