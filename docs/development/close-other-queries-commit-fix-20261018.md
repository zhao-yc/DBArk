# 关闭其他查询的真实提交与请求租约窄修（2026-10-18）

## 固定范围及原反例

基线为 `7142cb0c2a6a9b56f37523d8efc671b1310067e1`。新普通克隆：`D:\svn\DBArk\.cache\parallel-20261015\employee3-close-other-commit-fix-20261018`，独立分支 `codex/employee3-close-other-commit-fix-20261018`。未修改 Root、员工4独审或原员工3目录，未使用工作树，不尝试推送。

员工4原反例逐字节复制到本克隆 ignored `.cache/employee4-close-other-review`，只选择三个原红复现：直接关闭后的第二项请求、保存后关闭后的第二项请求、旧 A.failed 停错同队列 B。固定基线实际结果为 0 通过、3 失败、5 跳过。原文件和报告保留，未修改反例或断言。

- `component.test.tsx` 原件 SHA256：`22d1b2deab40285c1e222d1628bf707beb6f20ae49fd5fa9cbe1892ca0329270`。
- `ownership.test.ts` 原件 SHA256：`c100af6a29223d54909ad95c570b545474a6b1a899de49c64219eb5697f72e71`。
- 本轮原红报告 SHA256：`eaf90c6b69501d45bd87bd755222bb202239286c249609e1008b5fcef1726691`。

前两个原红通过真实 QueryTab、Modal、ReactDOM、store 与提取的真实 App 函数复现：第一项关闭成功后，同步 advance 仍看见原 portal，原全局 modal 门拒绝第二项。第三个是直接调用旧 hook 的 API 契约反例，不表示已证明用户按钮可达。

## 产品窄修与合同

仅修改 `App.tsx` 和 `queryCloseQueue.ts`。QueryTab、QueryCloseDialog、原单标签保存/关闭状态机、结果区和全局 modal 保护均不改动。

`finish(request, true)` 只完成原请求和准确目标的移除；若还有下一项，记录原请求为 `awaitingCommit`，不立即发下一请求。App 保存 `{ queue, request }` 票据，在实际 `useLayoutEffect` 中确认：原请求已从本次渲染清空、该队列仍是 current、票据仍是该准确原请求，然后检查 document 全局没有任何 dialog，再调用 `committed(request, modalClear)`。原 portal 在 React mutation 阶段移除后才有此回执。新的外部 modal、未来目标或连接归属变化会停链；旧提交票据不能清掉新票据或继续下一项。

空查询仍沿原同步关闭，不需要等待没有产生过的 modal 提交；忙碌、事务、取消、部分关闭和来源保存守卫保持。没有忽略旧 dialog、放宽全局选择器、定时器重试或微任务抢跑。

`failed/mutate` 的签名不变，但每次发出关闭请求都有独立租约。回执消费时清除该请求租约，下一目标领取新的租约。旧 A.failed 不影响 B；旧 A.mutate 在检查 B 的目标之前就被拒绝，不得停错或接管 B。当前请求第一次失败仍粘性停批次；当前原弹窗可按原流程手动重试，成功只完成当前项，不恢复队列。

## 原件与修后对照的区别

原独审夹具没有 App 的新 layout effect，且其 API 夹具假设 finish 同步 advance；因此不能把缺少提交回执的旧夹具直接当作新协议验收。原件及三个失败原样封存。

新增 `query-close-app-commit-fixture.ts` 从真实 App 提取四个方法、真实按钮和准确 layout effect，在 React Harness 渲染时注册该原 effect。`ui-query-close-commit.test.tsx` 保留原两个 modal 反例的关键断言，实际 React 提交后第二项请求均出现；再补旧 hook API 对照、提交间隙新外部 modal、未来对象变化、首次失败后手动重试及真实重复保存互斥。

原 RAM 队列和 App 受控回包夹具只增加明确提交回执，旧断言保留；新增断言分别核对提交前不推进、当前请求仍存在时不推进、错误/旧票据不推进、旧 A 提交不能清掉 B 的票据、旧 A.failed/mutate 不停错 B，以及当前 B 的失败仍停止。RAM 回执不会冒充真实 React 提交，后者由上述组件窄验独立覆盖。

## 实际命令与结果

```powershell
node --require ./.cache/employee4-close-other-review/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/employee4-close-other-review/vitest.config.mjs -t '成功后应展示第二个原查询关闭请求|同一队列已推进B后' --reporter=json --outputFile=.cache/employee4-close-other-review/baseline-red.json
node --require ./.cache/employee4-close-other-review/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/query-close-commit-fix/vitest.config.mjs --reporter=json --outputFile=.cache/query-close-commit-fix/focused.json
node --require ./.cache/employee4-close-other-review/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/query-close-commit-fix/single.config.mjs --reporter=json --outputFile=.cache/query-close-commit-fix/single.json
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

修后窄验 40 项通过：真实提交组件 7、队列 RAM 14、实际 App 受控回包 10、原单标签 App 守卫 9。另以独立配置运行未修改的原单标签组件 23 项，全部通过；共 63 项定向通过。类型检查退出码 0，差异格式检查通过。未重跑93项全套。测试守卫没有网络、私料、密钥生成或产品原生模块加载；只允许编译工具链，可选网络盘查询被阻止。

窄验报告 SHA256：`16484a0cc7fa664025fb003cab5e3fb0545341106b20f6c541190ba1ebd26062`。原单标签报告 SHA256：`febfcc3cc45b74bdea0c981785d9439c558e70f3dc37ffb4f8aaa9284fc7274b`。

边界为 RAM、真实 ReactDOM/组件与源码 AST 接线、静态类型证据。未运行 GUI、真实数据库、full/build、凭据、服务器、Docker、SSH或系统剪贴板。保留精确本地追加提交供 Root 独审。
