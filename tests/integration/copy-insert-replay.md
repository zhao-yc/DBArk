# 复制 INSERT 的真实解码回放准备

`engine-copy-insert-replay.integration.test.ts` 默认关闭。目标/认证读取和引擎动态导入均留在准备钩子；Vitest列表只收集定义，即使双门都开也不运行钩子。显式传递到worker的列表参数还会优先短路许可门。Root核对本轮目标后，同时显式注入 `DBARK_INTEGRATION_ENABLED=1`、`DBARK_COPY_INSERT_REPLAY_ENABLED=1` 和既有 `DBARK_TEST_HOST/PORT/USER/PASSWORD/TLS`；13484还须原严格TLS的 `DBARK_TEST_CA`。每轮仅指定200的一个既有隔离端口，支持13357/13380/13384/13310/13311/13484，不建用户、不授权、不生成证书、不读配置文件或调用剪贴板。

Root未来可单独运行 `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/engine-copy-insert-replay.integration.test.ts`。两项各新建随机 `dbark_colperm_<12hex>` 库及带本轮注释令牌的source/target普通表，分别使用独立会话的普通严格模式和 `ANSI_QUOTES,NO_BACKSLASH_ESCAPES` 组合；每项主体与准备各60秒、收尾30秒，零重试。测试通过真实 `connect(profile)`、`Engine.table.page` 和 `query.execute`，实际调用 `buildCopyInsertSql`；只对生产连接的close加严格收尾观察，不伪造驱动或SQL结果。

断言覆盖精确BIGINT/DECIMAL、JSON与文本引号/反斜杠/NUL/多字节、空与NULL BLOB、BIT64及日期/时间微秒，逐条INSERT零warning、真实解码及独立观察完整投影相等、源表不变。夹具不使用被测生成器造数。严格关闭复用生产close；清理复用已审 `cleanupD02Copy`。任何命令/创建/对象归属未知、未终态、严格关闭失败都不补DROP或重放；后续模式停链，交由Root核对。清库前要求精确两个普通表、注释、完整SHOW CREATE未变及无额外触发器/例程/事件。它不提供新表物理tableID归属保证，也不覆盖原生剪贴板、GUI、安装或跨平台体验。

本提交仅准备代码和纯验证，实际DB/SSH/GUI/剪贴板/200/CI/安装/Docker/私料读取均为0。默认关闭的两项跳过不算实库通过；六实例实际回放均待Root统一安排。
