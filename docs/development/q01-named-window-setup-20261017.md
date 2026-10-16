# Q01命名窗口验收准备：观察器的文档世代

基线：`586ae3252a4aa9d762f130d41991e87278d3d7ac`。独立普通克隆及分支：`codex/employee2-q01-named-setup-20261017`。

Root报告原run1088的B082两例均因“page.evaluate: Error: 未安装真实光标观察器”失败。原记录位于Root忽略目录 `.cache/parallel-integration/run1088-v020-installed-full/B082/test-results/`，保持原失败，不用本次RAM测试抵扣或改写。

原因是named-window的observe先调用共享caret.observeMonacoCaret。共享helper在其reload后的当前文档内用page.evaluate安装光标观察器；随后named observe为Worker probe执行的原reload创建新文档，清掉光标观察器。故Worker probe存在，正式trigger的光标守卫仍报未安装。

最小修复仅移动原调用：先安装q01 probe的addInitScript，完成原reload和statusbar等待，再调用共享caret.observeMonacoCaret。共享helper的另一次原reload会重放probe初始化脚本，之后把光标观察器安装到最终当前文档。总reload仍为2次，没有失败后补装、重新定位、重放或retry。

原两项定义的标题、期待、Worker元数据及能力证据、150秒用例期限、13秒补全及5秒子预算、原六组合范围和12个剪贴板只读采集阶段均未改。共享caret、产品代码、Root旧控制及run1085全部未改。

新增 `tests/unit/named-window-observer-generation.test.ts` 两项RAM反例，提取并执行实际named observe、共享caret observe及正式trigger的首个page.evaluate守卫。reload使用全新VM文档，只有addInitScript重放，page.evaluate安装的监听器不跨文档存活：旧序在文档1安装、到文档2丢失，原守卫报相同错误；新序在文档2安装，两个监听器并存，原守卫可以布防。模拟浏览器/IPC边界不是GUI、真实按键、补全内容或原生剪贴板验收。

本轮命令与结果：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/named-window-observer-generation.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-named-window.spec.ts --list --reporter=json
```

两项定向RAM测试通过，类型检查退出0；集成门与命名窗口门的四种组合列表均退出0，发现原两项、期限150000ms、results全空。列表原件在本克隆 `.cache/named-setup-evidence/`。

没有重跑33/5073旧测试，没有构建产品，没有GUI、200、系统剪贴板或手动CI操作。实际两项复验仍由Root另建run完成，原run1088的296项通过和B082失败原件不变。
