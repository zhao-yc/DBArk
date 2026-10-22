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

完整单元、六实例实库、Windows实际表单、macOS及打包目录/真实安装组合待分别记录。O01保持部分，发行计数不增加，暂不发布。

## 固定提交与首轮实库失败

`30fcd82c53e10b131e1b06ae617eecb128c6363b`（src树`6d51128af674fd575d249feb33bb2090c825e3fd`）本机完整回归：类型PID24924、exit0／32.39秒；完整单元PID51136、exit0／309.22秒，707文件通过／1平台跳过、14209测试通过／1跳过；构建PID38028、exit0／34.70秒。原有格式化React act及Vitest参数弃用提示保留，26份封存位于`.cache/table-create-generated-full-local-20261022/`，全部源码和配置输入保持。

首轮真实矩阵在13357停止（PID1968、exit1）。实际5.7.44身份已核，subject单条CREATE成功但definitionVerified=false，未写入测试数据，其余五实例未启动。独立只读生产核验函数确认：普通note的真实SHOW带`COLLATE utf8mb4_bin`，字段目录同值，新用途属性门误拒了合法冗余编码。原DDL、目录和失败保留于`.cache/table-create-generated-13357-inspect-20261022/`；原进程终态、两个表的准确所有者标记、subject空表、parent一行及无其它对象核对后，已精确删除原随机库并确认控制连接关闭，见`.cache/table-create-generated-13357-recovery-20261022/`。本轮没有捕获完整原任务线程ID集合，不补报计数。

补修仅在生成用途完整目录证明后接纳普通字符列编码属性：TABLES有效表配对、SHOW属性与COLUMNS必须一致；缺省COLLATE读取真实CHARACTER_SETS默认，Maria UCA只以显式完整SHOW配对交叉补证。数值/二进制和未知EXTRA门保留；MySQL JSON仅沿既有固有配对准入，生成列与JSON实库组合仍未验。新增真实5.7原SHOW脱敏固定反例，未用renderer生成期望。

该补修的类型PID45596、51文件1550项PID70404、构建PID10768和两默认列表均exit0；42份封存及全部输入保持于`.cache/table-create-generated-fixed-local-20261022/`。固定补修提交的完整回归与新资源矩阵仍需复验，不追认首轮失败为成功，也不重放原CREATE。
