# 辅助页面说明文案检查

本表记录本轮源码检查结果，共 44 个组件；不表示已完成界面实跑验收。组件均检查实际 JSX 渲染，不以字段名或样式统一隐藏。

| 组件 | 处理 | 结果与保留信息 |
| --- | --- | --- |
| `ActivityDialog.tsx` | 无需修改 | 任务消息和执行记录属于动态状态。 |
| `BinaryCellViewer.tsx` | 转入帮助、缩短、删除 | 文件、文本和图片规则按当前操作查看；移除其它驱动的阶段性说明，字节状态、只读原因及失败保留。 |
| `BoundedRecordTextarea.tsx` | 无需修改 | 有界输入组件，无独立说明文案。 |
| `ChildReferenceDialog.tsx` | 转入帮助、缩短 | 保留账号可见范围短句；父行快照和只读操作教程折叠，来源、映射及不稳定翻页警告保留。 |
| `CopyInsertSqlButtons.tsx` | 无需修改 | 已有按钮、禁用原因悬停提示，无冗余常驻教程。 |
| `DataSearchDialog.tsx` | 转入帮助、缩短 | 目录、HEX、服务器匹配及打开行为合并帮助；范围选择、视图授权和任务结果保留。 |
| `DataSearchRecordDialog.tsx` | 转入帮助、缩短 | 字段解释、时区规则与定位有效期按需查看；实际读取时间、类型与截断警告保留。 |
| `DataTypeColor.tsx` | 转入帮助、缩短 | 颜色影响范围说明折叠，设置操作保留。 |
| `DefinitionViewer.tsx` | 转入帮助 | 只读定义介绍折叠，定位失效、读取失败和不可精确定位原因保留。 |
| `EditorFontPreferencesDialog.tsx` | 转入帮助、缩短 | 字号范围与恢复默认规则合并帮助；当前字号、错误和保存状态保留。 |
| `EditorIndentPreferences.tsx` | 转入帮助、缩短 | 缩进范围及默认值说明合并帮助；当前偏好与保存状态保留。 |
| `EditorWordWrapButton.tsx` | 无需修改 | 仅操作按钮和状态提示。 |
| `EncryptionStatus.tsx` | 无需修改 | 系统加密能力和仅会话保存的认证状态须常驻。 |
| `ExplainPlanView.tsx` | 转入帮助、缩短 | 查找范围、键盘和详情规则合并帮助；保留估计值非耗时短句、路径和原始输出截断警告。 |
| `ExplainSnapshotDialog.tsx` | 无需修改 | 离线快照与敏感分享风险由主智能体统一精简共享文案，保持可见。 |
| `ExplainSnapshotSaveButton.tsx` | 无需修改 | 保存操作及文件任务状态，无冗余介绍。 |
| `ForeignKeyDialog.tsx` | 转入帮助 | 引用记录的查看和暂存规则按需查看；来源、列映射、空状态和清空 NULL 确认保留。 |
| `HistoryDeleteDialog.tsx` | 无需修改 | 全部匹配或已选范围、不可撤销风险及删除预览均为确认必需信息。 |
| `HistoryPagesDialog.tsx` | 转入帮助、缩短 | 时间格式、耗时和 SQL 插入规则合并帮助；本机时区、匹配进度、插入目标及永久删除警告保留。 |
| `RecentQueryFilesDialog.tsx` | 转入帮助 | 最近文件列表规则按需查看，文件名和空状态保留。 |
| `RecordFormPanel.tsx` | 转入帮助、缩短、删除 | 整行输入规则折叠；树和 JSON 视图简介移至模式按钮悬停，删除无条件客户端权限介绍，保留实际只读原因和待提交短句。 |
| `RecordJsonNodeEditor.tsx` | 转入帮助、缩短 | 教程并入已有详细信息，不再增加帮助入口；输入、路径和实际只读原因保留。 |
| `RecordJsonStructureEditor.tsx` | 转入帮助、缩短 | 输入规则并入已有详细信息；删除条目的后果提示继续常驻，原始数据与状态不变。 |
| `RecordReadonlyProjection.tsx` | 转入帮助、缩短 | 投影格式及原文树规则按需查看；字段与节点范围、摘要、不完整来源和失效状态保留。 |
| `RecordValueEditor.tsx` | 无需修改 | 显示当前输入和字段失效警告，无额外教程。 |
| `RoutineInvocationDialog.tsx` | 转入帮助、缩短 | 参数填写和生成草稿教程合并帮助；写入、隐式提交、外部副作用、完整脚本执行及变量残留说明保持可见。 |
| `SavedQueriesDialog.tsx` | 转入帮助、缩短 | 分组、搜索和插入教程合并帮助；实际插入目标、选择范围、读取失败和刷新要求保留。 |
| `SavedQueryDeleteSelectedPreview.tsx` | 无需修改 | 删除范围包含隐藏选择、不可撤销后果和保留对象均为确认信息。 |
| `SavedQueryMatchNavigation.tsx` | 无需修改 | 仅匹配导航操作和当前匹配状态。 |
| `SavedQueryOrganizationEditor.tsx` | 转入帮助、缩短 | 分组仅本地变更说明折叠；解散子分组后果与实际变更预览保留。 |
| `SavedQueryRenameEditor.tsx` | 转入帮助 | 仅改名称的介绍按需查看；原标题、名称输入及校验错误保留。 |
| `SavedQuerySearchDialog.tsx` | 转入帮助、缩短 | 本地搜索规则、插入与打开说明合并帮助；实际目标、输入待应用状态、失效提示保留。 |
| `SchemaCompareDialog.tsx` | 转入帮助、缩短 | 比较范围和名称匹配规则折叠；源到目标方向、实际选择数、忽略项及 SQL 预览保留。 |
| `SchemaCompareResults.tsx` | 删除 | 删除与已有搜索框悬停说明重复的段落；隐藏选择数量与清理操作仍明确展示。 |
| `SchemaDialog.tsx` | 转入帮助 | 新建表编码的介绍及只读定义教程折叠；CHECK 依赖、编码目录未就绪和删后重建风险保留。 |
| `ServerMonitorDialog.tsx` | 转入帮助 | 快照规则和刷新预算合并帮助；实际时间、数值、读取失败及关闭进度保留。主智能体复核根模块的简短范围文案。 |
| `ServerMonitorEntry.tsx` | 无需修改 | 缺少连接时只保留明确下一步。 |
| `ServerMonitorSessions.tsx` | 转入帮助 | 本次快照筛选和 SQL 摘要规则按需查看；返回数量、达到上限、账号无会话与没有匹配的状态保留。 |
| `Sidebar.tsx` | 无需修改 | 已有对象、数量和首个连接空状态，无常驻长段教程；不碰其它任务的侧栏工作。 |
| `SnippetsDialog.tsx` | 转入帮助 | 插入规则按需查看，用户片段描述为用户数据不修改；删除和未保存确认保留。 |
| `SnippetTransferPanel.tsx` | 转入帮助 | 片段交换规则按需查看；逐项实际警告、替换预览和确认操作保留。 |
| `SqlKeywordCasePreferences.tsx` | 转入帮助、缩短 | 格式化影响范围和恢复默认规则合并帮助，保存状态保留。 |
| `StructureSearchDialog.tsx` | 转入帮助、缩短 | 目录范围、匹配规则和打开行为合并帮助；实际失败、命中位置和继续搜索过期信息保留。 |
| `Workbench.tsx` | 转入帮助、缩短 | 本地收藏及对象链接规则按需查看，空状态只留星标添加入口，真实身份和保存状态保留。 |

风险复核：历史和保存查询删除、JSON 条目删除、例程副作用与完整脚本要求、结构重建及字段依赖警告仍在帮助之外。用户输入、记录值、SQL、对象身份、任务状态和错误没有移入帮助。

静态核验：渲染层 TypeScript 语法解析通过；未在本机运行类型检查、单元测试、构建或 GUI。现有 `explain-navigation.test.tsx` 通过 textContent 查看查找说明，说明仍保留在 DOM，真实默认折叠与键盘验证由统一测试承担。

验收补充：整行 JSON 的“不是可导入或可恢复格式”保持常驻，字段类型与投影规则按需查看；结构删除明确仍须本页数据修改预览提交。
