# SQL文件来源绑定整合检查点

固定56ae68f的后续完整CI39090535117/job117566124938已成功：499文件、9207通过、10条件跳过，类型及构建成功；原生与发行job仍条件跳过。解码原文日志`run1681-56ae68f-full-ci-green.log` SHA256`cdb8cbf3acd1cb4998e4e2932c5ddce4013dcc49ed3c907fa0e451af11741591`。下述真实CtrlS输入层失败仍保留，不能以完整单元绿替代原生验收。

## 后续文件原生专项：保留首次真实失败

Root在固定`e0764766a77aceb69a853871c14393ace3859bcb`整合默认关闭的文件专项及SQLite证据读取收紧，未改产品src/scripts/package/lock，仍使用已成功的f90a799编译字节。新增及直接复用的5相关文件99项通过，类型退出0；独立复核另7个RAM对照通过，包括原链接反例，交接SHA256`fcddecf126b80f8f10a4c27545530021681f2b3b515f92a0b78bbc46f8c66539`。这些检查不证明原生界面已通过。

Root固定112个运行文件的清单SHA256`584096400112b6555650f57b5b7799aea42a340bc539b2635fd0b0709911da8c`，独立合成配方SHA256`d32a35a2fd476fe34a1ecd0bc2c8489ab42037d91e88cda8fa0fa528272ce033`，执行run1672正式Windows源码单例，1失败、0重试，56.5秒。已读到真实编辑正文，但首次页面按键CtrlS后来源revision仍为1，未达到原`>1`期待。报告`run1672-query-file-native-source/stdout.json` SHA256`8789356bc7625969c654e8f86331e5c94c7481f1e80eb95df01c3c8253927404`。

原生菜单加速键与测试页面按键的输入层尚在核查，不能据此判定系统CtrlS损坏，也不能改用按钮声称快捷键通过。原临时目录保留，没有自动重试、强停或移除；事后原5个PID均已不存在，但缺少原正常will-quit握手，因此退出与后续重启、冲突、SQLite终态均未验收。本例只替换文件选择端口，不证明OS原生选择器。

日期：2026-10-18。普通clone分支`codex/p0-sql-file-binding-v024-20261018`，0.24.0开发中，配置库9。原主目录及0.22/0.23分支保留；没有worktree、200/SSH/Docker、数据库凭据或剪贴板操作。

## 实现与来源

基于0.23固定9b734e5，接纳合同0093242/29b7de0、后台b307e62、普通mode修复3593a06及POSIX单例a131448；UI03071b0及任务/互斥修复795ea45，重读持久化修复5eb7df1。Root版本与原生schema预期调整为0.24/9，未新增依赖。正式入口为QueryTab文件按钮、Ctrl/Cmd+S、关闭保存及任务面板，Main使用原生选择与私有来源表；初次打开接管新文档，重读只推进基线。

不向renderer传递路径权限；打开/保存绑定真实窗口文档、查询世代、私有修订及取消。原样保存也先读取并核对外部版本/字节摘要。文件写入采用有界分块、目标预约、同目录暂存/同步/替换及写后核对；替换事实与配置保存分开报告。详见[后台合同与限制](../../docs/development/query-file-sources-backend-20261018.md)。

## 原问题与独立复核

- UI03071b0在查询未返回时，文件操作获取占用失败会清掉查询busy，原真实React/RAM反例收到第二次执行。修复795ea45仅释放自己取得的作业；原审固定2例一次全绿，原用例字节保持，交接SHA256`8ed8de431a746d4efb1f3959cc9887c38e95e16e780b020cd779051ee58e4f33`。
- 后台b307e62仅给open传mode，POSIX RAM语义复现0664→0644；Windows真实文件0666→0666不能冒称macOS复现。修复3593a06在写入后chmod、同步及fstat核对。独审原红及失败/取消5例全绿，交接SHA256`0e1fe65ba6b1c4c43ed0980cdc0166937a8a86b630e083df91106ff2ca910882`。新增POSIX真实文件单例在Windows条件跳过，随后已在下述Linux完整CI中实际1项通过（13ms）；不能外推macOS或ACL。
- 原带source重读在Main返回前、无renderer flush时将外部正文写进原标签SQLite。5eb7df1将正文接管与读取期旧SQL保护分开：重读仅推进基线，首次打开仍接管占位。原红及3项作者窄测保留，独立3项全绿，原期待不变；无后续renderer flush且重开真实Store后原SQL仍完整，交接SHA256`471e19637125459d8733ed65376fcdabfa8d443542108074b6740bc48c882d10`。

## Root固定头检查

固定`79ab6ab01d95eb712f9dae0f68f19acf0241b7bd`：23个相关文件247通过、0失败、1个平台条件跳过，类型退出0。覆盖合同、后台/Main、真实React文件与关闭路径及架构9存储。日志`run1646-sql-file-source-integration/stdout.log` SHA256`5705f1d9bf150cfc0eff7cae84678175201ba0d9f310645062b8b166dc701170`。该头尚含重读持久化问题，不能用247绿否认随后真实Store反例。

固定`f90a7999dc6f2bad5611c48046d0fca873afa152`：重读/后台/Main/合同4文件38通过、0失败/跳过，类型退出0。未重复其余旧UI绿例。日志`run1649-sql-file-source-reread-integration/stdout.log` SHA256`99aefd574b1a1fed51e7fd368a5c49efb74d6872ec8a362bc9973fedf1ef71d1`。两批有重叠，不能相加为285个不同用例或全套结果。

同一f90a799构建退出0，使用最小OS环境并禁用envDir；沿现有buildMain、Vite及许可证复制，不重复已通过的同头tsc。日志`run1647-sql-file-source-build/build.log` SHA256`4acc9bbb9e0751fb3d85875e7686b40ea972bddfddcf902185551a875a51958d`。当前头完整CI、真实原生文件选择/保存/取消/重启、安装、Windows ACL与macOS文件元数据尚未验收；不计作0.24发行完成。比较与rename之间仍无跨进程原子CAS，权限修复只证明普通mode；平台边界不因RAM通过而消除。

## 继承基线的独立边界

0.24固定`0e36b2b59aca10cc707804d94391b3ac6ece7e0b`的CI39086888927/job117555216367首轮为497文件（493绿、4红）、9178通过/9失败/10条件跳过，另1未处理异常；类型通过、构建未运行。原日志`run1648-0e36b2b-full-ci-original-red.log` SHA256`6a531287d8af1d86b1233b25e9c7a6fbb146fcf530735fd4ec9f9455aa257fab`。失败为三个旧VM夹具缺少新增校验/文件来源/存储端口，以及原生gate夹具仍固定旧schema8；原日志和断言保留，补齐与修后完整CI继续。该次真实POSIX权限单例已通过，不因整轮失败抹去其来源，也不将其提升为整轮成功。

作者a0cc41f对应Root`c8a467aeff8ed8d02552216806f0bf875313e540`，补真实来源校验、真实QueryFileSources失效实现及沿LocalStore原型运行的RAM数据库；原91处完整expect链、用例矩阵和错误期待保持。三个受影响文件25项、作者一次类型检查通过。Root另将本架构的gate固定断言8→9，原其余门断言保持；合并后原四个失败文件一次33通过/0失败/跳过，无未处理异常。日志`run1652-v024-legacy-integration/stdout.log` SHA256`300b4ca954a5bcd5a6499c0a6bbb99e2fe936e5bfca20243bae213d1166ad7db`。src/scripts/package/lock与已构建f90a799逐路径相同，未重复构建；新完整CI另行核验，原红不删除。

修后固定`48064b4e1764076d26654ce336db8261c2d6ba55`的CI39087868014/job117558125592已完成成功：497文件、9187通过、10条件跳过，类型及构建通过，无原未处理异常。Linux真实POSIX单例再次实际通过（16ms）。原日志`run1655-48064b4-full-ci-green.log` SHA256`51af2befa81d84f1a997c69da5d50690c46300fa12b9b732e36693c6ef24e56f`。桌面与发行job条件跳过，不能当作0.24原生或安装证明。

0.22固定139c2a1的CI39085317923/job117550510415为477文件/8986通过/10条件跳过，类型/构建成功，日志SHA256`61534bf6192f98cca738697aa2783e789ebfa1387c2c88963035d55537436710`。0.23固定9b734e5的CI39085596332/job117551365686为487文件/9063通过/10条件跳过，类型/构建成功，日志SHA256`73e27201597f22fa04534719dee02a042c95a7369c245010a2ad12835e9b84dd`。两者桌面/发行job均条件跳过，不能外推为本版完整或安装验收；原Windows缩进和分栏专项仍各保留自身来源。
