# 完整补取修正：同坐标选择令牌一致性

基点为 `127f04fd4479d1cd4f138314eadbe313f9221f63`，普通克隆专用分支为 `codex/employee1-copy-selection-notification-fix-20261016`。开始时工作区干净、HEAD 与上游一致，先 fetch 再从固定基点创建分支；没有使用工作树或修改其它克隆。

ROOT 的 run833 五项原批为四通过一失败、CLI 1，失败发生在 INVISIBLE 完整补取后没有新增草稿；原失败、图片和后核保持原归属。本轮没有运行真实 GUI、200、系统剪贴板、Docker 或 CI，不将纯测试结果记成原五项通过。

## 拒绝条件与修正

`selectCurrentCell` 对相同 `rowId/key` 通知仍创建新的 `selectionRef` 对象；原函数式 `setSelection` 遇同坐标却返回旧 React 状态对象。这样同步引用与状态内容相等、身份不同。开始补取捕获新引用后，自有忙碌渲染执行原 `selectionRef.current = selection`，会把旧状态对象回写，令 `consumeRecordCopyRead` 的 `selection !== intent.selection` 拒绝成立。

本轮真实处理器回放定位了该引用拒绝：意图没有 invalidated，行数组/行/目录/版本/代次/来源引用及旧值均保持，实际消费收到的选择对象却不是捕获对象。该路径与员工2固定127独立反例一致；原生事件的实际终态仍由 ROOT 原五项复验确认。

产品只修改 `selectCurrentCell.activate`：有效同坐标复用同步令牌，真正新坐标创建新令牌，并将同一个对象同时发布到同步引用与 React 状态。真正行/列变化仍在忙态、模态判断前永久撤销旧意图；无效坐标仍同步清除选择。没有放宽消费端比较或改变取消、到期、旧值、目录和来源判断。

静态反向比对证明：把新的 activate 块恢复为原块后，整个 `TableTab.tsx` 逐字等于127。`recordCopySource.ts`、引擎来源实现、contracts、validation 和原正式 UI 文件逐 blob 保持；原五项补取期待、标题和期限不变。

## 最小反例与回归

新增正式测试直接抽取产品 `selectCurrentCell`、DataGrid 两个真实回调、原 ref 同步语句及实际 begin/consume/read 处理器；仅替换 React、DOM 存在性与 IPC 端口，不改结果或守卫。

- 修改产品前，固定127的四个同坐标正例失败，三个真实选择 ABA 负例通过，其余25项因定向过滤明确未执行。原产品 blob 和原失败报告保留。
- 修正后新增九项：新坐标发布同一对象、两个入口重复同坐标、两个自有占门提交调度、原 ref 同步回写调度，以及换行/换列/清空后恢复的永久失效。取消仍只发送一次。
- 选择相关正式文件最终34项全过，原25项目录/来源回归正文逐字保持。原页替换 ABA、来源到期、并发旧值、元数据和输入等测试文件未改。

员工2原反例只读复制到本员工忽略缓存并记录 SHA256；其原两通过一失败结果没有改写。该原件含旧缺陷前置期待，不冒称原件在新代码上原样三项通过；本轮正式回归使用正确的安全期待。

## 验证结果

| 项目 | 实际结果与边界 |
| --- | --- |
| 扩大正式单元 | 229文件联合覆盖4,482个唯一用例。初次整套4,481项中4,472通过、9项测试自建junction受沙箱EPERM限制；同文件34项重跑全部通过。收到独立调度反例后仅补一项正式回归并复验整个选择文件34项，没有重复跑整包或重复计数。 |
| 明确排除 | 按本轮限制，未运行生成内存临时私钥的 `tls-credentials-engine.test.ts`，不宣称完整无排除单元。 |
| 类型 | 最终冻结代码 `tsc --noEmit` 退出0。 |
| 构建 | 本克隆 `node scripts/build.mjs` 退出0，Vite 41.51秒；保留大chunk提示，未打安装包。 |
| 界面列表 | 317项、列表错误0、实际执行0；原完整复制五项仍在，源码/期待/期限不改。 |
| 列表守卫 | 原生/子进程实际放行、网络及私有文件读取均0；阻止一次Node平台探测，列表仍成功。 |

联合单元统计按文件替换正式重跑结果，原报告保持原样。机器证据在本员工 `.cache/copy-selection-notification-fix/`：`before-fix-results.json`、`before-fix-proof.json`、`targeted-results.json`、`broad-initial-results.json`、`junction-retry-results.json`、`selection-final-results.json`、`reconciled-unit-summary.json`、`preservation-proof.json`、`ui-list.json`、`collect-guard.jsonl`、`typecheck.log` 和 `build.log`。

127原src/dist摘要已保存，原108个dist文件在 `base-dist/` 备份并逐文件校验。新构建的339个src、108个dist文件清单和摘要分别为 `final-src-manifest.json`、`final-dist-manifest.json`。没有覆盖 ROOT run833 现场或员工2原反例。版本仍为0.18.0，其它功能来源及旧验收归属不变。

实际命令（工作目录为 `D:/svn/DBArk/.cache/parallel-20261015/w02-workbench`）：

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/copy-selection-notification-fix/vitest-targeted.config.mts --reporter=json --outputFile=.cache/copy-selection-notification-fix/targeted-results.json
node node_modules/vitest/vitest.mjs run --config .cache/copy-selection-notification-fix/vitest-broad.config.mts --reporter=json --outputFile=.cache/copy-selection-notification-fix/broad-results.json
node node_modules/vitest/vitest.mjs run tests/unit/c02-ssh-paths.test.ts --config .cache/copy-selection-notification-fix/vitest-broad.config.mts --reporter=json --outputFile=.cache/copy-selection-notification-fix/junction-retry-results.json
node node_modules/vitest/vitest.mjs run tests/unit/record-copy-metadata.test.ts --config .cache/copy-selection-notification-fix/vitest-targeted.config.mts --reporter=json --outputFile=.cache/copy-selection-notification-fix/selection-final-results.json
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node --require ./.cache/copy-selection-notification-fix/collect-guard.cjs node_modules/@playwright/test/cli.js test --list --trace=off --reporter=json --output .cache/copy-selection-notification-fix/ui-output
```

最终固定 SHA 由包含产品、正式回归和本文的单笔提交给出，只推送本专用分支。ROOT 仍需在该精确源码/构建上复跑原完整补取五项；本轮没有宣称 run833 已由真实界面修复通过。
