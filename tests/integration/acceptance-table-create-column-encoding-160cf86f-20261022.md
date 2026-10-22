# 新建表字段编码实际验收

## 准确版本与平台

源码`160cf86f03a037dab053e5cbd6bcf81744fd0fe7`，src树`401fbef7df5dab6ec7c32e4d88afae9f502cc250`。本批为新表逐列字符集／排序规则；完整O01及长期Navicat目标保持进行中，暂不发布。

WIN11-TEST旧b641回合已确认completed／空闲，新派单仍返回“An earlier turn submission is not yet confirmed”，没有派发本批测试。按用户授权在开发机Windows／Node24.17.0后备执行，未重复VM原任务。原日志、私有配置和真实观测仅留忽略目录。

类型原PID48596，35.17秒／exit0；65文件1970相关项PID38704，29.67秒／exit0；构建PID54672，34.66秒／exit0；默认实库／原生列表PID49896／76472均exit0。43份封存位于`.cache/table-create-column-encoding-default-fix-local-20261022/`。固定提交完整回归在启动时逐字比较全部生产／测试／脚本／配置源输入与该轮原输入，证明同字节后复用类型与构建，未将重复执行当作新增证据。

固定提交完整原进程26232，UTC12:14:24.6921794→12:19:43.4234808，318.75秒／exit0：714文件通过、1平台文件跳过，14477项通过、1项跳过。2356份源码／构建输入前后不变，11份封存见`.cache/table-create-column-encoding-final-full-local-20261022/`；原React act与Vitest参数弃用提示保留。候选[CI 39776410555](https://github.com/zhao-yc/DBArk/actions/runs/39776410555)准确同一提交已成功，候选分支只运行Linux类型／完整单元／构建，原生矩阵及发行跳过。

## 六个真实隔离实例

| 端口 | 版本／链路 | 原PID | 秒 | CREATE | 原非observer线程 |
| --- | --- | --- | --- | --- | --- |
| 13357 | MySQL 5.7.44 | 38704 | 5.78 | 1 | 5 |
| 13380 | MySQL 8.0.46 | 11776 | 6.61 | 1 | 5 |
| 13384 | MySQL 8.4.11 | 27268 | 6.98 | 2 | 9 |
| 13310 | MariaDB 10.11.19 | 67884 | 6.40 | 1 | 5 |
| 13311 | MariaDB 11.4.13 | 43048 | 7.31 | 1 | 5 |
| 13484 | MySQL 8.4.11 严格TLS | 52100 | 6.38 | 2 | 9 |

六个独立进程各1项、退出0；每例先核真实hostname／版本／socket端口／server_id及适用UUID，只创建本轮随机`dbark_ccenc_*`资源。共8次单条CREATE，每表2行；VARCHAR／TEXT明确utf8mb4_bin、latin1_bin，表默认utf8mb4_general_ci，普通键及subject外键、STORED数值生成列共存。两个8.4另核latin1 VARCHAR(4000)的3072字符前缀：按列MAXLEN1准确为3072字节，3073请求零DDL拒绝，未自动截短；该前缀组合沿原无外键边界。

预览零写、错误名称确认消费原令牌、重新预览后一次CREATE、旧令牌不可重用均通过；返回四项事实明确记录。独立SHOW／COLUMNS逐列顺序、存储、类型、默认与实际配对吻合；BIGINT、生成值、NULL及UTF8／latin1 HEX和OCTET_LENGTH精确相符。latin1_bin实际语义：Caféÿ匹配1，caféÿ匹配0，不只检查目录名称。

38个原非observer线程的实际ID集合逐端口采集，严格关闭和PROCESSLIST无残留；另六个observer均核原流close。清理前核准确表名／owner备注、parent原行及无额外触发器／例程／事件，精确删六随机库并读回SCHEMATA为空。63份封存见`.cache/table-create-column-encoding-live-default-fixed-local-20261022/`，源码、私有配置和身份输入摘要保持。

## Windows真实表单与来源

同一源码和新dist，原Playwright PID9744，UTC12:13:35.4746485→12:13:46.0484257，10.60秒／exit0，原120秒、1worker、0重试。Root预置唯一随机`dbark_e2e_ccenc_*`库，实际连接表单关闭记住密码；经对象树新建表，读取真实目录后为两列分别选择utf8mb4_bin与latin1_bin，另一字符列保持继承，重排后配对随原行保持。

预览前observer证实表不存在；多余空格的名称确认仍禁用按钮，准确名称及两项原确认后才创建。独立目录证明两列显式配对及旁列继承真实表默认，数值／二进制列仍无字符编码；源行BIGINT、6位DECIMAL、NULL、空串和原字节逐项相符。任务列表get2／preview1／apply1全部completed，历史与用户查询为空；这是产品任务观察，不冒充Main逐条IPC审计。

批准来源清单SHA256`97169959866a3dc3ab96af8237be18fac207ade45139caff924d08cf43698d8e`；批准集合包含实际Electron、default_app.asar、package、dist和原启动检查脚本，五阶段全量重读，并核实际App路径／资源／进程身份。确认区域截图已查看，只证明该状态，不称窄窗／全布局专项。原进程正常退出码0，observer原流关闭；Root再次独立读完整定义、所有列配对、精确数值与字节，确认零数据库连接和无其它对象后精确删库。17份封存见`.cache/table-create-column-encoding-ui-local-20261022/`，2356份源码／构建输入保持。Main逐条IPC审计、macOS和安装版未验。

## 失败记录与边界

首次开发检查类型通过，64文件1945通过／4失败；夹具误共享完整COLUMNS与TABLES补丁对象导致四反例在更早目录被拒，未到待测路径。已分离对象，完整目录必须到达、原SHOW／简目录不变及所有原执行门保留；原19份封存保留。

固定6748f954首轮13357／PID19316／exit1，CREATE实际存在但核验期待失败，其余五实例未启动、尚未INSERT。只读实际生成专属核验返回true；外层把合法省略默认COLLATE当不符。补为真实TABLES＋CHARACTER_SETS默认交叉证明，不硬编码默认名称，不接纳显式矛盾。原进程终态及准确对象／空subject／parent原行／无额外对象和连接核对后，原库已精确清理，控制流关闭；原11份失败与只读／恢复记录保留，不重放原DDL，不追认为成功。此首轮未采完整线程集合或四项返回实际值，不补报。

旧main9d58e43a的CI39770899567：三个原生平台作业成功，但Linux完整单元超1MiB文档用例原5秒超时。测试全字节比较改用原生Buffer.equals，存在性、全部字节、零写盘／孤儿保留与原期限不变；旧日志无阶段耗时，不能宣称根因已证。新候选Linux结果另记，不抹去旧失败。

CHAR／ENUM／SET显式配对及失效、权限／取消／断线、目录矛盾等主要为RAM证据；本轮实库为VARCHAR／TEXT，生成共存实际STORED，VIRTUAL及其它类型组合另验。GUI只测13384明文Windows源码；没有本片真实安装、Mac或真实长DDL取消。前后目录读取不提供原子CAS。没有剪贴板、Docker、新用户／授权、密钥证书、发行或部署操作。
