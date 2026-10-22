# 新建表数值生成列

## 实际入口与范围

对象树的新建表表单中，每个字段可选普通字段、VIRTUAL或STORED，并填写表达式。支持多个生成列与普通列交错排列；普通模式切换回来恢复原默认值、自增及时间属性，保留空串、文字NULL、SQL NULL与自有undefined键的区别。改名、删除、重排后重新校验，不自动改写算式或依赖。

生成列仅支持可空整数/DECIMAL，无DEFAULT、自增和ON UPDATE；只引用此前普通、非自增的精确数值列。接受十进制常量、加减乘、括号及一元正负，沿既有2048字符、256词元、16层、32引用预算，渲染后的SQL还须重新解析并保持AST比较键。MySQL尺度至30，MariaDB至38。普通PK、索引和FK可保留，生成列自身作为键、生成链、函数与其它表达式仍待开发。前缀组合保持原准确8.4能力与无FK限制。

## 执行与核验

沿`schema.tableCreate.get/preview/apply`，显式读取真实会话、准确版本、Linux/大小写、InnoDB及目录能力；未知能力仅关闭生成创建，不影响原普通创建。当前能力基线为MySQL5.7.44/8.0.46/8.4.11及MariaDB10.11.19/11.4.13。草稿声明与现表目录分开，不制造COLUMNS或writable权限；库表列名继续安全引用，支持原Unicode及反引号合同。

专属CREATE包含完整结构和已编译表达式，旧整表生成器明确拒绝生成属性。确认页保留原两项确认，另加生成计算确认；后端按固定设计核对准确集合，预览先消费，断线或结果未知不重放、不自动DROP。DDL成功、完整定义核验、资源释放分别报告。

CREATE后交叉核对完整SHOW、COLUMNS、TABLES、分区目录、表达式AST、顺序、类型、存储方式、NULL、默认值、EXTRA与备注；普通索引/FK仍走原完整核验。普通列未知EXTRA、INVISIBLE或目录与SHOW矛盾均拒绝核验成功。最终再读真实能力摘要及SHOW，覆盖后核已观察漂移；这不保证TABLE_ID归属或跨读取原子CAS。

## 当前证据与边界

首次开发检查基于main`5a6ff8ca`加本批冻结修改，本机Windows/Node24.17.0后备：类型PID76784、exit0；51文件1539项相关PID35072、exit0；构建PID73084、exit0；UI与实库默认列表PID47224/17456均exit0。42份日志/进程记录及全部新旧源码输入摘要封存于忽略目录`.cache/table-create-generated-first-local-20261022/`，前后输入不变。WIN11-TEST当时不可达，没有本轮VM执行链。该证据不等同于固定提交完整回归或实库验证。

实库定义`tests/integration/table-create-generated.test.ts`使用独立双门、逐端口独立进程和120秒期限，验证单次CREATE、普通键/FK、两存储、精确写入及收尾；未开启前只登记。原生备用定义`tests/e2e/table-create-generated.spec.ts`默认关闭，必须Root预置准确随机隔离库；它不自行建库、建用户或DROP。完整来源清单和Main IPC旁观尚需独立补齐，不能将备用定义说成已验收。

以上为首次开发检查时点；最终固定提交的完整单元、六实例实库及Windows实际表单结果见文末。macOS及打包目录/真实安装组合另验。O01保持部分，发行计数不增加，暂不发布。

## 固定提交与首轮实库失败

`30fcd82c53e10b131e1b06ae617eecb128c6363b`（src树`6d51128af674fd575d249feb33bb2090c825e3fd`）本机完整回归：类型PID24924、exit0／32.39秒；完整单元PID51136、exit0／309.22秒，707文件通过／1平台跳过、14209测试通过／1跳过；构建PID38028、exit0／34.70秒。原有格式化React act及Vitest参数弃用提示保留，26份封存位于`.cache/table-create-generated-full-local-20261022/`，全部源码和配置输入保持。

首轮真实矩阵在13357停止（PID1968、exit1）。实际5.7.44身份已核，subject单条CREATE成功但definitionVerified=false，未写入测试数据，其余五实例未启动。独立只读生产核验函数确认：普通note的真实SHOW带`COLLATE utf8mb4_bin`，字段目录同值，新用途属性门误拒了合法冗余编码。原DDL、目录和失败保留于`.cache/table-create-generated-13357-inspect-20261022/`；原进程终态、两个表的准确所有者标记、subject空表、parent一行及无其它对象核对后，已精确删除原随机库并确认控制连接关闭，见`.cache/table-create-generated-13357-recovery-20261022/`。本轮没有捕获完整原任务线程ID集合，不补报计数。

补修仅在生成用途完整目录证明后接纳普通字符列编码属性：TABLES有效表配对、SHOW属性与COLUMNS必须一致；缺省COLLATE读取真实CHARACTER_SETS默认，Maria UCA只以显式完整SHOW配对交叉补证。数值/二进制和未知EXTRA门保留；MySQL JSON仅沿既有固有配对准入，生成列与JSON实库组合仍未验。新增真实5.7原SHOW脱敏固定反例，未用renderer生成期望。

该补修的类型PID45596、51文件1550项PID70404、构建PID10768和两默认列表均exit0；42份封存及全部输入保持于`.cache/table-create-generated-fixed-local-20261022/`。固定补修提交的完整回归与新资源矩阵仍需复验，不追认首轮失败为成功，也不重放原CREATE。

`06359d29`第二轮在全新13357随机库中，产品CREATE、definitionVerified及resourcesReleased均通过，随后观察器将真实COLUMNS位次字符串硬比数字而失败（PID2652、exit1）；INSERT尚未到达，其余实例未启动。独立只读核验同一实际定义通过，COLUMNS位次为`'1'..'6'`、索引序号为`'1'`，原目录按自身排序规则将ix_qty排在PRIMARY之前。原件保留于`.cache/table-create-generated-second-native-metadata-20261022/`；第二库已按原标记及无其它对象精确清理，原失败保留。

观察器现仅接受目录小整数的准确数字或规范十进制文本（拒前导零、小数、空白等），索引查询显式按BINARY名称排序；其它类型、存储、备注、NULL及精确数据断言不变。实际纯门44项PID49552、默认列表PID61472及类型PID12072均exit0；25份封存位于`.cache/table-create-generated-observer-fix-local-20261022/`。生产src树没有因观察器修正改变；六实例仍须在新资源中闭合。

## 最终固定提交验收

准确`8dda6963de9b9891edcda43370cd3483984506fc`、src树`d0caf6a5cfc034bfa2bb20ced7225361aece307f`完成[本轮实测](../../tests/integration/acceptance-table-create-generated-8dda6963-20261022.md)。最终本机Windows类型PID43100、完整单元PID10860、构建PID47940均exit0；707文件14255项通过、1平台文件／1项跳过，26份封存及全部输入保持。

六实例各独立进程通过，共8次单条CREATE、16个VIRTUAL/STORED生成字段；六张subject保留普通主键／索引／外键，两张8.4额外核前缀组合，包含严格TLS。精确数值及NULL、单次令牌、原流关闭、线程零残留和六随机库精确清理通过，63份封存。前两轮失败保持原结论，没有追认为成功。

同一准确源码Windows实际表单PID74960、7.23秒／exit0：真实连接、新表两种生成列、重排、预览前零建表、三项确认、精确数值／微秒／字节／NULL及正常退出通过；Root独立读回后精确删库，16份封存，源码／配置／启动文件摘要不变。该例仅为源码功能验收，内部来源清单、Main逐条IPC审计、截图／窄窗及安装验收未具备，不称正式来源链闭合。

候选[CI 39769011981](https://github.com/zhao-yc/DBArk/actions/runs/39769011981)的Linux类型、单元和构建成功；原生矩阵及发行跳过。macOS、本片安装包、真实取消／断线及限权组合仍未验；旧原生CI失败另列于[编译流程记录](typecheck-heap-20261022.md)，不被本批成功覆盖。O01完整工作包及长期目标继续，暂不发布。
