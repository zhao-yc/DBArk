# Q01 会话元数据边界与解析器初始化（2026-10-15）

状态：0.16 开发中，Q01 和 Navicat 总目标保持部分。本页接续[会话临时对象检查点](acceptance-q01-session-objects-20261015.md)。视图确认、元数据完整性和初始化修正已实现；本机最终桌面回归及固定 e9ed54d 的三平台原生矩阵已通过，不把本检查点的安装结果用于后续输出别名源码。

## 用户入口与行为

工具栏“会话临时对象”现在接受“表或视图名称”。实际返回的 Create Table 与 Create View 分开确认，陌生或冲突格式不确认无临时遮蔽。永久视图只恢复指定名称的普通目录，不执行其正文或函数，也不清除其它对象的待核对状态。同名临时表仍遮蔽永久视图；删除临时表后可以显式确认恢复。查询正文、既有结果和原连接保持。

MySQL 支持生成隐形主键时，显式读取还会查询本会话的显示策略。策略为 OFF 时仍返回当前能读到的字段，但目录、结果和界面都明确标部分，不显示“完整已确认”；用户自己恢复显示后可再次读取完整字段。读取不修改该变量、SQL 模式或名称引用设置。[MySQL 变量文档](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_show_gipk_in_create_table_and_information_schema)说明该策略影响 SHOW 和信息模式，且不支持 SET_VAR 提示覆盖。

六实例研究 `run131-session-read-boundaries.json` 确认：读取视图定义没有执行其函数；关闭引用及 MySQL ANSI_QUOTES/NBE、MariaDB ANSI/ORACLE/NO_*_OPTIONS 下仍能识别 TEMPORARY 并取得字段可见性。普通和 EXTENDED SHOW COLUMNS 在 GIPK 显示为 OFF 时都会省略生成主键，不能把 EXTENDED 当作绕过。[MySQL SHOW CREATE 文档](https://dev.mysql.com/doc/refman/8.4/en/show-create-table.html)支持视图；[MariaDB 文档](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-create-table)说明兼容模式对输出的影响。实现按元数据种类和实际字段读取，不重建返回定义中的引用名称。

## 本机分层证据

原件位于忽略目录 `.cache/o16-sql-completion/`；每轮保留正式 JSON、原日志与输入摘要，不覆盖失败。不同阶段可执行范围分别核对：单元对应生产模块及 unit，后端对应 engine/shared 及实际执行的用例，构建对应源码/依赖/构建脚本，桌面对应最终产物及 e2e；不把未执行的其它目录文档当成测试程序。

| 层次 | 已取得证据 |
| --- | --- |
| 全单元 | `run145-session-warmup-unit`：2065 通过，102 文件，0 失败/跳过；包含真实 Worker 入口内存打包及独立语法初始化 |
| 类型 | `run146-session-warmup-types`、最终 `run160-session-read-final-types` 退出码 0 |
| 构建 | `run147-session-warmup-build` 退出码 0；启动8秒与用户分析2秒保持原值 |
| MySQL5.7 / 13357 | `run139-session-read-five`：35 通过，4 条件跳过 |
| MySQL8.0 / 13380 | `run140-session-read-eight`：38 通过，1 条件跳过 |
| MySQL8.4 / 13384 | `run156-session-read-primary-large-metadata`：39 通过，0 跳过，显式启用大定义扩展 |
| MariaDB10.11 / 13310 | `run141-session-read-ten`：36 通过，3 条件跳过 |
| MariaDB11.4 / 13311 | `run157-session-read-maria-large-metadata`：37 通过，2 条件跳过，显式启用服务器上限扩展 |
| 严格TLS / 13484 | `run158-session-read-tls-final`：38 通过，1 条件跳过，CA与目标身份校验保持 |
| 初轮读取UI | `run144-session-read-desktop`：18 通过，0 失败/跳过/不稳定；本轮初始化修正前的证据 |
| 最终桌面 | `run159-session-warmup-regression`：30 通过，0 失败/跳过/不稳定，200074 ms |

六实例合计223通过、11条件跳过，包含视图确认不执行函数、只确认单名、临时表遮蔽视图、引用/兼容模式及显示策略不变。5.7/MariaDB不支持的GIPK、5.7不可见列及未开启的大定义范围分别明确跳过。大定义实际接收/预算路径只在MySQL8.4验证；MariaDB验证服务器拒绝创建后会话仍可使用，不能混称为已读回超8MiB定义。其它三个较早矩阵轮次与最终 engine/shared 模块相同，后续只改变了被这些端口跳过的压力夹具及渲染线程初始化。

`.cache/o16-session-read-warmup-attestation.json` 记录真实构建依赖图：后端53个源依赖与各矩阵轮次相等；三个较早用例文件仅其被跳过的压力扩展发生后续修改，逐字节复原旧块后的全文SHA与当轮输入相等，其它已执行用例未变。单元、最终类型、构建及E2E分别核其实际执行输入；产物105文件另存完整摘要。`run162-session-read-warmup-resources-cleanup.json` 独立核六实例本批前缀库/用户/相关线程、本机项目进程及本批临时目录全部为零，13个历史目录保留。

## 压力用例、OOM 与资源恢复

`run134` 为37过1失败：INT返回数字42，测试误期待字符串，保留原件并修正该类型断言。`run135` 的大量列注释没有形成预期的返回字节数，未触发读取上限，不能以发出的 SQL 长度替代实际返回预算。改用默认表达式后 `run136` 原39项通过。

大量列/默认值的夹具在 MariaDB 超过服务器定义上限，原 `run142` 36过1失败2跳过；区分后 `run148` 37过2跳过。`run149` 在 MySQL8.4 大定义创建时服务端断开，后续会话套件无法初始化，27过1失败11未执行。只读核查 `run151/run152` 确认唯一 DBArk 隔离容器 OOMKilled=true、退出137，原内存上限768MiB，端口13384；没有把后续未执行用例算通过。

在同一SSH脚本先核Server-200/192.168.31.200，再只启动原容器，保留原卷、端口和限额。`run153`读取残留结构及表级SELECT授权；`run154`核对无活跃相关线程、结构/授权与失败夹具一致后，仅删除两个精确随机库及一个精确 cp_* 用户，并核零。没有前缀批量删除，也没有客户端重放中断写入。

压力扩展改为单列9MiB默认表达式，必须 `DBARK_TEST_LARGE_METADATA=1` 明确开启，默认后端回归跳过。`run155`发现MariaDB单个默认表达式的限制文案与多列表定义不同；按其实际错误固定断言后，`run156`的MySQL真实返回超8MiB被客户端拒绝并排空，`run157`的MariaDB在创建阶段拒绝，二者均保持原连接和其它对象可使用。`run161`核原容器仍running/OOMKilled=false、内存上限及端口未改；当前用量约324MiB，cgroup记录峰值约768MiB，不能把通过解释成压力负载没有触及资源边界。客户端元数据预算也不等于服务器DDL内存或驱动单包分配的上限。

## 固定35b2748的原生失败及当前修正

[CI38680783704](https://github.com/zhao-yc/DBArk/actions/runs/38680783704) 对应35b27483277075212100282fcf984a2b730fbf14，终态failure：2053单元通过；Windows x64与macOS arm64源码/真实安装各23通过119私网跳过；macOS x64源码23通过，实际DMG安装22通过1失败119跳过。不能将两个平台通过推广到x64安装。私网跳过不等于Mac实库通过。

原件在 `product-validation/main-ci-38680783704/`，包含终态run/jobs、四份完整日志和失败artifact。ZIP已独立下载并核GitHub digest `409bb6fac9dc48b7b9353ec037cf3443364af8354d71a9a88aba5b2d706365c3`。错误快照与截图显示第二个独立编辑器首次补全为“补全分析超时”；首个已通过，第三个未到达。`.cache/o16-session-objects-ci35b-attestation.json`固定源码、各阶段数量及失败位置，原失败不改写或盲目重试。

当前修正让Worker在本地固定样本完成真实语法预测与CTE投影收集后才发ready，初始化失败直接发unavailable并终止待发请求。用户SQL在有效就绪前不交付，不自动重试，也不使用样本列充当候选。单元用不同实际投影确认结果隔离，并用真实Worker入口核握手及非法请求；既有取消、迟到消息和两个期限守卫继续保留。失败快照只证明分析期限耗尽，首次预测初始化是据此采用的修正方向，不能声称所有历史偶发失败都已定位。

固定 `e9ed54d30699b1e97c98634acd2dddea32575b73` 的 [CI 38684037623](https://github.com/zhao-yc/DBArk/actions/runs/38684037623) 已终态成功：2065 单元通过；Windows x64、macOS x64、macOS arm64 的源码和真实 NSIS/DMG 安装各 23 通过、121 私网跳过。每轮三个独立编辑器的首次 Worker 补全均完成，合计 18 次；三个安装任务均报告本次安装及临时目录清理。原完整日志及固定 SHA、阶段数量、清理摘要校验保存在私有 `main-ci-38684037623` 和 `o16-session-read-warmup-native-attestation.json`，不覆盖旧失败记录。这证明本次原生回归通过，不证明私网实库或后续投影别名代码已在安装包验收。

## 后续

补齐服务器端长元数据等待的界面取消、断线/关闭迟到响应和其它兼容语法，继续投影别名、ORDER/GROUP/HAVING、窗口及LATERAL等作用域。后续源码仍须独立的原生复验；当前还需Windows实际安装实库及macOS相应私网实库验收。旧完整137与其它已发布版本不能替代本批范围；0.16尚未建tag或公开资产。无新长期密钥证书，认证环境及研究原件均不进仓库。
