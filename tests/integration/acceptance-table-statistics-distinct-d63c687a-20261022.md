# 表字段不同值计数实际验收

## 准确来源与检查

提交`d63c687ad6a06359beec1695e35a844777510a9f`，src树`2eef20141a92359e0fae940132ca0fb72cec5988`。本轮在开发机Windows／Node24.17.0执行：WIN11-TEST原b641回合已completed/idle，新只读准备仍未确认且后续状态返回主机不可达，本版未向VM派发测试；按用户明确授权回退，不混称VM、macOS或安装版。

修改输入在6c4基线上按字节绑定，检查前后全部源码／测试／脚本／配置保持，随后提交为d63。类型PID56560／33.36秒；64文件1694项相关回归PID64972／25.74秒；完整单元PID12072，UTC15:02:00.1093313→15:07:06.4073576，306.32秒；构建PID4968／33.07秒，均exit0。完整732文件通过／1文件跳过，14919项通过／1项条件跳过。原React act及Vitest弃用提示保留。实库／原生默认关闭列表PID61688、75112均exit0。51份封存在`.cache/table-statistics-distinct-fixed-check-local-20261022/`。

另有准确diff `6c4a8920→d63c687a`的独立只读正确性审查：未发现确定新增缺陷，覆盖原列去重语义、计数／类别／默认兼容、请求冻结和取消守卫；审查者未运行测试，不把该结论当作平台复验或全仓安全证明。

## 六个真实实例

| 端口 | 实际版本／链路 | 原PID | 秒 | 非observer原连接 |
| --- | --- | --- | --- | --- |
| 13357 | MySQL5.7.44 | 16076 | 7.59 | 20 |
| 13380 | MySQL8.0.46 | 63144 | 7.79 | 20 |
| 13384 | MySQL8.4.11 | 64092 | 7.40 | 20 |
| 13310 | MariaDB10.11.19 | 41188 | 7.73 | 20 |
| 13311 | MariaDB11.4.13 | 54696 | 8.32 | 20 |
| 13484 | MySQL8.4.11严格TLS | 60292 | 7.89 | 20 |

各进程1项／120秒／0重试／exit0，先核真实身份和适用UUID，再各建唯一随机`dbark_tabstats_*`库。沿[上一片](acceptance-table-statistics-cc43008a-20261022.md)的123条固定数据和subject／subject_view两个对象，新增原列不同值计数：BIGINT、DECIMAL、微秒时间各3；全NULL为0；BLOB为3，区分空字节／00／00FF；ci文本为2；FLOAT为3；BIT64为2。过滤ALPHA后ci文本不同值1，两个相邻大整数仍为2。空集明确计数0，其它聚合仍NULL。

原有默认不带distinct、COUNT-only、组合筛选、UINT64 IN／NOT IN／区间、视图及未提交第124行隔离全部保留通过。实际聚合无警告才发布，不通过改警告门获得成功。120条原非observer连接包含114条独立统计的strict原流close及6条握手原关闭，原ID在PROCESSLIST无残留；六observer另核原流关闭。核原123行／聚合／视图定义／owner及无额外对象后，六随机库精确DROP并读回不存在；63份封存在`.cache/table-statistics-distinct-live-local-20261022/`。

## Windows正式窗口

Playwright原PID47188，UTC15:10:31.0397214→15:10:43.4934373，12.48秒／exit0，120秒／1worker／0重试，仅13384明文源码。正式连接表单不记密码、页大小实际选择50，父首行金额仅暂存0.000001，服务器原金额保持。先运行原COUNT及五字段普通统计，再勾选不同值：旧结果清除，原statistics任务数仍2；点击开始后新增第三次读取。

不同值新列id123／amount106／measure112／payload99与独立固定SQL观察一致；JSON明确不支持。原SUM／AVG、NULL、字节、父草稿保持、撤销、空结果、清筛选及视图62行路径保留。共6个统计任务completed，历史为空，无preview／apply／schema／query.execute任务；Main逐条IPC审计false。

App正常退出exit0、数据库其它线程0、observer严格close；Root独立读完整SHOW、subject123行及view62行，与预置快照相同，核owner／无额外对象后精确清库，Root控制流close。来源清单SHA256`185f7b51d8fe30eea515956efb274ce1b78e9a97a6051ef0051e3b111985eb67`包含实际Electron／default_app.asar／package／dist／启动脚本，五阶段完整重读。区域截图SHA256`88d9355265911179177aa5631e542a2be29cdbddfba4efc83b009fae0177d43c`已人工查看，不外推窄窗／缩放或全部布局。18份封存在`.cache/table-statistics-distinct-ui-local-20261022/`。

## 原失败及额外诊断

首轮类型PID27748／exit0；相关PID48172／25.36秒／exit1，1693通过／1失败，完整和构建未启动。唯一新反例把undefined原流字段误预期为统计解码错误，实际原协议预算先以“驱动返回了不能无损序列化的字段类型”拒绝。仅修对应错误预期，其它值仍要求原“无效”，拒整包／控制次序／close断言保留，产品门未改变。21份原失败、原测试全文和dirty二进制patch封存于`.cache/table-statistics-distinct-check-local-20261022/`。

另因[MySQL BLOB／TEXT排序说明](https://dev.mysql.com/doc/refman/8.0/en/blob.html)涉及max_sort_length，六实例执行固定只读派生值诊断，不能把一般DISTINCT排序限制直接当作COUNT聚合结论。两个值前70000字节相同、末字节不同，原字段包类型252（BLOB），实际COUNT(DISTINCT)均2、最长70001字节，原EOF0／SHOW WARNINGS空，原控制流close；未建对象。6份封存在`.cache/table-statistics-distinct-long-values-20261022/`。此项不是产品或真实表长值验收，也不外推其它版本／内存临时表转换。

本片无安装包、macOS、百万行去重性能、真实权限／断线／取消／漂移故障注入或完整数据分布证据；相关边界主要为RAM测试，长值实际表组合另验。未使用Docker、剪贴板、新用户／GRANT、密钥证书、发行或部署。完整D09和全功能目标保持进行中。
