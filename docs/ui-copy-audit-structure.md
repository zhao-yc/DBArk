# 表数据与表结构页面文案检查

本表记录源码逐组件检查结果，不代表图形界面或原生平台已经验收。仅调整说明的呈现和措辞，未修改业务事件、IPC、确认项或数据库执行逻辑。

| 组件 | 处理 | 结果 |
| --- | --- | --- |
| ColumnEncodingEditor.tsx | 转入帮助 | 转换范围、会话说明与同字符集入口合并折叠；重建表、排他锁和磁盘风险常驻。 |
| ColumnPatchDialog.tsx | 转入帮助 | JSON、自动更新时间、生成列预算和会话说明按编辑区域折叠；维护窗口、隐式提交、重建表及所有风险确认保留。 |
| ForeignKeyPatchDialog.tsx | 转入帮助／删除 | 字段映射、额外父表及前置要求按区域折叠；名称规则改悬停提示；删除重复预览说明，保留替换风险、依赖状态和全部确认。 |
| IndexOptimizerEditor.tsx | 转入帮助 | 数据库方言下的优化器开关解释折叠；当前值、作用风险和拒绝原因常驻。 |
| IndexPatchDialog.tsx | 转入帮助／删除 | 前缀长度规则折叠，删除与按钮重复的预览介绍；维护窗口、DDL、依赖和风险确认保留。 |
| NewTableChecksEditor.tsx | 转入帮助 | 草稿、服务器能力、NULL 语义与预算规则合并折叠，保留项数和编辑控件。 |
| NewTableColumnEncodingField.tsx | 无需修改 | 仅显示选中编码值或实际不兼容警告，无常驻教程。 |
| NewTableGeneratedField.tsx | 转入帮助 | 表达式语法、前序字段与键规则合并折叠；实际可引用字段和错误保留。 |
| NewTableIndexEditor.tsx | 转入帮助 | 索引前缀及适用范围合并为一个折叠说明。 |
| NewTableOnUpdateField.tsx | 转入帮助 | 正常规则改为选择框悬停提示；实际不可用原因仍常驻显示。 |
| TableApplyReceiptsDialog.tsx | 转入帮助／删除 | 列表隐私规则按需查看，详情保留简短事务范围和不保存 SQL／行值提醒；删除空状态重复段落，未知结果、未确认行数和本机时间说明保留。 |
| TableAutoIncrementDialog.tsx | 无需修改 | 已有文字为目标、当前计数、预览、风险、执行与未知状态，不能删作普通教程。 |
| TableBatchFillDialog.tsx | 缩短 | 将范围说明缩为仅暂存当前页勾选记录、仍需表页预览提交；控件、计数和错误保留。 |
| TableCheckConstraintsDialog.tsx | 转入帮助／删除 | 能力与表达式实现解释折叠，删除与读取按钮重复的起步说明；元数据锁、独立会话、结果未知和确认保留。 |
| TableCommentDialog.tsx | 无需修改 | 仅保留目标、输入预算、实际警告、前后值、确认与任务状态。 |
| TableCopyDataDialog.tsx | 无需修改 | 展示对象身份、服务器能力、警告、预览与执行结果，无可删的普通长段教程。 |
| TableCopyStructureDialog.tsx | 无需修改 | 展示对象身份、生成列、计数核验及实际警告，均为当前操作事实。 |
| TableCreateConfirmation.tsx | 无需修改 | 固定 SQL、编码选择、生效前核对与风险确认属于执行前必要信息。 |
| TableDefaultEncodingDialog.tsx | 无需修改 | 编码范围属于影响范围提醒；当前配对、预览、警告和确认均保留。 |
| TableDraftDialog.tsx | 转入帮助／缩短 | 保存范围和本地状态说明折叠，恢复说明缩短；未加密文件风险和恢复确认常驻。 |
| TableDropDialog.tsx | 无需修改 | 永久删除的目标、准确名称确认、备份及 DDL 风险均必须常驻。 |
| TableFilteredDeleteDialog.tsx | 无需修改 | 全部匹配行删除的范围、事务/依赖风险、整表警告、准确行数与确认保留。 |
| TableFilteredExportDialog.tsx | 转入帮助／缩短 | 范围和未提交数据说明缩短；XLSX、选列与文件写入规则按区域折叠，SQL 非备份及恢复限制风险常驻。 |
| TableFilteredUpdateDialog.tsx | 转入帮助 | 赋值字段与预算教程折叠；全部匹配行范围、整表风险、事务与副作用风险及确认常驻。 |
| TableFilterGroupsDialog.tsx | 转入帮助 | 组合方法、层数限制与快捷键合并折叠，当前条件结构及错误保留。 |
| TableFilterPanel.tsx | 转入帮助 | 标量、区间、NULL 和集合规则按当前运算符统一折叠，去掉集合模式下的空说明占位。 |
| TableForeignKeyJoinDialog.tsx | 转入帮助／缩短 | 整表关联范围缩短，JOIN 语义、真实外键和别名规则合并折叠；实际关联映射和字段选择保留。 |
| TablePreferencesDialog.tsx | 转入帮助 | 列布局和冻结规则合并折叠；冻结边界及是否保存状态常驻。 |
| TablePresetPanel.tsx | 转入帮助 | 本地方案说明折叠，保存、应用、替换和删除确认及状态不变。 |
| TableQueryTemplateDialog.tsx | 转入帮助／缩短 | 模板、选列顺序及 INSERT/UPDATE 字段规则合并折叠；参数下一步提示缩短，保留实际 SQL。 |
| TableRenameDialog.tsx | 转入帮助 | 同库改名与名称格式解释折叠；准确目标、DDL 及依赖风险确认常驻。 |
| TableSelectedFilterPanel.tsx | 转入帮助 | 构造方法、与原条件组合、原值表示、应用流程与快捷键合并折叠；本次字段、行数及匹配语义常驻。 |
| TableSortPanel.tsx | 转入帮助 | 服务器排序范围、NULL 与并列比较规则合并折叠；当前字段、优先级和草稿保留。 |
| TableStatisticsDialog.tsx | 转入帮助／缩短 | 服务器统计范围和草稿提醒缩短；字段选择、停用条件、不同值语义及有界预览规则合并折叠；实际统计、精度提醒和警告保留。 |
| TableTruncateDialog.tsx | 无需修改 | 清空表的准确目标、备份、隐式提交与不可恢复风险及确认常驻。 |
| TableValueOptionsDialog.tsx | 转入帮助／缩短 | 服务器范围缩短；排序规则、返回上限和 LIKE 语法合并折叠；截断、近似数值及实际勾选状态保留。 |

本分工共检查 36 个组件。删除、清空、覆盖、隐式提交、元数据锁、维护窗口、未加密文件、结果未知和全部风险勾选维持可见。普通帮助默认折叠，使用原生 details/summary 支持键盘操作。

验证：结构分工组件 JSX 语法扫描无诊断；类型检查、单元测试、构建和界面回归由主智能体统一交给 WIN11-TEST。原有测试按文案对象引用检查范围和状态，未修改或放宽任何断言。

验收补充：提交记录详情保留简短的目标事务、触发器／外部副作用和不保存 SQL／行值范围说明，不能只依赖父窗口帮助。
