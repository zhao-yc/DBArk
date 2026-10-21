# 筛选草稿批量启用与停用

后继准确3005511的[Windows首次GUI](../../tests/integration/acceptance-query-result-filter-bulk-3005511-20261021.md)已失败停链：147项准备通过，停用草稿后原网格客户区89低于96门，未完成该步ID比较，取消／分组／导出／Python未到达。原251封存及unknown资源事实保持。产品[滚动条空间修正](query-result-filter-scrollbar-20261021.md)已按原几何构造父红新绿，类型／156项／构建通过；同一原GUI须新准确头复验，不放宽门。

准确b61的[完整CI日志记录](../../tests/integration/acceptance-bulk-enabled-ci-20261021.md)已四检查job成功，三平台源码／同次安装legacy均80通过／317条件跳过；本轮未独立审计其成功ZIP。后继300的Windows离线查找夹具启动失败另记，不用b61通过覆盖，不视为批量功能GUI通过。

固定源码提交`b61b19271ebd213fa22e9f65040f70e34e356b7f`已推送main，src树`97162ea158e662ab09b8b25c97ecad1b563c3cef`；[完整CI39546340655](https://github.com/zhao-yc/DBArk/actions/runs/39546340655)已启动，最终结果另记，不沿用c449的CI代替本批。

## 实际入口

“本地条件筛选”底部新增“全部启用”和“全部停用”，作用于根组及所有子组的叶条件。只修改当前草稿的启用位，保留稳定ID、分组AND／OR、字段、操作符、原值、区间、成员和大小写选项；不扫描结果、不执行SQL，仍须显式应用。

全部停用并应用后按既有控制器恢复准确原source；重新全部启用后重新校验条件，坏草稿会拒绝应用并保持原视图。取消保留已生效树，空草稿或已达目标状态时按钮禁用；输入法组合、旧草稿及移除节点后的迟到回调不能批量覆盖当前输入。不增加条件、分组、深度或比较预算，不改变单条启停合同。

## 验证

本轮远程连接仍有不可达，按用户本机回退授权执行一次：

```sh
node scripts/check-local.mjs --build tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-filter-enabled.test.ts tests/unit/query-result-filter-groups.test.ts
```

原CLI PID75732，创建2026-10-21T04:47:12.0581753Z，exit0、73.0054457秒；子进程无DBARK_*变量。类型27.93秒、三文件143项全通过、无失败／跳过，Vitest9.21秒；普通构建34.81秒、Vite33.94秒。保留原Rollup注释及大分块警告，没有启动客户端、数据库或系统剪贴板操作。

新增三项RAM组件用例通过真实QueryTab／筛选组件及控制器，覆盖多层组批量停用／恢复、显式应用、空草稿、已达状态、取消、旧批量回调、输入法、坏值重启及空结果保持，断言仅一次原查询。原日志位于`.cache/filter-bulk-enabled-20261021/`，stdout摘要9c5d9d1d4dafa43e9451ac3111725fa89f59e639232a5e8a95240b49e94362f7，stderr摘要e073854a60aba060efc1240612fa2b3f4e5f4a8a93beb0075c1c2b4faffac6bf。

## 未验边界

准确b61的完整CI39546340655中，Linux检查现已通过：类型、593文件11481项通过／10平台条件跳过、Vitest147.55秒、普通构建成功／Vite24.12秒，独立Python反例21项通过／0.189秒。三平台原生及安装继续运行，不提前记为通过。后继准确30055118eb1261dea5fef6f3e94261a3e31c373c只扩展真实整例和操作单，src树保持相同；批量按钮的147项准备／GUI／条件读回已交VM串行执行，不重复原c449准备。

当前是源码、RAM组件和构建证据，本批批量按钮的原生GUI、安装、macOS及完整CI另验。正在WIN11-TEST运行的c449单条启停／复制导出整例固定旧准确提交，不含本批新增按钮，不能计为批量按钮通过。保留其原进程，不重复派发或切换目标；暂不发布，完整工作包计数不变。
