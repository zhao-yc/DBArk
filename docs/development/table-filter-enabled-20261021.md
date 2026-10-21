# 表数据筛选条件启用与停用

## 功能

表页已应用的每条筛选条件增加启用勾选和明确的启用／停用文字，并提供“全部启用”“全部停用”。切换保留条件顺序、原值、NULL判断、全部／任一组合及排序，从第一页重新读取服务器；批量操作只产生一次分页请求。拒绝整页丢弃确认时原筛选及数据草稿保持；编辑停用条件不会隐式启用。

缺少`enabled`字段的旧条件默认启用。`enabled:false`只排除谓词和参数，全部停用时不生成WHERE；分页仍以当前排序及可靠行键处理并列项。停用条件仍计全部数量／值预算，仍校验字段存在，不能借停用绕过格式与体积限制。外键关联的强制范围不因停用附加筛选而放宽。

IPC和命名方案共用严格布尔字段，不接受字符串、数字或NULL。现有方案和SQLite配置保持可读；新保存的方案保留启停状态，真实文件重启已验证。旧版客户端可能拒绝含新字段的方案；降级前备份完整用户目录并按原备份恢复，不手工删除或降低配置版本。

## 已完成源码验证

```sh
node scripts/check-local.mjs --build tests/unit/table-filter-enabled.test.ts tests/unit/table-cell-filter-ui.test.tsx tests/unit/table-presets-storage.test.ts tests/unit/ui-table-filters.test.ts tests/unit/ui-table-presets.test.tsx tests/unit/engine-sql.test.ts tests/unit/references.test.ts
```

本机按已授权的远程不稳回退执行独立新功能检查，不接续VM旧c54回合。执行会话43614退出0，总66.88秒：类型27.15秒、7文件111项全部通过（单元4.24秒）、普通构建35.49秒／Vite34.70秒；既有注释及大包警告保留。覆盖严格IPC、AND／OR活动参数、精确值、全停用、未知字段、外键范围、预算、真实SQLite保存重启、原方案兼容、脏稿拒绝／确认、旧编号回调与非活动表页保护。

## 窗口验证

`table-sort-panel.spec.ts`在原14f174d4已通过的完整排序流程后，新增单条／批量启停、任一模式、编辑停用条件、恢复启用与排序保持，仍为120秒／零重试、最多16次正式分页。准确62224ddc的[本机Windows源码实库单例](../../tests/integration/acceptance-table-filter-template-62224dd-20261021.md)现已通过：CLI52172 exit0／11.9646107秒，16次正式分页，121行及定义保持、正常退出、精确清库与三条辅助连接关闭。安装、macOS及其它组合继续，暂不发布。

准确313bcb577e439180125511f6d22adcd3a781faac、src树dcffb43a5c7875c8badeb267efbace70ed6ed8a1已推main。首次向WIN11-TEST派发两例时返回`App server request expired while queued`。后续核原c54 completed且远程读取失败，成功发送取消后由Root按授权回退；测试会话明确确认未启动任何313新回合、无原生PID。新成功轮固定62224ddc，未重复VM回合，旧c54副本、App、库及日志保持。
