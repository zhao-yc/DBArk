# 参数查询和流式导出的合成paste准备SQL

本改动只处理两个测试私有`writeSql`的SQL准备步骤。产品仍为5abf435及同一d19候选，测试基点为586ae325；不修改产品、Monaco配置、SQL、参数、任务断言、用例身份或期限。

ROOT的run1116实际结果保留为notAccepted：B030两项通过；B031动态模式项失败、长查询取消项通过。后续流式8项和CALL2项没有执行。动态模式项的原全文断言发现正文末尾多一个单引号；全选后Backspace删除选区，再`keyboard.insertText`仍受Monaco自动补引号影响。原错误上下文、退出、控制、卸载及资源核对记录保持，不回写为成功。

两个帮助器现均聚焦当前可见编辑器textbox，通过Control/Meta+A和Backspace清空旧选区，再构造仅含`text/plain`的DataTransfer，向同一可见textbox投递可冒泡、可取消的ClipboardEvent paste，交由Monaco既有handler处理。这是**合成paste准备SQL**，不是原生键盘粘贴或原生剪贴板验收；不读写系统剪贴板、不调用setValue/executeEdits、不赋DOM值、不改编辑器配置，也不设置“先试键盘再回退”的路径。全文settings读取、CRLF归一化、严格toBe断言和原5秒默认轮询期限逐字保持。

定向纯测试抽取正式私有函数，在RAM事件/持久化端口执行：保留动态模式原SQL，验证Control/Meta事件传输及多行Unicode；旧insertText端口追加引号仍被原matcher拒绝；paste后持久化正文多引号或事件未消费仍失败；处理异常原样传播且不重投。这里的自动补引号是对已观察失败的端口注入，不能替代真实Monaco复验。

类型和仅列表检查另行记录。本片不执行GUI、200、系统剪贴板、安装或实际用例；动态模式实际复验由ROOT使用新测试头安排。参数与导出12项验证业务行为，另4项原生copy/paste仍等待人类许可，不能据此记为通过。

本提交定向验证：12项端口回放通过，类型检查退出0；门控0/1的列表均为参数4项、流式9项（含原utility定义），实际0、项目retries0、原180秒期限保持。两个完整E2E文件逆向移除输入及注释变化后与586仓库正文完全相等；run1116 binding及12控制摘要保持。证据在忽略缓存`.cache/query-synthetic-paste-20261017/verification.json`，未运行广套纯测或实际验收。
