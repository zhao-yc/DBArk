# SQLite 全表不同值按次数排序

## 使用

表／视图页展开“筛选与排序”，打开“从数据库不同值筛选”，在“SQLite分组排序”选择原类型／值顺序、次数最多或次数最少，再明确读取。数据库先对符合已应用条件及搜索的全部记录分组、排序，最后取 500+1 判断截断；不是重排已返回的前 500 组。

切换排序不自动查询。已有勾选时先确认丢弃，取消保留旧排序及完整勾选；接受后只清空候选，仍须明确重读。勾选后先加入条件草稿，再点击表页应用；同次数沿原存储类型、值及列排序规则，不把不同类型的同显示值合并。

范围、精度与原值沿用[原全表不同值入口](sqlite-value-options-20261102.md)。不含未提交数据，搜索先过滤记录再分组，计数为搜索后行数；最多返回 500 组／每页 50 组／勾选 128 组。无穷 REAL 仍仅可展示，不将其转换为有限近似。

## 实现与兼容

原 `sqlite.valueOptions` 严格合同增加可选受限 `order`：`value`／`count-desc`／`count-asc`。缺省继续旧协议与旧 SQL 顺序，控制器不从父 base 继承隐藏排序；回包绑定本次完整请求，并用 BigInt 检查次数单调性。不会按展示字符串或浮点近似验证。

原查询只在 GROUP BY 后增加固定 COUNT 排序，500+1、原编码核验、返回预算、只读事务和清理保持。复用原 taskId 墓碑、独立 utility、Main 文档／连接修订发布门；原读取和取消 ACK 两侧终态前不释放租约。不改配置存储、凭据、用户查询会话及写协议。

## 实测

WIN11-TEST 本轮不可达、未派发；按既有授权本机 Windows 验证，仅用独占临时 SQLite，不使用 Server-200、Docker、剪贴板或已安装配置。

- 最终五文件 81 项通过。真实 Node worker 的表与视图各用 646 行／532 组：默认前 500 组之外的热门值返回 100 行，次热门 9 行，TEXT 的 `2` 为 3 行；INTEGER／REAL／NULL／BLOB 分开，NOCASE 同组计数保持。原筛选后的次热门为 5 行，搜索仍为这 5 行；全部原类型及字节逐行不变。
- 真实消息检查 COUNT 排序在 LIMIT 501 前、`options.maxRows=501`，全部独立只读进程正常 exit0、无强停。原值序及最多／最少三种真实阻塞分组取消各完成，准确原 utility 被取消，用户标签事务保持打开并可回滚。
- 原 IPC 有效枚举原样透传，未知排序在投递前拒绝；回包绑定、64位计数、双终态屏障、旧事件 ABA、输入法、丢弃确认、父级拒绝与原条件保持均覆盖。
- Windows 正式源码客户端一例通过，用例 7.739 秒、运行器 9.319 秒，原 120 秒／单 worker／零重试，零跳过／flaky。真实连接表单、树、只读物理表、Main 与独立 utility 全程透传，四次显式候选读取，零用户 SQL；没有替换数据库结果。
- 原生物理表 640 行／529 组，验证默认截断、100／9／3 数值序、切换拒绝／接受后明确重读；最少次数下勾选 REAL 的 `2` 只返回第 636 行，不误选 INTEGER 或 TEXT。加入草稿不读表，明确应用热门值后第一页准确为 521–525。五次分页及四次候选原请求／回包保留，磁盘 640 行完整保持。
- 最后正常 exit0，所属进程与临时目录经独立 CIM／路径核不存在。实际截图已审阅，Main 原始审计、窗口终态及摘要在私有 `.cache/sqlite-value-frequency-20261103/attempt02/`，不入库。

最终类型检查与生产构建退出 0。最后仅修改专项确认适配器后再次严格类型通过，产品和构建未变。默认关闭及 `--list` 均通过登记检查，不启动桌面或创建数据库。

首轮单元失败是新断言误读 `maxRows` 的协议路径，已改为 `options.maxRows`，原 501 门槛不变。首轮原生已读通最多次数，随后 Playwright 不能通过 CDP 回答 Electron confirm；该轮正常退出未证实、准确 PID 已无、未由 Root 强停，原日志及目录保留。仅改用现有一次性准确 message 的 Electron Main 确认适配器，实际拒绝／接受记录及恢复均核对；不冒充操作系统按钮输入。文件 chooser 也仅适配准确独占文件路径。

本轮完整窗口仅验证物理表，视图另有真实 worker 证据；Mac、安装包、系统确认／chooser 输入及完整平台组合仍另验。不增加完整工作包或发行计数，暂不发布。

## 复验命令

```sh
pnpm exec vitest run tests/unit/sqlite-value-options.test.ts tests/unit/ui-sqlite-value-options.test.tsx tests/unit/main-sqlite-table-browse.test.ts tests/unit/sqlite-value-options-parent.test.ts tests/unit/sqlite-table-browse.test.ts --maxWorkers=1
```

完整窗口设置 `DBARK_INTEGRATION_ENABLED=0`、`DBARK_SQLITE_VALUE_FREQUENCY_NATIVE_TEST=1` 后运行 `node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-value-frequency-native.spec.ts --reporter=json`。禁止外库认证环境，保留原配置和失败现场；确认原句柄终态后才能接续新轮。
