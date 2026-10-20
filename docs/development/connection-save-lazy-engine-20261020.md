# 本地连接保存的引擎按需启动

## 原因与范围

任务分支 `codex/connection-save-lazy-engine-20261020`，从已同步的 `313dc3eae7274e620673ceaa39807596a8d0f697` 开始，普通克隆、不用工作树、不合并主分支、不发布。

静态调用链为 `ConnectionConfigManager.save/replace` → `EngineBroker.request('__connections.prepareSave')` → `start()`。首次新增本地连接也启动整个数据库进程，只为检查空会话／缓存状态；本次消除该不必要启动，不跳过连接概要、秘密解析、保存锁或磁盘提交。此前原生保存准备的两项超时与[一次未复现观察](connection-save-diagnostic-20261020.md)仍分别保留，没有证据证明其根因就是引擎加载，也不承诺固定耗时。

## 实现边界

仅对精确的内部准备命令，且无子进程、无待结算请求、未关闭中、无关闭Promise，认可非空且一致的连接ID后返回。已有引擎仍发送原请求，等待原会话／资源／缓存屏障成功；拒绝不落盘、不取消任务、不杀进程。身份缺失或不一致仍交原引擎校验。真实数据库操作继续按需启动唯一进程，不自动重放任何请求。

产品只改 `src/main/broker.ts`，不改IPC、引擎、存储、UI、原生用例或原期限。沿用既有 `engine-broker-close.test.ts`，新增六项进程启动／拒绝边界；原七项退出断言保留。反例提交为 `a259f4fe5d66e26291abe3f9c836787b3e830872`，产品修复候选为 `b45383ac2d6beb1ab22a8ed88d5f5ffca0a3d5f3`，两者的反例文件及原四条Electron spec字节相同。

## 修前实际结果

开发会话已直接读回WIN11-TEST的命令输出与完成摘要：测试分支 `codex/vm-connection-save-lazy-red-20261020`，固定a259f4f，单次13项／10通过／3失败、退出1、2.49秒。两个冷引擎准备场景（传输变更false／true）的fork断言为期望0、实际1；首次数据库操作场景的消息数为期望1、实际2。旧七项退出和另三项新边界通过，无所属测试进程残留、工作区干净，未改断言或重试。

这是mock utility端口上的真实Broker控制流证据，不是实际引擎进程或桌面性能测量。VM原件目录为 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\connection-save-lazy-red-vm-20261020`，原始 `red-original.json` 的VM校验值为 `8392f7c5a837a1862bf95cea88074711eeb91369a3627b6069dd6e18a349b0b8`；开发会话未独立取回复算。原失败报告保留，不记为产品通过。

## 修后实际结果（b45383a）

开发会话已读回同一WIN11-TEST账号及普通克隆的命令输出，固定 `b45383ac2d6beb1ab22a8ed88d5f5ffca0a3d5f3`，反例文件与原四条Electron spec未改：

| 阶段 | 实际结果 | 退出码 | 秒 |
| --- | --- | --- | --- |
| 类型检查 | 通过 | 0 | 47.32 |
| 8文件定向 | 206项通过，含原三项失败反例 | 0 | 25.79 |
| 普通构建 | 通过 | 0 | 81.60 |
| 原四条Electron流程 | 4通过，0跳过／重试 | 0 | 24.39 |
| 完整单元 | 576文件，10972通过／1平台跳过 | 0 | 345.93 |

定向入口总154.73秒。Electron JSON内报告时长21.502秒，与外部命令24.39秒分别记录；原5000ms保存断言及45000ms期限保持。唯一完整跳过为Windows不适用的POSIX严格umask／0664检查。原生采样PID及任务窗口确认结束后才运行完整集合，完整结束后无所属任务进程。原件保留在VM的 `outputs\connection-save-lazy-green-vm-20261020`，摘要与哈希待其保存后补充，不推断已取回原件。

四条流程覆盖真实Main／IPC／SQLite／临时文件，系统文件选择回答仍由原用例替代；不是实际OS文件框、应用重启、安装、实库、系统剪贴板或macOS验收。此轮未再出现保存准备失败，不代表已确认旧偶发超时根因；88d5d46原两项失败与独立诊断原件保持。后续区间筛选不在本次固定提交内，不沿用此完整结果。

## 顺序验证

本机仅静态审查和 `git diff --check`。所有运行交既有“dbark测试”会话。用户随后确认已将现有SSH密钥放到VM指定路径，已排队在本轮测试结束后严格核验；此前缺密钥记录属于当时状态，复制文件不等于SSH／MySQL认证已通过。

修前固定a259f4f仅跑既有broker文件，预计13项中3项冷启动反例失败；不修改断言或重试。修后保持同一测试文件字节，依次单次执行：

```powershell
node scripts/check-local.mjs --build tests/unit/engine-broker-close.test.ts tests/unit/connection-config.test.ts tests/unit/connection-replacement.test.ts tests/unit/main-connection-replacement.test.ts tests/unit/connection-transfer.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-multisort.test.ts tests/unit/query-result-sort-ui.test.tsx
node node_modules/@playwright/test/cli.js test tests/e2e/snippet-transfer.spec.ts --workers=1 --retries=0 --reporter=json --trace=off
```

原四条Electron用例、5000ms保存断言和退出保护保持；全部通过且所属资源结束后，再运行完整单元（两个worker）。失败保留日志、原始JSON、固定SHA、退出码、耗时及资源现场，不改门槛或重跑。单元／原生／实库／安装及跨平台证据分别记录，未执行不记通过，不增加完整Navicat工作包或公开版本计数。
