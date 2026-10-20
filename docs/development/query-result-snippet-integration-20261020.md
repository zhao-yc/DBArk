# 高频查询工作流整合：结果视图与片段文件

## 范围与来源

普通克隆内任务分支 `codex/query-result-snippet-integration-20261020`，不使用工作树、不合并主分支、不发布。原基线为 `915d3dcb3ee44731c1a703bdb04179754d027b45`。

- 结果视图：接入 `7c4b9daa29d9881c714131f307c3a139c1dea26f` 的五文件增量；本分支对应提交 `063394d`。增加七种文本条件，仍仅筛选已返回数据，不重新执行SQL；筛选后排序、复制和导出共享原行映射。
- 片段文件：沿用 `f173f4146460c01df8b9cf21fa7965e33e97de4a` 的完整产品和用例，保留原操作结算及迟到取消隔离；不修改查询、驱动和进程间契约来适配结果筛选。
- 实库用例：`query-result-organize-live.ts` 与类型通过的9e9812a相同，沿用准确目标、SQL、文件期望、零重试和原退出保护。
- 协作指南：接入根目录 `AGENTS.md`，后续所有占用电脑的测试统一在指定“dbark测试”虚拟机会话执行，本机仅开发和静态审查。

三组增量没有产品文件重叠。各自的独立候选通过不能直接转记为本整合分支通过；本地只做源码差异和 `git diff --check`，不运行类型、单元、构建、Electron或实库。

整合另增一项真实QueryTab／片段父弹窗的RAM回归：先筛选并多列排序，打开／关闭片段库后保持同一结果视图、撤销旧勾选，重新选择后复制／导出仍是正确原行，且只有原来一次SQL执行；仅将片段列表返回替换为明确RAM值，没有数据库或系统剪贴板。该项未执行前不记为通过；产品源码仍分别与两固定候选一致。

## 已知独立证据与边界

7c4b9da已在WIN11-TEST完成201项定向、类型及构建，完整570文件／10905通过／1平台跳过，详见[原始范围](query-result-text-filter-20261020.md)。9e9812a类型检查退出0／36.99秒，但该虚拟机缺少明确的专用实库接入配置，原生七条件还没有通过证据。用户随后表示已增加 `deve-server.yinzon.com` 到200服务器的hosts映射，测试会话仍须实际核对解析、连接及数据库身份，不能把映射当作认证通过。

片段16366df的四项反例已在该VM实际失败，修复f173f41的类型／68项定向／构建已通过；完整集合和四条Electron用例的本轮终态尚待读回，见[片段交接](snippet-transfer-vm-handoff-20261020.md)。四条Electron用例只替换系统文件框回答，不能代替真实OS文件选择、重启、安装或macOS证据。

本整合不增加Navicat完整工作包、公开发行或跨平台验收计数，不改变0.28冻结范围及旧失败现场。

## 顺序验收

先确认上一任务真实结束、工作区干净且没有所属测试进程，在同一VM普通克隆获取本分支并固定完整SHA。不得中断前一验收、重复派发、stash/reset或更改产品、断言、超时和退出夹具。失败保留原件及所属现场，交回开发会话修复。

先单次运行既有入口，类型只检查一次；加入上述整合回归后预计12文件270项，数量以实际输出为准：

```powershell
node scripts/check-local.mjs --build tests/unit/query-result-filter.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-header-copy-ui.test.tsx tests/unit/query-result-sort.test.ts tests/unit/query-result-multisort.test.ts tests/unit/snippet-transfer.test.ts tests/unit/snippet-transfer-main-ram.test.ts tests/unit/snippet-transfer-main-entry-ram.test.ts tests/unit/snippet-transfer-storage-ram.test.ts tests/unit/snippet-transfer.react.test.tsx tests/unit/snippet-transfer-sqlite-storage.test.ts tests/unit/snippets.test.ts
```

通过且进程收尾后，单次完整单元：

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/query-result-snippet-integration-full.json
```

后续Electron／实库验收按原用例和显式门安排，先核VM可用的专用连接；Docker仅在验证Server-200身份后使用，不能用本机或VM Docker。系统剪贴板隔离未确认前不写系统剪贴板。最终回报固定SHA、机器账号、原命令／数量／退出码／耗时、原始日志及SHA256和所属资源收尾，区分单元、真实IPC／磁盘、实库、系统输入、安装及平台。
