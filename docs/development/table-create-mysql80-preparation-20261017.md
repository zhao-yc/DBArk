# MySQL8.0.46新建表：准确版本兼容准备

本文记录固定12d0779的准备状态。后续已按Root授权补齐默认关闭的真实适配器和正式注册，当前接线、验证及未验收边界见 `table-create-mysql80-live-20261017.md`；下面的仅skip/无真实适配器描述属于12d历史，不代表后续入口现状。

本片基于固定 `745cdc7acbef9b5da643f3b85e733dc2247176d0`，在员工4普通独立克隆另建 `codex/employee4-table-create-mysql80-prep-20261017`，不用worktree，不向原745分支追加，不修改Root候选。仅准备准确版本合同、未来正式入口占位、目标/凭据/事实门和未知停链的纯反例。准备不等于产品、真实数据库或UI已验收；Root先验8.4后还须另行授权和提交激活。

## 已读生产边界

1. `src/engine/tableCreateTasks.ts` 没有按准确版本启停通用创建的profile：原MySQL/Maria普通创建路径已经包含8.0.46。`read`读取实际会话、服务器、MySQL UUID及精确库目录，快照绑定身份/版本/模式/修订；`verify`同时核SHOW、COLUMNS、表属性与STATISTICS。类型词法保留ENUM/SET文字量，完整列索引核前缀/方法/方向，FK未独立核验时仍明确不完整。
2. `src/engine/index.ts` 的独立任务等待取消控制终态和严格close，只有实际收尾明确才发内部 `onResourcesReleased`；`tableCreateTasks`还要求DDL未发送或已有完成事实才释放用途目标锁。未知DDL/关闭不能用取消ACK或finally无条件解锁。
3. 原 `tests/e2e/table-create-live.ts` 的745预检只核准确8.4.11/Linux及Root UUID，先完成独立只读预检关闭，再调用会建隔离库的共享helper。本片不改其版本、认证、正式回调或清理门；不把它切到13380。

上述Engine、协议、生成器、旧live/spec、共享fixture/helper与quitDesktop均逐blob保持745原件。新profile不接入通用引擎，不重新定义或收缩既有普通MySQL/Maria能力，也不把这条既有能力描述为已禁止写入。所谓“未激活”专指本片新增的准确版本追加合同和正式UI入口。

## 新准备合同与门

`src/shared/tableCreateProfiles.ts` 提供可复用的纯版本合同：只接受 `mysql` 和准确 `8.0.46`，允许非空且不含空白的发行后缀；邻近补丁、泛8.0、5.7、8.4和MariaDB均不能借本合同放行。状态固定为 `prepared`，可准备读取事实，`canWrite=false`；对象冻结，不存在环境开关提升状态。它不是服务器语义已验证的证据。

`tests/helpers/tableCreateMysql80Preparation.ts` 不导入真实驱动、桌面或认证helper：

- 仅接受原始自有属性明确指定的 `192.168.31.200`、`13380`、`DBARK_TEST_TLS=0`、规范36字符Root UUID、非空账号及显式密码。账号和密码都必须在原始环境与helper环境中存在且逐值相等；helper不能补缺或替换。显式空密码合法，缺失密码不合法。
- 版本、OS、名称模式、UUID事实须同一完整结果：真实方言mysql、准确8.0.46、Linux或debian-linux-gnu、lower_case_table_names=0，UUID与本轮Root绑定一致。缺项、多行、原型字段或未知形状不补默认值，不使用8.4证据。
- 准备协调器仅有归属检查、保留、无默认库只读连接、一次事实读取和严格关闭端口。无DDL、隔离建库、删除、重试或UI端口。首await前固定已校验凭据，仅传给未来只读适配器；结果及错误文案不包含凭据。
- 已知事实不符时只关闭该只读连接并拒绝。打开、读取、归属或严格关闭未知时保留并停链；未知读取不借自动退出或清理继续后链。事实不符与关闭未知同时存在时聚合首因。未等真实strict close Promise完成不能发布资源释放；即使全部准备完成，结果仍为 `canWrite=false`。

端口接口目前只有纯RAM适配器。未来真实事实中的dialect必须来自产品实际连接状态，不能从用户名称或端口猜；strict close必须接既有可信Engine资源终态，不能用测试替身、取消ACK或回调名代替真实收尾。本片没有连接任何服务器，也没有读取已有凭据或CA。

## 默认关闭的未来正式入口

`tests/e2e/table-create-mysql80.spec.ts` 为独立占位，使用新门 `DBARK_TABLE_CREATE_MYSQL80_UI`，不复用旧门：

- `--list`与`--list=...`在任何环境读取前短路。
- 非list还要求 `DBARK_INTEGRATION_ENABLED=1` 与新门同时为1。
- 即使双门打开也只读取纯准备profile并注册skip；不加载live、准备端口适配器、桌面、驱动或认证helper，不读取实际目标或密码。
- 若有人单改profile为verified/canWrite，入口直接拒绝，不能落入旧8.4回调。本片没有注册可实际执行的新建表UI回调，也没有声称端到端定义已就绪。

后续激活至少还需：Root的8.4真实验收、另行授权、8.0.46独立真实元数据和严格资源证据、准确13380/原始凭据/Root UUID在任何隔离DDL前核对、实际UI回调与本例owner/未知停链/精确清理接线、独立复核。不能仅翻一个环境开关或复制8.4结果完成激活。

## 本片验证与交接

使用自己的ignored配置 `.cache/table-create-mysql80-prep/vitest.config.mjs`，禁用envDir，worker守卫拒绝真实网络、子进程、私料读取和密钥生成，仅复用现有依赖，没有安装或构建：

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/table-create-mysql80-prep/vitest.config.mjs --reporter=json --outputFile=.cache/table-create-mysql80-prep/pure-results.json
node node_modules/typescript/bin/tsc --noEmit
```

5文件104项通过：新增profile20、目标/凭据/事实/停链准备45、准确入口与list16；旧列表门12、旧8.4预检11项回归通过。TypeScript `--noEmit`通过。未重复745的308项矩阵，没有把纯端口测试当实际连接或资源验收。

GUI、DB、200操作、私料/CA读取、clipboard、Docker、安装、CI、构建及生产部署全部为0。原745提交、原分支和原交付证据保持，不自动合并Root主线。最终提交、推送和文件哈希记录在本片ignored交接文件中。
