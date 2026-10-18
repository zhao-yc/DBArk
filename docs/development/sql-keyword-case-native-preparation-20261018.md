# 关键字大小写偏好原生验收准备

后续 Root 在修正真实标题栏定位后，固定 `41282a0` 的 Windows 源码两条正式身份已零重试通过，包含默认／大小写、一次 Undo、迟到原模块回包、SQLite9 和独立重启活动身份。原首败和准确观察边界见[实际验收](../../tests/integration/acceptance-sql-keyword-case-native-root-20261018.md)。以下保留准备阶段当时事实，安装包与 macOS 仍未验。

本片基于Root 0.28已公开提交 `2cf39e0c22001f33c707dcba1d87b4376f22231a`，在普通独立clone、分支 `codex/employee4-keyword-case-native-prep-20261018` 准备。只新增用例、独立门、纯样例和RAM护栏，不修改产品、原原生用例、运行时、工作流或任何现有文件。本轮未运行原生验收。

## 两个原生用例的计划

`tests/e2e/sql-keyword-case-native.spec.ts` 登记upper、lower两例，每例均包含：

- 真实偏好面板首次默认为preserve；改变草稿再取消仍为preserve。保存upper/lower只改变偏好，不自动编辑SQL。
- 真实Monaco输入和 `Alt+Shift+F` 格式化，固定四个关键字角色给出独立预期。未引用名称、反引号名称、字符串及两种注释必须保持原文；词法边界不能因排版归一化丢失。单次Undo精确恢复格式化前正文，Redo精确恢复结果，editor/model和EOL保持。
- 首次upper/lower真实角色模块请求扣留期间，真实切到另一查询并切回，再原样放行。必须观察产品拒绝迟到结果，两个模型的身份、正文、版本和alternativeVersion均不变。
- 显式切换upper/lower再恢复本例模式。首个实例正常退出后，原只读SQLite入口检查schema9、该模式、两个标签及活动标签；同私有目录独立重启后，先核持久化activeTabId、标签顺序及正文，再核唯一可见pane的顺序、editor/model及正文确属保存的活动ID，不能先点击标签修复恢复状态。随后经实际格式化证明恢复模式生效。
- 第二实例正常退出、原已记录PID全部确认不存在后，才沿原控制器删除精确所属目录。失败保留现场；不强停、不重试或延长期限。

设置、历史和任务只通过原只读IPC观察。真实连接表单使用原 `127.0.0.1:1`、无密码无SSH概要；必须保留拒连提示，再由原继续按钮打开离线查询，不执行SQL。本文描述的是未来计划，本轮没有触及该端口。

## 独立门与原生命周期

独立门为 `DBARK_SQL_KEYWORD_CASE_NATIVE_TEST=1`，同时要求 `DBARK_INTEGRATION_ENABLED=0`；旧缩进门及分栏门须缺省或精确0，不接受它们的清单。Root提供自己的绝对清单路径 `DBARK_SQL_KEYWORD_CASE_MANIFEST` 及原字节小写SHA256 `DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256`。直接使用既有 `createEditorIndentNativeRun(binding, approval)` 可选参数，不伪造旧门。

沿用原TestInfo起点、120000毫秒总期限、afterEach墓碑、身份清单、私有目录、正常will-quit/close/页面无错及原PID确认。每个await两侧继续使用原run.step和归属检查。清单和环境漂移永久停链，即使恢复原值也不可复活；trace、screenshot、video全部off。源码与安装身份核验及运行前端口预检仍由原运行时负责，本片不改任何预算或收尾方式。

默认关闭以及RAM模拟的list仅登记两例，不读取凭据值、不加载原生运行时或分配资源。RAM声明检查使用拒绝执行的运行时哨兵及凭据getter，不是实际Playwright/list运行。

## 真实模块回包门的边界

新用例内的临时门只注册于已认证实例唯一BrowserWindow的原webContents.session，nonce及原窗口/webContents/session对象共同约束。它只扣留该webContents唯一的 `file:` 协议 `sqlFormattingRoles-<hash>.js` 原请求callback，其它请求原样放行。释放调用原callback，保持真实文件载荷；未失败且唯一回包已闭合后才实际移除listener并删除私有门。释放后再来重复请求也永久置failed，detach必须拒绝，保留原listener、私有门及计数线索。默认/list不安装该门。

静态护栏递归检查全部src、scripts中的TS/JS源码及PowerShell/shell脚本，拒绝任何 `onBeforeRequest` 命名引用；括号访问、解构别名和Main入口以外模块均在此范围。链接或读取失败不得被静默忽略。这只证明本次扫描的受控文本没有该名字，不能证明第三方依赖、动态拼接代码或实际目标session没有listener，也不分析任意形式的等价动态代码。

Electron没有提供本门可用的既有onBeforeRequest listener读取接口，本片没有取得、保存或恢复旧listener的能力；注册会替换旧listener，正常detach(null)也不能恢复它。Root整合后必须复核相关依赖及运行环境，只有能确认目标session没有既有listener时才安排此专项；不能把静态通过写成任意环境安全的运行时证明。

未观察到唯一请求、请求重复、归属变化或回包未闭合都必须失败并保留现场，不能用已缓存模块或假延时替代。是否能在实际源码/安装入口观察到该file请求、平台协议行为以及真实选择器/快捷键仍待Root后续原生验证；RAM不能证明这部分成功。

## 本轮验证与交付边界

首片仅运行Vitest纯RAM和 `tsc --noEmit`；原184项及原交接保持在 `.cache/keyword-case-native-evidence/handoff.json`。本次对员工2独审三处边界做最小修正，仅跑必要RAM及类型；新的数量和日志摘要见 `.cache/keyword-case-native-review-fix-evidence/handoff.json`。新增反例从正式恢复断言及Main门提取函数，检查错误活动ID、错误可见pane/模型/正文和释放后重复请求；静态前提检查扩到全部src/scripts相关源码。本次不复跑首片其它旧回归，不修改原运行时、原用例、预算、正常退出或真实文件载荷。

实际Electron、GUI、Playwright（含list）、实库、SSH、Docker、端口探测、系统剪贴板和CI运行计数全部为0。没有新增密钥、证书或依赖安装，不读取1556，不修改共享依赖。RAM与类型通过只表示准备可供审查；Windows/macOS源码及安装入口的原生验收均未完成，由Root整合后另行安排。
