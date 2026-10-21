# SQL字段悬停：Windows源码实库验收

## 来源与执行

`D:\svn\DBArk`、`main`准确提交`7f926c41d1304114d6938a24fc55ca1ce8ab78ef`，src树`7684933dd3ab9a8321b7ab10b84aaefa1c3e34ec`。源码类型、138项定向及构建、另122项Worker等回归通过，详见[实现记录](../../docs/development/sql-field-hover-20261021.md)。本轮未改产品或断言。

WIN11-TEST已接收新回合，但自动审批／执行策略在进程创建前拒绝新克隆及准备命令，仅返回`blocked by policy`。测试会话明确确认没有新克隆、准备、GUI、SSH／Docker或新库，不排队补跑。Root按已授权本机回退执行；旧c54失败App、库和源码／dist未接续或清理。

在同一次SSH先核Server-200／root／192.168.31.200及socket，移除Docker目标覆盖并显式使用`unix:///var/run/docker.sock`，只读核唯一DBArk/13384容器。凭据仅留RAM及子进程环境。原用例再核MySQL8.4.11／Linux／lower_case_table_names=0和准确server UUID；仅创建本轮随机隔离库，不改业务库或权限。

执行`node node_modules/@playwright/test/cli.js test tests/e2e/table-query-template.spec.ts --reporter=json --output=<本轮独占目录>/results`。120秒、retry0、录制关闭及失败保留策略保持。原CLI PID39908，2026-10-21 UTC14:10:25.4770042Z～14:10:33.2719489Z，exit0，外层7.8344793秒；报告1 passed、0 skipped／unexpected／flaky，retry0，用例6398毫秒。

原件保留在忽略目录`.cache/sql-field-hover-ui-local-20261021/`。`stdout.json` SHA256：`d8afa42459b9e479fdf04da8a8ec323f76645435ebefdd91a1559011304b6df3`；空`stderr.log` SHA256：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。执行用例SHA256：`9d54535f95d5e97469719f3cfba19cda906d442125c44a7397f9ae8a3e641d3c`。

## 实际行为与资源

真实Monaco字段悬停显示`decimal(30,20)`、不允许NULL、默认值`0.12345678901234567890`及备注。含HTML和command链接语法的备注DOM中没有图片或链接。正式目录读取1次，悬停期间正文执行0次。

随后原模板整例继续：四类SQL预览、SELECT明确执行61行且原空串保持、UPDATE四参数只读识别及取消、原表草稿保持和恢复。附件`fieldHoverVerified`、`hoverMarkupSafe`及原模板行为均为true；audit为pages2、selects1、parameters1、hoverReads1、writes0、pending0、confirmations1、rows61、note空串。草稿恢复确认使用一次受限原生接口回答，不计为系统键鼠或剪贴板验收。

App正常退出及原严格资源结算通过；用例再核完整61行和定义摘要未变、库仅含subject且无例程／触发器／事件，再精确删本轮库。独立辅助连接复核库及准备／清理线程不存在。prepare、cleanup、verify-absence三连接均normal=true、streamClosed=true，附件databaseRemoved=true。

## 范围

这是本机Windows开发Electron／MySQL8.4的真实窗口单例，不是VM、安装包或macOS证据；其它版本／驱动、百万行及完整语义能力另验。旧失败不追认，O05及完整工作包计数不增，暂不发布。
