# 7410f68 CI：Linux通过与Windows安装首次模型失败

准确提交 `7410f68ee4a052c65dcff02c1543076fc0fd8b8f`，工作流[39648093195](https://github.com/zhao-yc/DBArk/actions/runs/39648093195)。这是排序草稿快捷键及读取器修正的基线，不能覆盖后继e257筛选保护或2cdf网格快捷键。

## 已核日志及原件

Linux作业119388893137成功：类型、612文件11692通过／10条件跳过，238.80秒，Vite33.41秒。Windows作业119388893602的源码legacy为80通过／322跳过、7.0分钟；安装步骤失败。未重跑或降低门槛。

Windows测试ZIP原件12368667519：2729406字节，SHA256 `e65e8de1fd9c2cc4f5852a5e0923dc9d0c16a32f82789ad5dd4b9111495da954`，与GitHub元数据digest一致，独立Python核CRC无坏项。保存在本机忽略目录 `.cache/ci-741-artifacts-20261022/12368667519.zip`，只读解包分析，没有执行附件或重新安装包。

原 `native-file-first-model-ci/source/report.json` 为4通过、0跳过／失败／flaky；安装同项report为3通过、1失败、0跳过／flaky，60801.448毫秒。原installed/started.json绑定的清单SHA256 `a396b180313aa44a9a73102a6b63024faf2fb572d78799846988ce9422e7b5be` 与ZIP内真实清单字节摘要相同。其它专项及安装legacy未在此做完整原件核对，不给本轮安装整体通过结论；macOS原件另行回收。

## 准确首错

安装版“CRLF首次文件模型：普通编辑Undo、格式化快捷键UndoRedo及独立重启”失败于 `editor-indentation-native-gate.ts:57` 的clock-reversed分支：start1792606221706，instant1792606235025，previous1792606235026，deadline1792606341706。两次已记录墙钟相差-1毫秒；失败栈处于launch身份检查，不能据此证明后续格式化断言已执行。

原门使用Date.now并拒绝时间回退，当前诊断证明其拒绝分支及已捕获标量，不证明Windows时钟回调的具体外部原因。原failure.json明确automaticRetry=false、automaticForceStop=false、cleanupAllowed=false；失败资源不补清理，不将另外源码窗口成功追认为此安装用例通过。后继需单独处理计时与真实安装验证，保留原120秒和原身份约束，暂不发布。
