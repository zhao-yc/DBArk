# C02 SSH 测试路径辅助的精确文件身份

日期：2026-10-16。独立普通分支`codex/employee3-c02-ssh-file-identity-20261016`，直接基线为ROOT指定的`9b820af7cb08f978d8f580c1a1c6c5f9028cac25`。仅修改SSH集成测试路径辅助、其纯单元及本说明，不混入W03、捕获替换或其它候选。

## 问题及严格基线

员工2W03固定f0d9923的全量报告保留了3449通过、1个既有SSH路径测试失败：Windows lstat.ino可大于安全整数，旧注入original[field]+1可能仍等于原值。原诊断在员工2忽略缓存`w03-search-navigation-20261016`中保留；本员工只读该诊断和失败日志，未修改或重跑其候选。

复核发现路径辅助本身也以默认Number元数据比较解析前后的ino/dev，不能只修注入增量。新增四个严格反例使用相邻精确ID：

- 前值9007199254740995n、后值9007199254740996n，均大于2^53且真实相差1n。
- 两者转成Number均为9007199254740996，显式断言该别名条件。
- 按lstat调用的bigint选项分别返回对应元数据类型，覆盖身份文件/临时父目录的ino/dev全部四种情况。旧辅助四项均错误放行，严格拒绝断言实际失败；补强前4失败与30名称过滤跳过的JSON原件保留。

没有使用更大的Number增量，也没有删除、放宽或跳过原拒绝断言。

## 最小改动与保留边界

`tests/integration/helpers/c02-ssh-paths.ts`的解析前、解析后四次lstat均显式使用bigint:true，ino/dev直接以BigInt比较。普通文件/目录判定、末级链接拒绝、realpath实际祖先解析、原身份目录隔离、错误传播和返回值保持原契约。没有把BigInt再转成Number，也没有引入认证或资源权限变更。

原四个元数据注入保留相同用例名和拒绝期望，只改为读取BigIntStats并使用+1n；先断言注入值确实不同。新增严格反例还逐次核对四次读取都请求bigint，避免类型路径意外回退。

新增正向检查保留同一精确大ID时仍允许独立合法路径。另在本例自建普通文本/空目录中，解析期间将旧对象移动到本例保留路径，再创建新的文件/目录；先核源和目标绝对父边界，严格确认实际新旧inode不同，再验证路径门拒绝。旧对象未删除，防止编号重用影响复现。设备号跨卷变化使用四类精确元数据注入覆盖，没有创建挂载或操作其它盘。

所有文件仅是本克隆.cache下每例新建的普通文本、目录及本例内部junction；不读取真实SSH身份或.env，不产生密钥/证书，不启动网络认证或GUI。原危险祖先别名必须在建连前拒绝，安全别名仅抵达明确失败的连接桩，原SQL/UI回调仍不得执行。

## 实际纯验证

| 阶段 | 实际结果 | 忽略缓存证据 |
| --- | --- | --- |
| 新四反例、旧路径辅助 | 4失败、30名称过滤跳过 | baseline-strict-results.json |
| 首次修复后普通沙箱 | 25通过、9失败；9项均为创建本例junction的EPERM | paths-fixed-results.json |
| 允许创建本例junction后，原样相关5文件 | 124通过、0失败/跳过 | related-elevated-results.json |
| 其中SSH路径文件 | 34通过，包括原26项与新增8项 | 同上 |
| TypeScript | 退出0 | 本轮工具输出 |
| SSH默认关闭用例列表 | 原1项，退出0 | 本轮--list输出 |

EPERM原件未覆盖。复跑未修改junction断言、跳过条件或期限，只使用允许在本例临时边界创建junction的执行上下文；没有把沙箱外执行称作管理员权限或服务器实跑。

实际命令，两道SSH运行开关及mTLS开关均显式关闭：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/c02-ssh-paths.test.ts --testNamePattern='精确身份严格反例' --maxWorkers=1
# 上一命令在辅助修改前执行，保留严格失败原件。
node node_modules/vitest/vitest.mjs run tests/unit/c02-ssh-paths.test.ts tests/unit/c02-ssh-policy.test.ts tests/unit/c02-mtls-fixture-policy.test.ts tests/unit/c02-mtls-ui-policy.test.ts tests/unit/c02-desktop-exit.test.ts --maxWorkers=2
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/c02-ssh-live.spec.ts --list
```

相关文件分别通过34、35、27、10、18项。全部为本机纯测试；未运行GUI、200、SSH、剪贴板、Docker、工作树、build或W03全量。生产认证、C02退出/资源权限、ROOT源码及旧候选没有改动。ROOT后续按独立固定提交核验，不能把本次纯测试换算成新SSH实库通过。

本员工证据根为.cache/c02-ssh-file-identity-precision，保留旧W03诊断副本/原件哈希、严格基线、EPERM轮次及最终通过JSON；verification.json记录固定提交、四项前后结果及Git状态。原W03失败、原捕获预算和d45候选继续冻结。
