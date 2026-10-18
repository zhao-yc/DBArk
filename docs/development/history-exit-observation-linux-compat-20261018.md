# Linux RAM 夹具的退出观察兼容

修复基线为 `9057178829b892b6e820337e1b8341ba6e548758`。R4 Linux job `117612660943` 的冻结日志是 JSON 字符串，只作为数据解析；SHA-256 为 `5e32ea4413484b4cb8f50e98cd1e3e4974026cf29627a57a9c3e3283c76d3db5`。原运行统计为 499 文件、9119 通过、52 失败、10 跳过。

## 根因与改动

冻结日志完整列出四个失败文件：`truncate-exit-preserve.test.ts` 31 项、`batch-record-duplicate-gate.test.ts` 7 项、`batch-record-duplicate-prepared-launch.test.ts` 9 项、`column-collation-installed-launch-gate.test.ts` 5 项。观察调用新增后，这些提取真实夹具函数的旧 VM 漏注入 `assertHistoryExitObservationScope`、`beginHistoryExitObservation`、`historyExitObservationFor`。入口 ReferenceError 使原启动和墓碑登记没有发生，随后出现状态 undefined、调用次数失败和等待超时。

四个 VM 只补接现有真实观察 helper，没有提供空函数替身。仅补端口时原 65 项中 64 项通过，余下是旧源码锁定检查。原断言取自动夹具第一条语句作为 strict 分支；新增的观察前置检查占据首位，导致切片位置错误，出现 `fa8f...` 对旧 `b828...` 的失败。现在按条件表达式准确定位 strict 分支，同时保留旧源码和原哈希，先完成去观察 AST 证明，再锁定已核对的新原文。

## 观察差异的独立证明

冻结观察前提交 `ff462366e2f7fbba06ced95e1048aa4404da68eb` 的 12 个片段为数据，保留来源提交和字节哈希。`historyExitObservationCompatibility.ts` 只撤销固定且恰好出现一次的观察片段，比较保留所有节点种类、字面量和子节点顺序的 AST；不执行冻结文本，不使用宽泛删行规则。

- `launchDesktop` 新增记录器获取、应用编号、close/console事件观察；原对话框 JSON 仅增加局部变量以便分类，原回答和 ready 调用保持。
- `requestQuit`、`quitDesktop` 新增记录器与捕获应用、固定事件、观察参数透传，以及记录后重抛同一错误的 try/catch。剥离后原退出 RPC、ready/close 等待顺序、12000/5000 毫秒期限及 PID 判断 AST 与旧实现相等。
- 默认自动夹具新增 begin/teardown/finish 观察、观察参数透传和原清理外层 finally 包装。剥离后原退出、forceStop、目录边界检查及 rm 顺序 AST 相等。
- `forceStopOwnProcess`、`launchPreparedOwnedDesktop`、`confirmOwnedDesktopExit`、`quitOwnedDesktop`、`bindOwnedDesktopExit` 和整个 strict 分支的原文字节及 AST 均与观察前基线一致。生命周期权限没有放宽。

旧默认片段哈希 `b8284b726f3cf8cf347b0e483ad162115ea1b57369eb492f99410b7f5ed37cd4`、旧退出函数哈希 `70ef0597565cd839b2b6c65db33fee9e26c25f8e8260851f860dbed909e75920` 继续保留。准确定位后的新默认片段为 `8102ec2b9f91456352a9581230fbd75512737f70fba56788017103905d8ce469`，新退出函数为 `1b9f2104406ba9952132a890871a8f41999901061d890250de27902458b87a93`；新锁定只在 AST 证明后检查。

新增八项内存源码反例，改变退出期限、强杀前置条件、准备启动归属门、真实 close 确认、默认/strict 清理目录边界、清理动作或 request/ready 先后，均在 AST/精确观察片段检查时拒绝，不能靠更换新哈希放行。

## 验证与边界

仅运行原四个失败文件、既有观察 16 项及新增兼容证明 9 项，共 6 文件、90 项通过；原 65 项全部恢复。类型检查通过。原产品文件、正式 E2E 夹具及观察 helper 保持固定基线原文；其它原测试声明逐项核对未改，只有旧源码锁定项适配为先独立证明再核旧证据。

没有延长期限、跳过失败、放宽断言或修改产品。没有启动 GUI、Electron、数据库、SSH、Docker、端口、剪贴板或 CI；没有重跑旧全套，没有触碰旧 1556 范围。Windows 的原生 Canceled 首败由另一个任务处理，本修复不解释或替代它。新的 Linux CI 由 Root 统一开启。

可复现命令和原失败/中间收敛/最终通过日志哈希见本克隆 `.cache/linux-observation-compat/handoff.json`。
