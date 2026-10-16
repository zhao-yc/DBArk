# Monaco 光标帮助器：空剪贴板与异常链修正

> 本文保留当时修正与验证记录。2026-10-16 后续测试实现已改为原生输入、真实按键时公开 API 位置证明和剪贴板只读核对，见[后续说明](monaco-caret-readonly-20261016.md)；以下恢复写回描述不再代表当前帮助器。

本次基于 `8199bf6ff914e3694206c8dfc93d5f0d43a5237e`，仅修改测试帮助器、专属纯回放单元和本文。不修改产品补全、Worker、候选、等待期限或跳过条件。

## 问题与修正

Electron 44.7.0 的原生 `clipboard.read()` 会构造一个条目，即使这个条目的 `types` 为空。此前帮助器保存快照时过滤无类型条目，但恢复后直接比较未过滤的数组长度：保存为零个可读条目，清空后读取为一个无类型条目时，即使剪贴板确实为空，也会报告恢复失败。可核对官方固定版本的 [原生 Read 实现](https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_clipboard.cc) 和 [JS 包装实现](https://github.com/electron/electron/blob/v44.7.0/lib/browser/api/clipboard.ts)。

修正后，快照和恢复核对都只忽略 `types.length === 0` 的条目。有类型的零字节文本、HTML、图片仍须原样写回并逐字节核对；非空格式、多条目、书签对象和独立的纯文本读取比较均保留。没有改为只保存文本，也没有降低恢复断言。

此前 `finally` 的恢复失败可能覆盖原定位异常。现在只有一处失败时仍抛出该异常原对象；操作和恢复同时失败时使用 `AggregateError.errors` 保留两份原始原因，并以原操作异常作为 `cause`。Playwright 的错误序列化会保留 `cause`，因此报告仍能追踪原定位异常。用独立布尔标记记录操作失败，原操作即使抛出 `null` 也不会丢失。

## 纯回放验证

`tests/unit/monaco-caret-clipboard.test.ts` 从磁盘读取正式帮助器，以 TypeScript 转译后在 VM 中执行整个函数及其 `desktop.evaluate` 回调；只替换剪贴板、键盘和设置读取边界。没有加载 Electron、派发系统按键、启动 GUI、读取系统剪贴板或连接数据库，也没有另写一份待测规范化算法。

18 项用例覆盖空数组、单个及多个无类型条目、清空后的单空条目、Windows/macOS 按键分支、有类型的零字节文本/HTML/PNG、Unicode 与 NUL 文本、非空富文本/图片/书签、多条目夹杂空壳；还注入格式丢失、图片字节变化、纯文本变化，以及单独/同时发生的操作和恢复失败。破坏性回放必须失败，两条原因与 `cause` 必须保留原对象。

验证命令与结果：

- `node node_modules/vitest/vitest.mjs run tests/unit/monaco-caret-clipboard.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/ci-8199bf6/clipboard-unit-results.json`：18 通过，0 失败。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node scripts/build.mjs`：通过；仅有现有 Rollup 注释位置及包体积提示。

这些结果证明帮助器在受控 API 形状下的行为，不构成原生剪贴板、Monaco 定位、平台补全或安装包验收。

## 固定 CI 的证据边界

旧基线的 [CI 38791570362](https://github.com/zhao-yc/DBArk/actions/runs/38791570362) 已终态失败，且未包含本次修正：

| 环境 | 类型/单元/构建 | 源码桌面 E2E | 打包及安装验证 |
| --- | --- | --- | --- |
| Linux | 149 文件、2760 单元及类型/构建通过 | 不适用 | 不适用 |
| Windows x64 | E2E 前置源码构建通过 | 63 通过、163 跳过、5 失败 | 被源码失败阻止，均跳过 |
| macOS x64 | E2E 前置源码构建通过 | 63 通过、163 跳过、5 失败 | 被源码失败阻止，均跳过 |
| macOS arm64 | E2E 前置源码构建通过 | 63 通过、163 跳过、5 失败 | 被源码失败阻止，均跳过 |

三个桌面平台的五项失败均最终报告旧 `monaco-caret.ts:44` 的恢复断言为 `false`，涉及窗口补全三项及原语义/输出别名补全两项。原日志没有保存初始剪贴板类型或比较失败分支，因此只能确认上述空条目缺陷存在，不能认定它是全部 CI 失败的唯一原因；`finally` 还可能遮盖较早异常，不能据此断言前缀核对已通过。

各平台的 D06 五项、D07 七项是开发 Electron 下的离线场景；执行计划和工作台导航各一项是额外沙箱窗口内的真实源组件交互。它们不能代替安装包或 200 实库验收。本次没有启动新的原生验证、重跑 CI 或访问 200；修正后的原生验证由统筹接入候选和新 CI。
