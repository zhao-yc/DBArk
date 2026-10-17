# 查询标签编辑区高度：0.22之后的独立后续片

本片基线固定 `e80f9d7ec272947e5c3c4fdcc6644017f38be5fe`，不进入已冻结0.22候选，不调整package版本。renderer由另一个任务接入，本片不修改QueryTab。

固定合同：`AppSettings.tabs`中的query标签可选自有字段`queryEditorHeight?: number`，像素整数130–8192，默认300。`src/shared/queryLayout.ts`导出`queryLayoutLimits`、`readQueryEditorHeight(unknown)`、`assertQueryLayoutWrite(settings)`。缺项合法且保持缺项，UI读取时调用read函数得到300；显式undefined、非数值、非整数和越界写入拒绝；table标签不能带此字段，继承字段不能伪装成自有字段。读取坏值只局部回退300，table上的不适用字段只局部移除；保留其它标签、SQL、来源绑定及偏好，不因读回退自动保存。

首个合同提交为 `0eee9e00f410c2ea63e160628f5d0b103c5e82dd`，仅供UI任务先固定接口。后续本片已接入现有settings.save：Main的validateCommand先对原始自有字段执行共享门，严格schema同样执行共享门；直接LocalStore.saveSettings也执行同一门，未知IPC字段继续strict。没有新命令、依赖或认证材料。

配置库当前版本在此后续分支升8，因为旧0.22严格settings合同不识别新tab字段。旧schema7只是原子提升版本，保留11张旧表的内容，不迁移或重写settings JSON；未知未来9在写盘前拒绝。写盘失败沿原事务/内存快照及临时文件替换回退，旧文件仍是7，可以消除故障后重试。旧非终态任务和回执仍按原既有启动恢复规则收尾；无新增恢复或SQL重放语义。回退到0.22须恢复升级前配置备份，不能把user_version改小绕过。

验证：20项纯合同通过；另9个定向存储/兼容文件唯一77项最终逐项全部通过（首轮临时目录EPERM及新增夹具传参错误后，仅修环境/夹具并针对未通过项复核，不重跑已通过项）。覆盖真实Main设置分支、严格IPC/直接存储、逐标签重启、坏读局部回退不写回、全部11张旧表逐表比较、旧7迁移失败/重试、未来9原文件保持，以及布局写入不改变现有连接/工作台/方案CAS和失败高度不夹带。一次tsc --noEmit通过；该检查后仅新测试改正了误带的select.id参数，产品文件未再改动。没有执行full/build/GUI/实际业务数据库/网络/.env/SSH/Docker/剪贴板；E2E版本期待仅兼容适配，未执行E2E。

必要旧夹具只把当前版本期待7改8、明确未来造数8改9及相关测试标题/注释同步；SQL、记录比较及原断言数量均保留。历史0.22文档、package版本、renderer QueryTab和Root工作区未改。
