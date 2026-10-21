# eb0ea00c CI全量单元：计划测试端口遗漏

准确 `eb0ea00c89589e47c230e82003d919f53306fa3b`，[工作流39654057462](https://github.com/zhao-yc/DBArk/actions/runs/39654057462)，Linux作业119409540959失败。原结果613文件中612通过／1失败，11707项通过／1失败／10条件跳过，原失败不重跑追认。

首错为 `ui-explain-plan-state.test.tsx` 的“真实新执行先清空旧计划，结果到达后仍显示新的普通结果”：VM渲染真实QueryTab结果表达式时，新增onHistoryTravel引用的travelResultHistory没有被该AST端口提取，导致ReferenceError。原栈在setBusy触发的渲染及runQuery路径，不是计时守卫或实际React组件内部缺少函数；该组件中的真实函数已经存在。

后继保留原源码抽取及全部原断言，把真实travelResultHistory加入抽取集合，提供准确的当前viewSource及未绑定history状态；追加调用两个真实回调方向，核没有整理绑定时不改变结果或新增SQL。不使用恒成功替身，不在产品中绕过回调或移除接线。

后继会话1363：类型26.93秒、五文件186项通过，总38.06秒、退出0，包含本端口5项、真实React排序／筛选148项、历史7项、单调时钟9项和原诊断17项。该定向结果不替代新的全量CI；eb0的Windows／ARM／Intel原生作业尚未在本记录消费原报告，另行回收。

连接器原返回文本完整封存为本机忽略文件 `.cache/ci-eb0-linux-119409540959-20261022.json`，214914字节，SHA256 `4fa45c2b5730820499beba3da4a803118c4ad09197ce364832185f665e5cfa19`。其中connectorText保持原返回155447字符；不将该JSON外壳摘要说成GitHub原始HTTP字节摘要。未修改既有失败，未发布。
