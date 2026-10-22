# 已有生成表达式修改的实际验收

## 准确版本和平台

源码 `c99cf166e24affaa337d33b83d5e278d337c427a`，源码树 `41c7b53b656d68011d080cacf9a700d8e1e3cfed`。本批只补已有数值生成列表达式修改，完整 O01 及长期目标保持未完成；暂不发布。

WIN11-TEST 最新已确认旧回合 completed／空闲；本轮只读准备派单仍报“上一提交尚未确认”，后续快照主机不可达，没有派发本轮测试、实库或 GUI。按已获授权改用本机 Windows／Node24.17.0，未重复旧进程。原始日志及输入清单留在忽略目录，不入库。

最终类型原进程19252，32.13秒／exit0；此前开发类型25072／exit0和新旧十文件368项通过，原进程75608／exit0。完整原进程31328，UTC08:20:38.4670820→08:25:34.9596277，296.51秒／exit0；Vitest 698文件通过／1平台文件跳过，14041项通过／1跳过，295.76秒。完整测试从开始即使用2worker，原断言、默认5秒及专项时限保持；18份封存位于 `.cache/generated-expression-final-windows-local-20261022/`。

固定源码构建原进程37896，35.94秒／exit0；Zod 注释位置和大分块警告原文保留。新旧原生门默认仅列举、无实库或 GUI，进程54392／exit0。构建及列表18份封存位于 `.cache/generated-expression-build-local-20261022/`。候选 [CI 39747451209](https://github.com/zhao-yc/DBArk/actions/runs/39747451209) 的 Linux 类型、完整单元和构建检查成功；候选分支的原生矩阵、可选剪贴板和发行任务均跳过，不称三平台通过。

## 六个真实隔离实例

| 端口 | 实际版本／链路 | 原测试 PID | 秒 | 原连接严格关闭 |
| --- | --- | --- | --- | --- |
| 13357 | MySQL 5.7.44 | 58760 | 7.78 | 16 |
| 13380 | MySQL 8.0.46 | 23284 | 8.44 | 16 |
| 13384 | MySQL 8.4.11 | 75920 | 10.40 | 16 |
| 13310 | MariaDB 10.11.19 | 46616 | 6.92 | 13 |
| 13311 | MariaDB 11.4.13 | 76500 | 7.36 | 13 |
| 13484 | MySQL 8.4.11 严格 TLS | 57880 | 10.77 | 16 |

六个独立进程各1项、退出0。创建前实际核对 hostname／server_id／socket 端口、准确版本、系统／大小写及 MySQL UUID，仅创建本轮随机 `dbark_genexpr_*` 库和唯一 owner 标记表；没有 Docker 或用户／权限操作。实际 Engine 分别修改 VIRTUAL 和 STORED，共12次成功 MODIFY，所有计划强制 COPY，MySQL VIRTUAL 同时 WITH VALIDATION；预览零写入，apply 仅允许本例准确预览 SQL，收到 OK 后完整独立目录和定义后核均 true。

每次修改后比较所有原普通列，含 qty／unit_price、BIGINT、DECIMAL(65,30)、微秒日期时间、Unicode、空值与 BLOB；仅生成值按新式重算。两种存储覆盖负数、30位小数及 NULL，一元正号真实规范化保持；之后明确更新 qty，原行比较仅允许该值改变，两种生成值随之变化。等价表达式拒绝、已用令牌零连接，以及外部表备注变更后旧计划零 ALTER 均通过。

四个 MySQL 实例另将原 TINYINT VIRTUAL 改为会使旧行越界的表达式，原协议错误必须同时符合 errno1264／ER_WARN_DATA_OUT_OF_RANGE／22003；不是接受任意 Error。原语句只投一次、令牌不复用，独立核原定义／目录／数据未变。MariaDB 本轮没有该越界反例，不外推。

90条原连接均观察原 callback 完成、strict close 返回及原流 close／closed；原任务线程 PROCESSLIST 为零。成功清理先核唯一表、owner 标记和无额外例程／触发器／事件，再精确删本例数据库，SCHEMATA核零；observer同流严格关闭。63份矩阵封存位于 `.cache/generated-expression-live-local-20261022/`。

## Windows 正式界面

同一源码及新 dist，原 Playwright 进程29700，14.67秒／exit0，原120秒、0重试、1worker。真实连接表单关闭记住密码，侧栏 subject →“字段差异编辑”→选择 line_total →“修改生成表达式”→新算式→应用草稿→旧新表达式／完整 SQL 预览→四项确认→一次执行。未注入组件、伪造 IPC 返回或用 SQL 入口替代设计器。

独立 mysql2 observer 核预览零变更，执行后原六列目录和两行源数据全量保持，微秒／BIGINT／DECIMAL／NULL／VARBINARY二进制值／Unicode逐值匹配；目标存储、类型、备注和位置保持，真实生成结果按新式增加，NULL继续传播。Main原处理器外只观察审计 get1／preview1／apply1／release2／pending0，三个真实任务 completed，历史为空，无用户查询或其它结构命令。合法 COPY 物理编号变化仅接受逐字匹配的单一提示，其它错误／警告一律失败，不删除产品警告。

来源清单 SHA256 `998da1f036abdddd29353ff33a9618a41c97f4e51456b99ff4938758b59d7fb0`；2316输入前后保持，来源在启动、提交前、结果、退出前、收尾后5个明确阶段完整核验，不称每UI动作全量重读。原 App 正常退出0且其原进程树核清后，才核目标线程零、精确删库和同一 observer 流关闭。15份封存见 `.cache/generated-expression-ui-local-20261022/`；截图仅为已核验状态条，已查看，不冒称完整布局／窄窗专项。GUI仅13384明文 VIRTUAL，STORED／其它版本／TLS界面不继承此结果。

## 失败及未验边界

初次开发类型进程9764，36.92秒／exit2：新原生审计中正则 match 未收窄，定向后续未启动；仅明确 null 时抛错修复，保留 `.cache/generated-expression-initial-local-20261022/`。交叉审查另提前发现实际渲染可增加括号深度，已加输出完整预算重解析与原 ADD／MODIFY 回归；同时补齐越界具体错误码、原 qty／unit_price 比较及 COPY 提示精确白名单。没有失败后放宽时限或删除原产品警告。本轮六实例和正式 GUI 均首次整例通过。

GitHub／连接器网络读取失败与推送连接超时保留；同一候选分支重试推送成功，未强推。旧主分支 `d0114315` 的 [CI 39739338106](https://github.com/zhao-yc/DBArk/actions/runs/39739338106) macOS arm64 六专项显示租约／原native／恢复证明失败仍保留，不被本机或本批 Linux 成功覆盖。

目录缺失、矛盾／漂移、取消／断线、关闭失败、未知结果、混批／注入／预算和失效保护主要为 Engine RAM／React／单元证据。真实长 DDL 取消、ACK 丢失、本片限权账号、macOS及实际安装包未验；结构后核不证明数据级原子 CAS 或全部外部依赖。转换、非数值／完整表达式、新表／分区等仍待开发。没有剪贴板、Docker、密钥证书、发布或部署操作。
