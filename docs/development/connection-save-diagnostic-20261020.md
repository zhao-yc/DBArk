# 保存连接：单次被动观察

## 已知事实

固定产品 `88d5d469706800ea5a974bbbff7d213b1ded0096` 已在WIN11-TEST通过类型、12文件270项定向及构建，157.87秒（52.03／28.01／77.80秒）。原四条Electron用例为2通过／2失败，零重试、原生进程退出1；未继续完整单元。两失败位于原spec42行，保存连接后弹窗在原5000ms内未关闭；公开表单字段正确，现存快照未提供保存按钮状态，stderr／console为空，**根因未定**。不把它推断为引擎冷启动、输入或验证错误。

通过的是取消／无效文件及真实IPC并发修改两条路径。前批f173f41的同名region失败、88的准备步骤失败及此前已通过的完整集合分别保留，不能相互替代。88原生JSON的VM校验值为 `92945a4c642ec2851ff8c54939feb1595b7f173081e5b2cc3ee7ed84d64ea15e`。

## 本分支观察范围

任务分支 `codex/connection-save-diagnostic-20261020`，基于88，只修改原有 `snippet-transfer.spec.ts` 的 `openLibrary` 准备步骤和本说明；产品、依赖、构建、原退出夹具及单元不变，不新增测试helper、宿主、服务或框架。

- 原生点击／submit监听只记录时间、trusted和是否阻止默认行为，不发出合成事件、不阻止默认行为或调用保存。
- Main只旁观原 `connections.save`／`connections.list` 的起止和成功标记，原处理器、输入和回包原样转发，不记录输入／认证／SQL。
- 原5000ms隐藏断言结束后，读公开的四个测试字段、有效性、按钮文字／禁用状态及错误框；密码等字段不采集。读取同一窗口的原观察器后恢复处理器，附加 `connection-save-observation` JSON。
- 归属不明或诊断本身失败保留原异常和所属资源；不强停、补关或清理。观察代码可能影响时序，因此一轮通过也不能证明原偶发失败的根因或代替正式验收。

## 只在指定VM执行

先核上一批终态、干净且无任务进程，固定本分支完整SHA，并确认 `git diff 88d5d46 -- src package.json pnpm-lock.yaml scripts build tests/e2e/desktop-fixture.ts tests/unit` 为空。复用该克隆上一轮88的实际构建，不重建产品或重跑270项／完整集合。

新用例代码单次类型检查，通过后用同一grep列表核一项，再执行仅原第一条，默认45000ms、一个worker、零重试；不改变原5000ms断言或重复执行：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/snippet-transfer.spec.ts --grep '片段导出经过父弹窗未保存确认' --list
node node_modules/@playwright/test/cli.js test tests/e2e/snippet-transfer.spec.ts --grep '片段导出经过父弹窗未保存确认' --workers=1 --retries=0 --reporter=json --trace=off > .cache/connection-save-observation-native.json
```

保留原始JSON、stderr、观察附件及SHA256，回报固定SHA、工具、实际命令／退出码／耗时、同一窗口／PID收尾；若保存成功，另行标明原失败本轮未复现。不借本观察运行其它测试、改变系统配置或扩大到数据库／SSH。

上一轮VM最新配置检查已确认标准hosts映射和DNS均指向192.168.31.200，13384单次TCP成功且socket已关闭；没有数据库认证／权限或实库证明。用户确认映射配置就在WIN11-TEST，旧的缺失观察只代表其原时间点。

## 单次实际终态（fcf0322）

开发会话已读回“dbark测试”的完成摘要：同一VM／账号／克隆，测试分支 `codex/vm-connection-save-diagnostic-20261020`、HEAD严格为 `fcf03228eac6201079fe79740ffd556a76e47c14`。单次类型退出0／40.73秒；同一grep列表退出0／1.42秒、只匹配1项；单次原生诊断退出0、1通过／零重试，8.74秒。复用88构建的109份文件哈希未变，未重建或重跑单元／其它原生用例。

观察附件的VM校验值为 `a53af594a25664665a253220b7c27308073aa529b0a2938dab3a3b70c33a742f`，原件尚未独立取回复算。附件时间线（上海）为：

- 11:25:17.701：真实点击和submit各到达一次。
- 11:25:17.702—11:25:19.222：原 `connections.save` 成功，1520ms。
- 11:25:19.223：原 `connections.list` 开始并成功结束。

读取时弹窗已经消失，字段／按钮／错误框数组均为空，没有失败期间的按钮状态。附件的 `prevented=false` 来自捕获监听及微任务读数，不能据此断言表单最终没有阻止默认行为；本观察没有修改事件。Main原处理器已恢复、无溢出、认证内容排除，工作区干净，严格退出通过、无所属进程残留。

原5000ms失败本轮未复现；1520ms包含整个Main保存路径，不能只归因于执行进程启动、SQLite或输入处理，也不能以本次诊断替代原正式四条验收。88的两条准备步骤失败和未执行完整集合继续保留，后续修复须另有依据与固定候选证明。
