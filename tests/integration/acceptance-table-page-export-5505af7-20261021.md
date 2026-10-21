# 表页与勾选快照导出：Windows源码实库及JSON文件

准确main `5505af74cf522ff7664d3af7c9e7c891c7d0371b`，产品src树`85bb200cda2007c0186d781909b4a3a50204bf53`。VM连接曾短暂恢复，只读确认旧9139未启动、无旧测试活进程，后续观察再次超时；本轮GUI未派给VM，按用户授权在本机回退，没有两端重复执行。VM只读SSH准备与本轮实跑分开，不沿用旧RAM。

Root先确认准确200/13384、MySQL8.4.11／Linux／名称大小写模式0及UUID，独占随机dbark_pageexport_*库、subject表61行；明确本轮nonce目录与selected-page.json保存路径。认证仅由已有配置在RAM传递，连接表单不记住密码。无SSH、Docker、用户／权限变更或系统剪贴板。

## 实际窗口与文件

命令`node node_modules/@playwright/test/cli.js test tests/e2e/table-page-export.spec.ts --reporter=json`，仅另指本轮输出目录。原120秒、workers1、零重试、关闭录制及严格owner保持。原Node PID59996，UTC2026-10-21T10:07:44.2255802Z至10:07:49.4361230Z，退出0、5.2358084秒；1通过，0失败／跳过／重试。

真实连接表单及对象树打开表页，正式选择每页50行、id升序。原handler旁观仅三次table.page：默认200返回61、选50返回50且hasMore=true、升序返回50。打开“导出当前页”实际预览50行，再取消，未写文件或重查。随后先勾第三行、再勾第一行，打开“导出本页勾选记录”，真实选择JSON、领取原生保存路径、执行原文件任务，文件按显示顺序输出ID1／3；其它页及未选中行不包含。关闭后原勾选保持清空。

窗口测试独立JSON解析手写期望，Root随后再次用独立JSON解析读回原文件：两行四列id／amount／note／bin顺序一致，`0.12345678901234567890`、`1.00000000000000000000`原文，空串与NULL、00ff与零长度二进制包装全部保持。原JSON193字节，SHA256 `8596b1fa56a04c6855c5e3df598ac998e8b59c1dd33b9b0982cdfb47c07f2939`。这里是两处独立解析断言，没有运行额外Python读取器。

导出前后分页仍三次，pending0、产品写命令0、页面错误0，任务全部completed，恰好一个files.exportResult。当前页50行本轮仅验证预览与取消，真实文件对应勾选两行；当前页整份文件另有纯快照及共享文件链路证据，不把本例扩大为50行实写、CSV或INSERT SQL的本轮原生通过。

## 终核与边界

原严格fixture确认正常退出并清理；未另建每个子进程CIM创建时间证据，不扩大退出结论。Root独立连接核仅subject、无例程／触发器／事件、完整SHOW CREATE及61行有序数据摘要未变、原准备线程及库线程不存在，才精确删除本轮库。第三条连接确认库和准备／清理线程消失。三条辅助连接原生正常关闭、stream.closed均true。2067个源码／测试／脚本／构建输入逐文件前后相同，HEAD、Git及专用配置未变。

`.cache/table-page-export-ui-local-20261021/`中22个封存条目复算通过，当前已知密码扫描0匹配。result SHA256 `7110fe5f7bb7210ac18fdf8b219ab80f823074dfe2e8d7a10d2e128db3f3aa32`；manifest `75f9135ee5cf4611e681c3380da314ee579ff5ccc847e85424c3cb09f12e1be3`；原GUI JSON `e3d8afe98331e3e6d4f4a62b9cde0399839fd6b8d56d02aaa291314be4d70883`；原生分页证明`8af550e77fcbe36223764d06c25d35f41b8da590829d394abf59b425200f6b58`；Root读回记录`e9c0db7475fb6fe82cc9b0859d3033a597af3849b875d2c6e94b7622d0981895`。外层控制台编码乱码原样保留，原UTF-8报告有效。

本轮夹具由Root创建／插入；“产品零写入”不表示整个测试无夹具写入。首轮本机沙箱EPERM、其它旧失败和保留资源边界不改；当前已知密码扫描不能追认历史凭据事件已处理。安装、macOS、其它驱动及新格式组合另验，暂不发布，不增加完整工作包计数。
