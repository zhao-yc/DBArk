# 新建表字符集与排序规则配对

本片从固定 `1dd59a6589acc40c73fd9241aca21633a0bf81b9` 的普通克隆、独立分支开发，不使用worktree，不修改Root或R93候选。已核对原缺项：通用 `TableDesign` 只有charset，原 `SchemaDialog` 为字符集文本框，没有新表collation选择。

## 用户流程与兼容行为

保留原字段、索引、外键草稿。进入“确认新建表”后，可选择“选择新表字符集与排序规则”；此时只读取得实际服务器完整目录，不立即生成显式预览。字符集选择会清空排序规则，排序规则列表仅含同字符集实际候选，不猜默认值、不替换别名。完整配对后重新预览，输入准确库.表名并确认原两项风险，再投递唯一CREATE。配对或模式变化立即撤销界面旧预览和确认，原能力仍由原资源集合释放；重新准备前先完整释放旧能力，释放失败不开始新请求。返回结构草稿后须重新选择配对。

旧客户端和原流程未提供collation时，不新增编码目录查询，仍按原charset生成CREATE，由服务器决定该字符集的默认排序规则。目录无权限、不支持、未编译、映射歧义或预算不足时显式配对不可用；用户可主动回到原草稿行为，不会暗中替换规则。新字段仅进入专用 `TableCreateDesign`，不扩通用 `TableDesign` 或已有表 `schema.preview` 契约。已有表编码仍走专用途径，不执行CONVERT、不重述已有列、不强制转换数据。

## 服务端事实与一次性执行

新表get增加可选布尔 `includeEncodings`；返回可选只读目录、摘要、警告及不可用原因。复用新建库已有的有界COLLATIONS/CHARACTER_SETS目录读取及Maria完整别名映射，不复制候选事实。目录快照返回副本，客户端不能改写引擎持有能力。显式collation必须与设计charset构成该快照中的准确配对；旧快照不能套用新字段。

预览、执行前与ACK后重读完整支持目录，摘要变化即拒绝旧能力或保留执行完成但后核未证事实。生成器只接受内部新表配对参数，有原对象或originalName时明确拒绝；通用ALTER路径不传新参数。预览回传实际配对及目录摘要，界面逐项校对，拒绝不匹配及迟到能力。连接ABA、目标变化、取消、到期、单次令牌消费、资源释放和未知不重放沿既有规则。

一次apply仍仅传预览令牌、准确确认及两项风险，不传charset/collation或客户端SQL。成功ACK后，实际SHOW表尾必须明确证明同一charset/collation，同时TABLES/COLLATIONS目录必须证明同一准确配对，再与原列、索引、FK及精确默认值后核合并。SHOW缺省、未知表尾或两种证据矛盾均不报完整核验。DECIMAL文字量不经JS Number换算，测试逐字保留 `123456789012345678.123456789012`。

## 纯验证与默认关闭定义

相关纯测执行真实Engine、原SQL生成器、真实ReactDOM与一次性能力链，仅驱动、DOM环境及外部端口为RAM。覆盖错配/注入/大小写与空白、返回副本篡改、三阶段目录变化、目录不可用、SHOW/目录矛盾、精度、旧调用兼容、已有ALTER参数拒绝、选项切换、释放失败、元数据迟到、连接ABA与双击一次提交。

新增 `table-create-encoding.spec.ts` 和专属真实定义，默认关闭。仅 `DBARK_INTEGRATION_ENABLED=1` 与 `DBARK_TABLE_CREATE_ENCODING_UI=1` 且本轮raw自有13384/plain账号、密码及Root UUID全部一致，才注册定义；存在认证回填文件时拒绝。list优先短路，双门开启也不读取认证环境或加载桌面/helper。

正式定义在注册时固定raw/helper身份，将同一TestInfo/page/application的owner传入原建库表单内部等待。任何DDL之前先核准确8.4.11/Linux/lower0/Root UUID，且预检连接必须通过产品strict QUIT等待同一原生流close；第二观察连接重核事实及准确隔离名称缺席后才进入真实表单。目录选择、只读预览、错确认拒绝、双击一次apply、实际排序规则/精确默认值及原目录刷新均有定义。用途自身afterEach在body或收尾仍活动时先保留，超时后的迟到响应也不继续。未知、漂移或失败不自动退出/清库，DROP未知不重试，原首因保持为聚合首项及cause。不修改共享fixture/live-helpers/quit、原新表正式定义或45秒预算；重试为0。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config .cache/table-create-collation/vitest.config.mjs --reporter=json --outputFile=.cache/table-create-collation/full-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
node .cache/table-create-collation/list.cjs
```

GUI、DB、SSH/200、CI、安装、构建、clipboard、私料读取及部署均为0。真实定义未运行；本片纯测或默认关闭定义不能替代MySQL/Maria各版本实际验收。Root须先独审，再独立授权和安排实测。尚未增加已有表转换、每列字符集选择或跨版本真实兼容证明。

## 独审E5-COLLATION-01追加修复

员工5最终报告将问题定为正式验收入口的条件性P2，生产编码配对路径未发现新增P1/P2。报告为 `.cache/employee5-review-table-create-collation-baaed6f-20261017/summary.json`，SHA256为 `961f6968739f5ae76b4306db3e717499bbff6dc8f193822cb1211be11deb12b1`。前提是共享保留通知在共享retained标记落定前抛异常，并非声称正常通知路径已经损坏。

原 `baaed6f` 的两项真实注册函数反例均复现：预检观察未知后继续退出；原建库表单提交未知后，在空任务列表下继续退出并尝试DROP。原测试替身先设置共享标记再抛通知异常，不能覆盖此条件；现已纠正为通知先失败、共享标记仍未设置，并记录 `.cache/table-create-collation/retain-parent-red.json` 两红。

新增仅属于本例的永久retained状态。retain先同步设置本地锁，再尽力通知共享夹具；通知异常被保留在边界内，不覆盖原请求首因，也不重试通知。own在任何共享资源读取前先核本地锁，allowClosed也不能绕过；原observe、finally及afterEach复用同一锁。活动超时先调用本例retain，通知失败或后来恢复、迟到close及activity结束都不能清除本地锁、重新观察、退出或DROP。原失败对象仍沿聚合首项及cause保留。

本文件对应追加修复只修改正式定义、其纯测和本文档，不修改生产、共享fixture/helper/quit、原预算或生成列分支。正式入口43项纯测通过；员工5原样两条独立反例在当前源码下也通过。补充覆盖通知设置前失败、afterEach、活动超时、迟到close和通知能力恢复。类型检查及真正CLI列表通过，真实外部操作仍全部为0，仍待Root复审。
