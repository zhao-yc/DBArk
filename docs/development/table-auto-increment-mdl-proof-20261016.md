# 下一自增值取消用例的MDL观察证据补强

日期：2026-10-16。独立普通分支`codex/employee3-auto-increment-mdl-proof-20261016`，直接基于冻结候选`3125405e1a2383a848e027e6464220660dd0b7b3`。仅增加测试观察、纯匹配辅助/回归及本说明；不修改引擎、权限、原候选或旧结果。

## 新增证明

原取消用例等待ddlSubmitted事件后就发取消，该事件只能证明客户端已进入发送阶段。本片在同一个原15秒vi.waitFor中保留该断言，并在取消之前通过原observer执行SHOW FULL PROCESSLIST，必须同时满足：

- 线程ID是tracer记录的本例线程，且不是observer自身；只接受精确正安全整数表示。
- Info与本次next.sql完整一致，仅统一末尾空白和一个末尾分号，不做前缀、内部空白或关键字改写。
- State严格等于Waiting for table metadata lock，匹配恰好一行；零行、多行或重复行均不能宣称观察成功。
- 查询前后本任务均没有failed/succeeded/cancelled终态或ddlCompleted=true。先结束或始终无法观察到MDL都使原用例失败，不补记状态，也不提前宣称取消成功。

新观察日志只有五个字段：白名单端口、任务ID、本例线程ID、明确状态及已观察布尔。未取得完整证明时已观察为false、状态为null，未匹配唯一本例线程时ID也为null；不输出PROCESSLIST原行、Info、next.sql、连接对象或口令。辅助不接收日志SQL或凭据，不新增权限，不直接执行任何KILL。

## 原流程保持

取得证明后仍执行原query.cancel，以及原错误实例、ddlSubmitted/ddlCompleted/outcome未知、计数未变和令牌不重放断言。原外层finally的ROLLBACK/等待pending、afterAll的closeAll、ROLLBACK、线程核零、精确DROP及observer严格关闭均保持字节不变。

没有增加第二个等待预算、延长期限、修改原6个用例名或增加重试。若观察失败，原finally仍负责释放本例事务并等待真实终态；用例保持失败，不因清理后ALTER可能完成而把结果改记为已证明MDL取消。

静态逆向检查只移除新增import、观察变量和新观察块，并放回原等待语句，就能逐字还原312的完整核心文件；原等待15000毫秒仍恰好一处。该证明同时覆盖原取消/未知/计数/不重放断言、finally、afterAll和其它用例没有改动。

## 本次纯验证与边界

新增20项纯检查覆盖数字/字符串线程ID、排除observer及未记录/非精确ID、完整SQL与末尾归一化、明确状态、唯一性、任务先终态/DDL先完成和安全诊断字段。它们使用合成PROCESSLIST行验证匹配规则，不是服务器MDL观察证据。

- 相关5文件111项通过，0失败/跳过；包括原自增Engine、main、UI政策和混合保护。
- TypeScript整仓检查退出0。
- 双门关闭的Vitest核心list退出0，活跃列表为空；静态确认原6个用例声明保留。默认关闭的Playwright UI列表仍为原3项，退出0。
- 列表命令的DBARK_TEST连接环境字段先从子进程环境清除，不读取真实凭据文件；两道实际访问开关为0，没有连接或执行自动GUI夹具。

实际命令：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/table-auto-increment-mdl.test.ts tests/unit/engine-table-auto-increment.test.ts tests/unit/main-table-auto-increment.test.ts tests/unit/table-auto-increment.test.ts tests/unit/table-auto-increment-mixed-app.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs list tests/integration/engine-table-auto-increment.integration.test.ts --config vitest.integration.config.ts --json=.cache/auto-increment-mdl-proof-20261016/integration-list.json
node node_modules/@playwright/test/cli.js test tests/e2e/table-auto-increment.spec.ts --list
```

全局DBARK_INTEGRATION_ENABLED与专项DBARK_TABLE_AUTO_INCREMENT_TEST均关闭。没有GUI、200、实库、CI、Docker、剪贴板、工作树或build，也未读取身份/.env。当前没有新的真实MDL通过结果，原312兼容记录和原候选保持冻结，交由ROOT在实跑前审查本单独增量。

本员工忽略证据目录为.cache/auto-increment-mdl-proof-20261016，保存原核心文件/hash、static-proof.json、related-results.json、默认关闭列表和verification.json；static-diff.patch为312到新固定提交的完整静态差异。
