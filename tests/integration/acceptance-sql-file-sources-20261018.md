# SQL文件来源绑定整合检查点

日期：2026-10-18。普通clone分支`codex/p0-sql-file-binding-v024-20261018`，0.24.0开发中，配置库9。原主目录及0.22/0.23分支保留；没有worktree、200/SSH/Docker、数据库凭据或剪贴板操作。

## 实现与来源

基于0.23固定9b734e5，接纳合同0093242/29b7de0、后台b307e62、普通mode修复3593a06及POSIX单例a131448；UI03071b0及任务/互斥修复795ea45，重读持久化修复5eb7df1。Root版本与原生schema预期调整为0.24/9，未新增依赖。正式入口为QueryTab文件按钮、Ctrl/Cmd+S、关闭保存及任务面板，Main使用原生选择与私有来源表；初次打开接管新文档，重读只推进基线。

不向renderer传递路径权限；打开/保存绑定真实窗口文档、查询世代、私有修订及取消。原样保存也先读取并核对外部版本/字节摘要。文件写入采用有界分块、目标预约、同目录暂存/同步/替换及写后核对；替换事实与配置保存分开报告。详见[后台合同与限制](../../docs/development/query-file-sources-backend-20261018.md)。

## 原问题与独立复核

- UI03071b0在查询未返回时，文件操作获取占用失败会清掉查询busy，原真实React/RAM反例收到第二次执行。修复795ea45仅释放自己取得的作业；原审固定2例一次全绿，原用例字节保持，交接SHA256`8ed8de431a746d4efb1f3959cc9887c38e95e16e780b020cd779051ee58e4f33`。
- 后台b307e62仅给open传mode，POSIX RAM语义复现0664→0644；Windows真实文件0666→0666不能冒称macOS复现。修复3593a06在写入后chmod、同步及fstat核对。独审原红及失败/取消5例全绿，交接SHA256`0e1fe65ba6b1c4c43ed0980cdc0166937a8a86b630e083df91106ff2ca910882`。新增POSIX真实文件单例在Windows条件跳过，须Linux CI执行。
- 原带source重读在Main返回前、无renderer flush时将外部正文写进原标签SQLite。5eb7df1将正文接管与读取期旧SQL保护分开：重读仅推进基线，首次打开仍接管占位。原红及3项作者窄测保留，独立3项全绿，原期待不变；无后续renderer flush且重开真实Store后原SQL仍完整，交接SHA256`471e19637125459d8733ed65376fcdabfa8d443542108074b6740bc48c882d10`。

## Root固定头检查

固定`79ab6ab01d95eb712f9dae0f68f19acf0241b7bd`：23个相关文件247通过、0失败、1个平台条件跳过，类型退出0。覆盖合同、后台/Main、真实React文件与关闭路径及架构9存储。日志`run1646-sql-file-source-integration/stdout.log` SHA256`5705f1d9bf150cfc0eff7cae84678175201ba0d9f310645062b8b166dc701170`。该头尚含重读持久化问题，不能用247绿否认随后真实Store反例。

固定`f90a7999dc6f2bad5611c48046d0fca873afa152`：重读/后台/Main/合同4文件38通过、0失败/跳过，类型退出0。未重复其余旧UI绿例。日志`run1649-sql-file-source-reread-integration/stdout.log` SHA256`99aefd574b1a1fed51e7fd368a5c49efb74d6872ec8a362bc9973fedf1ef71d1`。两批有重叠，不能相加为285个不同用例或全套结果。

同一f90a799构建退出0，使用最小OS环境并禁用envDir；沿现有buildMain、Vite及许可证复制，不重复已通过的同头tsc。日志`run1647-sql-file-source-build/build.log` SHA256`4acc9bbb9e0751fb3d85875e7686b40ea972bddfddcf902185551a875a51958d`。当前头完整CI、真实原生文件选择/保存/取消/重启、安装、Windows ACL与macOS文件元数据尚未验收；不计作0.24发行完成。比较与rename之间仍无跨进程原子CAS，权限修复只证明普通mode；平台边界不因RAM通过而消除。

## 继承基线的独立边界

0.22固定139c2a1的CI39085317923/job117550510415为477文件/8986通过/10条件跳过，类型/构建成功，日志SHA256`61534bf6192f98cca738697aa2783e789ebfa1387c2c88963035d55537436710`。0.23固定9b734e5的CI39085596332/job117551365686为487文件/9063通过/10条件跳过，类型/构建成功，日志SHA256`73e27201597f22fa04534719dee02a042c95a7369c245010a2ad12835e9b84dd`。两者桌面/发行job均条件跳过，不能外推为本版完整或安装验收；原Windows缩进和分栏专项仍各保留自身来源。
