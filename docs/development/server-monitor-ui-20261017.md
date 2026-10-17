# S02独立只读界面首片

## 固定依赖与文件归属

开发基线是Root整合 `369c5b1384ea9fb5e8e9754cd6973facefd22805`，普通克隆为 `D:/svn/DBArk/.cache/parallel-20261015/employee4-server-monitor-ui-20261017`，分支为 `codex/employee4-server-monitor-ui-20261017`，没有使用worktree。

此前批准的S02内核固定在 `609c886b3abe1bed49b7d2aeb1a5582e8f6ce710`，原普通克隆为 `D:/svn/DBArk/.cache/agent-workspaces/server-monitor`，远端 `task/server-monitor-20261015`。它的 `readServerMonitor(context,input)` 提供概要、固定白名单全局状态和有限会话的只读非原子快照。该历史内核的实库记录属于旧版本证据，本次未复跑，不表示当前UI已实库验收。

Root批准本分支单独移植 `src/shared/serverMonitor.ts` 为同字节依赖，Git blob为 `fd9a9c5d4c0b72dc9dc4e1b338b483d9db35ea78`。不重写第二套内核或协议。Root独占内核、typed IPC、校验、主进程、App入口与共享host；其已通知的正式接线片为 `813fcf6`，本分支未吸收该片，不重复提交engine或Root测试。整合时若共享契约已存在，只取UI专属提交即可。

## Root接线小契约

`ServerMonitorDialog`导出props：

```ts
{ open: boolean; connectionId: string; connectionRevision: number;
  services: ServerMonitorServices; onClose(): void; }
```

服务严格沿用旧契约，不传SQL或扩大执行范围：

```ts
interface ServerMonitorServices {
  read(input: ServerMonitorInput): Promise<ServerMonitorSnapshot>;
  cancel(taskId: string): Promise<unknown>;
}
```

Root为services提供稳定引用，接到 `serverMonitor.read` 和 `query.cancel({taskId})`。connectionRevision使用store的单调连接修订，不在renderer将额外字段塞进原严格ServerMonitorInput。Root在真实调度前核连接最新修订、分配独立只读短会话，并使read Promise覆盖原读取及严格释放处理。每次read使用新的taskId，默认50条会话，内核最多100条、SQL服务端最多512字符、快照最多512KiB。

**read拒绝或cancel ACK均不是物理资源释放成功证明。** UI只等待原read和原取消控制调用落定，不释放host容量或锁，不调用独立恢复/KILL。onClose仅关闭视图。未知数据库、TLS、SSH、取消控制连接资源由Root的独立资源账本保留并阻断不安全新调度；不能因本组件busy=false、卸载或关闭窗口而清空它。失败仅展示通用提示并暂停自动刷新，不持久化驱动错误、会话SQL或快照。

Root外层隐藏标签页时传open=false或卸载；document隐藏也会停止。连接、修订、services引用变化和A/B/A均先撤销旧接收权，取消绑定原services/taskId，等原read及取消控制收尾，再提交新目标。旧关闭回包不能调用新目标的onClose。

## 已实现行为

- 真实独立React组件及共享Modal，展示概要、原始精确字符串累计计数、缺失变量与分节不可用原因。
- 会话始终声明“当前账号可见范围，完整性未确认”，保留NULL和空字符串区别。显示硬上限100条；SQL摘要默认折叠、只作React纯文本，不提供kill、结束会话或执行SQL按钮。
- 手动与自动刷新共用一个pending；双击、连接切换、StrictMode和快速重开不产生重叠read。
- 自动刷新默认关闭；每次原任务结束后至少5秒才进行下一轮，最多60轮，隐藏、关闭、取消或失败时停止，不后台自动重试。
- 用户取消和窗口关闭均等原read落定；取消控制尚未结束时，即使read已返回也不开始下一轮。取消失败不据其回包释放占位，旧快照回包失去接收权。

## 本轮验证与未完成边界

13项专项通过：7项纯控制器、6项真实ReactDOM/Modal/组件入口（包含StrictMode两态）。测试覆盖精确预算、大整数/NULL/空串、A/B/A和修订、旧关闭回包、隐藏重显、取消失败、原read与cancel分别迟到、五秒及六十轮上限、分节权限缺项、显示条数上限及HTML文本。

必要命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/server-monitor-controller.test.ts tests/unit/ui-server-monitor.test.tsx --maxWorkers=1 --minWorkers=1
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

类型检查通过。未跑完整大套、未构建、未访问200、未做真实GUI/数据库/安装验收。未修改App、contracts、commands、validation、main、engine、SchemaDialog或locale总入口。S02仍为首片，不宣称完整服务器管理或取消任意会话能力。

后续默认关闭正式UI验收应由Root/专项验收线在独立资源host收口及App入口整合后准备：准确身份预检、真实窗口打开概要/会话、手动与定时串行、关闭及切换期间迟到回包、只读与不持久化旁观。真实200/GUI排队由Root统一安排，本片不自行开启。
