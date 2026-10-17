# MySQL8.0.46新建表：默认关闭的准确组合实证入口

本片从固定准备提交 `12d0779ff977852304cfb92c413026aab23f2d2e` 另建独立分支 `codex/employee4-table-create-mysql80-live-20261017`。Root授权在其8.4验证后补齐真实只读适配器和正式注册；本轮仍为actual0，不表示8.0.46已验收。不修改Root、745、12d原分支或FK固定分支，不使用worktree。

## 接线及准确目标

- 新 `tests/e2e/table-create-mysql80-live.ts` 注册一例真实创建流程，保留Root固定 `869364d018c170db33013bd18057b86b655ee5be` 的创建主体及本例终态/失败处理。它包含 `a7349b14ff3f85f806cde2d0f4e5f61a37baf122` 的三处断言：预览后目标仍不存在、唯一apply已完成、关闭确认后原连接树看到准确新表；另包含869的库目录显式click及aria-expanded断言。未缩短/扩展timeout或添加retry。
- 入口list在任何env读取前短路。只有 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_TABLE_CREATE_MYSQL80_UI=1` 才可能加载准确版本定义。先核原始自有字段及明确凭据，再检查 `.cache/dbark-test.env` 不存在；若存在直接拒绝，不读取内容，不加载可能回填的helper。直接调用register也有同一门。
- raw USER及PASSWORD都必须是本轮明确提供的own字符串，并与helper逐值相等；缺失、回填、替换或原型继承拒绝，显式空密码合法。register在第一次await前保存本轮六项快照，关键归属检查同步重核raw与helper，不能中途重绑已核目标。
- 只安排 `192.168.31.200:13380`、显式 `TLS=0`、准确MySQL8.0.46（允许无空白的发行后缀）、Linux/debian-linux-gnu、lower_case_table_names=0、规范36字符Root本轮UUID。实际服务器的方言沿产品逻辑从版本识别，不能以端口或用户标签代替。

## 任何隔离DDL前的实际只读适配器

`tests/helpers/tableCreateMysql80Adapter.ts` 为原12d准备端口提供真实实现：无默认库、无SSL/SSH选项，使用已固定凭据打开连接，只发固定服务器事实SELECT。校验失败也要先确认只读连接严格关闭；打开、读取、归属或关闭未知立即保留并停链，不重试、不借取消或退出继续建库。

strict close调用产品 `closeMysqlConnection(connection, true)`，要求可观察的底层流，并等待QUIT写入与底层close。不得将Promise版end返回、取消ACK或纯测试替身当实际资源证明。只有预检通过且严格关闭完成后才调用原 `isolatedDatabase`，因此不会先建隔离库再核Root UUID。共享helper的观察连接进入主体后也重核准确版本、OS、名称模式和UUID。

无额外生产语义修改：Engine、新建表协议/确认项/生成器、普通MySQL/Maria能力和旧8.4 live/spec全部保持。准备profile仍是事实范围说明，`canWrite=false`不作为通用创建的新开关；新正式例由明确双门及准确前置安排，8.0实证结果仍等待Root。没有修改共享fixture、cleanup、defaultelse、quitDesktop或Playwright配置。

主体及本例终态判断沿Root版本：预览不产生目标、准确确认保留尾空格拒绝、两个确认项、单次创建、精确默认值/主键/唯一索引、准确对象树刷新。任务读取或apply终态未知即保留，退出未知不继续DROP清库。仅复用已有隔离清理链，不以本轮纯回调测试替代实际原生退出/六资源验收。只读预检与后续连接不构成跨连接原子绑定；Root仍须按独占运行和资源归属流程完成真实验证。

## 纯验证与收集

自己的ignored配置 `.cache/table-create-mysql80-live/vitest.config.mjs` 禁用envDir，worker守卫拒绝真实网络、实际子进程、私料读取和密钥生成。仅复用已有依赖，没有安装或构建。

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/table-create-mysql80-live/vitest.config.mjs --reporter=json --outputFile=.cache/table-create-mysql80-live/pure-results.json
node node_modules/typescript/bin/tsc --noEmit
```

7文件累计138项通过：首轮137项通过，增加任务读取未知反例后正式回调23项复测通过，其余6文件未改。分项为准备profile20、目标/凭据/停链45、入口/list18、真实适配器RAM驱动9、实际register与原隔离函数RAM端口23、旧列表门12及旧8.4预检11。适配器测试实际运行产品strict close，但底层流仍是合成RAM端口；正式回调的UI也仅RAM端口，不是GUI验收。TypeScript `--noEmit`通过。

双门显式开启的真正CLI只运行list：

```powershell
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_TABLE_CREATE_MYSQL80_UI='1'
node --require ./.cache/table-create-mysql80-live/guard.cjs node_modules/@playwright/test/cli.js test tests/e2e/table-create-mysql80.spec.ts --list --workers=1 --retries=0 --trace=off --reporter=json
```

只收集原默认关闭身份，errors为0、results为空；没有加载live或认证模块，没有实际例执行。Root 869固定源码的来源blob、主体复用摘要与最终文件哈希保存在本片ignored交接证据。

本轮GUI、DB、200操作、私料、clipboard、Docker、CI、安装、构建和生产部署均为0。由Root独审后在新的隔离库安排8.0.46实证，不自动合并或部署。
