# 查询复制正文桥基线窄修（2026-10-18）

## 固定范围

修复基线为 `ff4f0b2705cf038ec6b2126a0e1240678c1e1e9c`，使用新的普通克隆和分支 `codex/employee3-query-duplicate-flush-fix-20261018`。未修改 Root、员工4独审或原员工3克隆，未使用工作树，未向外部推送。

员工4交接报告的 SHA256 已核对为 `b0b3c63d8c36b400c2595f10493eaedced5388976dedd677ab9ad159397a70e4`。原反例文件按字节复制到本克隆 ignored `.cache/employee4-query-duplicate/core.test.ts`，SHA256 为 `6e6107f6fd22241bcd3ff0fb622136a3e1767db5da84fabd10c73b263e75eab1`；修复前后保持不变。

## 原问题与改动

当前 props 和调用方草稿同时更新为外部新文本，但正文桥尚未执行 sync 时，旧实现只比较两者是否一致，因此可能把旧模型全文通过 onChange 覆盖回外部草稿，再创建副本。固定基线下按原字节执行该反例，得到 1 失败、3 跳过，复现了原问题。普通 GUI 点击进入该时序窗口的可达性仍未验证；修复针对正文桥 API 的防覆盖保证。

本次仅修改 `editorContentBridge.ts` 的正文基线记录和 flush 前置检查：

- 每个模型 lease 保存最近一次 sync 已接纳的受控文本，以及最近一次通过 onChange 交付的模型文本。
- flush 读取时，当前 props 必须匹配其中一个基线或当前模型全文；尚未 sync 的其它外部新文本立即拒绝，拒绝发生在任何 onChange 之前。
- 原调用方草稿检查、模型版本与归属检查、只读检查继续生效。flush 只发布原模型正文，不执行 sync、不编辑模型、不改 Undo 或原生 readonly。
- 明确 sync 接纳新文本后可以重新发起复制；正常未交付 native 输入，以及已交付 native 正文后又出现新输入的路径仍可 flush。
- 旧桥清理不锁新桥及异步意图的归属逻辑保持原实现。

## 实际验证

原反例修复后按同字节运行：1 通过、3 跳过。额外只运行原独审的“有未交付native正文时”和“旧桥清理与原模型迟到销毁回调”两个必要对照：2 通过、2 跳过。新增 `tests/unit/editor-content-flush-baseline.test.ts`：4 项全部通过，覆盖外部新草稿与旧 native 输入冲突、sync 后重试、已交付正文基线以及 props/原生 readonly 拒绝。

命令如下，三次修复后测试合计 7 项通过，范围互不重复：

```powershell
node --require ./.cache/employee4-query-duplicate/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/employee4-query-duplicate/vitest.config.mjs -t '新props已提交而controlled sync尚未执行时' --reporter=json --outputFile=.cache/employee4-query-duplicate/fixed-original.json
node --require ./.cache/employee4-query-duplicate/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/employee4-query-duplicate/vitest.config.mjs -t '有未交付native正文时|旧桥清理与原模型迟到销毁回调' --reporter=json --outputFile=.cache/employee4-query-duplicate/preserved-original.json
node --require ./.cache/employee4-query-duplicate/outer-guard.cjs node_modules/vitest/vitest.mjs run --config .cache/employee4-query-duplicate/focused.config.mjs --reporter=json --outputFile=.cache/employee4-query-duplicate/focused.json
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

类型检查退出码 0，差异格式检查通过。报告与守卫均在本克隆 ignored `.cache/employee4-query-duplicate`；测试守卫没有网络、私料读取、密钥生成或产品原生模块加载，工具链的可选网络盘查询被拒绝。

未重跑作者36项、其它旧套件、full/build；未运行真实数据库、GUI、系统剪贴板、Docker、服务器、SSH或凭据操作。RAM端口计数不等于原生输入或 Undo 已验收。保留固定本地提交，供 Root 独立复核与整合。
