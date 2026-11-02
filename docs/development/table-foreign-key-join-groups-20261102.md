# 外键 JOIN：嵌套条件组

## 用户流程

MySQL／MariaDB 表页进入“按外键生成 JOIN 查询”，预览父表结构并填写有效条件后，点击“组合 JOIN 条件”。在内联分组面板添加子组，选择各组 AND／OR，再将已有条件移入目标组；摘要保留原编号，并标明子表 c／父表 p，双方同名字段不会混淆。例如可表达 `条件1 AND (条件2 OR 条件3)`，不再只能统一 AND 或 OR。

分组草稿独占本窗口的编辑能力。编辑期间旧 SQL 预览隐藏，预览、独立打开、字段、外键、条件及排序控件禁用；明确“应用分组”后才一起更新组合树、根模式和 SQL。取消保持原 SQL、条件、排序及上限。分组区域支持 Ctrl／⌘+Enter 应用、Escape 取消；组合输入、已消费或长按按键不触发应用／取消。主窗口“关闭”仍按原流程退出本窗口。

原值或启停修改保留组；无效值可继续修正，不会清空括号。删除条件按稳定本地 ID 重编号并剔除空子组，新增条件放在根末尾，全部清空回到无 WHERE。同一外键重读保持，换外键清空。改变根组合保留子组；只有明确“恢复平铺条件”才移除嵌套结构。

最多 30 条条件、16 组（含根）、8 层。每条条件（包括停用项）必须恰好出现一次，非根空组不能应用。全停用子树被省略，不替换为真／假谓词；OR 下的空分支不会放宽剩余条件。原精确数值、集合、NULL、模式无关文本编码及 256KiB SQL 预算保持。

## 实现与边界

复用既有 `FilterGroup` 校验、稳定身份映射和内联编辑器，只增加 JOIN 来源摘要及本地应用说明。没有新增 IPC、配置格式或数据库写协议；原表页分组入口沿原默认行为。

JOIN 生成器只接受自有数据属性的完整有界树，拒绝循环、过深、重复／缺失／越界叶、模式漂移、继承选项及访问器。分组在预览中深冻结，并参与独立打开前的双方元数据重核和 SQL 重算。未提供树时，旧平铺 SQL 字节保持。

父窗口的环境检查允许内联面板首次渲染，明确应用仍核父渲染、原选择对象、原来源和独占占用。分组关闭或重新打开后，旧 Apply／输入回调不能作用于新草稿。Modal 仅新增可选 Escape 路由，让分组区域自身处理输入法及取消；其它窗口保持原 Escape 关闭行为，JOIN 的执行／保存快捷键继续禁止穿透。

仍只打开同连接独立查询，不自动执行或保存，不继承原表筛选。WHERE 在 ON 之后，LEFT JOIN 的父侧筛选及 NULL 三值逻辑保持原说明。任意多表、聚合／HAVING、查询转视图等尚未完成，不计完整 O04。

## 验证证据

本轮 WIN11-TEST 不可达，未派发任务；按既有授权回退本机 Windows。最终十二份相关单元 **286 项通过**，涵盖旧生成器及平铺条件、共享分组编辑器／门禁／重映射、JOIN 树语义、深冻结、完整覆盖、来源失效、真实 React 交互及 Modal 键盘路由。严格类型检查及产品构建通过；原 Rollup 警告和内存组件 act 提示保留，不宣称全仓测试通过。

已再次核 SSH 为 Server-200，未执行 Docker。六专用端点（13357／13380／13384／13310／13311／13484）各使用随机隔离库、真实父子外键及准确 owner；每库三表十条合成数据。读取实际元数据后，用产品生成器和连接执行 **28 向量 × 5 会话模式 × 6 端点 = 840 次 SELECT**，全部结果逐值比较、每次警告检查及原线程关闭后核零。13484 严格 TLS；不关闭优化器／外键检查，不修改全局设置、用户或权限。

原二十条向量及准确预期逐字保持，新增八条：AND 包含 OR、OR 包含两个 AND、两种全停用子组、全停用嵌套树、非顺序叶遍历、父 NULL 与子集合组合、分组后排序及 LIMIT。五模式为原值、空、ANSI_QUOTES、NO_BACKSLASH_ESCAPES 及两者组合；实际版本仍为 MySQL 5.7.44／8.0.46／8.4.11、MariaDB 10.11.19／11.4.13，含独立严格 TLS MySQL 8.4.11。没有从业务库读取夹具数据。

所有测试连接收尾后，逐库核 owner、完整行、准确三表与定义、内部外键、外部引用和占用，再精确删除六库，均核不存在。

Windows 原生组件 **六例单轮通过**，每例原 120 秒、单 worker、零重试：排序深／浅 5.216／3.025 秒，平铺筛选深／浅 3.486／3.794 秒，分组深／浅 4.125／3.967 秒。新增窗口从真实 TableTab 菜单进入，检查焦点进入、未提交组阻止旧预览、组合事件期间按键保护、Escape 取消保持原 SQL、混合分组及 Ctrl+Enter 本地应用。原全局 43 行上限、两项排序、父页草稿、四次准确元数据读取及只新增一查询标签均保持，零数据库执行和剪贴板操作。

六应用均正常 exit 0，准确 PID 经直接 Windows CIM 核不存在，通过例的六个临时目录核零。1024×680 逻辑视口保持，明暗编辑区截图已实看，横向溢出断言通过。逻辑 CompositionEvent 不代表实体系统输入法验收；离线组件及 840 次真实 SELECT 是独立证据，不合并宣称产品主进程、完整查询编辑器或实库完整 GUI 已验。

首轮新增交互测试五项失败，定位为首次渲染过早要求父提交标记；修正产品接线后完整复验通过。保留原轮、断言和超时，没有追认旧失败。前轮派生表 MySQL 8.0 特殊字符失败继续单独保留，不以本轮真实普通表通过覆盖原记录。macOS 双架构、安装包、全量回归和其它未完能力继续跟进，暂不发布。

## 复验

```powershell
pnpm exec vitest run tests/unit/table-foreign-key-join.test.ts tests/unit/table-foreign-key-join-filters.test.ts tests/unit/table-foreign-key-join-groups.test.ts tests/unit/table-foreign-key-join-intent.test.ts tests/unit/ui-table-foreign-key-join.test.tsx tests/unit/table-read-sql.test.ts tests/unit/table-filter-enabled.test.ts tests/unit/table-filter-groups.test.ts tests/unit/table-filter-groups-helpers.test.ts tests/unit/table-filter-groups-ui.test.tsx tests/unit/table-filter-groups-gate.test.ts tests/unit/join-order-native-guard.test.ts
pnpm typecheck
pnpm build
```

本轮严格类型与构建分别通过 `scripts/typecheck.mjs`、`scripts/build.mjs` 串行执行，未改标准参数。原始日志保留本机 `.cache/join-groups-20261102/`，不提交凭据、实库快照或日志。

原生入口仍为 `tests/e2e/table-foreign-key-join-order-native.spec.ts`，清除认证及模块注入环境后设置 `DBARK_JOIN_ORDER_NATIVE=1`、`DBARK_INTEGRATION_ENABLED=0`，使用单 worker、零重试。实库沿[条件筛选专项](table-foreign-key-join-filter-20261102.md)的准确身份、owner、预置与清理保护，额外明确 `DBARK_JOIN_GROUP_READONLY=1` 才运行 28 条向量；测试本身不创建或修改表，默认关闭／跳过不算通过。
