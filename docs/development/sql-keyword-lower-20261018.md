# SQL关键字小写偏好

固定起点为Root `4236db0ded6a4e071cb7f4255f7aaee56b2af684`。本片在独立普通clone的`codex/employee2-sql-keyword-lower-20261018`分支追加，不使用worktree，不修改Root或旧交接证据。开始前已检查仓库/分支/远端/干净状态并执行fetch；首次网络连接失败，重试成功，Root上游已前进，依明确任务保持指定起点，不自动合并其它任务。

## 使用和保存

原全局偏好弹窗增加“关键字小写”，三项分别对应`preserve`、`upper`、`lower`，默认仍保持原样。按钮和原格式化快捷键共用偏好；选区只处理完整选区，否则处理全文。

修改选择、取消、恢复默认均只操作面板草稿；显式保存仅合并当时的这一字段。保存不调用格式化、不改写已有SQL或重新载入旧标签快照。恢复默认仍需保存，保存失败显示原重试说明，旧面板关闭后迟到结果不能更新新面板状态或还原后来SQL。

原严格IPC schema及直接LocalStore写入允许三种准确值；显式undefined、大小写别名、未知值/类型仍拒绝，未知字段仍strict拒绝。合法lower读取不回退；缺项默认preserve，损坏存量仅局部读取回退，不自动写盘。原settings JSON、LocalStore事务与原子替换链路继续使用，schema9及迁移文件未改。

## 安全与加载边界

lower复用upper的公开MySQL词法类型、原始位置、正式解析器名称/函数跨度及四种引号/反斜线模式检查。只有已证明为关键字、完整属于原选区、未与名称/函数跨度相交、无点号限定或关键字函数歧义的ASCII原word才允许转为其精确`toLowerCase()`结果。其余token仍按类别、顺序、raw及敏感空白逐字核对。

没有整体忽略大小写，也不改变标识符、变量、类型、函数、字符串、注释或数值。比如数值的`E`指数原文也不能借lower改写。非保留词名字与Unicode相似词仍受保护；若上游已经保持名称，可以安全排版，若上游试图改变受保护名称则整次拒绝。不为追求大小写结果降低角色证明或对不确定语法放行。

默认preserve仍同步走原路径，导入、偏好读取/保存都不初始化角色模块；显式upper/lower才调用原动态加载入口。两种显式模式使用相同32768 UTF16单元/2048 token角色预算，不缓存用户SQL或角色结果。

沿用原`DeferredUpperSqlFormatting`类名兼容已有调用，它现在保存所选upper/lower模式。原模型、版本、全文、八项有向选区坐标、原owner和偏好快照共同约束回包；模型/内容/选区/配置/销毁事件以及工作区/模态变化永久撤销，原值恢复不复活。QueryTab除将lower纳入延迟分支外，其原owner、连接对象/版本、会话、活动标签、任务、关闭、文件状态、偏好及模态ABA守卫逐字保留。

原`formatSqlEditor`事务主体未改：同一模型、一次`executeEdits`、两侧Undo stop及原选区映射。不新增执行SQL、建连、会话、历史或剪贴板行为。

## 语料与窄验证

`tests/fixtures/sql-keyword-lower-cases.ts`逐字保留旧大写任务的8条成功输入：首条名称/变量/字面量综合输入、6条函数/类型/多词关键字/IN/CASE输入，以及DDL名称/类型同形输入。每条另有手工大写关键字输入与手工小写期望，未用产品生成期望。对照只忽略token外排版，注释/引号内部及所有原文单元区分大小写，不使用整体case-insensitive比较。

最终相关验证共143个唯一通过项，跳过项不计通过：

| 范围 | 通过数 | 证据 |
| --- | ---: | --- |
| 小写语料、污染/名字/Unicode/四模式/选区/预算 | 42 | `policy-final.json` |
| 原upper正式角色与原文保护对照 | 29 | `policy-final.json` |
| upper/lower原延迟意图，含有向选区漂移和事件/owner撤销 | 30 | `policy-final.json` |
| 默认冷路径及显式动态加载门 | 1 | `policy-final.json` |
| 三选项、取消/默认/保存失败、旧面板迟到及损坏读取 | 9 | `policy-final.json` |
| 严格IPC及真实LocalStore方法的RAM字节保存/重开/失败回退 | 4 | `policy-final.json` |
| 真实QueryTab按钮/快捷、选区/全文及等待中ABA撤销 | 28 | `query-initial.json`，该首次定向检查即通过；另26项未选中不计通过 |

持久化验证仅将文件端口和settings表替换为RAM，执行真实LocalStore读/写/失败恢复及正式IPC校验；没有创建实际配置文件、初始化SQLite或运行原磁盘持久化测试。原磁盘测试中将lower视为损坏值的断言同步改为未知`mixed`，并加入lower合法值，留给Root之后需要时验证。

最初RAM字节断言把JSON属性顺序作为合同，出现1项测试失败；正式IPC会按schema顺序重排属性。已改为解析后的结构严格相等并单独核SQL原文，未为测试改产品。初始及最终日志均保留。首次类型检查通过；最终类型结果与源码不变量另存本clone忽略缓存`.cache/sql-keyword-lower-evidence/`。

实际命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/sql-keyword-lower.test.ts tests/unit/sql-keyword-lower-storage-ram.test.ts tests/unit/sql-formatting-deferred.test.ts tests/unit/sql-formatting-lazy-module.test.ts tests/unit/sql-keyword-case-ui.test.tsx tests/unit/sql-keyword-case.test.ts --reporter=json --outputFile=.cache/sql-keyword-lower-evidence/policy-final.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/ui-query-formatting.test.tsx -t '关键字偏好|加载等待' --reporter=json --outputFile=.cache/sql-keyword-lower-evidence/query-initial.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

没有重跑旧大套、1556全套或Root已通过的19项当前语句断言；该修复文件逐字保留。没有GUI、Electron、真实Playwright/list、数据库连接、SQLite初始化、SSH、Docker、端口、服务、安装、剪贴板、新CI或版本/覆盖总表/工作流变更。纯内存证明不替代真实Monaco键盘Undo/Redo、桌面交互或实际数据库模式验收；未作原生性能声明。
