# 历史分页原用例的退出观察

固定基线：`ff462366e2f7fbba06ced95e1048aa4404da68eb`。只为 `history-pages.spec.ts` 原“历史真实IPC取消、切换、关闭和重启释放资源且筛选条件不写本地配置”用例补观察，不修改产品、版本、工作流或覆盖总表。

## 开启及输出

原用例通过派生的 `observedExitTest` 显式设置 `historyExitObservation: true`，保留 `trace: 'off'`。夹具默认值为 false；模块导入、默认用例和 `--list` 不建立记录器或产生新文件/附件。实际开启还核对原文件、原标题和关闭录制；这些内容仅作内存门控，不进入附件。

本例结束时使用原 TestInfo 附加 `history-exit-observation` JSON。每条事件包含本例递增序号、相对毫秒、主体或 teardown 阶段、固定事件名及本例应用序号；没有绝对时间、PID、路径、SQL、输入正文、标题正文、环境或凭据。最多记录 96 条事件、8 个应用，超限计入有界 dropped。阶段终态另有固定布尔摘要，避免事件饱和后误把清理当主体成功。

记录器在每个原 await 前捕获归属。原目标用例的 seed、退出和重启显式携带原 TestInfo；嵌套请求沿用捕获的观察上下文。晚到事件、回包和附件不能借用下一用例的记录器，下一默认或严格用例开始时也会失效旧观察世代。此归属只约束记录，不更换原退出目标或增加执行门。

## 覆盖与缺口

| 节点 | 观察方式 |
| --- | --- |
| 原退出请求进入、返回或失败 | 原 `requestQuit` 调用前后同步标记，不新增 RPC。 |
| will-quit、quitReady | 原 main `will-quit` console marker 到达既有 fixture 回调时标记，并记录原 ready Promise 被 resolve 的位置；不是新增 main 监听。 |
| 原 close 等待及 race 返回 | 在原 12 秒 waitForEvent 创建前和原 race 返回后标记。 |
| desktop.close 进入和返回 | 原调用前后标记；返回不等于已经收到 close。 |
| close | 原 fixture close 回调中的事实。 |
| 原生对话框回答 | 原 fixture 已经收到的 console 回答映射为 pending-work、shutdown-error 或 other，仅保留 0–31 选择编号；异常编号记 null。 |
| 主体与 teardown | 主体结束先封边；原 teardown 开始、走完或抛错分别记录，不用清理退出补写主体成功。 |
| persist-state 请求 / settings.save ACK | **未覆盖**。没有可直接借用的既有公开观察事件；不包装 Main handler、不拦截 IPC、不增加 RPC 来补采。 |

附件仅保存固定分类，不保存对话框 message/title/buttons 或错误原文。因此看到 shutdown-error 也不能单凭此附件区分状态保存超时、存储失败或其他资源收尾错误。缺少某个事件只说明未观察到；事件被丢弃、调试通道断开或运行未完成时不能推定应用处于哪个具体状态。

## 行为保持

原 12 秒 close 超时、退出顺序、原断言、默认返回工作台选择及既有 teardown/兜底保持。没有新增退出延时、重试、强退、清理、进程探测、录制或产品行为。仅附件写入另有 1 秒观察预算，不延长退出等待；拒绝或预算内未确认只写固定测试注记，不能覆盖原用例或原收尾错误。迟到附件仍绑定原 TestInfo 的冻结字节，失败已被观察，不会写入下一例。未修改公共 Main handler，也没有增加任何产品 RPC。

冻结 Windows 首败及原归档仍不能确定根因。该观察只是为 Root 后续统一检查点补齐阶段证据，本片没有启动新 CI 或执行原生测试。

## 离线验证

定向 RAM 测试覆盖默认零访问、启用门、事件/应用上限、隐私白名单、阶段区分、附件失败原错误、TestInfo/应用迟到隔离；抽取正式退出函数在 RAM 边界运行，核对原 RPC、12000 毫秒等待、desktop.close 和原 5000 毫秒 PID 断言的调用顺序。PID 列表为空且探测替身禁止实际调用，没有运行任何进程探测。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/history-exit-observation.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

本轮结果：上述定向 RAM 文件 15 项通过，0 失败、0 跳过；完整类型检查退出码 0。先行检查与最终 15 项重叠，不累加。

未执行 Playwright（包括 list）、GUI、安装、数据库、Docker、服务、端口、剪贴板或新 CI。RAM 结果不能证明此次 Windows 根因，也不能证明原生 console/close 的实际交付顺序；这些仍需 Root 审查整合后统一验收。
