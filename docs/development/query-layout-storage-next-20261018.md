# 查询标签编辑区高度：0.22之后的独立后续片

本片基线固定 `e80f9d7ec272947e5c3c4fdcc6644017f38be5fe`，不进入已冻结0.22候选，不调整package版本。renderer由另一个任务接入，本片不修改QueryTab。

固定合同：`AppSettings.tabs`中的query标签可选自有字段`queryEditorHeight?: number`，像素整数130–8192，默认300。`src/shared/queryLayout.ts`导出`queryLayoutLimits`、`readQueryEditorHeight(unknown)`、`assertQueryLayoutWrite(settings)`。缺项合法且保持缺项，UI读取时调用read函数得到300；显式undefined、非数值、非整数和越界写入拒绝；table标签不能带此字段，继承字段不能伪装成自有字段。读取坏值只局部回退300，table上的不适用字段只局部移除；保留其它标签、SQL、来源绑定及偏好，不因读回退自动保存。

首个合同提交仅供UI任务固定接口：Main/LocalStore和schema8迁移在后续本地提交接入，此时不能当作完成的端到端持久化。计划继续沿现有settings.save命令，IPC未知字段仍strict；两入口共用写入门。因为旧0.22严格settings合同不认识新tab字段，新片配置库须升8；旧7原子迁移保持旧内容，未来9拒绝且保留文件。历史0.22文档和安装来源版本不改写。
