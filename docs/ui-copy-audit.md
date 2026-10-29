# 全界面说明文案精简检查

本轮基于 fb619e85，以全部 135 个既有渲染组件、App 主入口、中文文案模块及实际引用为范围进行静态检查。默认界面移除常驻教程，必要规则按需展开；风险确认、操作目标、状态、错误和进度保留。静态全量检查不代表每个弹窗均已完成原生界面验收。

## 检查覆盖

- 主界面与查询组件：见下表。
- 表数据与结构：[逐组件清单](ui-copy-audit-structure.md)，36 个组件。
- 连接与传输：[逐组件清单](ui-copy-audit-transfer.md)，20 个组件。
- 搜索、记录、历史及其他：[逐组件清单](ui-copy-audit-auxiliary.md)，44 个组件。
- App.tsx：删除欢迎页和关于页装饰介绍及重复功能小字，保留操作入口、产品名称、版本和许可证。
- 服务器监控补充一句账号可见范围与非原子快照限制，详细规则折叠。

| 组件 | 处理 | 结果 |
| --- | --- | --- |
| OpenTabSearchDialog.tsx | 无需修改 | 仅保留命中数量、空状态和打开操作。 |
| PageFindPanel.tsx | 转入帮助 | 当前页范围、正则、替换快捷键和类型规则合并折叠；替换草稿确认与只读原因保留。 |
| QueryAnalyzeConfirmDialog.tsx | 无需修改 | 实际执行、副作用及取消不可撤销风险必须可见。 |
| QueryAnalyzeView.tsx | 转入帮助 | 数据库指标与树导航教程合并折叠；实测和估算指标、截断和警告保留。 |
| QueryBindingDialog.tsx | 缩短／转入帮助 | 绑定状态简化；更新拒绝规则折叠。 |
| QueryCloseDialog.tsx | 无需修改 | 保留草稿保存或放弃的必要确认。 |
| QueryContinueOnErrorNotice.tsx | 无需修改 | 仅包含执行完成情况、停止原因和写入风险。 |
| QueryDatabaseSwitchDialog.tsx | 缩短 | 作用范围和会话诊断副作用压缩，当前默认库与结果状态保留。 |
| QueryFileReloadDialog.tsx | 无需修改 | 文件变化、丢弃草稿风险、差异计数与确认需保持可见。 |
| QueryFilesDialog.tsx | 转入帮助 | 编码、大小及另存规则合并折叠；写入未知和重读建议常驻。 |
| QueryFileTaskProgress.tsx | 无需修改 | 仅任务进度和取消状态。 |
| QueryLayoutSplitter.tsx | 无需修改 | 没有常驻说明。 |
| QueryParametersDialog.tsx | 缩短／转入帮助 | 值参数规则、日期与暂存说明合并折叠，敏感值和覆盖当前输入提醒保留。 |
| QueryPartialOutcomeNotice.tsx | 无需修改 | 保留失败位置、已执行部分和事务风险。 |
| QueryResultColumnsDialog.tsx | 转入帮助 | 列布局和冻结规则合并折叠，当前冻结边界保留。 |
| QueryResultComparisonDialog.tsx | 缩短／转入帮助 | 保留已返回范围及截断；匹配键和内部身份规则折叠。 |
| QueryResultFilterPanel.tsx | 转入帮助 | 筛选语义、分组、候选和通配教程合并一处，移除每条规则重复段落。 |
| QueryResultFind.tsx | 转入悬停提示 | 保留匹配计数与查找范围，长规则改为范围提示。 |
| QueryResultPresetsDialog.tsx | 缩短／转入帮助 | 敏感条件原值本地保存提醒常驻，应用规则折叠，当前配置计数保留。 |
| QueryResultSnapshotActions.tsx | 删除／缩短 | 移除与两按钮 title 重复的常驻长说明；截断和文件操作状态保留。 |
| QueryResultSnapshotDialog.tsx | 缩短／转入帮助 | 敏感内容提醒常驻，离线规则和另存范围按需查看。 |
| QueryResultSortPanel.tsx | 转入帮助 | 排序范围、比较规则、NULL 语义和快捷键集中折叠。 |
| QueryResultStatisticsDialog.tsx | 缩短／转入帮助 | 保留统计范围和近似精度状态，专业规则折叠，舍入详情放悬停提示。 |
| QueryResultValuePicker.tsx | 转入帮助 | 删除重复范围介绍，候选值规则和快捷键集中折叠。 |
| QueryRowDetailsPanel.tsx | 删除／转入悬停提示 | 合并只读说明，内部 key 改为字段标题提示，实际值与截断保留。 |
| QueryStreamExportDialog.tsx | 转入帮助 | CSV ZIP 规范和结果序号规则折叠；新执行写入、协议诊断和重试风险常驻。 |
| QueryTab.tsx | 删除／转入悬停提示 | 移除常驻筛选和排序教程；无有效排序时不占状态行，保留数量、优先级和预算异常。 |
| QueryTransactionSettingsDialog.tsx | 缩短 | 精简诊断副作用说明，当前事务、默认属性和开启自动提交确认完整保留。 |
| QueryWarningsDialog.tsx | 转入帮助 | 报告快照规则折叠；实际警告和未完整采集状态保留。 |
| ResultsGrid.tsx | 无需修改 | 列头排序及单元格操作已经通过悬停提示说明。 |
| SessionObjectsDialog.tsx | 缩短／转入帮助 | 结构读取诊断副作用常驻，缓存和对象来源规则折叠。 |
| SqlEditor.tsx | 无需修改 | 无常驻教程，保留编辑器功能。 |
| TableTab.tsx | 无需修改 | 当前筛选表达式、只读原因、提交预览及不确定写入提示均为必要信息。 |
| ui.tsx | 新增帮助呈现 | 原生 details/summary 默认折叠，支持键盘和焦点样式；未统一隐藏说明类。 |
| WorkspaceTabStrip.tsx | 删除／转入悬停提示 | 删除重排教程和菜单冗余段落，标签 title 保留拖动与键盘提示；动作状态继续播报。 |

## 验证范围

实际平台为 Windows 本机、Node.js 24.17.0。优先排队 WIN11-TEST 后，测试机连续处理另一项菜单复验，确认本轮尚未取包或启动，已取消远端排队后在本机独立工作树接续；没有两台机器重复运行本轮。Corepack 下载受限，直接运行项目同一 Node 脚本，没有更改依赖锁。

| 验证 | 实际命令与结果 |
| --- | --- |
| 类型检查 | node scripts/typecheck.mjs，退出码 0。 |
| 全单元 | node node_modules/vitest/vitest.mjs run --maxWorkers=4 --minWorkers=1，969 文件通过、1 文件跳过；20,403 项通过、1 项 POSIX 条件跳过，退出码 0。原断言与测试超时未放宽。 |
| 构建 | 前置原类型检查通过后运行 node scripts/build.mjs，退出码 0。 |
| 窗口专项 | DBARK_INTEGRATION_ENABLED=0、DBARK_UI_COPY_TEST=1；node node_modules/@playwright/test/cli.js test tests/e2e/ui-copy-cleanup.spec.ts --workers=1 --retries=0 --trace=off --reporter=line,json，1 项通过，退出码 0。 |
| 原版本截图 | fb619e85 原源码独立构建，同一虚构快照与新专项的 BASELINE 模式，1 项通过，正常退出。 |
| 标签回归 | node node_modules/@playwright/test/cli.js test tests/e2e/tab-order-offline.spec.ts --workers=1 --retries=0 --trace=off --reporter=line,json，1 项通过，退出码 0。 |
| 静态交互比对 | 136 个入口（App 与既有 135 个组件）的 on* 事件和 disabled 条件与原版一致。新增说明组件仅使用原生 details/summary；Modal 将 summary 纳入焦点循环。 |

窗口专项以合成只读快照覆盖深浅主题和 1440／1024 内容宽度，检查 Tab 可达、Enter／空格展开收起、默认教程不可见及展开帮助边界，保留 12 张截图。原生归属、零禁止命令和正常退出均由原夹具核验。静态全量审查不等于逐个弹窗的真实数据库验收；未运行实库、认证、系统剪贴板、安装包、macOS 或发布流程。

首轮默认并发全单元的失败原件保留：35 项失败包括缺失帮助组件的纯展示端口、说明位置断言、必要格式和回执范围提示，以及资源超时。逐项修正后重新全量通过。CHECK 提取测试缺少两个外界 false 状态端口的问题在原版本原样复现后补齐，原断言未删；观察器在原版本和修正版均以原 5 秒门槛独立通过。未修改产品执行逻辑或放宽验收门槛。

记录与截图保存在主目录忽略的 .cache/ui-copy-cleanup-20261029；首轮失败日志另存于其中的 first-run。

并行工作补查：原目录另一个任务新增的侧栏菜单组件仅有短操作名称与快捷键提示，无需精简；初次文案冻结不含该功能；随后已跟随 main 整合，并完成组合验收。

## 最新 main 组合验收

本任务提交 f0304ba3 与 main 的侧栏提交 4b7f3844 自动整合为 a8f13c3b，未发生冲突。整合后在 Windows 本机以同一原门槛完成：类型检查通过、侧栏／收藏等 14 文件 132 项通过、原构建通过；查询帮助与标签重排两个正式窗口用例串行通过（零跳过、零重试），全部正常退出。与最新 main 对照的 137 个入口，on* 事件与 disabled 条件变化为零。

组合验收原件另存于上述本机目录的 integration 子目录；顶层 after-dark-1440.png、after-light-1024.png、help-light-1024.png 更新为整合后实拍，before-dark-1440.png 仍为原版本同场景实拍。
