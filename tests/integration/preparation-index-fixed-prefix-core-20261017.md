# 已有表CHAR/BINARY前缀：三个独立关闭态核心case

固定源码基线为 `212bdaa77abf618b51e7817b8ebb6c67f2fc8e45`，父链依次包含 `047d54c` 和 `cd827a5`。基线来自已推 `origin/codex/employee3-index-prefix-length-20261017`，不是只停在047的CHAR/BINARY初版。任务分支为 `codex/employee1-index-fixed-prefix-core-20261017`，使用现有干净普通克隆切分支，无worktree。

只新增专用入口、live、一个纯辅助、两个必要纯测试文件及本文。生产、旧 `engine-index-patches.integration.test.ts`、共享fixture/helper、原测试配置和安装计数全部不改。

## 默认关闭与真正Vitest list

入口为 `tests/integration/engine-index-fixed-prefix.integration.test.ts`。三个标题总是可收集；环境门和live动态导入均放在case体内，因此真正 `vitest list` 不执行任何环境读取，也不加载认证、Engine或驱动。默认运行到case体时，仅总门和 `DBARK_INDEX_FIXED_PREFIX_CORE` 同为1才加载live，否则skip。三个case在 `describe.sequential` 内串行，retry/repeats均为0。

每次只选择一个端口，没有六端口循环。Root后续须使用固定源码和精确文件过滤，避免顺带加载旧integration的宽松门控入口：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs list --config vitest.integration.config.ts tests/integration/engine-index-fixed-prefix.integration.test.ts --json
```

该命令仅列表。本文不提供认证值、证书内容或已开启的实际执行授权。Root旧现场完成独立处置之前，真实运行继续关闭。

## 六准确目标及显式合同

| 端口 | 方言/准确版本 | TLS |
| --- | --- | --- |
| 13357 | MySQL 5.7.44 | 显式0 |
| 13380 | MySQL 8.0.46 | 显式0 |
| 13384 | MySQL 8.4.11 | 显式0 |
| 13310 | MariaDB 10.11.19 | 显式0 |
| 13311 | MariaDB 11.4.13 | 显式0 |
| 13484 | MySQL 8.4.11 | 显式1、原严格CA合同 |

必须由Root显式注入 `DBARK_INTEGRATION_ENABLED`、`DBARK_INDEX_FIXED_PREFIX_CORE`、`DBARK_TEST_HOST/PORT/TLS/USER/PASSWORD`；空密码必须明确存在。MySQL另需本轮 `DBARK_TEST_EXPECTED_SERVER_UUID`；Maria另需 `DBARK_TEST_EXPECTED_SERVER_HOSTNAME/SERVER_ID/SERVER_PORT`，其中SERVER_PORT为实际监听端口，不能拿13310/13311发布端口代填。13484另需已有 `DBARK_TEST_CA`，保持产品原证书/主机验证；不加入SSH、客户端证书、私钥或降级逻辑。

主机只允许 `192.168.31.200` 或 `deve-server.yinzon.com`。绑定后的实时raw变化永久失效；每次connect的实际profile还精确核id、主机、端口、方言、账号、密码和TLS。每条实际Engine短连接都在交给Engine动作之前读取准确版本和身份，不能只用观察连接的身份替代它。

预检先于任何隔离DDL。核Linux、大小写模式0、16KiB页、普通SQL模式、autocommit/foreign_key_checks/unique_checks/严格InnoDB/SHOW引用均为1、utf8mb4 MAXLEN=4；5.7另核large_prefix。Maria不查询MySQL UUID/GIPK变量。原生产连接初始化及结构读取会设置本短会话的跟踪、检查或SHOW模式；本准备不添加全局设置，预览零DDL不等于会话零SET。

## 只有三个真实case

1. **字符/字节及原属性保持**：普通原索引 `old_c(c(2))` 单次替换为 `c(3),b(2)`，CHAR按字符、BINARY按字节。真实get的columnRef/indexRef生成结构化patch，preview前后独立快照相等，apply一次且完整后核。独立SHOW只允许指定索引行变化；STATISTICS.SUB_PART、原索引注释、全部列元数据、旁键、表尾、有序字符HEX及BINARY完整HEX分别比较。
2. **3072/3073发送前边界**：三个CHAR(255)按真实MAXLEN=4计3060字节，BINARY前缀13总计3073，必须在preview拒绝、无ALTER且原快照不变；前缀12总计3072才产生预览并单次apply，独立目录必须为255/255/255/12，无警告或自动截短。
3. **真实唯一前缀1062**：两行完整字符值及完整二进制值不同，但 `c(1),b(1)` 的组合前缀相同。要求真实ERR三字段精确为errno1062、ER_DUP_ENTRY、23000，保留原failed/ddlSubmitted=true/ddlCompleted=false/outcome=unknown。原SHOW、目录、列和数据必须完全保持；旧令牌调用只验证缓存拒绝，不能产生新连接、任务事件或ALTER，不新预览重试。

夹具为本例51字符随机库名 `dbark_fixed_prefix_<32位十六进制>` 内唯一普通InnoDB/DYNAMIC表。独立观察连接只操作该库和合成两行数据；BINARY(255)的补零包含在完整510位HEX比较中。公共诊断不保存认证、完整连接参数或原令牌。

## 生命周期与1062的清理边界

原integration的 `testTimeout/hookTimeout=30000` 不改。case体在任何异步导入前建立owner，使用Vitest已建立的 `task.result.startTime` 扣除已用时间后映射至单调截止；缺失开始事实、变更预算或超时均拒绝继续。afterEach先置本地sticky，active/pending未结束、迟到导入/连接/回包均不能恢复许可；前case保留则停止后续case。

测试私有spy完整透传实际connect、原Query对象、回调this/参数和close结果，不模拟数据库响应。每条连接捕获准确owner/task/profile、实际native/threadId/stream；记录原查询回调是否结束、ALTER投递调用次数、strict close调用及真实同流close事件。ALTER计数不是服务器全局语句审计，1062还须有真实ERR回调。其它目标ALTER在发送前拒绝。`connections.open`沿原非strict关闭，额外等待捕获的同流close事件，不升级产品关闭选项或把Promise end当close。迟到connect先捕获原native，再由sticky门拒绝后续查询；成功/失败诊断仅输出归属、投递和关闭事实，不输出认证、SQL、令牌或行正文。

1062只作为预设服务器ERR分支接受，消息包含1062不能通过。Engine可能保留原1062而遮住finally内close失败，因此旁观账本独立保留closeFailed；即使另一处显示任务failed或原DDL相同，也不能覆盖它。没有准确任务、原回调已结束、同native/stream及真实close等全部证据，资源门立即sticky，不调用closeAll取消换取许可，不DROP。

正常清理顺序为：全部准确任务及原生资源已终态 → Engine.closeAll仅释放已空闲实例 → 再核准确UUID/Maria指纹、库选项、唯一普通表、全部原定义和数据 → 单次精确DROP库 → 查询不存在 → 观察连接strict close及同流真实close → 恢复本测试spy并关闭active门。没有失败finally兜底DROP或空processlist即清库路径。首次建库ACK前仍有名称归属不确定性；ACK不明保留，不重试。不存在新增物理table ID保证，检查到清理之间的竞争窗口也未被消灭。

## 本地必要验证及实际0

- 新增41项纯测试通过：25项覆盖六目标、真实透传、准确task/owner/native/stream、1062与隐藏close失败、非strict正常close事件、30秒与迟到、正常收尾及零DROP反例；16项入口转译测试覆盖真正list收集、默认门及双开RAM注册。
- 固定生产源码定向正常对照：CHAR/BINARY新增、3072/3073、原属性保持及212长度冲突，共12项通过，其余78项本轮跳过。
- 父红：ignored隔离副本仅将 `tableIndexMetadata.ts` 覆盖为047版本；212新增的四种类型“词法等价空白不能让目录256绕过声明255”共4项预期失败；当前212相同4项通过。这是该组件的定向父红，不是整个父版或实库验收。
- 实际 `vitest list --config vitest.integration.config.ts <精确新入口> --json` 在双门关/开均只收集3个唯一身份。`tsc --noEmit` 通过，未构建安装包。

必要命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/index-fixed-prefix-core.test.ts tests/unit/index-fixed-prefix-list-guard.test.ts
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-index-fixed-prefix.test.ts tests/unit/table-index-metadata.test.ts -t '可新增普通前缀|3072|替换只改指定索引|词法等价空白不能让目录256绕过声明255'
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本轮实际DB、GUI、SSH、CIM、private材料读取、系统clipboard、CI、安装、Docker及200访问均 **0**。未检查、退出或修改Root旧五进程现场。三个场景仍是关闭态准备，不增加正式通过或安装验收计数；真实六组合由Root后续统一核定资源后安排。
