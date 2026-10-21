# VALUES／SET 补全的 Windows 实库界面验收

## 准确对象与平台

实际执行HEAD `bd748599bdf3bb2608100be6581eef295dcfc204`，src `a022d8d8e441316acac80828a52c21be7a72c889`。WIN11-TEST派发反复无回执，本轮按用户明确回退授权，在Root本机Windows运行独立补全用例；未在两端重复批量筛选任务。原9139复验派发仍单独保持未知，不能计入本条。

原准备类型25.75秒、四文件84项全通过，详见[用例说明](../../docs/testing/q01-insert-set-ui-20261021.md)。本次没有重装依赖或重跑完整单元；已构建产品src与9139一致。执行前后2054个输入逐文件SHA相同，含576源码／1319测试／109构建；Git头、干净工作区和原专用配置文件保持。

## 实际结果

唯一正式命令为 `node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-insert-row-alias.spec.ts --reporter=json`，仅将本轮输出指定到新独占目录，保持原120秒、workers1、零重试及trace／截图／视频关闭。

原生Node CLI20820，创建UTC2026-10-21T06:08:27.4354537Z、完成06:08:56.0742529Z，exit0、28.6582496秒。原4905字节JSON为1通过／0失败／0跳过／retry0，整例26.564秒，stderr0字节。一个真实窗口内三个场景，不能计成三条独立用例：

| 场景 | 真实断言 |
| --- | --- |
| 原VALUES | 点号触发id／note／created_at三列，接受note后准确插入，Undo／Redo正文正确 |
| 普通SET | 同一准确目标列，接受、Undo／Redo及原SQL保持 |
| 嵌套COALESCE／CAST的SET | 解析投影未改变用户正文，实际三列建议及接受／Undo／Redo通过 |

三个原附件分别在断言通过后生成，任务身份／状态及历史编号均与输入前相同，pending0、pageErrors为空；未把任务列表保持解释为目录零读取。使用实际Monaco输入和Playwright keyboard事件，无模型设置、伪造建议或系统剪贴板，不宣称系统级按键验收。

## 数据库与资源

Root显式读取已有专用配置，仅把必要RAM字段传给本例。每条辅助连接独立核200／13384的MySQL8.4.11、Linux、lower_case_table_names=0及准确UUID。新随机`dbark_upsert_<32hex>`库创建前不存在，只有subject空表、id／note／created_at三列；没有用户、权限、SSH或Docker操作。

三种完整SQL在真实服务器各PREPARE并关闭，仅验证语法，未执行INSERT正文。GUI后独立核表仍0行、原定义摘要一致，库内只有原BASE TABLE且无例程／触发器／事件、本例库和前置连接无活动会话，才精确删除本轮新建库。最后独立连接确认库不存在、前置及清理线程无残留；prepare／cleanup／verify-absence三个辅助连接的原严格关闭helper及stream关闭均通过。

GUI由原共享严格fixture完成捕获owner正常退出、所属PID轮询及目录清理；退出提示由原fixture回答。本轮未另建各子进程CIM创建时间审计或独立profile路径读回，不将其宣称为额外原生层证明。旧失败profile和unknown未读取或补清理。

## 封存与限制

独占原件：`D:\svn\DBArk\.cache\insert-set-ui-local-20261021`。21文件逐项SHA复核通过，当前实际传入密码的已知值扫描未命中；原件及配置不入库。

| 文件 | SHA256 |
| --- | --- |
| result.json | 46521d450f09dbf727b12680ba1e331729d6b2b57ddb32478b56f4b09b25bac0 |
| SHA256SUMS.txt | c2134088122c4f71bb64b21bc9783444967b53307a4bd15619f6cffda99a8123 |
| gui/stdout.log | 578aeb54d987c62566bfe94d9c2cafed911231c58638eff11fbc5943d54d7dc6 |

外层PowerShell控制台按原字节呈现中文编码乱码，独立UTF8的native结果文件及原GUI JSON正常；控制台原件单独保留，没有重写或因观察编码重跑GUI。以上只证明本机Windows源码补全、真实元数据及语法预编译，不包含实际INSERT执行、安装包、macOS、其它版本／驱动或完整Q01。旧凭据误输出事件的范围／用途未知不由本轮扫描处置，暂不发布。
