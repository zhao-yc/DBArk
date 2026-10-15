# 真实 SQL 结果类型 UI 验收准备

新增 `tests/e2e/query-result-types-live.spec.ts`，只新增用例和本说明。复用 `desktop-fixture`、`live-helpers` 的真实连接表单、随机 `dbark_e2e_*` 库、退出和精确清库流程，trace关闭；IPC仅包装原处理器记录命令及完成计数，不记录参数、SQL或认证，不伪造数据或返回。

默认未设置 `DBARK_INTEGRATION_ENABLED=1` 时，在自动桌面夹具启动前跳过。实库helper只在启用的测试体动态加载，默认不读取本地凭据文件。启用前必须显式注入已核对的 `DBARK_TEST_HOST=192.168.31.200`、合法 `DBARK_TEST_PORT`、`DBARK_TEST_USER`、`DBARK_TEST_PASSWORD`，不回退业务库配置。

observer只在本例随机库建立一张合成小表、插入两行并读HEX原值。字段包括TEXT、LONGTEXT、BLOB、VARBINARY和nullable TEXT；两行分别提供非空字节、零字节、NULL及文字。产品查询编辑器通过真实SELECT读取，同一SELECT包含文字与字节的重复别名。

测试先逐屏收集实际渲染列头的名称、协议类型和aria-colindex，再按真实坐标定位单元格，不猜c0，也不根据重复标题读值。断言文字／nullable TEXT的实际协议描述是BLOB；所有文字及NULL分别双击、Enter均无二进制弹窗。BLOB和VARBINARY的非空与空值分别经双击、Enter打开只读查看器，逐字节核对、无暂存按钮，重复别名标题按可见name而值来自所点坐标。

每轮查看后断言真实query.execute仅1次且已完成，table.preview/apply为零，observer逐项HEX及NULL原值保持。观察包装在退出前恢复；失败保存脱敏命令摘要、已取得的实际列头附件和当前页面截图，既有helper继续先退出应用再清理本例随机库并核对删除，桌面夹具最后清理临时用户目录和本次进程。

```powershell
# 由统筹注入已核对200临时测试账号；密码不写仓库、报告或轨迹。
$env:DBARK_INTEGRATION_ENABLED='1'
node node_modules/@playwright/test/cli.js test tests/e2e/query-result-types-live.spec.ts --output .cache/query-result-types-live
```

本次仅完成类型检查和默认跳过验证，不在员工电脑运行200，不启动新的GUI或读取根凭据。此入口准备不等于实库通过；后续真实源码运行、产品主进程IPC及安装产物来源分别由统筹注明，不能混为既有455候选已验证。
