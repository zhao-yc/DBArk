# 执行历史插入当前查询验收（2026-10-28）

## 候选与实现

基线 `398e5fab5ea47b8925ccedc707b0c78a25cebd13`，在原main实现Q03高频切片，暂不发布。执行历史新增“插入当前查询选区”，读取完整SQL并替换打开面板时的原查询选区，单次撤销；不执行SQL、不切连接或默认库、不新建标签。保留原“在新标签打开”。[实现说明](../../docs/development/history-insertion-20261028.md)。

九文件快照 `history-insertion-green01.zip` 为76001字节，SHA256 `98c9e0bf99c79cb75fd0ee30824485150ae58097438b933eb25bbf38b0b7c772`，十条目包含manifest及九源码/测试路径。WIN11-TEST沿原b523加已核overlay继续，只覆盖本次manifest路径，实际备份五旧文件、四新增文件原先不存在，原109份dist保留。未切HEAD或伪造与提交字节一致的声明。

## 审查与验证

独立只读审查发现：history.read已返回、pageRelease尚未结束时再次点击关闭，旧closed短路会漏撤销插入。已修为普通关闭先撤销、记录取消；原release结束只关闭，不编辑。组件反例覆盖标题关闭与延迟释放，原读取/原错误不替换。原标签、导航ABA、模型版本/内容/选区、连接修订、会话/执行编号及旧注册清理另有定向测试。

WIN11-TEST类型检查2496 exit0；指定八文件165项单元全部通过（原PID6812，exit0），包括新增逻辑/组件及原历史筛选、删除、片段、格式化、工作区导航。build含类型6580 exit0，新dist清单已固定。

green01的list10796 exit1，0文件/0用例：Playwright拒绝describe内的trace/screenshot/video配置，App和E2E均未启动。仅将三项off合并到已有模块级test.use，删除describe内配置；正文、断言、种子、fixture和原显式截图调用不变。新spec SHA256 `e779c380459d36c5f515d954dee345328251af283e8c87745072e55cd6983309`，green02只重复类型、list及尚未执行的E2E，不重build或单元。原失败保留，未作为通过。

green02类型14860 exit0，list17648 exit0、实际六例/一文件；整文件16904 exit1，原五例通过，新增例在插入前因会话定位器匹配“本地查询库来源”和“执行时连接”两个元素失败，尚未取得插入行为结论。仅将该定位器改为context-bar内精确匹配原 `zh.query.text009`，原会话状态期望、其它断言、产品和fixture不变；green03 spec SHA256 `cf46a75984ae217b7f61f1efbff2544620092848498afef083a61ce38178f8e4`。类型、单元及产品构建无新增变化，不重复；green03仅list和执行尚未通过的新例，分轮记录，不把原失败改签为同轮六项通过。

green03的list1084 exit0、精确一例；原6072 exit0，新Monaco复合例一次通过，无跳过或自动重试。真实按键产生选区及独立空格编辑；读取超过512字符的完整合成历史SQL，替换仅限选区，Unicode、精确数值、美元符号及周边换行保持。一次undo恢复原模型及保存正文；原Redo/Undo仍各一次。延迟原Main已完成的history.read回包，正式Escape关闭后放行，模型value/version/URI不变；原标签来源、当前连接/默认库、任务、历史和保存查询保持，query.execute/transaction/sessions.open调用为零。此处只证明原未连接、无结果状态保持，不推导真实活动事务或结果保护。

Root已回读三轮原件：green01为198958字节/SHA256 `b566452417df4db0d8b887b8fd25f451d3539b233a66132b44605c5ea0b3e5bc`（含输入快照，递归65项）；green02为528912字节/SHA256 `ff49c5ae44403b8ee6b5175b5ef74669bbbfcfe35b6311c6c1ed09640e9fb772`（46项）；green03为57179字节/SHA256 `c78ba7240969b6ab474ca9e4f1f0bddeddd87781e899cc8472ae2593b6c0c139`（36项）。逐条哈希、CRC、路径、私钥块及最终八源码/单元路径加新spec核对通过。原两轮失败不改写，旧五项仅记green02，新一项仅记green03；原非owned fixture正常收尾，无实库或剪贴板动作。

提交前逐字核对九源码/测试路径：仅App.tsx按仓库属性由CRLF规范为LF（76558→76076字节，暂存SHA256 `6086b9db886764fbeae9f763e8eb9f1bd50e4bd98cf009f6cb76727b36f6be48`），移除CR后逐字一致；其它八条暂存字节与对应VM候选相同。精确提交完整CI另行记录，不以本地快照测试冒充尚未执行的提交结果。

本机仅开发、Git、快照及原件检查，未运行产品测试。所有本轮进程均不加载私密环境、不访问实库或剪贴板；测试为本地合成历史，不能代表真实数据库执行、活动事务或已有结果保持。

## 未验范围

原历史页面E2E沿用非owned的seed/退出重启体系，不另宣称严格owned退出证据。Windows源码的真实Monaco检查点已通过；macOS、新安装包、实库活动事务/结果以及新提交完整CI和公开发行均另验，不借用此前系统URI的CI。Q03保持“部分”。
