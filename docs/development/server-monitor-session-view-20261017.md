# S02有限会话快照的本地筛选与排序

基线为Root固定 `8c6240abc5bf4c30af4846c5bbbdb06ae2e0cdf3`，普通克隆 `D:/svn/DBArk/.cache/parallel-20261015/employee4-server-monitor-session-view-20261017`，分支 `codex/employee4-server-monitor-session-view-20261017`。原207988准备分支保持不动，不用worktree。

## 用户行为与准确边界

用户可以按用户、来源、库、状态或已返回SQL摘要搜索，采用不区分大小写的字面包含匹配，`%`、`_`、`[]`不是通配符或正则表达式，空格也不隐式删除。搜索框最多512个UTF-16代码单元，不发送任何服务端请求或用户SQL。NULL不伪造成字符串参与搜索，空搜索保留全部已返回值。

会话可按ID或持续秒数升/降序。数字字符串只为比较去除前导零，按位数和字典序比较，不经过Number或浮点转换；原大整数、原前导零和原显示文字保持。数字并列以本次原快照序号稳定裁决，切方向也不反转并列组。无效数字/空串在有效数字之后，NULL始终最后，二者显示仍区分。

显示“筛选后 / 本次返回”条数，始终说明仅当前有限快照、账号可见范围/完整性未确认。SQL搜索只匹配已经返回的摘要；摘要可能截断，不代表搜索完整SQL。零匹配不表示服务器无其它会话。继承内核最多100条的预算，renderer亦只处理前100行，若收到超合同条数则继续显示上限提示和真实返回数，不扩大服务端范围。

本地投影新建数组，既不原地sort快照，也不改原行对象。旧的SQL详情仍默认折叠并用React纯文本呈现，不增加kill、执行SQL或复制入口。

## 生命周期与文件归属

`ServerMonitorSessions`始终按当前连接ID/修订的JSON key挂载。它在同目标刷新、读取等待或某节暂时不可用时保留筛选/排序；连接或修订变化、关闭重开则重建局部状态。旧目标控件属于已卸载的React子树，不能改变新目标状态。关闭期间控件禁用。

仅修改 `ServerMonitorDialog.tsx` 会话呈现区域及对应import，新增 `serverMonitorSessions*` helper、样式、专属文案、会话组件和专项测试。controller、services、Entry、App、main、engine、共享契约、原收尾/自动刷新状态机和207988正式准备片均未改。

## 本轮验证与任务卡

| 层级 | 本轮证据 | 未完成边界 |
| --- | --- | --- |
| 源码/本地RAM | 6项纯投影、5项真实ReactDOM/Dialog/控制器入口通过；type通过 | Root独立审查与整合 |
| 原生/200 | 实际0 | 不重复触发或等待Root三平台作业39031638089，不借其结果声明本片已验 |
| 安装/clipboard | 均0 | 未构建、未安装、未调用系统剪贴板 |

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/server-monitor-sessions.test.ts tests/unit/ui-server-monitor-sessions.test.tsx --maxWorkers=1 --minWorkers=1
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

未重跑旧13/19、完整大套、本地build或真实操作。push后该头Linux源码CI单独报告，不代表原生或安装验收。

备用正式验收任务卡保持默认关闭：先由Root完成207988原首例的正式资源排队，再在同一准确只读窗口记录本地操作前后的任务ID集合；输入包含文字/`%_[]`的查询、切换ID/秒数与方向，核筛选数量、精确大整数、NULL/空串与范围/截断提示；本地操作任务集合不变。一次手动刷新后同目标条件保留，待Root确定第二临时profile后核目标切换/关闭重开清空条件。不追加SQL输入、DDL、kill、clipboard或自动刷新实跑；所有未知沿原owner/期限保留，由Root统一安排200/GUI，本片不注册或执行新的正式场景。
