# 全局离线结果快照验收（2026-10-28）

## 范围

基线 `ee36a9c8f91ab30826e1c54922d66f909c599940`，新增主工具栏“查看结果快照”和独立只读查看器。真实零连接、零查询标签即可打开、查找、查看来源SQL和BLOB、另存完整快照；不伪造连接或标签，不改变原工作区设置。既有查询页高级整理与比较保留，文件格式及Main文件服务不变，暂不发布。

## 候选与源码阶段

Root冻结8个源码／测试路径，统一LF后封 `global-source01.zip`，48430字节／9项，SHA256 `396b38c7d7d7ed4ad3ac0ac5f86dda185fb4423153eceaef7ffb9bea34ea6282`。WIN11-TEST核CRC、每项SHA、两旧路径LF基线及六新路径不存在后，备份并仅应用这8项。与旧source24无交集，原source24、dist109及其它dirty字节保持，HEAD仍b523 detached；没有fetch、切换分支或覆盖其它任务。

类型、五文件相关单元、构建、默认关闭及list门按序执行，首错停链；最终结果及原件回读另附。默认／list不加载桌面适配器，只验证恰一个关闭占位，不当作正式用例通过。

source01原类型18152 exit0；五文件单元6152 exit1，73通过／2失败，build／默认／list未启动。两失败分别是新增App入口RAM执行环境缺少CommonJS `exports`、新增BLOB文本查看例的RAM `select.options`缺失。仅修新增两unit的局部环境与标准HTML属性反射，全部断言及生产源码不变；原失败不改判。Root回读原件160647字节／59根项／68递归项，SHA256 `3769689141939ca877b21641a302229e52851883e3ee1ad95a429e7e0baeef03`，核CRC、逐项哈希、路径、私钥块及原stdout／stderr／退出码。

source02仅两unit增量 `global-delta02.zip`，9675字节／3项，SHA256 `fc0fe25f807363ce293616377821b189472822be9126c2e80aba8f6529b4c413`；按原source01字节核基线后备份应用，不重跑已过的另外三文件57项。

source02原13236 exit0，两个文件18项全过；原620 build含完整类型exit0，新dist实际109文件。关闭门8740 exit0／恰1skip，list8744 exit0／恰1占位，独立子环境的DBARK键为空、全局门未设置，未启动App。由此五文件75个不同用例分轮覆盖，不能把原6152整体改判通过或相加成91项。每门候选8及旧source24原字节一致，build之外dist未变。

Root回读source02原件194286字节／87根项／90递归项，SHA256 `6e012da8b70bb639c2f27cc2ee28594299b6ada8ca77e742b93e55ca1206afbb`，CRC／逐项哈希／路径／私钥块通过，并读原日志及退出码、最终source32与Root候选8逐字核对。原件、日志及构建留忽略目录，不进入仓库。

## 正式窗口边界

专项 `tests/e2e/query-result-snapshot-global.spec.ts` 使用专用门 `DBARK_RESULT_SNAPSHOT_GLOBAL=1`、`DBARK_INTEGRATION_ENABLED=0`、一worker／零重试、原120秒TestInfo、关闭录制。两例分别真实导入另存及新进程重开同一文件，直接使用新安装空工作区，不通过settings.save注入查询或结果。

文件选择适配器只返回本例原窗口／frame明确请求的精确路径；原Main IPC、文件服务、codec和结果不替换。固定输入wire不调用产品codec生成，另存后独立JSON.parse核完整文档，包括原名称、重复列名、原型同名列、BIGINT／DECIMAL／日期文本、NULL／空串、BLOB／空BLOB和负零标签。BLOB内部Escape应只关内层；来源SQL只读、无执行端口。

数据库命令和utility fork零计数仅覆盖fixture就绪后安装旁观至正常退出前，最早启动前未观察；不能称全生命周期抓包。Windows launcher与Main可能不同，沿用实际Browser metric／userData／CIM直接父链核验及原fixture严格正常退出，失败保留现场、不自动重试。成功仅精确删除本例两文件和原identity目录，不碰旧1392资源。

本机仅开发、Git和原件审阅；本轮不运行Docker、数据库、剪贴板或安装包。macOS、安装版、已有实库结果与活动事务组合另验。

## 正式结果

WIN11-TEST唯一正式Node CLI进程2632 exit0，2通过／0跳过／retry0，原120000ms门保持。第一例Main2156／launcher13904真实读取及保存；第二例新Main12656／launcher14772、新profile重开同一保存文件。实际Browser metric、userData与CIM父链吻合，原owned正常退出门及launcher exit0均通过。未重建或重跑已过前门。

两例均保持真实0连接／0标签、原配置和精确值；原名称与完整wire独立核对，源SQL只读、BLOB内层Escape不关闭外层。第一例open1／save1／chooser2，第二例open1／save0／chooser1；观察范围内pending、utility启动、被拒数据库命令均0。保存SHA256 `1a62a085a6d07efbadfdabe587c8c50d13e7245e33688fcdbf0e4ae0cf84fb81`在两新进程一致。第二例完成精确两文件及原identity目录删除，source32／dist109前后未变。

Root完整回读原件108078字节／47项，SHA256 `397b0f67085e702a42ab6d865989f46414f5bef4ccf5ea52ce6983c1732f5a52`，核CRC、逐项哈希、路径、私钥块及正式报告、原附件、原退出码、父链和清理事实；最终8路径与Root候选原字节一致。原source01失败保持，当前不公开发行；CI、macOS和安装包不借用本轮结论。
