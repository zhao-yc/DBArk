# 本地连接保存的引擎按需启动

## 原因与范围

任务分支 `codex/connection-save-lazy-engine-20261020`，从已同步的 `313dc3eae7274e620673ceaa39807596a8d0f697` 开始，普通克隆、不用工作树、不合并主分支、不发布。

静态调用链为 `ConnectionConfigManager.save/replace` → `EngineBroker.request('__connections.prepareSave')` → `start()`。首次新增本地连接也启动整个数据库进程，只为检查空会话／缓存状态；本次消除该不必要启动，不跳过连接概要、秘密解析、保存锁或磁盘提交。此前原生保存准备的两项超时与[一次未复现观察](connection-save-diagnostic-20261020.md)仍分别保留，没有证据证明其根因就是引擎加载，也不承诺固定耗时。

## 实现边界

仅对精确的内部准备命令，且无子进程、无待结算请求、未关闭中、无关闭Promise，认可非空且一致的连接ID后返回。已有引擎仍发送原请求，等待原会话／资源／缓存屏障成功；拒绝不落盘、不取消任务、不杀进程。身份缺失或不一致仍交原引擎校验。真实数据库操作继续按需启动唯一进程，不自动重放任何请求。

产品只改 `src/main/broker.ts`，不改IPC、引擎、存储、UI、原生用例或原期限。沿用既有 `engine-broker-close.test.ts`，新增六项进程启动／拒绝边界；原七项退出断言保留。反例提交 `a259f4fe5d66e26291abe3f9c836787b3e830872` 尚无产品修复，已交WIN11-TEST单次执行，实际结果待回报。

## 顺序验证

本机仅静态审查和 `git diff --check`。所有运行交既有“dbark测试”会话；它已确认VM缺少同名SSH密钥、agent未运行，域名与13384网络可达不等于认证通过，暂不重做网络探测或运行实库用例。

修前固定a259f4f仅跑既有broker文件，预计13项中3项冷启动反例失败；不修改断言或重试。修后保持同一测试文件字节，依次单次执行：

```powershell
node scripts/check-local.mjs --build tests/unit/engine-broker-close.test.ts tests/unit/connection-config.test.ts tests/unit/connection-replacement.test.ts tests/unit/main-connection-replacement.test.ts tests/unit/connection-transfer.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-multisort.test.ts tests/unit/query-result-sort-ui.test.tsx
node node_modules/@playwright/test/cli.js test tests/e2e/snippet-transfer.spec.ts --workers=1 --retries=0 --reporter=json --trace=off
```

原四条Electron用例、5000ms保存断言和退出保护保持；全部通过且所属资源结束后，再运行完整单元（两个worker）。失败保留日志、原始JSON、固定SHA、退出码、耗时及资源现场，不改门槛或重跑。单元／原生／实库／安装及跨平台证据分别记录，未执行不记通过，不增加完整Navicat工作包或公开版本计数。
