# 补全目录等待严格物理收尾

固定基线：`54224fffc9eaf431005da9840763c77059d6ebd0`。此修复保留原 `1e8168a` 和1508/1511/1513记录，不改变 UI 输入、触发方式、请求内容或任何期限。

## 根因与最小修改

Root 的1511白名单已确认点号自动触发、MySQL8.4.11新行别名能力及两次 Worker `ready` 均正常，界面显示“补全目录暂不可用”。Root 随后提供的1513真实 Main IPC 错误与本片独立 RAM 反例完全一致：空前缀目录请求失败于“独立任务物理资源尚未确认释放，请显式断开连接；原操作未重放”。输入点号引发的上一请求取消另行正常完成；没有执行编辑器SQL或创建查询会话。

`metadata.completion` 原入口未启用既有 `strictRead`。目录SQL成功后，非严格关闭在驱动 QUIT 回调时返回；原连接流 `close` 可以稍后才到。`withIndependentTask` 随即执行资源账本确认，正确发现原流尚未关闭并拒绝交付目录，因此无法显示已读到的三列。

产品仅修改此入口：调用既有 `withIndependentTask(..., '读取补全元数据', true)`。沿用现成严格收尾，等写队列完成及原流关闭后才结算；读取中取消也沿用既有严格路径等待原命令终态及控制连接关闭。没有放宽资源确认门、提前认可QUIT回调、自动重放目录或修改期限。未知关闭继续失败并保留原账本。

## 原红与验证

原反例只替换 mysql2 驱动传输端口，Engine、connect、completionMetadata、关闭和资源账本均为实际代码。原测试 SHA256：`05e4ac4d932b922c4f0310c875ccbc45b9c9621dbcb734850c8addaf8de75d83`。在新普通 clone 中复制同字节重放：修复前 **1失败、1通过**；修复后 **2通过**，原 before 报告与诊断分支原件均保留。

新增 `completion-metadata-strict-close.test.ts` **4项通过**：

1. 目录与QUIT回调已完成、原流尚未close时保持未交付；真实close后才返回三列并释放任务号，不重发SQL。
2. 取消到达动作已结束的关闭间隙只等待原收尾，不新建控制连接或发送KILL。
3. 读取中取消收到KILL确认后仍等待原命令终态，再等待控制流close；不提前确认取消完成。
4. 写队列完成而原流close未知时仍失败并保留资源账本，不返回部分目录或自动重放。

实际命令（均从本任务普通 clone 运行）：

```powershell
# 工作目录：.cache/upsert-dot-ram；before与after使用同一测试文件，分别在修改前后执行
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest-close.config.ts --reporter=json --reporter=verbose --outputFile=before-results.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest-close.config.ts --reporter=json --reporter=verbose --outputFile=after-results.json
# 工作目录：clone 根目录
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/completion-metadata-strict-close.test.ts --reporter=json --reporter=verbose --outputFile=.cache/upsert-dot-ram/controls-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本轮只运行上述原字节及新增对照和类型检查，没有重跑旧全套、应用构建或实际DB/GUI/OS/剪贴板，不读取凭据。本片结果不代表真实补验已通过；Root仍需独审和无旁观的正式补验，按原专属fixture与服务器线程边界独立收尾。精确提交、类型检查结果、测试/日志/源码 SHA256 记录于本任务 ignored `.cache/upsert-dot-ram/handoff.json`。
# Root后续实证

Root 整合 `36d0562`，目录相关 37 项／合并类型／源码构建通过，独审三个原生等待与未知保留 RAM 对照通过。准确 MySQL 8.4.11 上的正式 Windows 点号自动补全、三列真实建议及精确插入已在无旁观 run1515 单次通过；原三次失败和诊断不改写，全部自有 fixture、线程及配置目录确认清理，见[正式复验](../../tests/integration/acceptance-upsert-completion-20261018.md)。本片不代替其它版本／平台／新安装或执行 UPSERT。

