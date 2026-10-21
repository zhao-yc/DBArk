# 筛选启停与查询模板：Windows源码实库验收

## 准确版本与执行平台

`D:\svn\DBArk`、`main`准确提交`62224ddc7404aab9254734dd274c22d4837d034a`，产品src树`dcffb43a5c7875c8badeb267efbace70ed6ed8a1`，与功能313bcb57相同。既有111项／类型／构建及观察器3项／最终类型保持；本轮未修改产品、用例或断言。

WIN11-TEST原c54已completed，新派发超时且读取主机不可达。Root先成功发送取消通知，再依既有授权在本机Windows串行执行两个全新回合；测试会话随后明确确认313新回合均未启动、无原生PID。旧c54的App、库、源／dist和原日志保持，不补退出或清理。以下均是本机源码证据，不是VM或安装验收。

每例在同一实际SSH会话先核Server-200／root／目标IP，再使用固定`unix:///var/run/docker.sock`，显式移除Docker目标覆盖，核唯一DBArk/13384映射。认证只存本轮RAM；用例再核MySQL8.4.11／Linux／lower_case_table_names=0及准确server UUID，各自创建不同随机库，不改业务库或权限。

## 原始执行

分别执行`node node_modules/@playwright/test/cli.js test <下列单文件> --reporter=json --output=<各自独占目录>`；每例120秒、retry0、录制关闭，失败保留策略未改。

| 用例 | 原CLI及UTC | 结果 |
| --- | --- | --- |
| `table-sort-panel.spec.ts` | PID52172，12:45:04.8122677Z～12:45:16.7550789Z | exit0，11.9646107秒；1 passed，0 skip／retry／flaky |
| `table-query-template.spec.ts` | PID9520，12:46:41.6994678Z～12:46:48.1823785Z | exit0，6.5113174秒；1 passed，0 skip／retry／flaky |

日期均为2026-10-21。原件保留在`.cache/table-filter-enabled-ui-local-20261021/`及`.cache/table-query-template-fixed-ui-local-20261021/`，不入库。两例`stdout.json` SHA256依次为`6b1bb6530027947590bcfa66e54e490b06b818d4e766f34d5051578043443985`、`65e472bfdcbfcf734aeb52455bda28540ab62b267af289d197e43bc74fbb824c`；两份stderr均为空（SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`）。启动后用例字节保持，SHA256依次`bd761947e265333384981d6e12176a08807888a2efc9649d7e6260534998082b`、`1d89cec329f2ad7a0f47187456c241400074d9b9db2cb15d0c1afea17cdfe03a`。

## 实际行为

排序／启停例保留原完整排序和草稿取消流程，再执行新增逐条／批量启停、任一模式、编辑停用条件、恢复全部及切回全部模式，共16次正式分页。关闭条件恢复服务器实际记录范围，全部停用不限制记录，仅启用一条时任一模式不包含停用条件；恢复后原精确小数、顺序、方向均保持。每次生效切换只新增一次读取，预览、取消及原样应用不重查，窗口与正式回包一致。附件`filterEnabledVerified=true`、pending0、产品写命令请求0、页面错误0，121行及定义摘要未变。

模板例按真实列元数据的内部key读取原SELECT，成功返回61行且id=1的note确为空串；没有默认空串或显示名称回退。四类SQL均预览，打开独立查询时正文零自动执行；用户明确执行一次SELECT，UPDATE参数名称只读一次并显示4项，随后取消。原表未提交草稿保持并正常恢复；最终分页2次、SELECT1次、参数读取1次、受限草稿恢复确认1次、写命令请求0、pending0。61行及定义未变。该确认使用原生接口一次受限回答，不计为系统键鼠验收。

## 资源与未验范围

两例均由原TestInfo／App正常退出，通过原严格PID结算及成功fixture的临时目录移除；未强杀。用例分别核独占库仅含subject、无例程／触发器／事件、完整数据及定义未变、产品会话释放后精确删库。各自第三辅助连接核库及准备／清理线程不存在；共六条辅助连接normal和streamClosed均为true。

旧c54失败不因此通过，其保留资源未动。此为MySQL8.4／本机Windows源码两个单例；安装版、macOS、其它驱动／版本、百万行及实体系统输入另验。完整工作包和发行计数保持，暂不发布。
