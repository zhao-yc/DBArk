# SQL只读结果列管理

## 交付范围

从Root固定基线`8c6240abc5bf4c30af4846c5bbbdb06ae2e0cdf3`建立普通clone与独立分支`codex/employee2-query-result-column-view-20261017`，不使用工作树；原字段排序分支保持不变。原ResultsGrid和QueryTab没有结果列显隐／顺序管理入口。

结果工具栏新增“管理结果列”。对话框可按名称、类型或原列序号搜索，按唯一内部key勾选显隐，上／下移动，恢复原始顺序；恢复顺序保留显隐选择，始终至少留一列。重复／空别名显示原始返回列序号，不能以别名认领另一列。搜索只改模态局部状态，不执行SQL、加载数据库数据或复制整份结果。

列草稿在点击“应用列布局”后生效，取消不改原显示。布局只保存于当前QueryTab的内存，不写outcome／pinned对象或表页列偏好。新执行的outcome获得新上下文；切结果和固定快照均更换绑定。网格保留原始rows引用、虚拟DataGrid及rowIndexes memo；只重排／投影列描述，不为每次输入复制行字典。

## 选择、复制和导出合同

沿原ResultExportSelection准确result、rows、columns、逐行引用、列元数据及context绑定增加visibleColumns及其顺序快照。布局变化必定产生新绑定，原行选择同时失效；旧网格不能用旧回执重新接纳选择。整行键数量及隐藏值漂移依然使原选择失效：只保存受原2000000源单元格预算约束的浅值摘要，不把隐藏内容加到输出。没有放宽原父接纳门或改变共享协议。

网格勾选行复制按当前可见列顺序读取原始CellValue，单格复制须来自准确行和可见列。所有网格动作均核scope、所属组件lifetime和父操作门；拒绝时不写ClipboardEvent数据。BLOB只读查看器打开及关闭也切换本地代次，旧回调不能借模态关闭复活。复制仍使用原typed＋TSV协议和50000单元格／字符预算，NULL、空串、Base64包装及BIGINT／DECIMAL精确字符串不作数值转换。

“导出已返回结果”和“导出勾选结果行”均在打开窗口时生成独立的可见列快照。仅在该动作或接纳勾选时创建投影行字典；每行恰含所导出列的自有key，使用无原型字典保护__proto__。隐藏值不进入文件请求。逐行先复用共享字段／单行校验，再累计不小于共享计量的UTF-8预算，超过32MiB立即停止，最终再通过原validateResultExportData后才深克隆。行、列、2000000单元格、字段256KiB、行1MiB和总32MiB上限均未提高。

原ResultExportDialog保持文件选择、格式、编码、确认、原子写入及任务协议。原ResultFileTasks按传入列数组顺序写CSV及JSON键值，不依赖行对象枚举顺序，本任务没有修改该引擎。窗口打开后的布局、勾选或原值变化不改变已冻结范围；关闭后不能用原绑定再次导出。

## 同步失效

新执行、切结果、固定／释放快照在原setState之前撤销选择。列管理打开时先更换网格回执；应用／关闭时再撤销本次租约。模态草稿也绑定当次列列表，旧行闭包不能用旧位置操作新排列。

直接订阅workspace检查activeTab、准确查询标签、连接和连接修订、activeJobs；B→A即使React合批也不复活旧租约。父接纳门仍活读busyRef、lifetime、工作区及DOM模态。自有模态在打开／关闭前同步撤销；MutationObserver补充其它组件的模态出现和移除，包括同一批次已添加又移除的dialog记录。只给本次列管理owner豁免其唯一模态，外来模态仍永久撤销本次管理。卸载结束全部旧回调，不借其它结果重领。

## 验证及证据

专属纯草稿／投影11项、真实React＋RAM23项，连同原选择、网格、QueryTab接纳端口、导出对话框与共享导出边界42项，共76项通过，0跳过。覆盖显隐／顺序／恢复、重复别名、__proto__、精度和BLOB、最少一列、隐藏数据不进CSV／JSON请求、打开时冻结、布局清选择、源行／隐藏值漂移、旧管理行闭包、切结果／固定快照／新执行、连接／作业／标签ABA、外来模态和二进制模态收尾。

专项运行真实QueryTab、列管理器、ResultsGrid逻辑、ResultExportDialog及store，仅将Monaco、虚拟网格外界渲染和IPC替换为RAM端口；复制只用RAM ClipboardEvent，files.choose／files.exportResult只记录RAM请求并运行原共享校验，没有操作系统文件选择、写出或系统剪贴板。RAM不能代替原生GUI或实际文件验收。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-result-columns.test.ts tests/unit/query-result-columns-ui.test.tsx tests/unit/result-selected-export.test.ts tests/unit/result-selected-grid.test.tsx tests/unit/result-selected-query-port.test.ts tests/unit/result-selected-dialog.test.tsx tests/unit/result-export.test.ts --maxWorkers=2 --reporter=json --outputFile=.cache/query-result-columns/final.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

类型检查及最终固定源码证据见本普通clone的`.cache/query-result-columns/`交接记录。没有full、build、安装、Docker、实际DB／200、GUI、文件导出、系统剪贴板或CI执行；正常代码push不代表生产或实际验收授权。CI按该固定SHA另行只读核验，未取得结果不得写成通过。

## 默认关闭的正式SQL列布局验收卡

本节仅为备用任务卡，没有新增或运行正式入口，也没有list。状态为关闭，等待Root明确调度、固定整合源码／产物摘要、单worker零重试、专属桌面owner和原始期限。不得复用或清理Root已有旧Maria5原生现场，不声称全局native0，不申请共享系统剪贴板。

Root选择已批准的只读连接及独立查询标签，使用只返回常量的SELECT覆盖重复别名、NULL、空串、精确BIGINT／DECIMAL字符串和二进制包装；记录查询实际执行一次。打开列管理搜索原序号、隐藏一列并重排，确认至少一列、恢复顺序保持显隐；网格与原值对应，整个布局操作不增加任何查询。固定快照单独改布局后原outcome和pinned内容不变。

原生验收复制如需覆盖，先由Root明确本轮剪贴板方式和归属；本卡不授予系统剪贴板权限。可先在专属页面只投递合成ClipboardEvent并读取RAM结果，比对可见列及原值。实际CSV／JSON文件验收另需Root明确的保存对话框授权及文件目标，检查隐藏列完全缺席、可见列顺序相同、重复标题按既有规则映射、精度与NULL／空串／二进制不丢失。导出打开后变更源布局或结果，应保留打开时固定内容，不能重执行查询来填充文件。

切结果、固定／释放快照、新执行、连接修订ABA、忙碌、模态和关闭后，保存的旧管理／网格回调都应拒绝。失败、未知或退出未确认保留本owner现场，停止后续动作，不全局杀进程、不借其它窗口处理认证、不自动删除测试文件或旧资源。成功后也只按Root授权处理本例资源，不能以本卡准备完成宣称正式验收通过。
