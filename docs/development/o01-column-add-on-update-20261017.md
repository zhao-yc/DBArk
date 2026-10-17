# O01 新增普通时间字段的受控自动更新

基线为 `474324a2792381e613045a608e47b8fe74e55aed`，另建独立任务分支，不修改原提交或冻结的0.20候选、版本和dist。原既有列切片仍见[前一片说明](o01-column-on-update-20261017.md)。本轮GUI、200、Docker、剪贴板、凭据读取及手动CI均为0实际，不重建或改动dist。

## 扩展边界

真实ColumnPatchDialog的新字段表单增加可选“修改 自动更新时间”。默认未勾选，ADD载荷完全省略该键，沿用原类型、默认值、NULL、注释及位置规则；显式选择不附加则发送 `onUpdate:null`。已选择的表达式和勾选状态随本地草稿保留；修改类型导致不兼容时明确报错，不静默丢弃意图，用户仍可取消勾选。

启用仅接受普通DATETIME/TIMESTAMP，复用 `{kind:'expression',expression:'current-timestamp',precision?:0..6}`。勾选该属性（包括明确不附加）时须有明确DEFAULT及一致精度，SQL NULL须配允许NULL；默认时间表达式、ON UPDATE和字段精度分别核对。省略精度沿用字段精度；不自动补默认值、调整NULL或舍入精度。无DEFAULT不能靠隐式规则开启自动更新。没有勾选自动更新时不改变原ADD的无DEFAULT行为。

当前五版能力门保持MySQL5.7.44、8.0.46、8.4.11及MariaDB10.11.19、11.4.13；其他版本明确拒绝新属性，不按邻近版本推断支持。非时间类型、任意表达式、generated/原SQL/未知键及显式undefined仍由原严格IPC拒绝。

## 执行与后核验

只扩展原 `schema.columns.*` 内的ADD可选字段，不新增命令。共享载荷、计划器、ColumnPatchDialog和locale承载；不改TableTab、数据提交、CALL、主分支版本或候选产物。

新属性仅进入明确的单条ADD COLUMN；用户本地暂存不生成DDL，预览显示实际只读SQL，完成原风险确认后仍用原一次性令牌执行。身份、原定义、MDL取消等待原回调、未知终态及不重放约束保持。

新列只有明确请求的受控ON UPDATE可以通过后核验；DEFAULT、NULL、类型、注释及其他属性仍核对。遗漏自动更新、服务端多出generated/未知属性、默认值或NULL被改变，均保留已收到DDL成功回应但未完整核验事实。所有新增时间列也核对EXTRA与完整定义，包括未勾选却目录暗含自动属性的情形，不把未知目录当作无属性。

## 验证与后续六组合

纯验证包含五版DATETIME/TIMESTAMP、精度0/3/6、显式DEFAULT、旧ADD省略行为、明确DEFAULT下null与省略的SQL一致、严格IPC、真实Engine预览零DDL/单次ADD/后核验拒绝；真实ReactDOM内存端口覆盖表单禁用条件、草稿重开、只读预览、风险确认、双击一次，以及类型变化后明确取消。内存端口不证明原生布局、输入、焦点或数据库行为。

新增 `tests/e2e/table-column-add-on-update.spec.ts` 独立默认关闭，双门为 `DBARK_COLUMN_ADD_ON_UPDATE_UI=1` 和 `DBARK_INTEGRATION_ENABLED=1`；list先短路，不加载live或桌面夹具。复用既有isolatedDatabase和桌面生命周期，没有新建控制框架。每个目标原完整3例：DATETIME(0)/NULL默认、DATETIME(6)/NULL默认、TIMESTAMP(6)/NOT NULL及CURRENT_TIMESTAMP默认，均从真实对象树打开专用设计窗口、实际输入并预览SQL、确认单次ADD；独立观察精确数据、未改属性及真实UPDATE自动时间行为。

六组合仍为200的13357/13380/13384/13310/13311/13484；ROOT实际执行前重新核目标服务器、实际版本、独占窗口和TLS，13484沿原严格TLS及证书路径。认证只由ROOT既有安全渠道提供，本轮不读取或制作runtime。实际权限、取消/MDL、断线及安装验收继续交由ROOT；3例准备不等于这些场景均已覆盖，更不是六组合通过记录。
