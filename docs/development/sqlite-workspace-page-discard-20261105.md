# SQLite 跨页草稿逐页放弃（2026-11-05）

## 行为与范围

接续[跨页草稿工作区](sqlite-multipage-workspace-20261105.md)，每份保留页新增“放弃此页”，可访问名称带准确页号。确认列出该页修改条数及是否含撤销／重做记录，并明确其它保留页保持。取消不释放来源、不读取也不修改数据库。后台页确认后只释放该页准确snapshot和展示票据，不重新读取当前页，释放一个有保护历史的保留槽后可继续进入第17页。

放弃当前页会明确重新读取同一偏移一次，建立新Editor与新快照。其它页的原Editor、完整typed值及撤销／重做保持，不把当前页的新值拼接到旧来源。若重读失败，有其它有效保留页时恢复其中第一份原页，保持错误提示及预览／导航能力；已明确放弃的页不会成为兜底而复活。若只剩一页，明确放弃后允许建立全新工作区。

零条当前修改但有undo／redo历史时，确认仍明确提示将丢弃历史，不静默淘汰。已过期页可在本地明确移除，不替它重绑原值；有剩余页时不会因删除一页清除整个工作区的失效墓碑。结果未知、任一页有打开的输入／预览或事务在途时拒绝拆组，不能借删除一页解锁未知提交。

这是当前标签RAM内草稿管理，不保存文件、不持久恢复，不取消或重放数据库写入。原全部保留页放弃入口、16页上限、合计500条／10000格／2MiB预算、统一事务与来源保护保持。其它驱动工作区、批量表单、自动重绑／重基和完整持久恢复仍未完成，D04／R02与整体Navicat对标继续部分覆盖，暂不发布。

## 来源与确认

SqliteEditWorkspace.discardPage仅接受账本内准确Editor；重复、旧Editor、unknown、任一输入／预览／busy均返回false。移除后仅Editor释放准确snapshot，Browser.forget只移除展示票据；其它页不dispose、不改rows、不清undo／redo。不在模型里发送page／preview／apply或系统剪贴板请求。

父页事件绑定准确已提交渲染、当前Editor、全部成员及各页generation／rows、已应用查询对象及正文、连接配置／版本、活动标签、结构修订及模态占用。确认期间同步订阅store，一次身份变化即永久撤销本轮意图；配置版本ABA、迟到旧按钮、其它输入及预览不能借确认移除新页。操作之后主动重算全组dirty，后台页清理不会覆盖其它页未保存状态。

当前页重读以前先撤掉已放弃页的输入、选择、菜单及结构展示兜底，再登记其它有效原页为失败恢复源。新读失败按原Browser错误恢复路径处理，成功则正常采用新页；不自动提交、合并来源或重试原修改。

## 验证

实际macOS arm64／Node24.17.0。开始时WIN11-TEST只读检查不可达且未派发，按AGENTS约定回退Mac。所有数据库为独占合成SQLite，零Docker、SSH、业务库和系统剪贴板操作。

严格类型退出0；构建17.53秒通过，保留原第三方PURE及大分块提示。最终相关11份文件248项通过、0失败／跳过；模型及完整React两份33项复验与其重叠，不累加。完整单元1295份文件26970项通过、10项既有Windows tar平台条件跳过、0失败，470.9秒，退出0；逐一核跳过仅query-csv-native-check.test.ts中的win32条件，不把它们计为通过。

Mac真实Electron完整窗口10347毫秒通过。三次逐页确认响应分别为取消1、确认0、确认0，Main原件共有8次受限读取、3次双页预览及2次明确apply；未知请求为空、pending为0。两个准确owner PID39417→39523均正常退出0，launches为2，准确fixture目录删除已独立核不存在。原双页提交两行、次页冲突此前已执行一行仍整批回滚、int64／BLOB／生成列及重启不恢复保持。已查看后台页移除后第一草稿保持的原窗口PNG。

模型新增覆盖：只释放目标一次、其它页原rows和undo／redo保持、下一次组合预览不含旧页、16页满额移除后可进第17页、零变化的重做历史保护、最后一页后新账本与旧Editor不复活、过期页移除、任何输入／预览／在途及unknown拒绝拆组。

正式完整React父组件覆盖：取消后保持、后台移除零读零写、干净当前页预览仅含剩余dirty页、当前页一次同偏移重读、旧回调不能移除同偏移新页、只剩一页时dirty清理、重读失败恢复其它原草稿及undo／redo／预览、输入和预览期间旧回调无效、确认中配置版本ABA永久拒绝。仅替换IPC端口和无布局网格，实际TableTab／Browser／Workspace／Editor及两个Dialog完整运行。

新原生在上一批完整跨页窗口里增加真实“放弃此页”按钮及window.confirm的取消／确认流程。先取消第二页放弃并核三页两条修改保持；后台明确放弃第二页，零新增读取／预览／apply，独立磁盘保持，准确旧snapshot只释放一次。再次进入第二页只读一次并显示原值；重新暂存临时候选后放弃当前页，再只读同偏移一次且恢复原值。第一保留页仍可缓存返回和undo／redo，重新暂存第二页后继续原完整双页统一提交、后继冲突整批回滚及重启不恢复流程。Main原件保留确认响应、准确释放和全事务事实，不用直接内部函数替代按钮。

## 原件与未验

首轮模型及组件32过／1失败，仅新增测试错误引用不存在的arguments；改为比较实际snapshot释放调用数，未改产品或放宽断言，随后33项通过。原始JSON／日志保留，不累加逐轮数。

原生首轮7423毫秒失败：测试把Electron response=0误当取消，实际0为确认、1为取消，产品正确移除该页而与测试预期冲突。原Main显示4次读页、0预览、0apply、pending为0、denied为空；失败合成库四行、int64、BLOB及生成值独立只读核对保持。保留完整报告、窗口PNG、Main／启动／失败原件、合成库及SHA；准确PID37141经ps核不存在后才修夹具响应并复验，未强停、不冒称失败owner退出0。只改测试回答，产品及全部业务断言、原期限／重试保持；随后完整复验通过。Windows本增量、Mac Intel、安装包、实体输入法、OS chooser实际键鼠及人工辅助技术未验；16页满额和读取失败由模型／完整React父组件覆盖，不泛化为本批Electron逐项故障注入。

## 命令与交付

使用.tools/node/node-v24.17.0-darwin-arm64/bin置于PATH首位。NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同堆配置node scripts/build.mjs。DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run 指定相关文件 --maxWorkers=1 --reporter=json --outputFile=对应JSON；完整回归不筛选文件。原生node scripts/sqlite-workspace-ci.mjs multipage-workspace，保留原120秒／1worker／0重试／trace关闭；git diff --check。没有持续服务。

原始证据.cache/sqlite-workspace-page-discard-20261105/与test-results/sqlite-multipage-workspace/。项目归档.local/交付/2026-11-05-SQLite草稿逐页放弃-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-05-SQLite草稿逐页放弃-v1/。保留可编辑Markdown、源码／patch、逐轮JSON／日志、原生完整回包／PNG及ZIP；原件到归档、归档到备份逐件SHA-256，ZIP另核CRC，独立版本不覆盖历史。无PDF、正式安装包、凭据或密钥，源码推送不代表发布。
