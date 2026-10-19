# 首次格式化EOL准入的原生准备

基线为Root指定离线bundle的HEAD `23dac39775f5ea5f6c742e88013733af890ec4e9`，产品已含5e0a149在Root的移植；本片只新增准备，不改产品、原runtime、旧格式化用例或依赖。原 `query-format-selection.spec.ts` 先追加Space，正文事件已令store追平模型EOL，因此它继续验证普通格式化/选区/Undo，但不能证明本次未编辑草稿的首次准入。

新 `query-format-eol-native.spec.ts` 声明两个独立例，分别首次点击按钮和首次按Alt/Option+Shift+F。每例在新私有profile中经正式Main创建一个无密码、127.0.0.1:1的离线概要及原LF保存查询，再从真实“历史与保存的查询→保存的查询→在新标签打开”入口进入模型。没有直接写workspace、模型、选区、EOL或Undo，也不执行SQL。Main创建的是合成自有保存查询，返回值不伪造；UI打开及原来源绑定必须匹配该Main返回。

首次触发前同时要求：保存查询原文逐字LF、Main当前草稿逐字LF、实际模型正文等于原LF按其声明EOL映射，模型观察以来零内容事件；聚焦及移动光标后模型身份/版本/内容事件不变，选区在开头折叠。触发前再次核原LF，禁止先追加Space、先格式化另一入口、预Undo或其它正文编辑来修复前提。

Windows本例必须实际观察CRLF模型，否则明确失败，不能把LF/LF当成本次差异覆盖。macOS按实际LF/CRLF核对，终态witness明确记录`modelEol`及`mismatched`；macOS实际LF仅证明普通首次入口，不能冒称LF/CRLF差异。没有用setEOL人为构造该差异。

格式化的独立期望手写为两空格缩进，按观察到的模型EOL映射。新例要求同一模型/EOL、一次内容事件和原焦点；只按一次Undo即恢复格式化前模型全文，随后一次Redo及一次Undo复核同样边界。Undo的正常正文回调可以使Main草稿变为模型EOL，这时不再错误要求store回到原LF；保存查询正文/来源引用、会话、任务和历史仍须保持。两入口各自新建owner，互不污染首次前提。

生命周期完整复用原 `bindEditorIndentNativeCase`、`createEditorIndentNativeRun`、Root完整批准identity和真实Main/window来源、原120秒TestInfo/sticky、固定回环拒连且原Socket关闭、正常will-quit/close/准确PID消失。首次正常退出后读取原SQLite schema9及草稿/活动ID，第二个独立owner从同profile恢复原标签/模型，再正常退出后由原run限定删除目录。保存查询草稿没有文件来源，不安装dirty回答、不设clean或改dirty标记；若出现未知提示/错误，沿原期限保留现场，不自动回答或强停。没有导入旧通用desktop-fixture或R7 marker链。

默认及`--list`只声明两例，不加载live/runtime、读清单/凭据或预检端口。未来真实执行须Root同时明确`DBARK_FORMAT_EOL_NATIVE_TEST=1`、`DBARK_FORMAT_EOL_NATIVE_APPROVED=1`、`DBARK_INTEGRATION_ENABLED=0`、绝对`DBARK_FORMAT_EOL_MANIFEST`和原`DBARK_FORMAT_EOL_MANIFEST_SHA256`。安装模式可提供准确绝对`DBARK_EXECUTABLE_PATH`。拒绝其它DBARK门、认证、外部renderer/profile、预加载、别名及录制/配置覆盖；环境漂移恢复仍停链。这里不生成真实批准清单。

本轮仅运行28项新增声明/前提/独立黄金值护栏及原79项gate/owner/runtime RAM检查，共107通过、0失败/跳过，`tsc --noEmit`退出0。实际GUI/Electron/Playwright含list、端口/网络、SQL/DB、CI、剪贴板及依赖安装均0；仅复用祖先现有node_modules，不新建或改junction。RAM不是实际Monaco或原生Undo证明。

Root需整合后审批准确构建并实跑两例，验证实际保存查询分页选择器、未首次编辑的LF/CRLF差异、按钮/快捷键/焦点、真实单次Undo及回声、来源/任务零副作用、两次正常退出/PID/SQLite9/目录清理及总120秒。Mac只有实际`mismatched=true`才能补充差异覆盖。新例不自动加入严格CI专项runner，不代表已取得真实验收结果。
