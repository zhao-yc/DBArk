# 筛选条件跨组移动：本机真实界面验收

## 准确版本与平台

main `21c164f2ad60949170393ee35e2de59fc13dfc0b`，src树 `e0b2eff968994ebd74558dac27bbd2ee5adc5b6c`。WIN11-TEST 远程再次不可达；此前只读终态确认原9139任务未启动，按用户允许连接不稳定时本机接续的授权执行。本记录仅对应新的准确21c164f，不追认旧300失败或旧9139。

第一次沙箱预检返回 `connect EACCES`，没有取得连接或启动GUI，目录`.cache/result-filter-move-live-20261021/`保留。获得网络执行权限后使用新独占目录`.cache/result-filter-move-live-network-20261021/`，不覆盖第一次记录。只读预检确认200/13384、MySQL8.4.11、Linux、lower_case_table_names=0及准确UUID；辅助原生连接和stream正常关闭。

## 实际结果

执行 `node node_modules/@playwright/test/cli.js test tests/e2e/query-result-sort-case.spec.ts --reporter=json`，输出仅另指本轮独占目录。原120秒、workers1、零重试、录制关闭和严格收尾保持。

原Node PID17716，UTC2026-10-21T07:10:11.3543471Z至07:10:27.0934214Z，退出0、15.7608874秒。一个用例通过，无失败、跳过或重试；用例13.512秒。真实控件验证：

- 多列排序、大小写、Unicode、NULL、小数简写、条件单条及批量启停；草稿取消后原树与成员原文保留。
- 条件移入OR子组、取消恢复、实际应用及移回最外层；选择框焦点、成员原文和顺序连续编号正确。应用前结果不变，应用后分别为3／6／7及3。
- 原真实虚拟网格读取39次，最小客户区96，保留原几何门。单条常量SELECT和两个导出任务完成，审计pending0、revision0、无额外查询，历史不变、无页面错误。
- 原严格fixture退出及观察连接正常关闭通过。没有另行建立每个子进程CIM创建时间的独立证据，不扩大退出结论。

无数据库写入、DDL、用户权限变更、SSH或Docker；合成copy/paste仅使用本页DataTransfer，未使用系统剪贴板。

## 独立文件读回与边界

GUI后冻结本轮nonce目录两文件的七字段身份、长度和SHA。从准确Git blob提取原8589字节Python读取器，Python3.12.14，使用`-I -B`、两个准确绝对路径及冻结SHA执行一次。原PID51840，退出0、0.1037261秒：四行八列，18字符串／11 NULL／3二进制，精确值和Unicode通过，stableRead=true；两文件读取前后身份和SHA相同。

CSV383字节，SHA256 `b0dc77e99c919b25c05b2282d554861f467f492c98fa35f764c3f579da6d27ce`；JSON827字节，`c8f1958d36ae099ee13b0f9d4eed1c561d6212986664e2fdf7a95b6908ae9674`。源码、测试、脚本、构建输入逐文件前后相同，Git干净、HEAD及专用配置未变。

本轮27个封存条目独立复算通过，当前已知密码扫描0匹配。结果SHA `a19f9249b4176cbfb79ec44aa07c57d892e70b7b1cdc4d7826882b41232804fa`，manifest `1fc653ca79ab756d4edc207bdec0ac82b3e2a1eb24ac5a300d0f579395728cbc`；原GUI JSON `7046075fe15656b9ce6ede217c6e7f67c910ad4ce3cb179e06bc003945a489cb`，原Python报告 `47419aa1ab98aaa2a8f9e75ee9bfad7afb93abb75c21d4dd8d61ac0386ee44fb`。外层控制台编码乱码原样保留，原UTF-8 JSON及日志有效，不重写或重跑。

这是本机源码真实界面及指定MySQL实例的证据；安装版、macOS、其它驱动和完整大数据量另验。旧失败、未知资源及历史凭据事件边界保留，已知密码扫描不能追认历史事件已处理。暂不发布。
