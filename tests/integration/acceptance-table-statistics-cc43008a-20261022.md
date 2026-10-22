# 表数据统计实际验收

## 固定来源与平台

六实例准确提交`004a1c2e4fc5a94c9a6b239a0c78f89d2c80f027`；正式窗口准确`cc43008a04ad6b88f4145dbe190dbc11fd270e9b`，后者仅修原生测试页大小准备。生产src同树`055baad23528f5152900438699fe666b8d7c5385`。完整D01、Navicat目标与发行保持进行中，暂不发布。

WIN11-TEST曾重新可读且旧回合completed/idle，随后准备派单返回未确认、状态查询连续主机不可达；本版测试未派发到VM。按用户明确授权回退开发机Windows／Node24.17.0，不把结果称为VM、安装版或macOS验收。未使用Docker、剪贴板、新用户／GRANT或新密钥证书。

## 类型、单元与构建

先于004a提交运行时，修改后的全部源码和测试输入逐字节封存；提交后生产／测试输入一致。类型PID21644／33.20秒，64文件1555项相关回归PID41376／25.20秒，完整单元PID14964／314.45秒，构建PID25680／33.29秒，均exit0。完整结果为732文件通过／1平台文件跳过，14780项通过／1项跳过，原React act及Vitest弃用提示保留。实库和原生默认关闭列表分别PID51648、62588／exit0。

随后仅原生测试增加真实页大小选择；类型PID75992／33.89秒及原生／实库默认门40项PID10544／exit0。其余生产和单元输入按原字节核对，复用完整单元与构建，不冒称再次执行。51份CLI与18份补验封存分别位于`.cache/table-statistics-unsigned-check-local-20261022/`、`.cache/table-statistics-ui-page-check-local-20261022/`。

前一58e3候选[CI39791741802](https://github.com/zhao-yc/DBArk/actions/runs/39791741802)Linux检查成功、原生矩阵跳过；修后004a的[CI39795869988](https://github.com/zhao-yc/DBArk/actions/runs/39795869988)记录时仍进行中，不能借前版成功外推。上游4cb的CI39786795821中Linux及两Mac架构成功，Windows在既有辅助程序60秒编译预检失败；只到SIGNATURE_BEGIN，未到PATH_READY／CALL_BEGIN／SOURCE_READ／ADD_TYPE，不认定C#语法或签名网络根因。Windows原生、旧套件和打包未开始，原日志保留，不由本轮成功抹去。

## 六实例原始连接与统计

| 端口 | 实际版本／链路 | 原PID | 秒 | 非observer原连接 |
| --- | --- | --- | --- | --- |
| 13357 | MySQL5.7.44 | 47972 | 7.26 | 18 |
| 13380 | MySQL8.0.46 | 60460 | 7.42 | 18 |
| 13384 | MySQL8.4.11 | 16992 | 7.50 | 18 |
| 13310 | MariaDB10.11.19 | 47028 | 7.76 | 18 |
| 13311 | MariaDB11.4.13 | 5808 | 7.68 | 18 |
| 13484 | MySQL8.4.11严格TLS | 63860 | 9.14 | 18 |

六个进程各1项、原120秒／0重试／exit0。先核实际hostname／版本／server_id／socket／系统及适用UUID；各创建唯一随机`dbark_tabstats_*`库，仅subject和subject_view。123条固定样本包括UINT64最大及相邻值、DECIMAL30/12正负精度、DATETIME微秒、BIT64、BLOB空串／原字节、全NULL、ci文本和近似FLOAT。

独立观察连接取得真实SUM／AVG；另以BigInt有理数界核AVG原生尺度，数值不经JS Number。全部／OR／启停分组、精确IN／NOT IN／BETWEEN、上界空集、NULL、视图三行均通过。observer在本会话未提交第124行时能见124，产品新独立RR只读事务仅见123；同observer回滚后原123行保持。产品只允许固定只读控制语句与SELECT／SHOW，不执行写入或SELECT星号读取整页。

108条非observer原连接中，102条统计独立读取核strict原物理流关闭，6条connections.open握手按原关闭路径核close；原ID逐端口PROCESSLIST无残留。六个observer另核原流关闭，原123行、聚合、视图定义、owner及无其它触发器／例程／事件后精确DROP，读回不存在。63份封存在`.cache/table-statistics-unsigned-live-local-20261022/`，配置和源码输入保持。

## 正式窗口与原始文件

Playwright PID11504，UTC14:33:55.3558914→14:34:07.5762585，12.24秒／exit0，原120秒／1worker／0重试，仅13384明文源码。正式连接表单不记密码，实际页大小选择50；记录表单把首行金额暂存为0.000001，服务器原金额仍为123456789012345678.000001。

显式COUNT全量123；选id／amount／measure／payload／doc后再次统计，金额SUM精确为13086419635308641868.006555、AVG为123456789012345678.0000618396，NULL、字节极值、浮点近似和JSON仅计数通过。关闭后原草稿保留，单次撤销清本例草稿；id=0统计0、清条件统计123、视图统计62。五个统计任务completed，历史为空，无preview／apply／schema／query.execute任务；Main逐条IPC审计明确false。

原App正常退出exit0，数据库其它线程0，observer严格close。Root再独立核完整SHOW定义、subject全部123行及view62行，与预置快照相同；核owner／无额外对象后精确清库，Root原控制流close。

来源清单SHA256`9019731552b7ed5ce6eab8a9063e9e0e758461a6cad32e1236f4393bdd4fb0c6`包含实际Electron／default_app.asar／package／dist／启动检查脚本，五阶段完整重读并核实际App路径／resources／PID。区域截图SHA256`9c3da8566e1312fc999cbfd5488843303efc5a265987cf71fbf257bd7b9b0100`已人工查看；不据此声称窄窗、缩放或全部布局通过。18份封存在`.cache/table-statistics-ui-page-fixed-local-20261022/`。

## 原失败与未验范围

首轮类型PID34652／exit2仅测试patch数组推断不匹配，保留原10份；修正后类型和1514项定向通过。首次六实例在13357的原PID28636／5.76秒／exit1停止，其余五例未启动：UINT64max-1的IN条件引起真实1292 DECIMAL转换警告，统计拒绝发布；没有降低警告门。随后原库只读诊断证明日期和DECIMAL条件无警告，BIGINT条件单独复现，原生绑定参数也未消除；安全范围内整型UNSIGNED双层定型后EOF0／SHOW WARNINGS空。负数、分数、超UINT64保留原DECIMAL路径，未声称所有这类5.7警告已解决。原失败库在进程终态、归属／定义／123行／无额外对象及数据库线程核对后精确删除；原失败未持久化完整线程集合，不补称已取得全部线程证明。11份失败及2份恢复记录保留。

首次GUI PID32396／11.11秒／exit1，在统计前预期50行但默认200行，原快照明确选择200。修正为真实选择50，未改50／123断言或期限。原进程终态、只读进程清单未见Electron、原123行及视图完整定义保持、无额外对象／DB线程后精确清理；17份失败及2份恢复保留。首例App正常退出及原observer严格关闭未完整证明，不补报成功。

取消、权限不足、DDL漂移、大字段预算、异常包与关闭失败主要为纯测试／RAM证据，实库未注入；GUI未验真实取消、复杂分组、跨数据库、全部类型及大量数据。客户端边界比较完整来源DDL，可能对自增计数变化保守拒绝；摘要前后核对不提供同值DDL原子CAS。没有本片macOS、安装版、百万行性能或完整Navicat功能完成证据。
