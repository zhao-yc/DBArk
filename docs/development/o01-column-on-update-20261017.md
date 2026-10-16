# O01 既有时间字段自动更新属性

本片基于 `2c1c1bef181394fec09edd54621ed0840c5506cf` 独立开发，不属于冻结的0.20候选，也不修改版本号。本轮只进行纯验证、类型检查和源码构建；GUI、200实库、Docker、系统剪贴板和手动CI均为0实际。

## 可视化范围

复用真实表的“字段差异编辑”，在既有普通DATETIME/TIMESTAMP字段中增加独立“修改 自动更新时间”开关。未勾选不修改；选择移除明确发送 `onUpdate: null`；启用复用原受控 `{kind:'expression',expression:'current-timestamp',precision?:0..6}`。精度必须与现有字段相同，不接任意SQL。本片不对新增字段开放此属性，也不允许与同一字段的类型、默认值等属性混合修改。

打开设计窗口不产生草稿；行编辑恢复原属性再暂存会移除该差异。暂存只在本地，预览只读且零DDL；风险确认完整后仍沿原单次令牌执行一条ALTER。原始名称、DEFAULT、可空性、注释、其他属性、旁列和约束不从简化模型重建。

## 保守能力与默认语义

首片能力只开放既有基线MySQL 5.7.44、8.0.46、8.4.11，以及MariaDB 10.11.19、11.4.13（允许版本产品后缀）。这是一项代码门槛，尚不是本片实库通过声明。其他版本只读。

- 无明确DEFAULT的时间列均只读。ON UPDATE的增删可能影响隐式默认语义，不能通过补DEFAULT“修好”用户原定义。
- TIMESTAMP还必须有明确NULL/NOT NULL片段；不读取或改变 `explicit_defaults_for_timestamp`，不把缺省当ON。
- 生成列、隐藏列、自增或未知/可执行定义、不能可靠识别的表达式及精度、不兼容类型均拒绝。视图仍沿原基本表读取门拒绝。
- 本字段流程独立核对COLUMNS.EXTRA与完整原定义。目录未知或矛盾时get关闭该属性，直接伪造preview/apply也会在DDL前拒绝；不修改共用结构读取器。
- DEFAULT及其他原属性均参与原后核验。DDL已收到OK但自动更新、默认值或目录不符时，保留 `ddlCompleted:true`、`definitionVerified:false`，不自动重试或逆向修改。
- 原MariaDB风险默认值整表门、独立结构连接、身份/模式/定义重核、MDL取消等待真实回调、单次令牌和未知终态保持。

语义依据：[MySQL自动时间属性](https://dev.mysql.com/doc/refman/8.4/en/timestamp-initialization.html)、[MariaDB TIMESTAMP](https://mariadb.com/docs/server/reference/data-types/date-and-time-data-types/timestamp)。这些文档说明不能替代本片六组合实际验收。

## 公共边界

仅扩展原 `shared/tableColumnPatches.ts` 的原字段读取投影、属性能力及 `alter.changes.onUpdate`；新增字段输入仍严格拒绝该键。复用原 `schema.columns.get/preview/apply/release`，不新增命令、不接受渲染进程传入SQL，不修改main/shared其他API、Engine分发、TableTab、数据提交或CALL。

实现位于原字段解析器、SQL计划器、短任务与后核验、前端草稿助手、ColumnPatchDialog及集中中文文案。新的EXTRA只读核验限定在字段任务模块，不扩散到其他结构任务。

## 自动验证与后续实际验收

单元覆盖：五版纯能力及SQL、精度0/3/6、严格IPC空值/未知键、无DEFAULT/隐式TIMESTAMP拒绝、原属性保持、目录矛盾/变化拒绝、真实Engine单次投递及后核验失败、取消未知与不可重放。真实ReactDOM内存端口覆盖控件暂存、只读SQL预览、确认门、同步双击仅一次、移除后重开及恢复原值。内存端口不证明原生布局、焦点、输入或数据库行为。

新增 `tests/e2e/table-column-on-update.spec.ts` 默认关闭，只有 `DBARK_COLUMN_ON_UPDATE_UI=1` 与 `DBARK_INTEGRATION_ENABLED=1` 同时存在、ROOT明确分配200单一目标时执行；`--list`先短路，不加载live/desktop夹具。不得为收集删除该短路。测试每例复用现有isolatedDatabase及桌面生命周期，未新建控制框架。

| 后续目标 | 已准备身份 | 实际验收要求 |
| --- | --- | --- |
| 13357 MySQL5.7、13380 MySQL8.0、13384 MySQL8.4、13310 Maria10.11、13311 Maria11.4、13484 MySQL8.4严格TLS | 每组合原完整3例：DATETIME(0)、DATETIME(6)、TIMESTAMP(6) | 从真实对象树打开专用字段窗口；预览前后SHOW CREATE和精确数据不变；开启后真实UPDATE自动改时间；移除后再次UPDATE保持时间；DEFAULT、NULL、注释、DECIMAL、空串与文本NULL保持；各一次apply且令牌不重放 |

ROOT执行前须重新核对目标服务器、端口、实际版本、TLS/证书及独占窗口，通过既有安全渠道只在内存注入认证。员工3不读取凭据或生成runtime。13484必须沿原严格TLS路径，不能降级或借其他实例代替。

原字段MDL/权限/断线/身份回归继续作为实际验收要求；新增测试文件中的三例不覆盖这些全部场景。当前没有本片六组合、原生平台或安装验收结论，不能据纯验证把O01标为完整覆盖。
