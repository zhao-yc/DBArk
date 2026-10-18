# R5启动观察模块的Playwright加载修复

基线：`2ca278db1da956d09782e0223234d7cbf4c66746`。

## 原始故障

run1803 Windows、run1803 macOS x64和run1804 macOS arm64的原归档均显示：源码缩进专项在加载 `editor-native-startup-wire.ts` 时发生 `SyntaxError: Cannot use 'import.meta' outside a module`。报告 `suites` 为空，随后出现 `No tests found`。导入栈为缩进专项 → runtime → `editor-native-startup-diagnostics.ts:3:1` → 启动观察模块。尚未进入原生执行，不能据此判断Canceled修复结果。

模块中的 `createRequire(import.meta.url)` 即使位于未调用的函数内，也会使Playwright按CommonJS转换后的文件在解析时失败。现有Vitest按ESM加载的RAM测试和TypeScript `ESNext` 类型检查都不能覆盖此差异。

先在独立普通clone、全部集成和原生专项门关闭的环境中，通过安装的Playwright 1.64.0正式转换器 `playwright/lib/common.transform.requireOrImport` 直接导入diagnostics，重现相同语法错误，退出码1。原归档仅按ZIP目录和文本读取，未执行其内容。

## 最小变更

仅将该模块的依赖解析锚点改为 `createRequire(join(process.cwd(), 'package.json'))`，沿用项目既有CJS/ESM兼容方式。正式 `native-editor-ci.mjs` 明确以批准项目作为cwd；旧文件URL锚点与新项目锚点在当前依赖树中解析到同一 `@playwright/test` 及 `playwright-core/package.json`。

保留原先通过 `@playwright/test` 查找SDK元数据的解析链、精确1.64.0版本门、同进程toImpl映射、collector指纹和失败合同。SDK读取仍只发生在观察函数明确调用时。观察函数起至文件末尾的R5原文SHA-256保持 `82429ac364e1c8ba419e741ae0ab1e3c44125ce887bc287e8a140849ae8bb867`。

没有修改产品源码、专项入口、权限门、断言、观察开关、120秒专项期限、45秒全局期限、原37await/55guard、内存或附件预算，也没有调整依赖、版本和工作流。

## 验证

- 新增4项模块回归：真实依赖解析路径对照、R5观察原文摘要、Playwright正式CJS转换器加载runtime/diagnostics/wire、独立ESM加载wire。
- CJS和ESM均不注入SDK加载替身，实际进入修复后的fixedSdk，读取真实1.64.0元数据并通过真实collector方法指纹；仅原应用映射和事件流由RAM提供。核对早期标记、持续流、console、封存及监听移除。
- 模块加载子进程明确封闭Electron、子进程创建和网络入口，原生及网络入口调用次数均为0；没有运行SQL或读取用户数据库。
- 17个直接相关单元测试文件232项通过，包含原runtime、权限、等待点、预算、归属、分栏和CI纯合同；`tsc --noEmit`退出码0。
- 仅两个正式专项通过Playwright `--list`，共2文件2项。列表门按原合同跳过runtime；不能将其单独作为本故障修复证据，因此另有正式转换器直接加载的正反对照。

实际列表命令（全部专项门为0，integration为0，清除外部预加载/实库/认证环境）：

```powershell
node D:\svn\DBArk\node_modules\@playwright\test\cli.js test tests/e2e/editor-indentation-native.spec.ts tests/e2e/query-layout-native.spec.ts --list --workers=1 --retries=0 --trace=off
```

本轮只验证本机Windows的模块加载及纯合同，没有启动Electron、应用、实库、端口、剪贴板、Docker或新CI。macOS原生启动及Canceled问题仍需Root后续实际运行验证；本修复不将“可加载”计作原生通过。
