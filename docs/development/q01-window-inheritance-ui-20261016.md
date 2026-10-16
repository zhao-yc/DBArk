# Q01 命名窗口继承：正式 UI 验收准备

本分支以 ROOT 固定候选 `a190c83d873fdd7d3208da0c5de8c116109afbd4` 为基点，只新增本说明和 `tests/e2e/sql-completion-window-inheritance.spec.ts`，不修改产品、版本、依赖、原四个窗口/会话 spec、私网帮助器或原断言。现有 `sql-completion-window.spec.ts` 的正式部分覆盖单窗口与命名 WINDOW，没有 `OVER(base ORDER BY ...)`、多级继承或 b878 完整性修正的专用正式场景；新文件补此缺口。

默认同时要求 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_Q01_WINDOW_INHERITANCE_UI=1`。任一门未明确开启，5 项全部声明跳过。`monaco-caret` 和 `live-helpers` 只在测试执行体调用的函数中动态加载；列表阶段不会经它们加载私网配置。没有新增连接凭据或环境文件。

## 五个逻辑标题、十六个 SQL 场景

| 标题范围 | 场景数 | 实际执行时的断言 |
| --- | ---: | --- |
| 继承 ORDER | 2 | 已定义空/分区窗口，限定与非限定真实字段，Enter 接受、完整右侧 suffix 替换、原生撤销 |
| 多级继承 | 2 | 三层窗口链及命名 child 的继承 ORDER，仍取当前块物理目录 |
| 非法继承 | 4 | 未知引用、自循环、相互循环、无环前向引用均为真实 Worker 的 syntax 阻断 |
| b878 完整性 | 3 | 尾逗号、PARTITION 缺参拒绝；完整 COALESCE 表达式和后继定义允许接受撤销 |
| 查询块隔离 | 5 | UNION 兄弟、祖先和 CTE 外部不能借名；内层不合法定义不能借外层绕过；合法内层独立遮蔽 |

6 个正向场景均核对独立声明的完整 SQL，并接受后撤销；10 个负向场景均要求同正文、同光标、真实按键之后的真实 Worker 明确返回 syntax 阻断，候选行为零行，完整草稿不变。不能只因建议面板没有显示就判负向通过。所有补全前后比较普通任务与查询历史，样例正文不得被执行。

## 真实入口与观察边界

执行时使用原 desktop 自动夹具、原隔离数据库创建/清理和真实连接表单，建立本例独立表 `q01_window_subject`。实际读取服务器版本；MySQL 8+、MariaDB 10.2+ 才执行窗口切片，MySQL 5.7 或无法确认的版本明确跳过，不计通过。ROOT 仍须先核批准的实际服务器、端口、方言和 TLS 策略；不能从版本字符串替代服务器身份核验。

只通过原 UI 执行一条 `SELECT 1` 建立真实查询会话，再经“会话临时对象→读取会话结构”确认本例名称不是临时表。之后的 16 个样例只做补全，不执行窗口 SQL。物理字段必须由真实目录、实际 Worker 和 Monaco 建议链提供；正式 spec 没有替代目录、解析、结果或 Worker 回包。

输入复用 a190 中已审的 `monaco-caret`：原生清空、`insertText` 和键盘移动；实际 Control+Space 的公开当前模型观察证明全文/光标。它对系统剪贴板只做原有完整只读不变性核对，没有写入、清空或恢复；新文件不增加剪贴板操作，也不调用模型 setter、设置光标或制造键盘/Worker 事件。

Worker 观察器只包裹原 `Worker.prototype.postMessage`，原消息、转移选项和接收者经 `Reflect.apply` 原样传递；消息监听只保留当前真实按键代次、状态及原因，每个队列最多 32 条。旧请求、其它正文和其它光标不能满足本次结果断言，没有设置 Worker 响应或模拟解析结果。它在本例临时页面退出时释放，不改公共 helper 或产品。

`trace`、`screenshot`、`video` 全部关闭，并在私网执行体前核对实际 fixture 选项，拒绝覆盖为开启。原 `isolatedDatabase` 的失败路径会显式调用截图，因此新文件只在本次 Page 上临时拒绝截图 API，保留原错误与原退出、精确 DROP、观察连接关闭；结束后还原该方法。没有截图、录像或私网附加材料。每项 150 秒，补全与公开光标证明共享原 13 秒截止时间，UI 后续断言只取剩余时间；未延长任何旧测试期限。

## 员工2本轮实际验证

- 17 项纯准备检查通过：从 spec AST 读取 6 正向/10 负向数据，真实分析和建议函数核完整替换范围；纯目录端口仅存在于忽略缓存探针，不进入正式 spec。另核双门、延迟导入、只读传递和禁止捷径。
- 类型检查 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 真实 Playwright `--list` 在双门 00/01/10/11 四个配置各收集 5 项；前三组声明跳过 5 项，11 组声明可执行 5 项。每项列表期限 150 秒，全部实际执行 0。
- 收集子进程仅传系统运行白名单和这两个门；预加载守卫禁止私有文件/证书读取、网络、密钥生成及任何被测子进程。四次收集均退出 0，越界尝试拦截 0，实际产品进程、GUI、数据库和系统剪贴板操作均 0。

机器证据保存在员工2自己的忽略缓存 `.cache/q01-window-inheritance-ui-20261016/`：`pure-confirmed-results.json`、`collection-results.json`、四份 `list-*.json` 及日志。它们没有提交为正式验收记录；本轮没有运行真实 GUI、200、Docker、安装或手动 CI，没有将准备结果计入产品通过覆盖。

## ROOT 后续执行入口

ROOT 在已核验并授权的独立原生资源上，给运行进程注入批准的连接配置和这两个门，再执行：

```text
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-window-inheritance.spec.ts --workers=1 --retries=0 --trace=off --reporter=json
```

五个标题每个平台各有五项结果，不把16个内部场景当16个 Playwright 用例，也不把三平台重复当新功能。ROOT 按实际测试 SHA、安装/源码身份、实际服务器、原失败/跳过及清理记录核定；不足以据此宣称窗口查询实际执行、安装产品或跨平台验收完成。无需重跑或改写原21项来替代本专用缺口。
