# 表勾选值筛选验收

## 源码与实际平台

代码提交`fbc9e471ee7b0095c9f5ecbe7c400a6373040492`，src树`15ca9943ddefc59cd1558bd7004b905680afebcd`。本轮在开发电脑Windows源码App验证；WIN11-TEST状态快照可读但随后read_thread超时，原b641任务已终结，本轮未向VM派发，按用户授权本机接续，不重复原任务。

## 准备、失败与修正

| 回合 | 原进程及结果 | 保留结论 |
| --- | --- | --- |
| 首次相关检查 | PID6976，363通过／1失败 | 新RAM测试误用支架不支持的class选择器，尚未到筛选断言；仅改为按真实属性定位 |
| 定位修正 | PID59856，364通过 | 中间检查点，不代替最终完整版本 |
| 同步条件反例先红 | PID10060，2失败／10筛选跳过 | 真实TableTab旧应用覆盖尚未提交的手工条件／模式，证实同步撤销缺口 |
| 同步修复后旧夹具 | PID23460，386通过／11失败 | AST／VM提取器缺新增selectedFilterRef，补5个生产初始空引用，保留原断言 |
| 扩展夹具复验 | PID44708，548通过 | 原两个条件反例已绿；随后最终版本再加入确认期间连接ABA |

修复在普通`canReload`确认成功后、setState排队前同步撤销旧提案。唯一owner例外是本提案自身应用；它不会清除invalid，也不会撤销后来不同的预览，仍在确认前后核完整来源。拒绝丢稿保留原条件、页、草稿和可重试预览。原失败日志与退出码不追认为成功。

## 最终源码检查

| 命令／范围 | 原PID | 终态 |
| --- | --- | --- |
| `node scripts/typecheck.mjs` | 64132 | exit0，34.109秒 |
| 28文件定向Vitest，2 workers | 63324 | 549通过，exit0，17.084秒 |
| 完整Vitest，2 workers | 61172 | 15012通过、1条件跳过，exit0，318.132秒 |
| `node scripts/build.mjs` | 67408 | exit0，38.531秒 |
| 原生定义最终类型／默认关闭列表 | 65384／71576 | 各exit0，31.928／0.595秒 |

完整回归后仅调整原生测试定义：分页前置上限16收紧为10，并附原分页记录；产品src和单元文件字节保持，未重跑无关完整套件。最终类型、默认关闭列表和实际原生轮使用同一定义；2410个输入与原生实际来源、编译dist逐项匹配。

覆盖独立三值逻辑真值、旧OR／嵌套／启停整体AND、精确字符串及原型同名列、原值与完整勾选集合、重复值、空串、访问器拒绝及不消费自定义迭代器、200集合及完整共享预算；真实React接线覆盖取消／重试、旧事件、同轮条件／模式及选择／连接ABA。静态复核不替代下述实库结果。

## MySQL8.4正式窗口

Root在200服务器13384核对实际版本、主机、UUID、端口后，仅预置本轮唯一随机库及subject表。夹具121行，含UINT64范围id、精确DECIMAL、NULL／空串／重复文本；无Docker、新用户或GRANT。

原Playwright PID64640，UTC `2026-10-22T16:53:10.8884315Z` 至 `16:53:25.9652710Z`，exit0，15.098秒；1例通过，零失败／跳过／重试。正式连接不保存密码，完整来源清单五阶段复读通过。

1. 正式手工条件`id <= 边界61 OR id >= 边界101`匹配82行，双列排序为id升序、amount降序；50行页大小，第二页32行。
2. 第二页勾选NULL和空字符串，旁列amount暂存修改后打开预览，原勾选2行、非NULL唯一值1、完整`""`及NULL展示正确，分页次数保持7。取消保留原草稿，实际Undo恢复原值后才重新生成并应用。
3. 包含组与旧OR整体AND后返回第一页42行，超过刚才32个已加载行；完整输入、分组、精确原行id集合与排序均核对。
4. 仅勾选空字符串后排除，正式新组为`NOT IN ('') OR IS NULL`，保留22行NULL；再排除仅勾选的NULL得到空集。全过程保留原双列排序，三次应用各只重读一次。
5. Main有限观察只透传原正式处理器，前置拒绝第11次分页和正文／产品写入，实际总分页10、写入0、执行历史0、pending0。原分页输入和回包id留在私有附件，Root按原全表独立重算并核对；这不是完整Main逐条IPC审计。

原App正常退出0，原观察socket严格关闭，目标线程0。Root再核原全部定义和121行数据均未改变，核随机owner、仅原一表、无触发器／例程／事件或残留线程后精确删库，读回不存在，原Root控制socket关闭。

## 私有原件索引与边界

以下位于`.cache/`且不入Git：

| 目录 | manifest SHA256 |
| --- | --- |
| `selected-filter-targeted-local-20261023` | `5b10bea518935f06a00bcb622dc4799864c8977fa64c5df1d3fd11b2ff14a0f1` |
| `selected-filter-targeted-fixed-local-20261023` | `f89109af416ce71adffc19ddbcaf3ad3e16b20b29ecf8bce201c65c0c7632e88` |
| `selected-filter-aba-red-local-20261023` | `861b3608db5a8df20204809cfbb91fd3258a84bb82890c39be72ad28e3a2d683` |
| `selected-filter-sync-fixed-local-20261023` | `dce91e3b096d4591a7be5a3bf35a7a9948069d7a4b7fec3bfcd0611c9fba4e3e` |
| `selected-filter-context-fixed-local-20261023` | `908fc6275bd2541d74ce63718b5454c0b8803bc1114eb8d5986b8eb16579e397` |
| `selected-filter-complete-check-local-20261023` | `24a57c8838bd2752b11a1bd9f9eaf3a496e69687bda623bcc3502873a5dc8421` |
| `selected-filter-native-definition-check-local-20261023` | `d62c595537d1da7e8bf7b5073cce75487ddafc9096593174f9ad7952c2722e11` |
| `table-selected-filter-ui-local-20261023` | `975d25e62e9725b7d39ce6d8cb52299991a6a1efb93b8b0fbb5ab67852676fa3` |

原生批准来源清单SHA256：`aec6e32e8732ed7ca8531873e6fd438dbfc8649ed003330d2efe85df0daebeeb`。截图SHA256：`5746fe433ea65777f8396c48f92230b3eb2bff45e19752a8ac76b550b8c94c74`，人工复看只记录预览上部的原值及NULL，不外推完整窗口布局。

本轮没有系统剪贴板或实体快捷键输入。实库新组合只验MySQL8.4明文及字符串／NULL成员，确认拒绝、数字成员和其它异常边界为RAM证据；其它五实例、SSH／TLS、安装包、macOS另验。候选CI39817846291查询时进行中，不计已通过。完整Navicat工作包与发行计数不增加，暂不发布。
