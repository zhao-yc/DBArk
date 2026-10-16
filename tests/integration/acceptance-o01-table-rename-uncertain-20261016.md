# 表重命名未核验与未知结果的名称链接退役

本补丁直接基于`361b7bec6503d7d4c8fae6d86c7d8a9eae614ad4`，分支`codex/employee1-rename-uncertain-20261016`。员工2固定361的独立审查仍有三项失败：实际Engine两种后核验失败回执进入App，以及真实弹窗的结果未知回调，都只刷新目录、废弃在途请求，没有阻止之后再次打开旧名称URI。来源名称被外部另一物理表复用时，v1名称链接仍可能指向另一表。

## 修复行为

- `finishTableRename`在收到DDL已发送或已完成、但未完整核验或缺少物理身份凭证的回执时，把来源和目标名称均按未知身份退役。保持原回执、DDL完成事实和未核验提示，不迁移收藏、不关闭旧标签、不调用成功完成路径。
- 真实`TableRenameDialog.onExecutionUncertain`对同一连接版本下的来源和目标名称执行相同退役，继续刷新目录、标记结构过期和废弃在途请求。只未发送DDL的防御输入不会退役名称；连接配置版本变化后也不会退役新配置的同名对象。
- 不使用未完整核验回执中的`after.physicalIdentity`恢复名称，不重放DDL。完整核验的同一物理表a→b→a仍可恢复导航；已知不同身份或未知身份的名称历史不能被后续完整回执抹除。
- 当前v1 URI只携带名称，存在身份歧义时来源和目标同名新URI也保持拒绝，提示从真实对象树人工核对。跨重启和未观测外部替换仍保持原切片边界。

产品代码只调整`App.tsx`的两处结果接线；Engine、SQL、权限阶段、物理身份算法、导航历史算法、共享接口及Sidebar/CSS均未改动。自增功能冻结在已推送的独立分支`codex/employee1-auto-increment-20261016`（`4fa6155`、`5f3a2c5`），未混入本补丁。

## 独立原探针复现

原报告只读来源为员工2克隆`.cache/parallel-20261015/q07-explain/.cache/review-table-rename-361b7be.md`；原四组探针和两份实际Engine回执在其`.cache/review-rename-361b7be/`中。逐字副本与SHA256保留在员工1克隆`.cache/table-rename-uncertain/original/`及`provenance.json`，未修改原报告和其他克隆。

原探针摘要：

| 文件 | SHA256 |
| --- | --- |
| strict-engine.test.ts | d0fd73e7990f791780b305d8b10570a45593fc838d19e53bce949221c104313d |
| strict-app-navigation.test.ts | 518353fb830bcd0bca86bdd50b1fe27f7cd31c1b6c95da74ffb192afa1945107 |
| independent-permission.test.ts | 9dbf7e5593c2e2db739b30ab79babb80f35c0d9906b0f5ec28dfa8f5eea5d8c6 |
| independent-navigation.test.ts | f7b2a7a4d9b1c7cfa7a0542360d0d4341c0fa9ecf6accf15251f7040421c07ad |

只适配固定源码导入、AST源码读取及本克隆输出路径，原断言没有改动。每个阶段先运行真实Engine的驱动替身探针生成两种回执，再由真实App方法与JSX回调提取探针读取该阶段输出；没有用测试里手动退役替代App调用。

| 阶段 | 结果 | 本克隆证据 |
| --- | --- | --- |
| 固定361源码归档 | 30项中27通过、3失败 | baseline-source/、baseline-results.json、baseline.log |
| 修复后最终源码 | 30项全部通过 | current-results.json、current.log |

以上路径均以`.cache/table-rename-uncertain/`为前缀。后读失败和物理身份变更两种回执保持`ddlCompleted=true`、`definitionVerified=false`；后者虽有after凭证也不能恢复名称。原权限、不同身份、同身份往返和迟到结果对照均保留。

## 常规验证

新常规单元`table-rename-app-navigation.test.ts`保留原6项实际App探针，增加未知历史/迟到结果、连接版本隔离和未发送DDL/跨连接数据库对照，共10项。原两份实际Engine失败回执作为类型化协议夹具保存在`tests/helpers/tableRenameResults.ts`；不是实库数据或构造的成功回执。常规单元使用真实目标保护函数、工作区、导航和收藏迁移，IPC边界及组件setter使用替身。

- 重命名专属6文件77项通过。
- 相关回归15文件178项通过，覆盖重命名、注释、默认编码、迟到取消、工作区和列偏好；布局持久化组的TEMP/TMP限定本克隆`.cache/table-rename-uncertain/tmp`。
- TypeScript类型检查通过；主进程、preload和前端构建通过，保留现有前端分块体积提示。

实际命令：

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/table-rename-uncertain/baseline.vitest.config.mts --reporter=json --outputFile=.cache/table-rename-uncertain/baseline-results.json
node node_modules/vitest/vitest.mjs run --config .cache/table-rename-uncertain/current.vitest.config.mts strict-engine.test.ts --reporter=json --outputFile=.cache/table-rename-uncertain/current-engine-results.json
node node_modules/vitest/vitest.mjs run --config .cache/table-rename-uncertain/current.vitest.config.mts --reporter=json --outputFile=.cache/table-rename-uncertain/current-results.json
node node_modules/vitest/vitest.mjs run tests/unit/table-rename-app-navigation.test.ts tests/unit/engine-table-rename.test.ts tests/unit/main-table-rename.test.ts tests/unit/table-rename.test.ts tests/unit/table-rename-tree-refresh.test.ts tests/unit/ui-workbench-navigation.test.ts tests/unit/engine-table-comment.test.ts tests/unit/main-table-comment.test.ts tests/unit/table-comment-ui.test.ts tests/unit/engine-table-default-encoding.test.ts tests/unit/main-table-default-encoding.test.ts tests/unit/engine-structure-late-cancel.test.ts tests/unit/ui-store.test.ts tests/unit/ui-table-column-preferences.test.ts tests/unit/table-preferences.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

独立探针和常规测试均为纯命令验证。没有GUI、实库、200服务器、剪贴板、Docker或worktree操作；实际Electron与数据库验收由ROOT在固定集成提交继续执行。本轮没有新增持续运行服务。
