# 连接与数据传输界面文案审计

本表覆盖本次分配的 20 个组件，记录源码检查与实际文案处理；不代表界面或实库验收完成。所有危险操作的确认项、目标、状态、错误和必要风险保持可见，未改变 IPC、事务或事件处理。

| 组件 | 处理 | 结果 |
| --- | --- | --- |
| ConnectionDialog.tsx | 转入帮助／缩短 | 连接 URI 规则折叠；复制连接认证提示压缩；SSH 指纹、密码清除状态、待选认证文件和活动标签限制保持可见。 |
| ConnectionOrganizationDialog.tsx | 转入帮助／缩短 | 分组、颜色、勾选与预览教程合并为一个使用说明；表头改为“选择”；数量、预览原值与目标值及保存状态保留。 |
| ConnectionsTransferDialog.tsx | 缩短 | 概要及认证文件名说明缩短；替换目标、确认项、认证文件重新选择及身份关联风险保留。 |
| ConnectedExcelTransferDialog.tsx | 无需修改 | 仅连接任务事件，无独立说明文字。 |
| TransferDialog.tsx | 转入悬停提示／删除重复 | CSV 表头规则、模板与提交方式关系、文件选择说明改到对应控件 title；批次提交、整文件事务限制、未知提交和 SQL 脚本风险常驻。 |
| ExcelTransferDialog.tsx | 转入帮助／缩短 | 格式协议、资源上限合并折叠；文件选择说明放 title；导出不应用筛选和分批提交风险保持可见。 |
| CsvExportDelimiter.tsx | 转入悬停提示 | 移除常驻分隔符说明，改到选择框 title。 |
| CsvExportFields.tsx | 缩短 | 所选字段范围及重新读取重置选择压为一句；目标库表、目录失效和空字段警告保留。 |
| ImportConflictFields.tsx | 转入悬停提示 | 冲突策略不保存到配置的解释改到选择框 title；服务器匹配和触发器副作用范围保留。 |
| ImportConflictReport.tsx | 缩短 | 更新计数口径压为一句；处理与提交计数、失败、提交未知及资源收尾风险保留。 |
| ImportNewTableDialog.tsx | 转入帮助 | 扫描与设计教程、类型建议及源文件字节数/SHA256 合并帮助；扫描行数、样本、建表不可回滚和退出保留表风险常驻。 |
| ImportPreflightPanel.tsx | 转入帮助／缩短 | 预检规则和明细编号限制折叠；常驻短句说明只检查映射字段、不写数据且不保证导入成功；报告与失败状态保留。 |
| ImportPresets.tsx | 转入帮助 | 本机配置范围和应用流程折叠；映射未就绪、空列表、错误及进度保留。 |
| DatabaseBackupDialog.tsx | 转入帮助／缩短 | 计划准备状态简化、归档格式折叠；工具信任、全实例写阻塞、锁预算、维护窗口确认和未备份事实常驻。 |
| DatabaseCreateDialog.tsx | 无需修改 | 现有显示为准确目标、创建能力与警告、预览确认和结果，无独立重复教程。 |
| DatabaseDefaultEncodingDialog.tsx | 缩短 | 范围说明保留新表默认值、已有数据不转换及其他查询事务不提交，删去重复措辞；确认项不变。 |
| DatabaseDropDialog.tsx | 缩短 | 范围介绍只保留永久删除数据库及全部结构数据；部分删除、不可回滚、备份及四项风险确认不变。 |
| ResultExportDialog.tsx | 转入帮助 | 文件协议、列映射规则、XLSX 限制及快照范围合并帮助；导出行数、截断警告、目标映射和确认项保留。 |
| ResultInsertDialog.tsx | 转入帮助 | 来源规则、映射规则及完整预览解释合并帮助；来源行列数、TIMESTAMP 时区风险、目标确认和事务/副作用确认常驻。 |
| PasteInsertDialog.tsx | 转入帮助／缩短 | 文本协议、上限、默认值和样本范围合并帮助；预览状态压缩；行列数量、映射和暂存按钮保留。 |

## 检查与待验

- 使用现有 TypeScript 解析器静态解析上述 20 个 TSX：0 个语法诊断；未在开发机运行类型检查、单元测试、构建或界面测试。
- 主任务统一交由 WIN11-TEST 验证帮助默认折叠、键盘展开、明暗主题及较窄窗口。
- 已知测试定位变化：transfer-import-transaction.test.tsx 的 presetHint 从段落改为提交方式选择框的 title；已将该定向断言改为检查选择框 title 的准确提示，其余原导入功能断言保持。
- 原生安装包、实库写入和发布不属于本次文案修改验证。
