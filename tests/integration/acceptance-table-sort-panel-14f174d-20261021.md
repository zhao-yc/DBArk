# 表数据多列排序：Windows源码实库验收

## 准确范围

- 仓库`D:\svn\DBArk`，`main`准确提交`14f174d4091931d10b579922fbd9ad743bb8fb8b`；产品src树`7f1dcce7c51df6293482db1dbc6e62159071c49d`，与已通过类型／50项／构建的858faa53产品相同。
- 本机Windows源码Electron实跑。WIN11-TEST原c54回合停在失败的远程工具调用，未取得GUI终态；依既有回退授权，仅启动新的排序回合，不重跑或接续原模板回合。
- 每次Docker前在实际SSH会话核Server-200、root、192.168.31.200、`unix:///var/run/docker.sock`及唯一DBArk/13384映射。认证从既有容器捕获到RAM，不入参数、仓库或凭据文件。辅助连接再次核MySQL8.4.11／Linux／lower_case_table_names=0及准确server UUID。

## 原运行

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/table-sort-panel.spec.ts --reporter=json --output=<本轮独占目录>
```

原CLI PID34344，UTC2026-10-21T12:00:08.8326614Z至12:00:18.4184534Z，退出0，9.6110104秒；Playwright单例passed、retry0、零失败／跳过／flaky，case8257毫秒。最终用例与启动时SHA一致：`94e355ec11c5015562bea61033f216a57723ef3df48c60f70d282f24102bf94a`。

原日志在忽略目录`.cache/table-sort-panel-ui-local-20261021/`：`stdout.json` SHA256 `7478f7afeed3e7847da7f1a139afd53f253c4253a6392700b4c5ac52d92bc312`，`stderr.log`为空（SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`）；另有启动／退出记录及脱敏概要，不将私有原件入库。

控制脚本首次由旧版PowerShell解析无BOM中文源码失败，发生在执行前，未创建回合目录或执行SSH、Docker、GUI；改用已有PowerShell7后只启动上述原生一次。默认列表及最终类型先前均exit0，列表仅1例。

## 实际行为

正式表页共7次`table.page`：默认页200载入121条，明确选50条、精确小数等值筛选、跳第三页21条、双字段排序回第一页50条、交换优先级50条、清空显式排序50条。全部正式回包和当前窗口首三行吻合；并列项／NULL／空串使用数据库顺序，没有把本地快照排序当作服务端执行。

编辑排序草稿零分页。应用两字段排序只新增一次读取，保留原精确筛选和组合方式并回第一页；提高第2字段优先级后实际顺序改变。取消排序保留已暂存的本页记录草稿，随后真实网格恢复原空串，零产品写入；清空草稿须应用，未改规则直接关闭且零重查。最终pending0、写命令请求0、页面错误0、任务全部completed。该例不包含确认丢弃路径的实体输入或系统键鼠／剪贴板验收。

## 资源与边界

同一TestInfo／App正常退出并通过严格PID结算，成功fixture执行受限临时目录移除；未强杀或补退出。辅助连接实际复核121行完整数据及表定义摘要未变，库内仅subject表且无例程／触发器／事件，原数据库会话已释放后精确删本轮随机库；第三连接核库和准备／清理线程均不存在。附件中prepare／cleanup／verify-absence三条连接均normal与streamClosed为true。

这是新排序面板的本机Windows源码／MySQL8.4单例证据。原c54模板GUI、旧失败资源、安装版、macOS、其它驱动／版本及百万行性能不因此通过。不增加完整工作包或公开发行计数，暂不发布。
