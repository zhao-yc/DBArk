# 表级下一自增值与当前ROOT的兼容集成准备

日期：2026-10-16。独立普通分支`codex/employee3-auto-increment-compat-20261016`，固定ROOT基线`2938c7c20a2e7dff3709fdd77b9c45c4aed095b2`。只顺序集成已审自增候选及其Monaco准备，与当前重命名、侧栏请求门、未知URI和捕获替换接线兼容；不加入其它功能，不改变原候选或旧报告。

## 固定输入与提交顺序

| 原固定提交 | 本分支顺序集成提交 | 内容 |
| --- | --- | --- |
| 4fa6155d21673a6b7b6b074bba0ca57d6a5b4641 | 3463d55 | 自增独立任务、协议、受控表单和入口 |
| 5f3a2c5d3b56ee82b1af91ee12f8141e78e2dae3 | b77d225 | 完整只读/恢复状态、回执一致性、默认关闭验收准备 |
| 8814696afad253746507391834603fc90b3a0a74 | 0a86d4a | Monaco就绪与同一innerText只读断言 |

三项使用cherry-pick -x保留原SHA。后续兼容测试/说明为本分支独立提交。原分支、员工4原复审、原自增准备和旧实跑记录均保持，当前结果只属于本固定混合源码。

## 冲突留存与最小兼容

首项在App、Sidebar、TableTab及table-rename-tree-refresh.test.ts四处冲突。修改前已保存index三个stage、每份原始字节/SHA256、带冲突标记的工作文件、状态及完整差异，位于本员工忽略缓存`.cache/auto-increment-compat-20261016/first-4fa6155/`。第二、三项没有冲突。

三个生产组件以ROOT原字节为基础，只逐个增加自增import、状态、入口、JSX属性/按钮和模态；逆向移除这些新增片段可逐字还原ROOT，记录为first-resolution-audit.json。没有整行选边覆盖ROOT大段JSX。

- App保留现有finishTableRename、精确数据库刷新及两个未知名称退役回调，新增独立自增入口和counterEdits脏态。入口与beforeApply都核对同目标全部表页的数据/布局草稿及活动任务；连接版本变化后迟到回执不能标记新配置。
- Sidebar保留当前SidebarNodeRequests、同步展开意图、系统刷新接管、卸载/连接修订、断开/删除结束屏障；仅增加父子属性传递和真实表对象行的自增按钮，不回退旧load实现。
- TableTab保留重命名、表备注、默认编码及原PageFindPanel/getSelectionToken；自增按钮仍要求真实表且未blocked，实际App入口进一步核对隐藏页。原选择变化拒绝旧单处替换的负例继续执行。
- 当前树测试已通过共享夹具整段执行生产Sidebar，不换回旧候选手写VM上下文。只为该夹具补新默认回调，并把原按钮接线/视图排除断言扩展到自增；原接管、折叠、迟到和结束屏障断言保留。

compatibility-proof.json逐字核对ROOT原有66处方法/接线，包括重命名完成/未知态、侧栏内部方法与选择令牌；15份原自增核心/测试/验收准备文件与8814696逐字一致，覆盖5f和Monaco最终内容。

## 原受控能力保持

没有改变原自增任务实现：规范正十进制字符串贯穿验证、范围、请求和回执，不用Number处理大值；只开放原已证明版本及目录能力，只上调现有整数自增列，不新增列属性或重述表定义。session/global步长和偏移必须为1，read_only、super_read_only、innodb_read_only和innodb_force_recovery均须为0，未知能力只读。

预览/执行仍使用单项固定ALTER、消耗型令牌、同表结构任务租约及原完整快照，分别保留实际发送、DDL完成、结构核验和计数观察状态。取消/关闭异常不借Promise状态伪称未发送或完整成功，不重放已消费计划。5f的完整回执匹配及completedUnsettled分类保留。

隐式提交、外部DDL窗口和并行DML推进计数三项风险必须显式确认。维护窗口要求及并行DML可能使观察计数不同于请求值的边界保持；不把结构租约称作数据库写入排他锁，也不承诺在并行插入下精确保持请求计数。此处只记录原实现契约，没有扩大认证、权限或数据库资源范围。

## 新混合负向与实际纯验证

新增table-auto-increment-mixed-app.test.ts共15项，提取混合App真实入口和JSX回调，使用真实store、目标保护及导航历史；只替换展示setter、DOM存在性和IPC端口，不执行GUI或数据库：

- Sidebar/TableTab两个入口各覆盖隐藏数据草稿、布局草稿及活动任务，不能因为活动页干净而打开；大小写不同的其他目标不误拦。
- 已有重命名或其它模态时不覆盖；预览之后才出现数据/布局草稿或busy时，实际beforeApply重新拒绝。
- 自增完成/未核验/未知回调不能恢复重命名两端未知URI；连接修订变化后迟到回调不能把新配置标为已核验或过期。

原树/表页混合测试继续核对四个属性按钮各自精确目标、视图/busy保护、真实请求门和捕获选择令牌。

| 本次执行 | 结果 | 边界 |
| --- | --- | --- |
| 初轮混合6文件 | 104通过、0失败/跳过 | 包含新增15项，属于下行子集，不累加 |
| 最终相关29文件 | 459通过、0失败/跳过 | 自增、重命名、侧栏、备注/默认编码、捕获/意图/选择及结构迟到取消 |
| TypeScript | 退出0 | 整仓类型检查 |
| 生产构建 | 退出0，37.24秒 | 主进程/preload/前端，保留既有第三方注释和大分块提示；不是GUI/安装验收 |
| 默认关闭列表 | 原自增UI3项，退出0 | 全局integration=0，专项DBARK_TABLE_AUTO_INCREMENT_TEST=0；不运行自动夹具 |

实际入口为tsc --noEmit、node scripts/build.mjs、29文件Vitest纯单元，以及playwright test tests/e2e/table-auto-increment.spec.ts --list。原单元、默认关闭实库准备及Monaco文件均保留，未增加GUI用例期限、重试或替身结果。

全局集成开关关闭下只运行纯检查；ROOT后续仍须显式同时开启DBARK_INTEGRATION_ENABLED和DBARK_TABLE_AUTO_INCREMENT_TEST，按原版本/只读边界安排真实核心与UI。当前没有新的GUI、实库、200、剪贴板、Docker、工作树或安装产物通过证据，未改ROOT工作区或生产部署。

本员工缓存根`.cache/auto-increment-compat-20261016`保存三方冲突、逆向字节证明、方法/候选文件哈希、mixed-results.json、related-results.json、playwright-list.log及verification.json。构建产物仅留本克隆ignored目录，不提交构建、日志、环境或身份文件。固定候选交由ROOT最终审查与真实验收。
