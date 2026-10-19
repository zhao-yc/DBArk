# 首次格式化EOL准入：LF来源文件的窄修准备

本次修复基于未接纳的 `1ff6700e8e4b20f2d4e41a456044e1e2288801e9`，产品基线仍为Root指定 `23dac39775f5ea5f6c742e88013733af890ec4e9`。原提交、原bundle和原证据在原clone保留；本片在新的普通clone修改准备，不改Root、产品、原native runtime或依赖。

员工4独审交接SHA为 `6d43028f07afbfc125c6c4f602f5b481443aa4e202750b28977e5d2d7f058a13`。原例从保存查询卡片把完整LF正文作为SqlEditor.defaultValue创建新模型，锁定Monaco会检测为LF，不能获得Windows CRLF前提；原RAM手工提供CRLF没有覆盖这条创建链。另一个问题是同一page.evaluate内串联两次Main写入，第一次晚回后可能在父门失效期间继续第二写。两项原始反例保持，不以旧107项通过冒充实际覆盖。

窄修改用正式“打开SQL文件”入口：先通过真实无密码回环连接表单和新建查询表单得到空查询，再由产品在原空placeholder模型中异步加载本例自有UTF8/LF文件。原 `useQueryFileSource.open` 明确先建`sql:''`文档、等待原保存，随后调用正式来源RPC并更新正文。该路径是Root run1871/1874所观察的Windows CRLF路径；本轮仍须实际观察成功，不以源码或RAM替代原生现场。

文件由复用的 `QueryFilesNativeFiles` 在run新私有profile中用原wx+句柄创建，冻结原目录与文件dev/ino、大小及SHA256。一次准确自有路径的原OpenDialog回答使用既有严格helper，立即恢复并核一次消费。每次独立读取都消费原身份；首次格式化前、Undo后、重启后均核原UTF8/LF字节、同一文件身份、Main来源ref/格式/原摘要，没有保存或覆盖该文件。

每个入口各一个独立用例。触发前要求：原文件逐字LF、Main草稿逐字LF、实际模型为该原文按已声明EOL映射；观察后零内容事件，聚焦和移动光标不改原模型/版本；触发前再次读原文件及Main。Windows必须真实CRLF，否则失败；macOS按实际EOL并记录mismatched，LF/LF不能冒称差异覆盖。不先追加Space、不先运行另一个入口或预Undo，不使用setter/改变模型EOL/系统剪贴板。

原嵌套Main写入已移除：概要和空查询走各自受父run.step保护的正式UI动作，不创建保存查询；所有显式page.evaluate最多一条Main只读RPC，逐次回父进程原门，没有在浏览器闭包中串行发送后续写入。独立原函数加原run.step的迟到动作反例确认，首个UI动作晚回失效后不再进入下一项表单动作。

格式化仍使用手写两空格黄金全文，核同一模型/EOL、一次内容事件及焦点。单次Undo恢复原模型全文，再单次Redo及Undo复核。Main正常正文事件可使草稿变为模型CRLF；原文件及来源基线仍为LF。当前dirty摘要不归一化行尾，因此不能把Undo后的逻辑同文冒称clean。测试用真实 `queryFileSourceHasChanges` 与Main原元数据计算dirty并等待真实caption；LF模型可clean，CRLF草稿须dirty，绝不更改dirty状态。

退出时，若实际dirty为真，只复用原SQL文件helper的准确warning标题/正文/按钮、原window/webContents/PID、原TestInfo deadline及一次暂停/父门复核/消费回执；未知提示、期限或owner失效都保留。若真实clean，不安装回答。确认的是正常“退出客户端”，不强停，不保存源文件；最终仍由原run的will-quit/close/全部记录PID不存在证明结算。两次独立owner、原SQLite schema9、原活动ID/正文/文件ref及原目录身份核验之后，才由原run限定删除目录。未引入另一套生命周期或R7观察链。

默认/list和独立批准门保持：`DBARK_FORMAT_EOL_NATIVE_TEST=1`、`DBARK_FORMAT_EOL_NATIVE_APPROVED=1`、`DBARK_INTEGRATION_ENABLED=0`及Root准确绝对manifest/原SHA。原完整树/真实Main-window来源/120秒/sticky合同不改；这里不生成批准，不自动加入CI runner。

验证新增真实依赖原_getEOL和正文桥placeholder同步小例、逐evaluate单RPC护栏、原函数晚动作门及LF/CRLF真实dirty摘要；连同原文件/退出/gate/owner/runtime回归，最终6文件160项通过、类型检查退出0。最终配置显式envDir=false。首轮同样160通过但使用默认配置，其原件保留；该新clone没有.env文件，随后改用显式配置重核。RAM不代表实际Monaco、原生文件打开或Undo验收。

实际GUI/Electron/Playwright含list、端口/网络/DB/CI/安装/依赖修改均0。本次没有重放Root1871/1874，也不能继承其整体通过结论。Root仍须在最终准确构建上实跑两例，验证placeholder实际就绪/EOL、文件授权、焦点、单次Undo、真实dirty、精确提示消费、正常退出就绪/PID/SQLite/目录清理及各例总120秒。新提交和bundle仅本地交接，不推送。
