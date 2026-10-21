# Navicat 全功能覆盖目标

## 当前开发安排（2026-10-22）

高频连接管理新增[批量整理分组与颜色](development/connection-organization-20261022.md)：分页选择与完整预览、严格元数据补丁、一次SQLite事务及全局CAS，不解密或改写凭据、不委派引擎；侧栏换组保留原节点及在途加载。相关存储／组件／Main和真实React回归通过；最终类型／新构建及完整单元12684项通过／1平台跳过，准确窗口随后记录。C01 完整工作包、安装／macOS矩阵及发行计数不增加，暂不发布。

高频结果导出新增[已返回快照 XLSX](development/result-excel-20261022.md)：正常导出窗口选择 Excel，沿当前行列及勾选范围，数值时间文本、NULL／空串／字节按原 DBArk 协议保留；完整预检后复用原流式背压／取消／原子文件路径，不重发 SQL。完整单元 12606 项通过／1 平台跳过、最终类型／构建通过；准确 `452dda7e` 的[本机 Windows 实库整例及独立 Python 原件读回](../tests/integration/acceptance-result-excel-452dda7e-20261022.md)首次通过原一条 SQL／两个文件、两行六列精确协议及正常退出。F02 完整工作包、安装／macOS矩阵及发行计数不增加，暂不发布。

查询工作区新增[两份固定结果只读对比](development/query-result-comparison-20261022.md)：明确选择匹配键，完整显示四类计数、差异分页及左右字段原值；保留精确数值、NULL、空串及字节，分批可取消，不执行 SQL 或同步。完整单元 12496 项通过／1 平台跳过、最终类型与构建通过；准确 `891a4cb8` 的[本机 Windows 实库窗口](../tests/integration/acceptance-query-result-comparison-891a4cb8-20261022.md)通过四类各一行、精确原值及正常退出，保持两条 SELECT 白名单与剪贴板零调用。四次原生准备失败保留，安装／macOS另验。完整 M03 库表比较同步仍待做，不增加完整工作包或发行计数，暂不发布。另补[离线控制台诊断](development/page-find-fixture-diagnostics-20261022.md)，保留旧 CI 的不同阶段失败，不将本机通过当作根因已清除。

查询结果新增[列统计](development/query-result-statistics-20261022.md)：当前列或可见列、已筛选全部行或打开时勾选行的计数、非 NULL 不同值、极值及精确数值合计／平均值；分批可取消，不执行 SQL，截断范围明确提示。完整 12343 项通过／1 平台跳过、类型与新构建通过；准确 c071f4d1 的[本机 Windows 实库单例及独立文件读回](../tests/integration/acceptance-query-result-statistics-c071f4d1-20261022.md)通过，含 21 位有限平均值、范围切换、原一次 SQL／两格式导出与正常退出。截断／取消及预算为 RAM 证据；旧基线 Windows CI 失败保留，安装／macOS等组合另验，不增加完整工作包或发行计数，暂不发布。

表数据新增[嵌套 AND／OR 筛选](development/table-filter-groups-20261022.md)：组合现有条件、先审阅再应用，服务器分页、复制来源与外键范围传递完整树，保留多列排序、命名方案及丢稿保护。最终完整 12218 项通过／1 平台跳过、类型与新构建通过；准确5dc77a25的[Windows实库单例](../tests/integration/acceptance-table-filter-groups-5dc77a25-20261022.md)完成81行跨页、精确末位、排序及方案恢复，成功轮正常退出和自建库清理通过。首轮102项夹具失败、首次原生方案定位失败及旧现场保持；安装、macOS及其它数据库组合另验，未增加完整工作包或发行计数，暂不发布。

查询结果新增[勾选值加入筛选](development/query-result-selected-filter-20261022.md)：当前列的已勾选原值生成完整 IN／NULL 草稿，与旧完整表达式按 AND 组合；先审阅再应用，保留多列排序并记一次整理历史。初次相关十文件 489 项、最终完整 12112 项通过／1 平台跳过、类型和新构建通过；准确8a2b8145的[Windows实库单例及独立文件读回](../tests/integration/acceptance-query-result-selected-filter-8a2b8145-20261022.md)通过，保持原一次SQL、两格式导出与正常退出；混合NULL、预算与旧回调仍为RAM证据。安装、macOS及极限规模界面耗时待验，不增加完整工作包或发行计数，暂不发布。

结果命名方案补足[Windows源码真实客户端重启](../tests/integration/acceptance-query-result-presets-restart-3270ebbb-20261022.md)：准确3270ebbb的同一配置两代各一次常量SQL，原完整嵌套筛选／停用原文／多列选项在第二代实际预览应用，并可一步撤销重做；临时密码不落盘、两代正常退出及目录清理通过，14封存／2143输入不变。产品树仍为原211de735；新安装／macOS另验，不增加完整工作包计数，暂不发布。

查询结果新增[命名整理方案](development/query-result-presets-20261022.md)：按连接在本机保存完整嵌套筛选、多列优先级、NULL及大小写，支持预览、新建、明确覆盖、仅重命名、删除和手动应用。元数据、连接来源、原文档、修订与结果租约分别复核，完整试算成功才一次发布并接通撤销。完整11921通过／1平台跳过、最终352项及构建通过；准确edd7bd57的[本机Windows实库窗口及独立读回](../tests/integration/acceptance-query-result-presets-edd7bd57-20261022.md)已通过原一次SQL、8次方案IPC、两格式导出和正常退出。跨标签为React证据、重开为SQLite证据，客户端重启／安装／macOS另验，不增加完整工作包计数，暂不发布。

查询结果[筛选与完整排序联动](development/query-result-filter-preserve-sort-20261022.md)：应用／清除筛选保持原多列优先级、NULL 和大小写；扩大结果导致非法排序值或预算失败时整份拒绝，保留原视图及历史。类型／构建及准确9469ed2a的[Windows两个实库整例及两组独立导出读回](../tests/integration/acceptance-filter-preserve-sort-9469ed2a-20261022.md)通过，原单条SQL与正常关闭保持。完整Linux的复制旧行序断言失败已记录，修正完整矩阵后七文件383项通过，新完整CI另验；失败原子性为RAM证据，安装／macOS另验，不增加完整工作包计数，暂不发布。

查询结果新增[暂存整理／应用暂存](development/query-result-memory-20261022.md)：同一标签内存保留完整筛选与多列排序，由用户明确应用到字段和可见列一致的新结果；完整试算成功才发布，可一次撤销。类型／六文件357项／构建及准确6e365406的[本机Windows实库整例与独立读回](../tests/integration/acceptance-query-result-memory-6e365406-20261022.md)通过：原单条SQL、两列NULL／大小写、暂存／恢复、原4行CSV／JSON及正常关闭。新查询复用为React RAM证据，安装／macOS另验；暂无命名、跨标签或跨启动方案，不增加完整工作包计数，暂不发布。

安装验收的墙钟回退误拒绝已转为[原TestInfo单调期限](development/native-original-monotonic-deadline-20261022.md)：沿原起点与120秒，不以当前时间补签；仍拒绝缺失／漂移、单调回退和超时。eb0ea00c的Windows源码正式首次模型四例、八正常owner和113原字节复核通过，后继合法负时间域另有305项RAM检查。旧741安装失败、后继安装及macOS结果分别保留，不增加功能／发行计数，暂不发布。

查询结果新增[多列排序面板](development/query-result-sort-panel-20261022.md)：独立草稿集中设置完整优先级、NULL及大小写，分页保留全部规则；一次应用保持筛选并接通整理撤销，预算拒绝保持原视图及草稿。原精确比较与旧视图保护保持，Linux完整11682通过／10跳过；首次VM及62诊断的应用前失败继续保留。[小数底边读取修正](../tests/integration/acceptance-query-sort-grid-fractional-20261022.md)有22项定向及独立1.75缩放实验；741仅克隆TLS失败，GUI未启动。后继准确2cdf5a6d的[本机Windows实库整例与独立导出读回](../tests/integration/acceptance-query-sort-history-2cdf5a6-20261022.md)已通过全部面板及原流程，原App／观察流正常关闭；本机整数视口、VM小数几何、安装和macOS分别记录，暂不发布。

结果筛选补充[键盘事件保护](development/query-result-filter-keyboard-20261022.md)：子控件已消费的事件及带修饰键Esc不误应用或关闭草稿，保持原筛选与整理历史。两项新增回归先失败，修正后类型、四文件171项及构建通过；准确2cdf5a6d的本机Windows实库整例已通过实际文本框Shift+Esc、原精确端点及原导出流程，其它消费／修饰情形仍为RAM证据，安装和macOS另验，不增加完整工作包计数，暂不发布。

结果网格新增[整理撤销／重做快捷键](development/query-result-history-keyboard-20261022.md)：Ctrl／⌘+Z、Ctrl／⌘+Shift+Z及Windows Ctrl+Y沿原完整历史，不抢输入框或编辑器撤销，旧租约和长按拒绝。类型、四文件200项及构建通过；准确2cdf5a6d的本机Windows实库整例已通过原单元格Ctrl+Z／Ctrl+Y、原按钮恢复及CSV／JSON独立读回，27封存和2113输入核对通过。其它组合及安装／macOS另验，旧失败与范围保留，暂不发布。

高频对象设计补齐[结构化JSON字段创建与识别](development/table-column-json-20261021.md)：共享严格类型、表单、预览及后核验，MariaDB只认完整本列JSON_VALID与实际固定编码；原依赖和默认值限制保持。类型／9文件208项／构建及[六组合真实Engine](../tests/integration/acceptance-column-json-six-20261021.md)通过，12个表场景、78条原连接真实关闭、六随机库精确清理。准确9d713bb8的[WIN11-TEST窗口](../tests/integration/acceptance-column-json-ui-9d713bb-20261022.md)单例通过真实新增／零DDL预览／一次应用／类型重读／原行及正常退出，四辅助关闭及随机库精确清理；新安装／macOS另验；O01及完整工作包计数不增，暂不发布。

新建连接新增[从MySQL／MariaDB URI填入](development/connection-uri-20261021.md)：明确用户、一次百分号解码、IDN／IPv6及端口，拒绝不认识的查询／TLS参数；只填表、清除URI输入、密码默认仅会话，复制来源传输及秘密不带往新目标。完整本机11664项／1平台跳过、最终类型／63定向及构建通过；准确491f81e3的[本机Windows实库整例](../tests/integration/acceptance-connection-uri-491f81e-20261021.md)通过URI拒绝参数／填入及明确保存，并继续原字段悬停／模板／查询／参数／草稿恢复、正常退出与数据定义保持／精确清库。安装／macOS及其它版本另验，C01／C03仍部分，暂不发布。

准确b4a22208的[完整CI回归](development/main-ci-regression-39617503113-20261021.md)发现Linux光标RAM测试15项缺失新增闭包依赖，Windows固定C#编译预检失败。提取正式作用域门并保持原断言后48项光标及19项Worker通过；Windows本机原／诊断版编译均通过，但原runner根因未证，新增固定阶段证据不降低60秒和签名／关闭门。完整单元首轮本机五项Worker构建超时保留，两worker完整复验11664通过／1平台跳过，修正提交b0a3aa0d的CI39621803878已通过Linux类型／609文件11616通过（10跳过）／构建，[三平台源码／安装及原件核对](../tests/integration/acceptance-main-b0a3aa0-ci-20261022.md)现已通过本轮离线范围：各阶段80通过／321跳过，六专项和12正常owner；原失败根因不倒推，后继URI／JSON及私网实库分别验收，暂不发布。

高频查询结果新增[整理撤销／重做](development/query-result-history-20261021.md)：按整步恢复筛选和多列排序、NULL位置及大小写，独立完整试算后原子发布，不执行SQL；新结果／列布局／连接变代撤销历史，旧回调不重放。类型、6文件343项及构建通过，含真实QueryTab RAM端口、空结果、精度、20步与文本预算、复制和导出后继续撤销；准确b4a22208的[本机Windows实库整例及独立CSV／JSON读回](../tests/integration/acceptance-query-result-history-b4a2220-20261021.md)已通过多列优先级与空结果往返及全部原流程，一次查询、两个2行文件、正常App及原观察流关闭。VM准备策略拒绝且未启动，按授权回退本机；安装／macOS另验，暂不发布，完整工作包计数保持。

高频SQL编辑新增[字段悬停](development/sql-field-hover-20261021.md)：真实类型／NULL／默认值／属性／备注，按作用域及物理会话定位；歧义不猜、计算别名不套型、临时遮蔽与ALTER保护保持，纯文本不可变成HTML或命令。类型、138项／构建及另122项真实Worker bundle回归通过；准确7f926c41的[本机Windows源码实库整例](../tests/integration/acceptance-sql-field-hover-7f926c4-20261021.md)通过精确字段悬停、安全DOM及原模板／查询／参数／草稿恢复、正常退出和数据定义保持／精确清库。VM明确未启动策略拒绝回合，按授权回退，不借旧622或c54外推。安装／macOS及其它组合继续，O05及完整工作包计数不增，暂不发布。

高频表数据筛选新增[逐条与全部启停](development/table-filter-enabled-20261021.md)：保留精确值、组合、排序和命名方案，活动规则才进入SQL与参数；全停用不生成WHERE，外键强制范围及全条件预算保持，编辑不隐式启用。类型、7文件111项及构建通过，含真实SQLite重启及草稿／旧回调保护。准确62224ddc的[本机Windows源码实库单例](../tests/integration/acceptance-table-filter-template-62224dd-20261021.md)现已通过16次分页、启停／任一模式与原排序、121行／定义保持及正常退出后精确清库；VM确认未启动超时派发回合，未重复。安装／macOS及其它组合继续，暂不发布，完整工作包计数保持。

表数据页新增[多列排序编辑](development/table-sort-panel-20261021.md)：独立草稿支持字段、方向、优先级和清空，显式应用才保留筛选从第一页读取；复用原未提交数据确认与可靠键补足，列头及命名方案保持同一排序。类型、3文件50项（含41项原SQL引擎回归）及最终构建通过，覆盖第三页返回第一页、零预览请求、取消／拒绝／确认、连接ABA与控件身份。准确14f174d4的[本机Windows源码实库单例](../tests/integration/acceptance-table-sort-panel-14f174d-20261021.md)已通过：7次分页、原筛选、优先级、草稿取消及恢复、正常退出和121行／定义未改后精确清库；零产品写入。独立新回合不接续原c54模板GUI，安装／macOS及其它组合继续，暂不发布，完整工作包计数保持。

新增[从表结构生成四类查询SQL](development/table-query-template-20261021.md)：只读预览后打开同连接／明确库的独立查询，原表草稿保留；SELECT带当前上限，INSERT排除自增／生成列，UPDATE／DELETE要求可靠非空键及参数定位。生成和打开零正文执行，沿原类型参数工作流。本机类型、30项定向与构建通过。原3264a96类型失败保留；c54b0f29在WIN11-TEST准备12项及构建通过，但GUI在SELECT61行后因观察器把内部列键当显示名而失败，后续未到达、App退出未知且库保留。按Engine.columns修正观察器并通过3个实际声明RAM反例与最终类型后，准确62224ddc的[本机Windows源码实库整例](../tests/integration/acceptance-table-filter-template-62224dd-20261021.md)通过四类预览、SELECT61行／空串、UPDATE4参数、草稿保持／恢复及正常退出／精确清库；原断言和预算不变，旧c54失败及资源保持，不追认旧轮。安装／macOS另验，暂不发布。

表页补齐[当前页及本页勾选快照导出](development/table-page-export-20261021.md)入口，按当前行列顺序冻结可见列，空勾选不回退全页，复用CSV／JSON／INSERT SQL文件任务；不重查、不带未提交数据。类型、29项定向（含原INSERT真实文件链路）及构建通过；首次沙箱6项Temp原子替换EPERM保留，正常文件权限下原断言全部通过。准确5505af7的[本机Windows源码实库及JSON验收](../tests/integration/acceptance-table-page-export-5505af7-20261021.md)通过整页50行预览／取消、勾选两行实写与两处独立读回、零重查及成功轮精确清理；未外推50行整份实写或其它格式原生通过。VM间歇失联按授权回退，安装、macOS及其它组合另验，暂不发布，不增加完整工作包计数。

高频表数据浏览补齐[按当前单元格原值筛选全表](development/table-cell-filter-20261021.md)：可审阅的等值／排除草稿，添加后沿当前全部／任一规则参数化读取，从第一页开始并保留排序；精确原文、空串与NULL分开，二进制／脏稿／旧回调拒绝。类型、61项定向及构建通过，准确7f37925的[本机Windows源码实库整例](../tests/integration/acceptance-table-cell-filter-7f37925-20261021.md)通过跨第61行、空结果、NULL、零产品写入及成功轮精确清库。首轮默认页大小准备失败和保留资源单列，不追认退出；安装、macOS和其它版本另验，暂不发布，完整工作包计数保持。

既有“关闭其他查询”CI失败已作[有界准备修正及本机复验](development/query-close-others-ready-20261021.md)：准确1ca76d4仅在键盘输入前核准确标签及正式正文桥可交互，产品源码、原断言／120秒／零重试保持。类型、5门测试及两个原生流程通过，正常退出与目录移除复核；旧失败保留，偶发根因不追认，不扩展测试工具工程。后续继续优先完整高频功能，暂不发布。

高频结果筛选新增[已有条件跨组移动](development/query-result-filter-move-20261021.md)，保留原值、启用状态与焦点，草稿取消及空组校验保持。准确21c164f已通过[Root本机Windows实库整例及独立导出读回](../tests/integration/acceptance-filter-move-ui-21c164f-20261021.md)：多列排序、单条／批量启停、移入／移出／取消、四行CSV／JSON及严格退出通过，39次网格读取最小客户区96；另有类型、164项定向及构建证据。VM不可达按已授权回退执行，旧300失败和旧9139未验不追认。安装版、macOS及其它驱动另验，完整工作包计数保持，暂不发布。以下保留此前检查点。

INSERT SET补全准确bd74859已取得[Root本机Windows实库界面](../tests/integration/acceptance-insert-set-ui-bd74859-20261021.md)：一个真实整例含VALUES／普通SET／嵌套SET，建议、接受、Undo／Redo和任务历史保持通过；真实服务器仅三次PREPARE、正文零执行，空表及随机库精确清理、辅助连接、2054输入和21封存终核通过。远程不稳按已授权回退执行，不是VM／安装／macOS证据；批量筛选9139派发独立保持未知，不重复本机运行该轮。Q01及完整工作包计数保持，暂不发布。

批量启停首次真实窗口发现[滚动条空间遗漏](development/query-result-filter-scrollbar-20261021.md)：原外高96.857而客户区89，原96门拒绝，后续分组／导出未到达。修正按实际滚动条与边框差额预留、观察本网格，父版本两反例失败／修后156项、类型及构建通过；原spec／读取器／期待均不改，待新GUI。原300的251封存与关闭unknown保持；准确b61三平台CI日志成功和后继300离线启动失败[分层记录](../tests/integration/acceptance-bulk-enabled-ci-20261021.md)，不互相覆盖。

高频SQL补全新增[INSERT SET新行别名](development/q01-insert-set-row-alias-20261021.md)：复用既有目标字段和MySQL版本能力，保留原替换范围、默认库及局部名边界。类型／10文件342项／构建通过；实库、原生及安装另验，Q01仍部分，不增加完整工作包或发行计数。

单条筛选启停准确c449的[Windows实库GUI及独立读回](../tests/integration/acceptance-query-result-filter-enabled-c449506-20261021.md)已完成：原一整例、62网格附件、两文件读回及严格资源终核通过，249封存终核通过。只修外层控制加载，不改产品或原断言；后继批量按钮另在准确3005511串行验收，不混记。当前操作说明见[排序筛选速查](query-results-guide.md)，暂不发布，完整工作包计数保持。

筛选草稿补充[全部启用／全部停用](development/query-result-filter-bulk-enabled-20261021.md)：递归保留分组、原值和稳定ID，仅改变启用位，显式应用后生效，取消／输入法／旧回调保护保持。类型、三文件143项及构建通过，当前为源码／RAM组件／构建证据；批量按钮真实GUI及安装另验，不混入固定c449的单条启停续验，不增加完整工作包或发行计数，暂不发布。

Q01普通窗口帧关键字及同块命名窗口继承已取得[准确0a4的Windows实库证据](../tests/integration/acceptance-q01-window-frame-0a4b23f-20261021.md)：原单项GUI七场景、真实接受／Undo／Redo／任务历史不变及原模型执行通过，严格收尾和91份封存终核通过；另有同产品Windows699项准备及Linux11460单元通过。c449已整合main并完成[三平台CI原件核对](../tests/integration/acceptance-main-c449506-ci-20261021.md)：Linux11478通过／10跳过，各平台源码／同次安装legacy80通过／317条件跳过，六专项与四ZIP一致。原RANGE解析和控制脚本失败不追认，凭据误输出事件仍单独保留未知范围。本能力安装／macOS私网及其它版本继续，完整工作包及发行计数不增，暂不发布。

高频结果筛选新增[逐条启用／停用](development/query-result-filter-enabled-20261021.md)：保留条件草稿，停用叶及仅含停用叶的组不参与AND／OR，全部停用恢复准确原结果；重新启用校验原值，活动键漂移保护保持。类型及9文件391项、修复本机冻结依赖后的普通构建和23项Monaco补丁检查通过；首次构建补丁门失败原件保留。准确12c的[三平台CI及原件核对](../tests/integration/acceptance-main-12c08ad-ci-20261021.md)已闭合：Linux11398通过／10跳过，三平台source／同次安装legacy均各80通过／317条件跳过，六专项与四ZIP一致、ARM退出前恢复通过。该离线安装范围不替代启停功能的专用GUI；c449整合版准备／实库／读回新回合已接收，结果待验，完整工作包及发行计数不增，暂不发布。

排序／筛选后继按main交付源码：每列文本大小写、复制条件及小数简写的产品树保持585875a1，与准确338实际验收一致。Windows类型／363定向／新构建、独立GUI1项、39读回器合成20通过／1原权限跳过、原四行CSV／JSON独立读回，以及完整591文件11389通过／1POSIX跳过均通过，最终文件／图／Git、旧封存和进程身份终核通过。连接恢复后续读原回合completed终态，209份最终封存逐项SHA校验通过，原报告及20角色记录的路径／摘要已返回，见[本批准确记录](../tests/integration/acceptance-query-result-sort-case-338a06b-20261021.md)。main准确3eb4e9f的[三平台原生CI及原件核对](../tests/integration/acceptance-main-3eb4e9f-ci-20261021.md)已闭合：Linux类型／591文件11380通过、10平台跳过／构建成功；Windows及两种macOS架构源码／同次实际安装legacy均各80通过、317条件跳过，六专项原report与四ZIP长度／SHA／CRC一致，ARM独立显示租约实测及退出前恢复通过。该离线安装范围不外推为新排序筛选的macOS私网GUI。原7f高度、1f8排序规则及首次Python身份比较失败均保留，不回填旧unknown；后继Q01另留开发分支。暂不发布，不增加完整工作包计数。以下保留前期检查点。

main准确c40a97e的[三平台原生CI及原件独立核对](../tests/integration/acceptance-main-c40a97e-ci-20261021.md)已闭合：Linux类型／587文件11275通过、10平台跳过／构建成功；Windows x64、macOS arm64及x64的源码／同次实际安装legacy均各80通过、316条件跳过。每个平台每阶段六专项、12正常owner及原report／accepted／四文件proof已逐份核对，四ZIP长度／SHA／CRC一致；ARM两代显示租约的实测几何和退出前恢复通过，原receipt缺失／false字段不回填。本轮仅离线源码及CI安装范围，不转作新NULL／快捷键的macOS或安装版私网GUI，后继1f8失败另线保留；不增加完整工作包或发行计数，暂不发布。

多列NULL位置与结果筛选快捷键组合已按main交付源码。固定3fedb46通过Linux类型／587文件11275通过、10平台跳过／构建，Windows类型／301定向／新构建、1项实库整例、Python独立CSV／JSON读回及完整587文件11284通过／1项POSIX跳过均通过；574源码／109构建、Git、原进程及30份封存终核通过，见[本批准确验收](../tests/integration/acceptance-query-result-sort-filter-3fedb46-20261021.md)。独立基线ab27fb1运行与测试输入一致，不混入后继文本排序大小写或复制条件；旧失败和元数据缺失保留。新安装、macOS及系统输入未验，不增加完整工作包或发行计数，暂不发布。下方保留NULL候选的历史检查点。

开发分支新增[复制结果筛选条件](development/query-result-filter-duplicate-20261021.md)：同组插入独立副本，保留区间、候选值及大小写选项；输入法、旧草稿和32条总上限保护保持。b8112a6、f30afd9及后继1f8fc19均通过独立Linux类型／589文件11310单元（10平台跳过）／构建，6项新增用例含在总计内。Windows类型／189定向／构建退出0，纯PID终核失败及离线身份补证另记；首次组合窗口在query.execute失败回包时停链，独立原常量SELECT诊断证实UNION排序规则冲突1271，排序／筛选断言未到达。夹具修正另验，不将原3fed核心或本轮c40离线成功转作后继证据。暂不合入main或发布，不增加完整工作包计数。

新增[每列NULL排序位置开发候选](development/query-result-null-order-20261021.md)：多列优先级可逐列选择默认／NULL在前／NULL在后，显式位置独立于方向，双NULL继续比较下一列，精度、原行及旧回调保护保持。e251a0c的Linux类型通过，11247单元通过／2个新RAM控件断言失败／10平台跳过，原日志保留。已定位测试文件的单选互斥端口缺失，4dff1f9修端口后原控件及复制／导出已通过，完整11249通过／1新增端口用例收尾失败／10平台跳过；3394d07仅补该用例正常准备，保留原期待及产品树，后继Linux类型／586文件11250项／构建全部通过，10平台跳过，见[准确范围](../tests/integration/acceptance-query-result-null-order-3394d07-20261021.md)。通配源码已按main交付；本候选窗口用例fcc8530另通过Linux类型／586文件11250单元／构建，10平台跳过，Windows类型／276定向／新构建通过；首轮窗口止于活动草稿联合预检、尚未执行App查询，原因待只读诊断，读回和完整回归未启动，见[本轮准确记录](../tests/integration/acceptance-query-result-nulls-fcc8530-20261021.md)；新窗口、安装及macOS未验，尚未合入main，暂不发布，不增加完整工作包计数。

main准确f505f6b的[原生CI及独立原件核对](../tests/integration/acceptance-main-f505f6b-ci-20261021.md)已闭合：Linux类型／586文件11246通过、10平台跳过／构建成功；Windows x64、macOS arm64及x64的源码／同次真实安装legacy均各80通过、315条件跳过。三平台每阶段六专项及12正常owner的原report／accepted已独立核对，ARM两代显示租约的实测几何及退出前恢复另已核实。仅覆盖本轮离线范围，不含后继NULL排序／筛选快捷键组合、私网驱动或系统输入；旧4dae140安装失败保留，具体根因未被本次成功倒推。组合候选及WIN11-TEST原队列继续，不增加完整工作包或公开发行计数，暂不发布。

新增[已返回结果文本通配筛选](development/query-result-wildcard-filter-20261021.md)：独立正反通配方式，固定%／_及反斜杠转义，Unicode码点匹配和有界状态机，原字面比较、NULL、精度及投影租约保持。63fb0f6通过Linux类型／585文件11229项／构建，10平台跳过；Windows类型／89项接线／构建、13384独立后继GUI1/1、Python独立文件读回及完整585文件11238通过／1项POSIX跳过均通过。原复制选择、首次EEXIST、跨API时间戳及读回脚本准备失败保留，原断言不变，见[准确记录](../tests/integration/acceptance-query-result-wildcard-63fb0f6-20261021.md)。Git及574源码／109构建哈希和原进程身份终核通过，原旧profile仍保留；按main交付源码。新安装、macOS和系统输入未验，不混入后继NULL排序候选，暂不发布，不增加完整工作包计数。


新增[SQL源文件外改检查与当前草稿重载](development/query-file-reload-integration-20261020.md)：显式预览和替换确认，取消保留草稿；Main回包丢失不先覆盖唯一持久草稿，原Monaco保留正文／换行及普通撤销历史。关闭文档释放重载状态，同ID重建拒绝旧预览。603dc5a的Linux类型／584文件11203项／构建通过，10平台跳过；Windows类型／65项相关／构建、真实文件GUI1/1及完整11212项通过／1项POSIX跳过，573源码与109构建哈希不变，原owner及进程终核通过，见[准确记录](../tests/integration/acceptance-query-file-reload-603dc5a-20261021.md)。首次外部数字PID预检失败和补证顺序偏差保留，后续只读对照完整；远端失联期间未重复原队列。按main交付源码，安装、macOS及系统输入未验，不增加完整工作包或发行计数，暂不发布。

新增[从当前单元格追加筛选条件](development/query-result-cell-filter-20261020.md)：原值预填到现有草稿，显式应用才生效；现有OR整组保留，再与新条件AND组合。按唯一键、原位置及标量精度捕获，NULL与空文本分离，漂移撤销旧动作，不执行SQL。固定57f62a4的Linux类型／580文件11144通过、10平台跳过／构建，以及WIN11-TEST类型／368项／新构建、单次原实库GUI、Python独立文件读回与完整11153通过、1平台跳过均通过。恢复SSH255由离线对照定位测试子进程缺少PROGRAMDATA，修正后严格身份探针通过，原失败保留；准确本轮进程、Git及构建终核通过，见[准确本批验收](../tests/integration/acceptance-query-result-cell-57f62a4-20261020.md)。按main交付已验源码，安装、macOS实库等范围不外推，不增加完整工作包计数，暂不发布。

新增[文本筛选大小写选项与短窗口布局修复](development/query-result-filter-case-20261020.md)：默认保持敏感，每条文本条件可显式采用Unicode小写映射，支持分组及多值，保留原文及排序规则。原窗口揭示96像素结果区被内部工具条挤为28，固定74c59bf改为按实际工具条额外留空间；原2反例修前失败／修后同断言转绿。Linux类型／579文件11116通过、10平台跳过／构建，Windows类型／301项／新构建、原实库整例、Python文件读回及完整11125通过、1平台跳过均通过，原几何网格96／client88、五点命中表头，见[本批验收](../tests/integration/acceptance-query-result-case-74c59bf-20261020.md)。按main交付源码，旧失败及未确认收尾保留，不外推新安装、macOS或系统输入；暂不发布，不增加完整工作包计数。

继续定位[Intel执行计划点击超时](development/explain-native-stability-20261020.md)：旧ZIP已独立核对，只有runner trace，尚不能确认原生窗口或帧状态。复用现有有界记录器补真实context及自身窗口观察，不改原断言、点击、期限或产品。固定4917d0a通过Linux11083项／类型／构建，Windows78定向／新构建／原GUI及完整11092通过、1平台跳过；独立正向采集含127个真实浏览器帧，见[准确验收](../tests/integration/acceptance-explain-diagnostics-4917d0a-20261020.md)。原生CI的ARM与Intel源码／安装legacy均各80通过、314跳过，Windows停于既有helper检查，整轮失败；已按main交付诊断，不将诊断有效写成旧偶发根因已修复，暂不发布。

常规Mac arm64 CI已接入[现有显示租约](development/macos-main-display-lease-20261020.md)。固定8e41972在候选原生CI中源码／同次DMG安装各六项及24正常owner通过，两阶段原实际几何与模式恢复已独立核对原ZIP，见[准确范围](../tests/integration/acceptance-macos-main-display-8e41972-20261020.md)。Windows job成功；整轮仍因Intel执行计划离线组件点击超时失败，原因与trace待读回，不追认旧Mac失败或全平台完成，不增加发行计数。

新增[嵌套分组条件](development/query-result-filter-groups-20261020.md)：独立AND／OR、空子组拒绝、稳定节点草稿和全部叶条件预算。固定ceb607a的Windows类型／329定向／新构建、分组后复制和两格式导出的1项实库整例、独立读回、严格收尾及完整11061通过／1平台跳过均通过；独立Linux类型／577文件／11052通过／10条件跳过／构建成功，见[准确本批验收](../tests/integration/acceptance-query-result-groups-ceb607a-20261020.md)。按main交付源码，不外推日期时间分组GUI、安装或macOS，不增加完整工作包或公开发行计数，暂不发布。

新增[结果多值匹配](development/query-result-members-filter-20261020.md)：逐项填写文本／精确数值／时间成员，正反列表均排除NULL，成员冻结与总比较预算保持。固定9b06ef1的独立Linux CI类型、576文件／11036通过／10条件跳过及构建成功；运行输入相同的ac629f3随后在WIN11-TEST通过类型／313定向／新构建、1项扩展实库窗口、独立CSV／JSON读回、严格收尾及完整11045通过／1平台跳过，见[准确增量验收](../tests/integration/acceptance-query-result-members-ac629f3-20261020.md)。按main交付源码；日期时间成员GUI、安装包及macOS不外推，不增加完整工作包或公开发行计数，暂不发布。

后继[新建查询目录生命周期修复](development/new-query-directory-lifetime-20261020.md)固定3a85b58，保留首次执行前补全事实并阻止关闭后追加目录；Linux首次CI类型、576文件／11012通过／10条件跳过及构建成功。WIN11-TEST随后通过289项定向／新构建、多列排序与文本及精确区间的1项实库复合窗口、CSV／JSON独立读回、严格退出及完整11021通过／1平台跳过，见[准确源码验收](../tests/integration/acceptance-query-result-organize-3a85b58-20261020.md)。已验源码按main交付，旧两轮失败保留；安装、macOS、系统输入及日期时间区间GUI未外推，不增加完整工作包或公开交付计数，暂不发布。

已建立[高频查询工作流整合分支](development/query-result-snippet-integration-20261020.md)：接入结果文本筛选七条件、既有多列排序及片段JSON候选。固定88d5d46在WIN11-TEST类型／270项定向／构建通过，原四条Electron用例2通过／2失败，完整集合未运行；通过取消／无效文件及并发修改，另两条在保存连接准备步骤失败，原区域歧义未再出现。后续[本地连接保存按需启动](development/connection-save-lazy-engine-20261020.md)固定b45383a，修前3项反例失败，修后同断言转绿、206项定向／类型／构建通过，原四条桌面全部通过、零重试；完整576文件／10972通过／1平台跳过、退出0，资源正常收尾。旧失败及被动观察保留，不据此确认原偶发超时根因。另增[精确区间筛选候选](development/query-result-range-filter-20261020.md)5b1c468，类型／235项定向／构建与Windows完整11005通过、1平台跳过；同提交Linux CI检查成功，桌面及发布job跳过，GUI／实库未验。独立候选与整合证据分开记录，按最新规则验后交付main；暂不发布、不增加完整工作包计数。

新增 [Q06 用户片段 JSON 导入导出开发候选](snippet-transfer-0.29.md)：固定 ID 差异预览、同名保留、明确新增/替换/跳过、修订校验整批入库及原子导出。测试迁移前的本地历史结果为类型/构建通过、64 项定向及 10925 项完整回归通过（1 平台条件跳过），含 4 项真实 SQLite/临时文件测试，不能代替后续VM验证。新增四条真实 Electron/IPC/文件用例已在VM运行、终态见下，只替换系统文件选择框回答，未计为原生文件框或应用重启证据。后续所有 Windows 类型/单元/构建和桌面测试交 WIN11-TEST，本机仅开发和静态审阅；候选及测试机消息送达均不等于验收完成，不增加公开交付计数。

Q06 后续修补原导出终态被迟到取消回包覆盖的时序，固定候选 `f173f41`。WIN11-TEST已复现修前四项预期失败，修后同一断言及68项定向／类型／构建通过，完整576文件／10929通过／1平台跳过。桌面1通过／3失败，外层与实际差异区域同名已转整合分支修复，原spec保持不变、待复验。仍不增加完整工作包或公开交付计数。

用户已明确暂缓发行、优先开发，不再以 0.28 的发行 A/B 选择阻塞后续功能。保持原冻结候选和已知失败，串行接入高频功能。本开发线已接入[查询结果复制（含列名）](development/query-result-header-copy-20261020.md)、[多列精确排序](query-result-sort.md)及[本地条件筛选](query-result-filter.md)：筛选先于排序，复制、详情、查找及导出共享同一视图，BIGINT/DECIMAL 不转浮点数，空筛选结果不回退全集。首次整合的本地证据见[整合记录](development/query-result-multisort-filter-20261020.md)。后续 Windows 源码、MySQL8.4/13384 实库界面发现并修复导出模态清空筛选，固定 `72e3035` 新窗口完整案例、连续 CSV/JSON 与 Python 独立读回通过，原失败现场保留；完整回归 570 文件全部通过、10869 项通过、1 平台条件跳过，见[实际验收](../tests/integration/acceptance-query-result-organize-20261020.md)。系统剪贴板、安装包、其他基线及 macOS 尚未验证。不据此增加公开交付或完整工作包计数；片段传输继续单独接入验证。

## 上一轮统筹检查点（2026-10-20，仅文档收口）

[最后阻断表与发行A/B方案](releases/v0.28.0-final-decision-20261020.md)、[四层功能交付复核](releases/v0.28.0-feature-delivery-audit-20261020.md)已备。80工作包/195子ID保持；D06.4命名表筛选/排序方案实际已在bf，误分C现纠正为B（A51/B30/C114），旧局部合同证据不等于专用GUI/实库通过。封存0.29的查询结果新增排序/筛选与它不是同一能力。本轮不全仓重审或运行验收。

80个唯一工作包已按实际入口、限制与证据整理为[195条A/B/C子功能](releases/v0.28.0-feature-status.md)，包含AI01至AI04；A类25个代码入口已核存在于公开0.21标签，不以测试数当完成功能比例。[可审资产、发行说明及发布后计划](releases/v0.28.0-release-review.md)已齐备。Mac新关键字在重启后再次格式化失败、Windows安装系统CtrlS窗口绑定失败、Root输入0次、Intel空间与Mac系统输入仍缺，0.28不能认定完成或可发行；完整Linux固定02e69为563文件/10680通过/10跳过、类型及构建成功。建议有条件审阅两平台预览A，需明确接受已知失败/未验及平台排除；否则保持完整三平台B。两方案尚未批准，最终源码/全量SHA及发行路线均未落地。今晚文档提交后停止，0.29仍封存。

Windows冻结0.28测试头`4a2bcd4`已完成源码和真实NSIS安装各6项专项，共24个正常owner；legacy各76通过/313条件跳过，包含组件层。原run39244695054的候选/证据经新只读回读39250949911核ZIP字节、SHA及全部CRC，安装器与同次封存输入一致。legacy内关键字条件跳过保持；新增独立关键字源码/安装各2项已通过，安装系统保存仍未验，不增加完整工作包或公开发行计数，详见[Windows闭环](../tests/integration/acceptance-v028-windows-success-20261019.md)。Mac arm64也已核3fd真实DMG安装六项/12正常owner、恢复/清理、legacy76/313及候选/证据ZIP完整字节/CRC，见[Mac闭环](../tests/integration/acceptance-v028-macos-arm64-20261019.md)；源码普通legacy也已闭合，x64仍环境阻断。本轮只修改验收脚本/证据，不加入0.29能力。

## 历史检查点（以下为各自当时状态）

最新人工安排为Root串行收口冻结0.28并在版本完成后暂停，五员工已封存，0.29不继续开发。产品仍为`bf08645`，原生/实际安装/发行门保持。Windows源码系统Ctrl+S、原字节/来源/SQLite9/独立重启及两正常owner通过；`4d41e1b`完整Linux561文件/10643通过/10条件跳过，类型与构建成功，桌面/安装/发行跳过。Mac arm64固定`689b352`的run39240838841已完成源码缩进/分栏和首次文件模型四例，Root回读39242022204核原报告、12正常owner、原模式恢复及归档摘要；不算安装或Mac系统CmdS。Windows专用run39242374243缩进通过、分栏在新增居中操作后实际1008×655未达原1400宽度，安装未执行；修正已限定居中仅Mac，182项及类型通过，新实际验收待运行。见[当前有效范围与矩阵](development/v028-serial-closeout-20261019.md)及[Windows系统保存](development/v028-windows-system-source-20261019.md)。下列记录保留历史来源，不代表并行计划仍执行。

最新整合`8b6bdea`完整Linux首次运行39206282767已成功：560文件、10590通过／10条件跳过，类型与构建成功；原0f失败保持，桌面及安装不外推。Mac独立只读枚举确认当前1024×768／scale1、visibleFrame1024×674，并支持1600×1200等模式；未切换，后续仍实测原布局目标，见[完整CI终态](../tests/integration/acceptance-query-file-first-model-root-20261019.md)和[Mac枚举准确来源](testing/macos-display-probe-root-20261019.md)。

首次文件模型及格式化历史产品`f27c85a`已完成Root280项／类型、新109文件构建及113封存；固定`0f655b3`的Windows源码四例`run1924`单次全部通过，覆盖LF／CRLF×按钮／快捷键、普通编辑与格式化Undo clean、Redo选区、SQLite9及独立重启，8个原owner正常收尾。原`run1918`的Redo失败及现场保持，见[准确实际证据](../tests/integration/acceptance-query-file-first-model-root-20261019.md)。本能力安装及macOS仍待验，Q01／Q03和公开发行计数保持。

三夹具及分栏整合`1bb0f9f`的完整Linux首次运行39202556896成功：554文件／10431通过／10条件跳过，类型与构建成功。随后`0f655b3`完整Linux39203597956为554文件通过／1失败，10438通过／1失败／10跳过，类型通过、构建跳过。复制结构只读定义失败已构造可控时钟反例并补齐textarea内存端口；与新三平台四例CI接线整合`29f342e`后Root342项及类型通过，新完整CI仍待终态，见[原失败与整合范围](../tests/integration/acceptance-query-file-first-model-root-20261019.md)。

新单次Ctrl+S诊断`run1929`记录唯一启用保存菜单及`CmdOrCtrl+S`，页面keydown出现，但未收集到符合过滤条件的Main S输入、公开菜单／保存任务通知；原保存断言仍失败，退出未知及现场保留。没有增加DOM保存兜底，继续核原输入通道，见[准确分层观察](../tests/integration/acceptance-query-file-shortcut-observation-root-20261019.md)。

旧产品`e0fa1dd`的R9 Windows源码／真实安装缩进及分栏四份原专项已由Root独立下载原报告复核，8个owner正常收尾；该整轮仍因Linux和两个macOS失败而失败。该Windows范围不转给新产品，也不是Root独立下载安装器验收，见[固定R9 Windows实证](../tests/integration/acceptance-native-r9-windows-root-20261019.md)。以下记录保留各原检查点的当时范围。

声明依赖修正`701ba17`的新完整Linux检查已成功：551文件、10296项通过、10条件跳过，类型和构建成功；桌面／安装／发行均条件跳过，见[固定检查范围](development/sql-workspace-linux-ci-20261019.md)。后续`91194d5`仅新增快捷键观测准备，本地56项及类型通过；单次Windows实际Ctrl+S收到页面keydown，但未观测到preload菜单／保存任务通知，保存断言失败，旧源文件原62字节与身份保持。根因和正常退出仍未确认，见[原始失败观察](../tests/integration/acceptance-query-file-shortcut-observation-root-20261019.md)。不据此增加完整工作包或发行计数。

0.28 已整合文件捕获原换行保留、格式化准入和严格源码／安装原生CI接线；固定 `e0fa1dd` 本地24文件／459项、类型及新109文件构建成功。同一产品的最近SQL及来源保存两项Windows源码流程已分别取得实际通过，四个owner正常收尾、成功目录删除；首例所在整轮仍退出1，第二例独立运行绿色，按钮保存不含原生快捷键，见[正式文件验收](../tests/integration/acceptance-query-files-root-20261019.md)。本版原生CI `39189445206` 的Linux检查成功，三桌面任务失败、安装未执行；安装／macOS与保存菜单快捷键仍待对应验证。不新增完整工作包或公开发行计数，原失败均保留，见[当前证据与边界](development/query-files-native-root-20261018.md)。

同一 `e0fa1dd` 产品的首次格式化按钮／快捷键两例Windows源码已完整绿色：真实文件／Main LF、模型CRLF、触发前零编辑，一次Undo及Redo／Undo、SQLite9独立重启和四owner正常收尾完成。仅恢复模型正文；按当前原摘要规则回传CRLF后相对磁盘LF仍dirty，不冒称磁盘clean体验已解决。见[准确格式化实证](../tests/integration/acceptance-query-format-eol-root-20261019.md)。R8完整Linux为549文件／10253通过／10跳过，类型与构建成功；原生及安装失败边界保持，Q01／Q03仍为“部分”。

R8之后的旧文件任务／来源／恢复窗口／schema合同校正与真实窗口尺寸完成门，已整合至`c221d98`，Root的7文件59项窄RAM及类型通过，产品及受保护运行器不变。原arm64的226不因增加观测而改判通过，三平台源码和安装仍须新的checkpoint验证，见[本次测试整合边界](testing/v028-legacy-layout-integration-20261019.md)。

上述修正的新R9已一次推送启动：[39194270038](https://github.com/zhao-yc/DBArk/actions/runs/39194270038)，固定`95e6863`、首次运行，产品仍为`e0fa1dd`源码。三平台源码专项和Linux完整检查已开始；这是启动快照，未取得原生／安装终态，完整工作包和发行状态保持。

R9后续确认arm64原生内容窗口始终1400×645，未满足1400×1000前提，尚未创建查询即失败；源码缩进通过。Linux为550文件通过／1失败、10291项通过／5失败／10跳过：声明夹具遗漏新纯几何模块，Root已精确修正并补测8文件67项及类型通过，仍需新完整检查。macOS x64源码聚合失败待其原报告定位，Windows继续原legacy回归；没有本批安装通过或发行结论。准确原件、失败及后续修正分开保存在[本次测试整合边界](testing/v028-legacy-layout-integration-20261019.md)。

上一个完整 Linux 检查点 `6c86986` 已通过：542 文件、10119 项通过、10 条件跳过，类型与构建成功；该轮桌面／安装／预览发布均条件跳过，详见[准确 CI 范围](development/sql-workspace-linux-ci-20261018.md)。同一产品构建 `5c29ce2` 的 Windows／MySQL8.4 正式 INSERT 发布和等待确认取消两例已通过，成功随机库、目录及原观察线程外部后核释放；旧表单失败根因未确认、现场保留，见[实际实证](../tests/integration/acceptance-query-insert-ui-root-20261018.md)。

0.23 独立分支 R7 已完成三平台源码／实际安装缩进和分栏共12份专项、24 owner正常退出及目录收尾，六轮真实系统加密／重启解密通过，见[固定来源](https://github.com/zhao-yc/DBArk/blob/ba534193acd6364622bc99edd1553f84a58b1c84/tests/integration/acceptance-native-r7-root-20261018.md)。其证据不能转写为0.28通过。当前继续补齐0.28严格原生CI接线及最近SQL／来源文件保存的两例真实验收，不新增完整工作包或公开发行计数。

## 分版本进度记录

以下段落保留各固定提交当时的实现与验收状态；其中“最新”“未验”仅相对于对应检查点。评估当前交付优先读取上面的统筹检查点及其实际证据，不把旧通过叠加或外推给新产品。

0.28 完整CSV／ZIP分隔符固定 `b40d9ec` 的真实后台18组合已通过：2格式×3编码×3分隔符、每例301行及源查询一次；独立后核18成功库／目录、54原线程释放，含首批共60精确ID缺席。原ZIP类型期待失败和现场保留，GUI／安装／其它版本／百万行继续，Q05／F01仍部分，见[实际分层范围](../tests/integration/acceptance-query-csv-delimiter-root-20261018.md)。0.27独立分支的两项Windows窗口也已完成，见[固定源码验收](https://github.com/zhao-yc/DBArk/blob/9dc13991c719bc22fc05502c2ad15a4a71360a64/tests/integration/acceptance-v027-native-root-20261018.md)，不转写为0.28安装结论。

0.28 固定 `41282a0` 的 Windows 源码关键字偏好两条正式身份已零重试通过：保持／大写／小写、一次 Undo、迟到原模块回包拒绝、SQLite9 和独立重启活动 pane，四 owner 正常退出及成功目录清理完成。首轮定位失败与原目录保留，安装和 macOS 本能力仍待验，Q01 仍为部分，见[实际分层证据](../tests/integration/acceptance-sql-keyword-case-native-root-20261018.md)。

0.28 完整单 CSV／CSV ZIP 分隔符增补 `3553750` 已整合：逗号默认保持，新增分号／Tab，标题／数据／ZIP 清单一致，原配置失效后重新选文件确认。Root 402 项／类型／新构建及独审 30 项通过；固定 `5b697a8` 完整 CI 39114937435 为 532 文件／9862 通过／10 条件跳过，类型及构建成功。新增量原生及实库仍待验，前批六项 INSERT 实库不能外推这次改动，见[准确记录](development/sql-workspace-root-20261018.md)。

当前页批量填充固定 `d20bde2` 的两项 Windows 源码窗口／准确 MySQL 8.4.11 专项已单次通过：暂存／撤销重做／集中提交、并发冲突整批回滚／草稿保留／禁止重放，精确旁列和 fixture 退出／限定清理路径均核。报告未记录原库名／PID供另行外部审计；安装、macOS 及其它版本仍待验，未新增公开发行，见[实际分层证据](../tests/integration/acceptance-table-batch-fill-20261018.md)。以下历史未验段落保留其当时范围。

0.28 最新完整 CI 39112284431 成功：530 文件／9790 通过／10 条件跳过，类型及构建成功。完整流式 INSERT 在 Windows 后台 Engine／准确 MySQL 8.4.11 的六个实库场景单次通过，三编码 301 行双模式回放、等待确认取消／关会话及多结果拒绝均已核，独立后核本轮八库／29 原线程无残留。原失败保留；这不增加原生、安装、跨版本或百万行通过计数，也没有新增公开发行，Q05 仍为部分，见[分层实证](../tests/integration/acceptance-query-insert-stream-root-20261018.md)。下列段落保留各检查点当时状态。

0.28 流式首批完整 CI 为 9721 通过／5 项旧 VM 缺 INSERT 依赖失败／10 跳过；原失败保留，真实 helper 接线修后原断言保持。另整合 Monaco 三处高亮延时取消修复，Root 24 文件／311 项、类型及新 109 文件构建通过，实库准备另有 37 项护栏／类型通过，真实执行仍为 0。新完整检查继续，未增加原生／安装／公开发行计数，见[准确分层记录](development/sql-workspace-root-20261018.md)。

0.28 后续已整合完整流式 INSERT 首片及暂存归属修复 `6ab4652`：一次新执行、真实样例及完整统计、确认只发布同一文件，首片限制一个行结果集。原两条真实文件误删反例修后保留外来文件并报告清理未确认；Root 三组独立对照、19 文件／265 项及类型通过，新完整 CI 继续。此增量尚无实库、百万行或原生安装验收，不能继承前批 9669 项结论，Q05 仍为“部分”，见[当前整合](development/sql-workspace-root-20261018.md)及[使用说明](query-stream-insert-sql.md)。

0.28 前批增补关键字小写及表／快照 CSV 导出的分号、Tab。组合 31 文件／448 项及类型通过，旧选择失败反馈污染已原例转绿；旧合同的 1 项冲突已修正，固定 `9d0cef1` 完整 CI 为 521 文件／9669 通过／10 跳过，类型和构建成功。本版原生／安装／实库继续，该完整检查不含后续流式 INSERT。Q01、Q05、F01 保持“部分”，见[当前记录](development/sql-workspace-root-20261018.md)。

0.28 开发候选新增显式关键字大小写偏好及已返回／勾选结果 INSERT SQL 导出。组合 261 项／类型、本地 109 产物及动态块核对通过；原夹具漏引用的 1 项失败已修复，固定 `4236db0` 完整 CI 为 517 文件／9551 通过／10 跳过，类型与构建成功。INSERT 需明确映射并先预览，只写快照文件、不执行 SQL；完整查询流式 SQL 导出仍未开放。本版三平台原生／安装和实库继续，Q01、Q05 仍为“部分”，公开预览仍为 0.21，见[整合记录](development/sql-workspace-root-20261018.md)及[候选说明](releases/v0.28.0.md)。

0.27 开发候选整合 CSV 导入分隔符（逗号／分号／Tab）与新建表受控自动更新时间。固定产品头 `50626ec` 的完整 CI 为 508 文件／9439 通过／10 跳过，类型、构建及本地 108 产物成功，Windows 未签名候选已生成。新表原前缀组合、非法目录标记两项反例已修复并独立原样复验；本版原生、安装和实库尚未完成。O01、F01 仍为“部分”，不继承 0.26 安装候选或 0.23 原生结果，见[整合记录](development/daily-workflow-root-20261018.md)及[候选说明](releases/v0.27.0.md)。公开预览仍为 0.21，格式化关键字大写仍在独立开发。

0.26开发候选新增工具栏／文件菜单的最近SQL文件入口、最多20条Main私有记录及显式重开。已修可选历史影响普通来源提交的问题，Root98项相关／类型／源码构建及独立窄复验通过，Windows未签名候选已生成；实际界面、安装与macOS本版本验收继续，Q03仍为部分，见[整合范围](development/recent-query-files-root-20261018.md)。公开版本仍为0.21，不把本地候选视为发行完成。

该版首次完整CI为9322通过／1失败／10跳过；旧schema7夹具错误保留了新增空缓存表，现已修正并保持原11表保护断言，原文件7项通过。修后 `e7eebfc` 的[完整CI](https://github.com/zhao-yc/DBArk/actions/runs/39098712643)已成功：504文件／9323通过／10跳过，类型及构建成功。桌面与发行步骤跳过，原红和平台未验边界保持。

0.25列头定位窄修后的完整CI `39094873058` 已成功：502文件／9297通过／10跳过，类型及构建成功；该头不包含0.26新增源码，修后两条批量填充真实用例仍待窗口恢复后执行，原失败和隔离现场保留。

0.25修后固定74102c8完整CI已成功：499文件/9247通过/10条件跳过，类型及构建成功。批量字段填充的原生/实库/安装继续，桌面与发行job跳过；不将该CI计为全部产品验收，原失败见[整合记录](../tests/integration/acceptance-table-batch-fill-20261018.md)。当前公开仍为0.21，Navicat全功能目标继续。

0.25首次完整CI为9243通过/4失败/10条件跳过、类型通过。原失败集中于命名方案旧夹具漏引用，补齐后原文件17项通过，修后完整CI继续；不将首轮红例改写为完整通过。

0.25开发分支新增当前页勾选记录的批量字段填充，暂存为一次可撤销草稿并沿原预览/集中提交。修后完整CI为499文件／9247通过／10跳过，类型及构建成功；Windows未签名候选已打包。首次13384真实界面在暂存后因测试列头定位超时，尚未提交，第二例未跑，原失败与隔离资源保留，见[候选与实跑边界](../tests/integration/acceptance-v025-package-and-first-live-20261018.md)和[原整合记录](../tests/integration/acceptance-table-batch-fill-20261018.md)。D02仍为“部分”，当前公开仍为0.21。

0.24修后固定48064b4完整CI已成功：497文件、9187通过、10条件跳过，类型及构建成功，Linux真实文件普通mode单例通过。该轮桌面/发行job跳过；SQL文件原生操作、安装、macOS及元数据边界继续，原9红及修正证据见[整合记录](../tests/integration/acceptance-sql-file-sources-20261018.md)。当前公开仍为0.21，不将完整单元套件计作全部产品验收。

0.24开发分支已整合SQL文件来源绑定、原文件保存、重启授权、编码/换行保持与可取消任务；外改先拒绝，重读为新草稿时原SQL在持久化层也保留。Root首轮247项及后续38项相关检查分别通过，两个固定头类型、最终源码构建通过；存在重叠且不是完整套件。原忙状态、普通权限、重读持久化问题的原红及修复分别保留；原生文件/安装与平台元数据继续，见[本版检查点](../tests/integration/acceptance-sql-file-sources-20261018.md)。0.24未公开，Navicat全功能目标继续。

后续0.23独立分支已实现逐查询标签的编辑区高度恢复、可取消指针/键盘分隔条及配置库8迁移。固定4576920完整CI为483文件/9022通过/10条件跳过，类型及构建成功。随后固定1ebf0d9的Windows源码分栏专项单次通过：双标签真实鼠标/键盘、取消/默认、缩窗不改偏好、模型/正文/Undo、SQLite8及独立重启，两次正常退出及PID/目录清理完成，SQL/剪贴板操作为0。当前头完整CI、安装包和macOS专项仍待验，不能沿用0.22或0.21统计，见[整合及原生检查点](../tests/integration/acceptance-query-layout-source-20261018.md)。当前公开仍为0.21，0.22候选及本0.23均未新增发行。

当前公开为 [0.21.0 开发预览](releases/v0.21.0.md)：固定 5bb8409 标签的源码及三平台运行全部成功，各源码/实际安装阶段 76 通过／291 条件跳过、0 重试；三个主安装包、源码和摘要清单已独立下载，1805 个源码文件逐项一致，见[公开发行实证](../tests/integration/acceptance-v021-published-20261018.md)。76 含组件层次，不是 76 个安装产品路径。后续0.22进度见下段；单列排序规则及勾选多行复制草稿的专用实库/GUI仍待完成，新资源测试授权待确认，Navicat全功能目标继续。

后续高频源码已整合按表隔离的命名筛选/排序方案与 SQL 编辑器全局缩进。固定 `0724e25` 的完整CI已通过：469文件、8824通过、10条件跳过，类型及构建成功。原863c70c的7红及39个未处理拒绝在补齐旧夹具真实依赖后消除，279处原断言保持，原失败日志仍保留；命名方案此前两项迟到发布问题也由原审查者复核。固定91e3c0c的三平台源码及实际安装阶段分别76通过/292条件跳过/0重试，Windows候选独立下载核验通过；组件统计不等于安装产品路径，专用GUI及私网实库仍待验，0.22尚未公开，见[候选原生实证](../tests/integration/acceptance-v022-native-checkpoint-20261018.md)及[本批整合实证](../tests/integration/acceptance-p0-presets-indent-20261018.md)。

固定303fa92的Windows源码缩进专项已单次通过：真实编辑器两种样式、Tab/撤销/重做、选区、SQLite7及独立重启，两个owner正常退出、PID/目录清理完成，SQL及剪贴板操作为0。安装包和macOS该专项仍待验；批量草稿与命名方案专用实库/GUI未扩大。原失败和严格滚动观察见[专项实证](../tests/integration/acceptance-p0-native-preparation-20261018.md)。固定0f23b96另有475文件/8959通过/10条件跳过的完整CI，类型和构建成功，不能外推到后续测试增量。

<details><summary>历史整合与验收记录（版本状态仅指记录当时）</summary>

查询工作区产品 `8c067f2` 的完整 CI 为 441 文件／8173 通过／10 条件跳过。同源 Windows 新 NSIS 另有只读整行详情实库一项、关闭其它查询离线两项分别零重试／零跳过通过；原输入失败与新独立身份补验分开保留。原 e436 六个路径门失败、后续 b084／6de 完整终态、c256 三平台及独立安装包下载摘要见[准确证据](../tests/integration/acceptance-query-workspace-frequency-20261018.md)。本机实库不外推其它平台，没有新增公开发行。

固定 `8200537` 的修后完整 CI 已成功：436 文件／8109 项通过／10 条件跳过，类型及构建通过。固定原生 `a04a61d` 的 Windows x64、macOS arm64／x64 三个桌面 job 均已成功，各源码及真实安装阶段分别 74 通过／290 条件跳过，包含查询复制与编辑器偏好恢复。原 d0b337e 完整 CI 及 a04a61d 的 Linux job 仍保留旧提取夹具遗漏 ref 的失败，原生运行整体仍为红；产品／E2E／构建路径已独立比对相同，见[准确分层终态](../tests/integration/acceptance-query-duplicate-native-20261018.md)。没有新增公开发行。

同一 `8200537` 的真实 Engine 补全目录正常收尾已在 MySQL 5.7.44／8.0.46／8.4.11、MariaDB 10.11.19／11.4.13 及严格 TLS MySQL8.4.11 六组合分别单次通过：三列完整目录、原命令／流关闭、原服务器线程消失及本例零行库清理均确认。只覆盖正常目录，不扩大实际取消或其它平台界面，见[六实例收尾](../tests/integration/acceptance-completion-close-matrix-20261018.md)。

后续Root `36d0562` 已修补全目录严格收尾，目录相关37项、合并类型／构建通过；Windows准确MySQL8.4.11的原点号自动补全、三列真实建议及精确插入正式无旁观一项单次通过，原红及诊断保持，原库／线程／配置目录清理完成，见[正式复验](../tests/integration/acceptance-upsert-completion-20261018.md)。“复制为新查询”及草稿基线保护另有53项相关通过，固定 `c17ad63` 的Windows正式离线原生一项已核原始正文／换行、保存来源、副本独立、实际Undo基线及正常退出／PID／目录清理；新三平台源码／安装门已配置，见[复制原生实证](../tests/integration/acceptance-query-duplicate-native-20261018.md)。本源码增量不继承旧安装或完整CI计数。

固定 `b378dd2` 的完整CI已成功：432文件／8078通过／10跳过，类型与构建通过；不覆盖随后复制和严格收尾源码。未增加公开发行，当前公开仍为0.20.0。

后续高频整合 `da157e0`／`f838e2e` 新增受版本及厂商门保护的UPSERT VALUES新行别名字段补全，并修正SELECT投影／CAST的AS误识别；Root283项相关／类型／构建和独审窄复核通过，真实界面继续，见[补全边界](development/q01-insert-row-alias-20261018.md)。固定 `4576d73` 的新Windows同包另有三个高频实库身份分批通过（表字段CSV、查询选行JSON／CSV），原定位／精度期待红及修正分别保留，服务器／进程核零、规范卸载完成，见[安装实库补验](../tests/integration/acceptance-native-installed-frequency-20261018.md)。不跨产品或分层累加，不计作公开发行。

固定 `cbb46f4`（含私有源会话）的完整CI已成功：429文件／8017通过／10跳过，类型及构建通过，见[源会话检查点](../tests/integration/acceptance-backup-source-session-20261018.md)。后续Root `eac6de8` 另整合MySQL8.4.11私有锁观察／受许可释放原语，13项专项／类型及5组独审RAM通过；尚未申请真实FTWRL、不放开lockCapability，见[锁原语边界](development/database-backup-mysql-lock.md)。这些不增加完整备份、安装或发行计数。

后续私有备份源会话已整合，8项相关回归及类型通过；准确MySQL8.4.11的默认连接反例与规范专属连接正例各完成24条真实读取、九对象七类别定义及精确清理。规范连接下七类可见性proven，程序依赖及持锁仍正确阻断，尚非完整备份产品入口，见[源会话实证](../tests/integration/acceptance-backup-source-session-20261018.md)。本源码增量不继承此前完整套件或原生通过数。

新原生 `4576d73` 的Windows x64／macOS arm64／x64三个桌面job均成功：源码和实际安装阶段各73通过／289条件跳过，包含字号与换行组合及独立重启；Windows helper安装资源摘要一致。运行总体仍因旧Linux夹具显示失败，修正头 `85db959` 的完整CI另为8009通过／10跳过；相关产品文件已逐路径核为相同。Windows新附件已独立下载核SHA，本机新安装实库继续，见[增量原生终态](../tests/integration/acceptance-native-increment-20261018.md)。公开预览仍为0.20.0，本批未发布。

整合夹具修正头 `85db959` 的完整 CI 已通过：428文件／8009通过／10跳过，类型与构建通过。产品源码、E2E、构建脚本、包配置及锁文件与 `5d22044` 相同；旧完整失败保持原证据，新原生 `4576d73` 的各产品阶段继续独立核验，见[整合CI终态](../tests/integration/acceptance-backup-windows-files-20261017.md)。公开预览仍为0.20.0，后续增量未发布。

字号专用原生头 `1d7cb55` 已在 Windows x64、macOS arm64／x64 的源码和实际安装阶段各73通过／289跳过，Linux完整422文件／7927通过／10跳过，详见[字号三平台终态](../tests/integration/acceptance-editor-font-native-20261017.md)。该头不含后续换行／备份端口增量。新整合 `5d22044` 的完整 CI 8003通过／1失败／10跳过：失败为安装脚本VM夹具遗漏新资源依赖，后续已补该夹具及五种资源拒绝场景，9项相关及类型通过；原失败保留，新完整及新原生增量验收继续。

自动换行偏好已整合，并修复损坏单项设置引起工作区草稿覆盖的恢复路径。Root 8 项相关回归／类型／构建通过，Windows 长行绘制、字号共存、撤销、SQLite 及独立重启一项单次通过，见[换行实证](../tests/integration/acceptance-editor-wrap-native-20261018.md)。备份私有中继另完成准确 MySQL 8.4.11 上的正常 QUIT 与取消两场景，服务器身份／自有线程及终态逐项核对，见[中继实证](../tests/integration/acceptance-backup-relay-20261018.md)；仍未计作完整备份。新安装与完整源检查／持锁／dump／恢复继续。

备份 Windows 文件运行端已补真实实证：固定原句柄／完整 ACL／合成选项写入、两官方客户端读取及原文件清理通过，Root 75 项相关回归及类型通过；新增固定 C# 编译和安装资源摘要检查门。尚无真实密码、dump、服务器持锁或完整产品入口，详见[文件运行端](../tests/integration/acceptance-backup-windows-files-20261017.md)，不计作完整备份已完成。

后续高频开发已整合 SQL 编辑器字号设置及取消时旧回调保护：Root 12 项相关专项、类型与构建通过；Windows 真实 Monaco 热更新、撤销基线、SQLite 独立读回及同配置独立重启一项通过，两次正常退出及临时目录清理完成，系统剪贴板和数据库执行均为 0。新增用例已配置未来三平台源码／安装 CI，当前新安装和 macOS 尚未验收，见[字号实际检查点](../tests/integration/acceptance-editor-font-native-20261017.md)。前一备份开发头 `0f59758` 的完整 CI 为 420 文件／7915 通过／10 跳过，类型及构建通过；不外推字号或完整备份通过。

最新未发布检查点：查询结果列布局和有界本地查找已整合，连续跳转、原勾选保持、合成复制及CSV／JSON实际内容在准确MySQL 8.4.11的Windows开发Electron通过，资源前后核对通过，系统剪贴板操作为0。固定 `42e4be4` 的完整CI为418文件、7860通过、10条件跳过，类型和构建通过；其三平台原生固定头 `f93100f` 源码与安装阶段均各72通过、289条件跳过，Windows附件已独立下载核SHA，见[运行端及原生终态](development/database-backup-runtime-checkpoint-20261017.md)。后续备份原生进程和有界读取已整合，真实版本探测及两种元数据读取端口通过；真实权限文件／持锁／dump／恢复仍待接通，不计作完整备份能力。旧失败按原始来源保留；公开版仍为0.20.0。

后续未发布检查点：正式服务器监控入口及资源恢复固定`2aa8d15`的完整Linux CI为7384通过、10平台跳过，类型和构建成功，见[监控入口与边界](development/server-monitor-integration-20261017.md)。新建表前缀另固定`b840102`完成三项严格元数据补修及父租约保护，16文件613项、类型和隔离源码构建通过，见[新表整合证据](development/table-create-prefix-indexes.md)。两批均未增加真实原生、安装或已发布计数；结构比较筛选仍有独审P2在修，未整合该片。

后续未发布检查点：共同测试屏障修复头`369c5b1`的完整Linux CI为7240通过、10平台条件跳过，类型与构建成功；原失败保留，见[就绪屏障证据](development/definition-navigation-verification-20261017.md)。前缀索引三场景及JSON/CSV勾选导出仅补关闭态准备，59项纯检查、另8项包装器与列表通过，实际执行仍为0，见[准备整合边界](development/query-selected-results-export-20261017.md)。这些不增加已发布版本、真实安装通过数或大包完成状态。

后续未发布索引规范化：满列前缀在可信完整成本一致时规范为整字段，修正服务器SHOW/SUB_PART规范化导致的后核误报；旧全字段同值不误重建，真正短前缀仍严格核对。固定`28d5e4e`的12个相关文件420项、类型及独立源码构建通过，另9项独审通过；MAX边界和原红保留，真实矩阵仍待执行，见[规范化及整合证据](development/index-full-prefix-normalization-20261017.md)。上一`afecff5`完整Linux CI7228通过、10跳过及构建另属其原头，不外推本次完整或原生验收。

后续未发布完整检查：原cbf的Linux CI暴露三个旧查询端口遗漏新依赖，22项失败及原日志保留。Root修复为`515d152`后，Windows完整7169项/类型通过，同头Linux CI7159通过、10平台条件跳过及构建成功；后续零DDL勾选导出夹具`10d60ca`另有82项定向、类型及四种关闭态列表通过，真实入口仍未执行，见[后续核验](../tests/integration/verification-query-entry-ci-root-20261017.md)。不与此前定向计数相加，不外推原生、安装或公开发行。

后续未发布检查点：已有表补CHAR/BINARY普通索引前缀，查询结果新增勾选行固定快照导出，并修复目录空白声明长度核对和父级拒绝勾选回调时的范围不一致。固定`cbf935b`的29个相关单元文件608项、类型、三个默认关闭入口列表及独立源码构建通过；索引和选择回执的原红保留。新默认值/定义定位正式夹具已补，实际界面及索引矩阵仍待统一安排，见[本批源码验证与剩余边界](../tests/integration/verification-p0-selected-index-root-20261017.md)。不计入固定R93安装或已公开版本。

后续未发布检查点：表设计器已整合显式空串默认值、已有表目标/连接修订及迟到预览保护，并修正Maria目录字符集NULL时的完整SHOW补证。原整合头aef完整6977及type通过；最终cbf在收紧三项独审反例后489项相关/type和独立源码构建通过，108份旧活动产物未覆盖。真实10.11原阶段通过，11.4原成功ACK/后核失败及保留现场如实列出，修复后真实UI尚待执行，见[本批整合和剩余边界](../tests/integration/acceptance-schema-default-maria-root-20261017.md)。

后续未发布检查点：同库复制结构及数据已完成准确MySQL8.4.11的空表与精度表两个正式Windows源码界面身份，前后六资源零，来源567的208项定向/type与0fb完整6859基线分开记录；1351整批仍因后续Maria前置失败不接纳，见[Data完整阶段实证](../tests/integration/acceptance-table-copy-data-root-20261017.md)。取消/断线、更多类型、安装及其它平台继续。

后续未发布检查点：两条临时限权账号的真实表单已明确取消密码保存；`649b317` 的 19 项定向、类型及列表通过，生产和构建逐摘要与已验基线相同。Windows/MySQL 8.4.11 两个源码权限界面身份单次通过，六实例相关临时库、用户和线程核零，见[权限源码实证](../tests/integration/acceptance-limited-account-ram-root-20261017.md)。固定 R93 安装并集不增加。

后续未发布检查点：表页当前行、勾选行复制为有界 INSERT SQL 已整合，含严格原值、草稿拒绝及整批字节上限。固定 `39e8701` 完整 6546 项、类型及构建通过，独立假端口反例通过；后续790源码的100项定向/type通过，六个准确隔离组合各两项真实Engine回放全部通过并核资源零，逐条INSERT零警告且源值不变，见[12项回放实证](../tests/integration/acceptance-copy-insert-replay-root-20261017.md)。原生复制按钮、新安装及其它平台尚未接纳；[实现边界](copy-insert-sql.md)保持。

后续未发布检查点：准确 MySQL 5.7.44 普通新建表已增加真实会话、InnoDB 和字符集能力证明。固定 `509a57b` 的完整 6480 项、类型及构建通过；Root 保留编码配对合并冲突并新增三项组合回归，Windows 正式开发 Electron 一个准确 5.7.44 界面身份单次通过、前后六资源零，见[5.7 实证](../tests/integration/acceptance-table-create-mysql57-root-20261017.md)。不外推完整 5.7 类型/FK、安装或 macOS，也不新增新表 tableID 归属保证。

后续未发布检查点：普通数值生成列 VIRTUAL/STORED 空表结构复制、新建表实际字符集与排序规则配对已整合。固定 `9d2fd9c` 的完整 6390 项、类型及构建通过，Windows 正式开发 Electron 在准确 MySQL 8.4.11 的三个界面身份单次通过，前后六资源零；原目标漂移及通知失败反例与追加修复分别保留，见[本批源码实证](../tests/integration/acceptance-generated-encoding-root-20261017.md)。生成列复杂表达式及其它版本、安装、macOS 和完整对象能力继续，不计入固定 0.21 安装候选。

后续未发布新建表已完成复合外键首个正式 Windows/准确 MySQL 8.4.11 界面身份，包含 SHOW/RC/KCU 完整后核和树刷新；首轮标签定位失败及测试修正分别保留。固定生产整合 739e 的完整 6182 项、类型和构建通过，最终测试头另有 80 项定向和类型，前后六资源零，见[外键实证](../tests/integration/acceptance-table-create-fk-root-20261017.md)。其他版本、数据级联、安装及完整矩阵继续。

后续未发布新建表已补准确 MySQL 8.0.46 入口：固定 `1dd59a6` 的 221 项定向回归、类型和构建通过，Windows 正式开发 Electron 一项实际界面单次通过并核前后六实例零资源，见[准确组合实证](../tests/integration/acceptance-table-create-mysql80-20261017.md)。不外推其他版本、安装包或外键创建。

后续未发布新建表首片已整合五项审查修复，固定 6afb 生产源码完整 5957 单元、类型及构建通过；Windows 正式开发 Electron 在准确 MySQL 8.4.11 完成一次最终界面验收，覆盖预览零创建、准确确认、唯一任务、精确默认/索引及已展开目录刷新，前后资源核零。首轮目录前置失败保留，见[本批实证](../tests/integration/acceptance-table-create-root-20261017.md)。不计入 0.21 安装或完整外键等未验范围。

后续未发布普通整合分支已开放准确 MySQL 8.0.46 的普通/含自增列表结构复制：固定 e8db 源码完整 5860 单元、类型和构建通过，Windows 正式开发 Electron 两个实库身份单次通过，前后六实例资源核零，见[本批实证](../tests/integration/acceptance-table-copy-mysql80-20261017.md)。不继承 0.21 安装、macOS 或直接 SQL 首次插入结果，也不外推其他版本和复杂依赖。

0.21.0 固定 `93f33ec` 候选的原三平台原生CI已成功；Windows本机后续记录浏览与编辑14批56项全部单次通过，规范卸载并核前后资源零。完整批并集由159增加为 **215/340**，原无系统剪贴板变更清单剩余 **125**：通用安装98、C02专用3、开发组件21、安装宿主源码组件3。8条路径会只读剪贴板并仅在RAM比较，不能称零读取；两项合成DOM不算原生复制。旧B015失败和诊断均保留，13个原生组件及补充CI的macOS x64打包失败分别记录。尚未发布，见[本批56项实证](../tests/integration/acceptance-v021-record-installed-20261017.md)、[原三项补全](../tests/integration/acceptance-v021-alias-installed-20261017.md)及[候选说明](releases/v0.21.0.md)。此计数不代表Navicat功能完成比例，也不继承后续源码通过数。

最新未发布检查点：复制空表结构（含自增）与单表清空已合入当前任务分支。固定功能来源 b995 完整5780单元、类型及构建通过；Windows正式开发Electron的清空一项、普通/自增复制两项均单次通过，六实例资源核零。当前目录逐段解决正文桥接/格式化冲突，104项定向与类型通过，108构建产物与已验来源逐字一致，见[本批验收与范围](../tests/integration/acceptance-table-copy-truncate-20261017.md)。复制生成列/依赖及非8.4范围仍未完成；新安装包和macOS私网不由本批接纳。以下检查点保留原始来源，不跨版本累计。

后续高频产品3ad已完成5606项完整单元、类型和构建，CSV选列及单表删除两个正式Windows源码界面身份已分别单次通过并核资源清零，见[整合与实库检查点](../tests/integration/acceptance-frequency-csv-drop-20261017.md)。DROP旧超时、Root一次定位错误及修正链均保留；最终测试头ef8仅改正式测试，不把旧失败改成通过。新功能及三格式取消修复尚未进入公开0.20标签，安装/macOS及取消MDL服务器逐ID终态继续。

当前公开开发预览为[0.20](https://github.com/zhao-yc/DBArk/releases/tag/v0.20.0)：12附件、11独立SHA、1264源码blob已核对，公开Windows NSIS六项真实安装回归通过并完成卸载、六实例资源核零，见[公开后验收](../tests/integration/acceptance-v020-public-20261017.md)。表导出取消提交窗口已知问题保留，后续修复不计入本标签；下方旧发行状态均保留其历史来源。

后续历史时间范围固定390d已完成49项相关回归、类型和构建及一项正式Windows界面，见[时间筛选实证](../tests/integration/acceptance-history-time-ui-20261017.md)。新功能、CSV修复的完整整合回归及实库继续，不以旧测试或纯检查代替。

后续高频产品7e59、正式测试头032390b已通过ON UPDATE六个真实界面身份在六实例的36次正向执行，0跳过/重试；独立采集核对源码、构建、完整身份及前后资源，见[六实例实证](../tests/integration/acceptance-on-update-ui-20261017.md)。这批是Windows开发Electron，尚未进入0.20发布标签，不代替安装、macOS或取消/MDL逐ID终态。

同一来源的新建库专用真实窗口另有一项通过，覆盖编码配对、预览零DDL、准确名称确认、单次创建和树刷新；原控制文件身份错误已保留，按真实定义重采既有结果且未重放写入，见[新建库实证](../tests/integration/acceptance-database-create-ui-20261017.md)。另已复现原CSV表导出在sync期间取消后仍替换原文件的提交窗口，后续修复中，不能把普通取消测试当作该窗口已验。

最新0.20候选产品686已修正文监听就绪及条件性布局恢复，5124项完整单元、类型和构建通过；新Windows包SQL补全/命名窗口/CALL共13项真实安装专项已通过并清理，见[新候选实证](../tests/integration/acceptance-v020-editor-readiness-20261017.md)。普通CI三平台各安装阶段72通过，实际分为58产品路径、12开发组件和2安装宿主源码组件；另13个开发组件专项在三平台各单次通过，见[分层校准](../tests/integration/acceptance-v020-native-layers-20261017.md)。新候选309项已全部通过，累计335个唯一身份（安装产品298、开发组件34、安装宿主源码组件3），卸载和六实例资源核零，见[完整分层检查点](../tests/integration/acceptance-v020-editor-full-20261017.md)。下方335项属于旧5ab候选，不能跨产品累加；公开发行继续。后续高频分支7e59已整合专用删除表与新建库编码，5468项完整单元、类型和构建通过，Windows真实格式化四项单次通过，见[新检查点](../tests/integration/acceptance-frequency-objects-format-20261017.md)；数据库写入及安装仍待验。

0.20准备版产品固定5ab：5073项单元、类型与构建通过；同一Windows候选累计接纳335个不同验收身份，其中安装产品298、开发组件34、安装宿主源码组件3。查询/导出/CALL14项准备修复复验已通过并完成卸载、资源核零，剩余4项原生复制等待本轮剪贴板许可；这不是Navicat功能覆盖百分比。测试头586的Windows原生CI仍有正文同步失败，单独排查并保留原失败，详见[最新分层实证](../tests/integration/acceptance-v020-installed-progress-20261017.md)。尚未公开发行，当前公开版仍0.19；以下旧检查点保持各自来源，不重复累计。
<details><summary>开发分支原始检查点（保留其当时来源）</summary>

最新未发布检查点：功能产品3ad完整5606单元/type/build通过，CSV选列正式UI一项及DROP最终测试ef8一项单次通过、资源核零；两个旧DROP失败与更正均保留。后续5e只集中17条渲染文案，Root原10回归/type/build通过，main产物不变，见[整合与实际验收](../tests/integration/acceptance-frequency-csv-drop-20261017.md)。不混称同一头完整大套或安装结果；新包和macOS私网及取消MDL逐ID终态继续。

当前公开开发预览为[0.20](https://github.com/zhao-yc/DBArk/releases/tag/v0.20.0)。后续高频分支的ON UPDATE六身份在六实例共36次实际通过，新建库专用一项通过；历史时间范围固定390d的49项相关回归、类型和构建，以及正式Windows界面一项通过。各自证据见[自动时间](../tests/integration/acceptance-on-update-ui-20261017.md)、[新建库](../tests/integration/acceptance-database-create-ui-20261017.md)和[历史筛选](../tests/integration/acceptance-history-time-ui-20261017.md)。这些是未进入0.20标签的开发Electron能力，不代替新安装或macOS实库。

CSV字段选择与顺序已在本分支源码整合；已复现的文件sync期间取消窗口正在补齐三种表导出格式，正式CSV界面及完整整合回归继续。公开0.20已经明确记录该已知问题，没有把后续修复算作该版已修。下方旧检查点保持其原始来源与统计。

后续产品7e59已整合专用单表删除、新建库编码及相关接线，5468项完整单元、类型和构建通过；Windows正式App格式化四项实际单次通过，见[对象与格式化检查点](../tests/integration/acceptance-frequency-objects-format-20261017.md)。这不接纳数据库写入、安装或其它平台，实库用例的归属追加继续；下面源码5335和旧候选均保留历史来源。

本分支后续高频源码已固定f9dfa3c：ON UPDATE、选区/全文与快捷格式化、单表清空、正文桥接及严格退出验收整合后，5335项完整单元、类型和构建通过，见[源码整合实证](../tests/integration/acceptance-frequency-source-20261017.md)。内部版本未改，原生/实库/安装未由本次源码结果接纳；下文旧候选保留其历史来源，当前公开版仍0.19。

0.20准备版固定5ab：5073项单元、类型与构建通过；三平台源码/真实安装离线各72通过、265条件跳过，另原12个开发组件各平台12单次通过。本机候选常用六项真实安装/13384实库及卸载、资源核零已完成，见[分层实证](../tests/integration/acceptance-v020-ci-and-smoke-20261017.md)；[完整安装差异](development/v020-windows-acceptance-delta-20261017.md)继续，未公开发行，当前公开版仍0.19。以下旧检查点保持各自来源，不相加为同一候选通过数。
</details>

</details>

用户于 2026-10-13 要求持续开发至覆盖 Navicat 全部功能，高频优先。本清单固定本轮需求基准，后续新增能力作为明确变更记录，不用“全功能”代替可验收要求。

行为研究参考本机 Premium 17.0.8 x64；能力目录参考 2026-10-13 阅读的 [Navicat 官方矩阵](https://www.navicat.com/en/products/navicat-premium-feature-matrix)。官网已含新版本能力，不能说在本机 17.0.8 都已验证；旧 17.3 PDF 本轮返回错误页，不用搜索摘要代替原文。下面是自主工作包和验收要求，不复制第三方程序、素材或私有格式。

优先级由典型开发流程推断，尚无实际频率统计。状态“已验”只覆盖对应版本说明、[验证记录](validation.md)及具体实库/平台记录明列的组合，不能外推未验驱动或平台；最新公开证据见[0.21公开验收](../tests/integration/acceptance-v021-published-20261018.md)：12附件与摘要清单核对，三个主安装包和源码独立下载，1805个源码文件逐项一致。此前[0.19公开验收](../tests/integration/acceptance-v019-public-20261016.md)及历史各检查点保留其当时来源，旧文案不代表当前发行状态。“部分”有缺项，“在做”未发布，“待做”未实现。工作包内全部子能力均需验收，不以 SQL 入口替代专用功能。

## P0：日常流程

<details><summary>0.18—0.19历史验收（不累加为当前候选统计）</summary>

0.18 开发验收补充：[SQL 补全 22 项](../tests/integration/acceptance-v018-caret-input-20261016.md)、[数据表与记录视图补充](../tests/integration/acceptance-v018-grid-install-20261016.md)及[两项原生复制](../tests/integration/acceptance-v018-native-copy-20261016.md)已使用同一 Windows 候选实际执行并核对清理。另 [12 个开发组件](../tests/integration/acceptance-v018-native-components-20261016.md)在三平台临时原生 CI 各自实际通过并下载逐例核对，原 281 身份计划现已补全：246 个安装产品和 35 个组件；Mac 同身份不重复累加。这些计数不是功能覆盖比例。0.18现已公开：12附件/1075源码blob独立核对，公开Windows六项常用完整批及两端口各四场景SSH通过，实际EXE/ASAR与原候选相同；原计划未全套重跑，见[公开验收](../tests/integration/acceptance-v018-public-20261016.md)。

0.19前期31项检查点仍保持[原来源](../tests/integration/acceptance-v019-common-source-20261016.md)。完整源值补取的选择令牌误失效已窄修，固定31在MySQL8.4/13384六批36身份正式界面全过；Maria OFF布尔格式另在固定ad修正后六组合各三项自增UI全过，未改服务器设置或原期待，资源核零。固定dbd1新Windows候选已真实安装八批42身份通过，见[安装检查点](../tests/integration/acceptance-v019-windows-candidate-20261016.md)。Engine夹具永久清理门、诊断及观察别名原失败分别保留；固定8b在明文13384和严格TLS13484各七项核心全部通过，包含自然五分钟TTL、精度/并发/物理身份/预算及限权隔离，两轮资源核零，MDL仍未验，见[核心实证](../tests/integration/acceptance-d02-copy-source-actual-20261016.md)。同候选剩余本地261/65批及本轮两项原生复制均已实际通过，累计305个不同身份：282安装产品、20开发Electron组件、3安装宿主源码组件，六实例/卸载资源核零。百万行ZIP安装产品实际1000001行、独立Python逐行/CRC通过。固定8b三平台源码/安装离线各72通过、245条件跳过；原Windows输入准备失败保留，不据后续通过推断已修根因。后续[原生开发组件补验](../tests/integration/acceptance-v019-native-components-20261016.md)在CI38910633307三平台各12项单次通过、0跳过/重试，run977已独立下载核摘要/CRC/完整caseKey及恢复附件；原317计划补全为282安装产品、32开发Electron组件、3安装宿主源码组件，三平台重复不计36个功能。恢复仅证明CI当前1个原始空壳/0个可读条目，不外推本机或非空剪贴板。正式标签、公开附件及其它平台私网继续，见[安装实证](../tests/integration/acceptance-v019-windows-candidate-20261016.md)，0.19尚未发布。

后续高频开发批的配置替换、可选类型颜色及粘贴新增已完成Windows源码8项正式界面；4777项串行单元、类型与构建通过，开发分支三平台源码/实际安装离线各72通过、253条件跳过，原失败及全部范围见[本批实证](../tests/integration/acceptance-p0-workflows-20261016.md)。本批与公开0.19分别存证，安装完整计划和其他组合继续。

</details>

| 编号 | 工作包 | 状态 | 验收要求 |
| --- | --- | --- | --- |
| C01 | 连接配置/分组/搜索/颜色/布局 | 部分 | 基础配置与布局恢复已验；0.16修正USE后布局库、无库/未知和schema5保护，Windows源码、本机及公开NSIS147项含实际重启通过。0.18修复侧栏迟到响应、重复加载及修改后旧关闭屏障，3361单元/类型/构建、5项受控App时序和8次实库表属性界面通过，见[侧栏实证](../tests/integration/acceptance-sidebar-async-20261016.md)。0.18已公开，macOS实库及完整连接生命周期继续 |
| C02 | SSH/TLS 与安全凭据 | 部分 | SSH密码/私钥口令及基本双向TLS已有基础实现。0.18开发源码新增加密客户端私钥口令与独立秘密槽，拒绝孤立UTF16并保留有效Unicode/1024字节边界；严格CA/IP SAN、REQUIRE X509和缺/错/正确口令已验。主目录Windows正式表单/utility/原生safeStorage/真实重启恢复/仅清TLS及不记住回退两项真实GUI通过，无回调核心复验通过，3267单元与类型通过、相关资源核零，见[TLS正式实证](../tests/integration/acceptance-c02-mtls-ui-20261016.md)。既有未加密私钥SSH在13384/严格TLS13484各1正式UI复合用例通过，含错指纹拒绝、utility、真实退出及无补填重启，原密钥摘要不变、资源核零；3422完整单元与类型通过，见[SSH实证](../tests/integration/acceptance-c02-ssh-ui-20261016.md)。密码SSH/加密私钥口令已补隔离OpenSSH两端口四项核心和公开Windows两端口各四场景，含原生加密/真实重启/仅清SSH及仅会话，资源核零，见[隔离SSH实证](../tests/integration/acceptance-c02-isolated-openssh-20261016.md)。系统加密不可用、macOS私网及其它组合继续；0.18已公开 |
| C03 | 配置导入导出/复制 | 部分 | 0.7.0 首批白名单复制、所选概要 JSON 导出及不可变预览新增/跳过；不带秘密或生效认证路径，pendingFiles/schema4 阻止误连。418单元、本机完整56项、三平台源码/实际安装各22离线项及公开12资产/209源码blob通过，公开Windows完整56项通过；后续开发头407已加入已有ID的明确受控替换，211项相关纯验证及独审通过；Windows源码正式3项验证目标/风险、合成会话凭据清除、ABA及CAS，见[高频工作流](../tests/integration/acceptance-p0-workflows-20261016.md)。尚未独立发布，真实持久加密/认证文件、会话任务及其它格式/macOS组合继续 |
| C04 | 连接资源生命周期 | 部分 | 原取消、断线、改目标不重放已验；0.16未知库显式确认重连、真实KILL后零自动写入、发送前落盘及准备取消均通过Windows源码、本机及公开NSIS147项，终态资源清零。macOS实库矩阵待验 |
| Q01 | SQL 高亮/补全/格式化/搜索替换 | 部分 | 0.16已有语义Worker、真实上下文、会话临时对象/遮蔽/实际读取、视图确认及隐藏字段部分状态，新增普通ORDER/GROUP/HAVING输出别名、字符串引用及UNION首输出。2089单元、六实例四套后端275通过13条件跳过，Windows源码147分两轮完整覆盖、本机及公开NSIS各原147完整通过，注册/资源核零。固定b366cae标签三平台源码/实际安装各24离线通过123私网跳过，12公开资产/608源码文件一致。完整窗口/LATERAL/例程及其它边界继续，原失败保留，见[补全计划](plans/sql-semantic-completion.md)与[发行验收](../tests/integration/acceptance-q01-release-candidate-20261015.md) ；后续30fc6af新增当前查询块裸OVER窗口名候选及版本能力隔离，已纳入903f953的5020单元/类型/构建，新命名窗口两项实库界面仍待执行，见[实现边界](development/q01-named-window-scope-20261016.md) ；5abf435修复原离线字段门回归并增加CALL过程名补全，5073单元/类型/构建通过，0.20候选内容核对完成；新安装/实库及CI终态继续，见[准备记录](../tests/integration/acceptance-v020-preparation-20261017.md) |
| Q02 | 选区/脚本/多结果/取消/事务 | 部分 | DELIMITER、临时表、隔离、回滚与释放已有公开验收；CALL模式/状态矛盾已在0.4.0修复并通过五库及公开Windows安装回归。0.19准备候选新增当前语句按钮及Ctrl/Cmd+Shift+Enter，Windows源码在MySQL8.4五项真实界面通过，含原选区/全部、真实片段历史、过程体、拒绝输入及事务状态，见[常用操作实证](../tests/integration/acceptance-v019-common-source-20261016.md)。0.19已公开且核对安装包来源，该能力的Windows同一候选实装已纳入原317身份计划；macOS私网及其它驱动/版本继续 |
| Q03 | 历史/保存查询/SQL 文件编辑 | 部分 | 三编码打开/另存随0.3.0公开；0.16修正历史执行前库、保存当前库、重开/重启的无库与未知，Windows源码、本机及公开NSIS147项通过，标签三平台离线通过。0.17开发中保存查询浏览改为复合键概要分页、完整文字筛选和摘要保护打开/删除，2210单元及Windows源码/真实NSIS各39项通过，含原上下文3项，资源核零，见[分页验收](../tests/integration/acceptance-query-pages-20261015.md)。执行历史后续见下方新增检查点，关联编辑/另存后续已有[来源绑定](q03-query-binding.md)及第二/第三批实证；开发头73c8196新增保存后关闭三选及迟到草稿/作业保护，独审176项相关测试与6项对抗通过，ROOT整合4827单元/类型/构建通过；后续3192开发头的Windows源码四项完整界面已通过，含原失败修正与资源核零，见[关闭及撤销验收](../tests/integration/acceptance-query-close-undo-20261017.md)；新安装仍待验，本能力未进入公开0.19，详见[开发边界](development/q03-save-close-20261016.md)。其它工作流与macOS私网继续，前期依据见[第三检查点](../tests/integration/acceptance-q03-query-context-20261015.md) |
| Q04 | 固定结果 | 已验 | 0.2.0 Windows 实库/实装：原 SQL、精度、截断标记、释放；只保留已返回数据 |
| Q05 | 结果集导出 | 部分 | 已返回结果/固定快照及同会话明确新执行、JSON全结果/CSV指定行集、背压、取消断线与退出已有公开检查点。0.16源码、本机及公开NSIS的CSV/JSON各逐行验证100万行，精度/顺序/Unicode正确，待写峰值1行73字节、预览200；原完整147项及资源核验见[发行验收](../tests/integration/acceptance-q01-release-candidate-20261015.md)。0.17同次新执行的多CSV ZIP64具备顺序流式写出、位置映射/状态清单、10GiB/200结果及原子替换；六组合核心各20通过/1百万行条件跳过、MySQL8.4真实界面9项通过，实际系统tar小包及4297328968字节真实ZIP64独立校验通过。后续MySQL8.4引擎层真实百万行ZIP、取消及失败保护复合验收通过，1000001行/5协议结果/136780886字节，独立Python逐行/CRC校验，待写峰值1行148字节、资源核零；不改变先前六条件跳过统计。0.18 Windows源码正式GUI百万行ZIP补充1项已通过，实际1000001行/136780880字节、队列峰值1行148字节，独立Python逐行/CRC及一次执行核对通过，见[正式UI实证](../tests/integration/acceptance-q05-million-archive-ui-20261016.md)；公开安装包百万行ZIP、强杀恢复及macOS等仍待验，见[第四批验收](../tests/integration/acceptance-parallel-fourth-20261016.md)、[百万行入口](development/q05-million-csv-archive-manual.md)与[容器边界](development/query-multi-csv-archive.md) |
| Q06 | 片段/参数查询 | 部分 | 0.3.0 独立片段库、九类型 :name、动态模式、部分提交与隐私已有五库核心、Windows 实库和公开安装验收；三平台原生离线通过，macOS 实库未验 |
| Q07 | 可视化执行计划 | 部分 | 0.17开发中已有原会话JSON树、服务器包含关系、估算指标/原文及明确文本回退；保存/来源更新/另存/CAS期间状态保持通过六组合界面分轮验收及Windows同一候选实装，见[第三批验收](../tests/integration/acceptance-parallel-third-20261016.md)。复杂节点语义、权限/取消组合及新macOS安装等仍待补齐，不能把估计成本当耗时 |
| D01 | 分页/虚拟表格/筛选排序 | 已验 | 0.2.0 五基线筛选、Windows 实库/实装百万行滚动跳页；变化数据不保证快照分页 |
| D02 | 网格编辑/复制粘贴/集中提交 | 部分 | 基础草稿预览、可靠键、完整旧值冲突检测已有公开检查点；后续发现0.17源码在MySQL5.7的UINT64最大键重复谓词可能误报冲突。0.18源码已去重并保留文本键字节及非键原值保护，六组合36真实Engine/12正式D06界面通过，3337单元、类型与构建通过，见[原行实证](../tests/integration/acceptance-d06-current-and-key-guards-20261016.md)。修复已随0.18公开，安装产品与原候选字节相同。后续开发头407新增有界粘贴为新增草稿，保留typed NULL/字节/JSON和DEFAULT，明确预览/暂存，零自动写入；行预算反例已独立父红新绿，Windows源码3项正式界面通过，见[高频工作流](../tests/integration/acceptance-p0-workflows-20261016.md)。本轮粘贴为手工输入及合成paste；后续3192开发头已提供有界按操作撤销/重做，修复无blur卸载占门，4894单元/类型/构建及Windows源码原两项界面通过，见[关闭及撤销验收](../tests/integration/acceptance-query-close-undo-20261017.md)。原生粘贴、新安装与完整其它平台矩阵继续，本批尚未独立发布 |
| D03 | 文本/JSON/NULL/二进制精度 | 已验 | 整数金额、时间微秒、JSON 大数及原型同名列 |
| D04 | 表单/树/JSON 记录视图 | 部分 | 0.11普通表单、0.12投影、0.13整行、0.14节点值及0.15结构操作分别公开。0.15正式1801单元、五基线新增界面50次、Windows源码/本机及公开NSIS原完整各126项通过；两轮三平台源码/真实安装各22离线通过、104私网跳过，12资产/544源码blob一致，见[结构验收](../tests/integration/acceptance-d04-record-structure-input-20261015.md)。0.17已接通保留原词法及有序身份的对象成员移动，MySQL8.4三个真实界面用例通过，见[第四批验收](../tests/integration/acceptance-parallel-fourth-20261016.md)。新安装、跨页、关联树、模板、批量及持久恢复仍待完成 |
| D05 | 外键值选择/关联导航 | 部分 | 0.4.0复合外键、NULL、跨库、权限、取消及草稿保护五库核心及公开Windows完整实装已验，三平台原生离线安装通过。0.18获增补授权，MySQL8.4源码正式界面补跑父表拒读/可空复合键清空草稿及预览后提交1项通过，临时用户、库和线程核零，见[限权补充](../tests/integration/acceptance-d05-permission-supplement-20261016.md)；不回填0.17安装245项历史。macOS实库、无可靠非空唯一键父表及本例新安装/其它组合继续 |
| D06 | 网格查找替换/表偏好 | 部分 | 0.6页内查找/草稿及列偏好、0.17有界Worker正则/零宽已有公开检查点；0.18补单处前进、键盘及ABA/组合/选择守卫，既有六组合12次正式UI及36原行核心见[前期实证](../tests/integration/acceptance-d06-current-and-key-guards-20261016.md)。默认关闭的捕获组展开及分配前完整预算已接入，3478完整单元、最终类型与新构建通过；六组合18次捕获产品UI及加强交付时钟后的8项真实组件通过，SQL显示辅助不单独证明WHERE语义，见[捕获实证](../tests/integration/acceptance-d06-capture-and-late-20261016.md)。新安装、实体输入法、macOS实库及更多驱动/类型继续；0.18已公开 |
| D07 | 图像/Hex/Web/BFile 编辑查看 | 部分 | 0.17开发中已有有界图像/Hex查看及可靠表草稿暂存，任意SQL结果始终只读、按真实字节包装区分TEXT/LONGTEXT和空字节，重复列名按唯一键定位。六组合类型界面及Windows同一候选实装通过，见[第三批验收](../tests/integration/acceptance-parallel-third-20261016.md)；Web/BFile、其它驱动/格式和平台实库等仍待做 |
| D08 | 类型颜色/编辑会话历史 | 部分 | 后续开发头407已有可选类型颜色，默认关闭、可靠类型/歧义降级、偏好持久化及原值保持；147项相关纯验证及独审、Windows源码2项正式界面通过，含亮暗设置/真实重启/重置及表与SQL结果，见[高频工作流](../tests/integration/acceptance-p0-workflows-20261016.md)。后续903f953已接入独立持久提交回执、单次预览绑定及可靠取消阶段；5020单元/类型/构建、Windows源码两项离线与两项13384真实CUD/重启/冲突回滚界面通过，资源核零，见[回执实证](../tests/integration/acceptance-table-apply-receipts-20261017.md)。真实ACK丢失/写盘失败、完整类型/高对比/缩放、新安装与其它平台继续，本批尚未独立发布 |
| O01 | 数据库/表设计 | 部分 | 0.8字段、0.9 BTREE/主键、0.9.1取消保护、0.10外键及0.17受控FULLTEXT/SPATIAL均已有公开检查点，原证据分别保留。0.18开发源码新增普通表备注和表默认字符集/排序规则专用编辑，两切片六组合核心分别各24项通过；Windows正式Electron四项在六组合共24次通过，含180px窄栏、严格TLS、预览零DDL和原列/数据保持，主目录3239单元、类型及构建通过，旧失败与核零见[表属性实证](../tests/integration/acceptance-o01-table-properties-20261016.md)。0.18另增同库表重命名，MySQL8.0.30以上的8.0分支及8.4可写，5.7/Maria本片只读；六组合核心18通过/18条件跳过、正式UI12通过/6条件跳过，3571完整单元、类型及新构建通过，未知两端URI及刷新保护见[重命名实证](../tests/integration/acceptance-o01-rename-root-20261016.md)。0.18另增受控下一自增值，仅上调已有整数自增列；六组合核心18通过/18条件跳过、Windows正式UI15通过/3条件跳过，三个可写实例实际观察MDL后取消且不重放；完整3763及新增MDL20项、类型与新构建通过，见[自增与导航实证](../tests/integration/acceptance-o01-auto-w03-root-20261016.md)。0.18已公开，旧版本写能力、完整列转换、其它表属性、复杂特殊属性、新安装与macOS实库仍待验；前期见[外键](../tests/integration/acceptance-o01-foreign-keys-20261014.md)及[第四批](../tests/integration/acceptance-parallel-fourth-20261016.md) |
| O02 | 视图/过程/函数/触发器/事件 | 已验 | 0.2.0 Windows 实库/实装逐类读取编辑执行刷新，实际结果断言；其它驱动尚未实现 |
| O03 | 结构 SQL 预览 | 已验 | 预览后执行，隐式提交及失败说明 |
| F01 | CSV/JSON/SQL 文件任务 | 部分 | 常规映射、编码、进度、取消、错误与恢复已验；0.7 及更早含结构 SQL 对部分 Maria 表达式默认及旧版二进制文字默认存在已证保真缺口。0.8 已公开保护拒绝不可靠结构并保原文件，纯数据和视图路径分别验证；其它格式/驱动仍有缺项 |
| W01 | 快捷键/主题/标签/退出 | 已验 | 各平台，原生确认及保存失败保护 |
| W02 | 收藏/虚拟分组/专注/对象 URI | 部分 | 0.17开发中已接入收藏/虚拟分组/专注/对象URI、连接辨识及最新导航意图，前期依据见[首批集成](../tests/integration/acceptance-parallel-integration-20261016.md)。第四批新查询接管迟到表/定义/错误已通过6个受控回包App用例及1个MySQL8.4真实双连接用例；明确会话回填落盘后保留旧标签完整快照断言，见[第四批验收](../tests/integration/acceptance-parallel-fourth-20261016.md)。系统协议注册、新安装/macOS及公开发行仍未完成 |
| W03 | 全库搜索 | 部分 | 0.17开发中已有结构名称、定义正文、分页数据搜索、权限降级、首批只读记录定位及本地查询全文/概要浏览。当前2210单元、Windows源码/真实NSIS各39项通过，新增最小原生窗口正常点击和错误明细可见性修复，冻结归档一致、六实例及本机资源核零，见[分页及布局验收](../tests/integration/acceptance-query-pages-20261015.md)。本地正则/光标见[本地全文验收](../tests/integration/acceptance-w03-saved-query-search-20261015.md)；旧定义六实例66/名称54及导航276见[定义](../tests/integration/acceptance-w03-definition-search-20261015.md)和[导航](../tests/integration/acceptance-w03-record-navigation-20261015.md)，身份仍限明示Linux/ASCII/非分区InnoDB及目录权限。0.18本地保存查询正文增加最多200处高亮/前后导航和Unicode零宽，绑定摘要/连接修订/实际模型，CRLF不能无损定位时整组明确降级；Windows新4项及原5项离线搜索9通过/1原实库条件跳过，400ms保存观测原失败及窄修保留，见[本批实证](../tests/integration/acceptance-o01-auto-w03-root-20261016.md)。其它对象/权限、可编辑导航、定义内行列与多处高亮、执行历史分页、SSH、完整桌面及本批macOS私网/公开发行继续，见[搜索计划](plans/database-search.md) |

0.17后续Q03执行历史已接入独立概要分页、来源/执行结果/完整SQL或错误筛选、按摘要打开和明确替代连接；完整2226单元通过，Windows源码43个不同用例分两轮覆盖且保留原失败，新历史实际安装及macOS仍待统一验收，见[历史验收](../tests/integration/acceptance-history-pages-20261015.md)。保存查询关联编辑/另存、其它历史工作流与全目标继续。

## P1：常用扩展、迁移与运维

| 编号 | 工作包 | 状态 | 验收要求 |
| --- | --- | --- | --- |
| R01 | PostgreSQL | 待做 | 会话、schema、序列、类型、函数、约束与驱动完整矩阵 |
| R02 | SQLite | 待做 | 用户数据库驱动，文件锁、只读、事务和恢复 |
| M01 | 同类/跨类型传输 | 待做 | 结构数据映射、预览、批次、取消、错误与精度 |
| M02 | 结构比较同步 | 部分 | 0.17开发中已有两表原定义比较、差异分类及受限SQL审查稿，六实例读取/预览保护24项通过，见[首批集成](../tests/integration/acceptance-parallel-integration-20261016.md)。尚不能执行同步；完整对象/方向/依赖及目标再检查继续，外键全库名称可用性未知时拒绝危险混合脚本 |
| M03 | 数据比较同步 | 待做 | 键/筛选、差异分页、冲突，选择增删改 |
| M04 | 跨库记录复制 | 待做 | 类型映射，形成目标草稿，避免误贴原连接 |
| B01 | 常用数据库备份恢复 | 待做 | MySQL/MariaDB/PostgreSQL/SQLite/Redis 分别验证；表导出不能代替整库备份 |
| B02 | 备份转 SQL/SQL 与 Redis 文件 | 部分 | SQL 执行已验；补转换及 Redis 命令任务 |
| S01 | 用户/角色/授权撤销 | 待做 | 真实权限、预览、权限不足与当前账号保护 |
| S02 | 服务器/会话/命令监控 | 在做 | 已接正式连接选择、概要/固定状态/有限会话、串行刷新及只读独立任务；源码与RAM证据见[接线边界](development/server-monitor-integration-20261017.md)、[资源隔离与退出](development/independent-task-resource-recovery-20261017.md)，实库/原生/安装待验；取消读取与结束他人会话区分 |
| F02 | Excel | 部分 | 0.17开发中已有XLSX有界读取、工作表/字段映射及流式导出；MySQL8.4实际1201行往返及六实例文件精度/真实警告批次回滚已验，后者174项包含XLSX/CSV/JSON，见[第二批验收](../tests/integration/acceptance-parallel-second-20261016.md)。完整工作表/类型/公式与取消矩阵、原生macOS及公开发行仍待完成 |
| D09 | 数据概况/剖析 | 待做 | NULL、分布、抽样范围、服务端聚合及取消 |

## P2：专业数据库与工作流

| 编号 | 工作包 | 状态 | 验收要求 |
| --- | --- | --- | --- |
| R03 | SQL Server | 待做 | schema、身份列、批次、程序与驱动矩阵 |
| R04 | Oracle | 待做 | 服务名/TNS、序列、包、类型、LOB 与精度 |
| R05 | MongoDB | 待做 | 集合、索引、BSON、树/JSON、查找与聚合 |
| R06 | Redis/Cluster/Sentinel | 待做 | 键、TTL、扫描、命令、重定向与取消 |
| O04 | 可视化查询/视图/查找/聚合构建 | 待做 | JOIN、条件、排序、聚合及代码预览 |
| O05 | 重构/语义代码辅助 | 待做 | 引用、声明、悬停、错误、重命名保留注释字符串 |
| E01 | ER 关系查看 | 待做 | 真实外键、复合关系、对象选择、缩放刷新 |
| A01 | 编排/本地计划任务 | 待做 | 跨连接依赖、失败策略、进度、重复运行控制 |
| A02 | 通知/导出附件 | 待做 | 用户配置后发送，秘密隔离及实际结果 |
| G01 | 数据生成 | 待做 | 约束、分布、参照完整性、预览及取消 |
| G02 | 数据脱敏 | 待做 | 一致性、关系、复制目标、预览与恢复边界 |
| G03 | 数据字典 | 待做 | 库/模型、注释、模板、PDF 输出和任务 |
| N01 | MongoDB 管道/结构分析 | 待做 | 编辑运行、抽样推断、索引和结构差异 |
| N02 | Redis Pub/Sub | 待做 | 专用连接、订阅、消息上限与退出释放 |

## P3：低频及高级范围

| 编号 | 工作包 | 状态 | 验收要求 |
| --- | --- | --- | --- |
| R07 | Snowflake | 待做 | 账号/仓库/角色、认证、元数据、查询及任务 |
| R08 | 兼容厂商 | 待做 | OceanBase/TiDB/Fujitsu/Dameng/KingbaseES/IvorySQL/Garnet/openGauss/GaussDB 逐项能力及证据 |
| R09 | 托管数据库 | 部分 | AWS/Azure/Google/Oracle/Atlas/Redis Cloud/阿里/腾讯/华为适用认证与限制；现仅普通 MySQL 协议 |
| C05 | HTTP 隧道 | 待做 | 自主协议、权限、TLS、超时及并发 |
| C06 | PAM/LDAP/Kerberos/Windows AD | 待做 | 分驱动平台验证，不可用组合明示 |
| F03 | TXT/XML | 待做 | 字段、转义、编码与流式任务 |
| F04 | ODBC/Access/DBF/Parquet | 待做 | 系统适用性、类型映射、文件往返 |
| B03 | MongoDump/Restore | 待做 | 工具版本、参数、任务、实际恢复及权限 |
| B04 | Oracle Data Pump | 待做 | 服务端目录/权限/版本、任务及恢复 |
| B05 | SQL Server 原生备份 | 待做 | 服务端路径、完整/差异/日志、版本与恢复 |
| O06 | PL/SQL、PL/pgSQL 调试 | 待做 | 断点/步进/局部值、权限及释放 |
| L01 | 概念/逻辑/物理/混合模型 | 待做 | 自主格式，关系/维度/Data Vault 方法、属性验证 |
| L02 | 图形及批量模型编辑 | 待做 | 关系、图形、字段、命名/词汇、布局、撤销 |
| L03 | 库/SQL 反向工程 | 待做 | 方言解析、对象选择、同步差异、解析失败提示 |
| L04 | 正向工程 | 待做 | 数据库/文件输出、同步预览、依赖与错误 |
| L05 | 模型比较/转换/输出 | 待做 | 工作区差异、驱动映射、PDF/图片及字典 |
| I01 | BI 数据源/计算字段 | 待做 | 实库、权限、刷新、缓存、指标与数据范围 |
| I02 | BI 图表 | 待做 | 20 多种图表逐种配置及真实数据验证 |
| I03 | BI 多页仪表板 | 待做 | 布局对齐、全局参数、交互、刷新及演示 |
| H01 | 项目/成员协作 | 待做 | 自主服务、身份权限、审计、冲突、离线 |
| H02 | 连接/查询/片段/分组/偏好同步 | 待做 | 同步范围、秘密、冲突、恢复 |
| H03 | BI/模型/管道工作区同步 | 待做 | 版本、访问控制、冲突、大小限制 |
| AI01 | 对话/模型提供方 | 待做 | 自有密钥、结构附件、模型比较、多对话及分支 |
| AI02 | 代码到编辑器/快捷动作 | 待做 | 先审阅再执行，自定义/固定动作、权限及错误 |
| AI03 | SQL 解释/优化/格式化/转换/修错 | 待做 | 上下文、驱动测试，禁止泄露秘密和自动执行 |
| AI04 | 表/模型设计、注释及填充 | 待做 | 先预览，生成变更走可靠提交路径 |
| P01 | Linux 客户端 | 待做 | 官方平台能力纳入后续；现 Windows/macOS 桌面 |
| P02 | 发行签名/公证 | 待做 | 合法证书及原生验证；现预览明确无发行签名 |

## 组合验收与结束条件

2026-10-16 五路并行集成检查点：D06 单处/正则、Q07 JSON 树、W02 收藏/虚拟分组/链接、F02 XLSX、M02 两表比较已接入独立统筹分支。最终2544单元通过，离线专项25通过/1私网跳过，200/MySQL8.4的14个实库界面用例分两轮完整覆盖；结构比较六实例24项及BIT64参数六实例12项通过，相关资源清零。定标浮点/导入警告专项、统一安装和新原生CI继续；Q03关联保存与D07二进制查看第二批切片在独立任务分支，不计作已公开能力。各工作包状态保持“部分”，详细已验组合、原失败及未验边界见[并行集成验收](../tests/integration/acceptance-parallel-integration-20261016.md)。不将普通克隆的作者测试、旧提交CI或部分子能力当作全功能完成。

新增驱动至少验收安全连接、会话、元数据、查询/取消、事务、编辑定位、精度、对象和文件任务及专用功能。官方最低历史版本不能由一个新版本通过外推；版本/厂商兼容性要另建实际可执行矩阵。Windows x64、macOS arm64/x64 分别构建及随包验收；Linux 后续独立交付。

第二批统筹检查点：Q03关联保存/另存、D07查看/Hex暂存、Q01普通窗口作用域已集成，2610单元与25项离线专项通过（3私网跳过）；MySQL8.4十个不同界面用例分轮覆盖，含同名SQL列按唯一键查看，六实例文件精度及真实警告回滚共174项通过。首批CI三平台源码和构建通过，但安装步骤均失败，新的安装验证继续；另有已复现的整行JSON/节点原生输入截断P1正在修复，不能计为已交付。各包继续按实际子能力标“部分”，见[第二批验收](../tests/integration/acceptance-parallel-second-20261016.md)。

第二批后续补验：整行JSON/节点截断P1已修复，作者组件10项及独立原生粘贴9项/模型4项通过，统筹完整2627单元通过。首个Windows真实NSIS专项25通过/3失败；定位并修复TEXT/LONGTEXT被wire BLOB类型误判后，新候选定向7项全过，分别保留两候选与原失败，不能称为同一候选完整28项通过。实际ASAR一致、卸载及六实例/根进程核零。任意SQL结果文本的只读类型呈现、新三平台CI、完整旧桌面回归及公开版本继续，详见同一[第二批验收](../tests/integration/acceptance-parallel-second-20261016.md)。

第三批统筹检查点：Q07保存/另存/CAS期间计划状态保持、D07任意SQL结果TEXT与实际字节区分、Q01有界LATERAL及版本能力事实已集成。完整2760单元、类型和构建通过；LATERAL六实例核心30通过/30条件跳过，六组合真实Monaco分别通过，结果类型/计划保存两个UI用例在六组合分轮覆盖。Windows同一未签名候选14项安装专项通过（10实库产品UI、3离线Monaco、1源码组件/安装宿主），严格TLS再验3个实际产品UI，ASAR一致、卸载及相关资源核零。旧8744484的Windows原生源码/安装各68通过，两个Mac源码仍有窗口失败且未进入打包；新光标核对已验Windows，新的Mac原生、完整旧桌面及公开发行继续。各包完整能力仍保持部分，原产品及夹具失败、实际候选哈希和矩阵见[第三批验收](../tests/integration/acceptance-parallel-third-20261016.md)。

第四批原检查点完整2992单元、类型及构建通过，Windows32个不同界面用例分轮覆盖（26实库、6受控回包），六组合特殊索引42项、多CSV核心120项通过/6百万行条件跳过，真实4GiB ZIP64文件边界另层通过。后续旧Delete守卫已修复，完整3025单元、类型、新构建及6个二进制实库UI通过；独立run567候选四次真实安装共245项通过（218安装产品、24开发Electron、3源码组件），正式246项精确缺1个未授权额外权限用例，原失败保留。归档/身份/执行输入/公共脚本一致、卸载及六实例/本机资源核零；c712和82e分别三平台离线源码及安装成功，新82e各阶段68通过/178条件跳过。公开发行另验，见[第四批](../tests/integration/acceptance-parallel-fourth-20261016.md)、[原生CI](../tests/integration/acceptance-parallel-native-ci-20261016.md)及[上一候选](../tests/integration/acceptance-parallel-full-20261016.md)，分轮和夹具不冒充完整全功能。

所有工作包子能力完成、声明的驱动/平台矩阵验收，源码、中文文档和安装包公开分发校验后，才完成全功能目标。缺少验收账号、专用认证服务器或证书时记录条件并继续其它工作，不删除要求或冒充通过。服务器网页版仍不属于桌面运行目标，协作服务不能冒充 Web 客户端。

0.17公开检查点已完成：12附件、890源码文件独立下载和摘要/逐blob核对；公开Windows自有60个spec四批245项通过（218安装产品、24开发Electron、3安装宿主源码组件），0失败/跳过/重试，正式246身份唯一增补权限缺项保留。四批实装/卸载、记录内输入冻结、原脚本保护及六实例/本机资源核零；补证时间边界和macOS私网限制见[公开验收](../tests/integration/acceptance-v017-public-20261016.md)。0.18现已公开TLS口令、表属性及编辑保护等能力，公开安装和SSH新组合见[0.18实证](../tests/integration/acceptance-v018-public-20261016.md)。各固定检查点与平台未验边界分别保留；0.19常用流程继续集成验收，不改变全功能目标。

0.28后续完整INSERT在固定6c86986通过Windows／MySQL8.4源码正式发布与等待确认取消两例，原会话一次新执行、两行精确值／JSON大整数、原文件对象、背景结果及正常退出收尾均实际核验，Root只读后核成功资源释放。旧保存表单失败根因未确认且现场保留，范围见[正式实证](../tests/integration/acceptance-query-insert-ui-root-20261018.md)。不增加完整工作包或安装／macOS／百万行／公开发行通过数。
