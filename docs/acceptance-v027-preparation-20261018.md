# 0.27 CSV和新表属性真实验收准备

本次仅准备脚本。真实Playwright执行、真实`--list`、GUI、数据库建连、只读SQL预检、Docker、SSH、安装、启动服务、端口探测、剪贴板操作和新CI触发均为0。离线保护测试不构成产品或真实环境验收通过。

## 固定来源与范围

- Root基线：`1839a54a8e62bf5852b6e352c10246dc8f5c31e8`。
- 待验产品构建：`50626ec69cc20df699c9073a29640510ef6bf36c`，应用版本须为`0.27.0`。环境中的构建号仅是准入约束，仍须Root提供已核对该候选的启动身份清单及SHA-256；不能据环境字符串证明候选来源。
- 唯一目标：现有200服务器`192.168.31.200:13384`，MySQL `8.4.11`，UUID `f568f70e-c730-11f1-8190-3e6c830dde01`，TLS明确为0。运行时只读核版本、UUID、模式及InnoDB能力，不建立或变更服务器环境。
- 独立普通clone、独立`codex/employee2-v027-native-acceptance-preparation-20261018`分支，不用worktree。

## 两条未来真实场景

| 场景 | 输入与原入口 | 独立观察 |
| --- | --- | --- |
| CSV | 原TableTab→TransferDialog；实际逗号、分号、Tab三份外部UTF-8文件，每份2行；全部字段引用，含引号、三种分隔符、CRLF和emoji。变更分隔符及UTF-16LE/UTF-8参数后旧忽略映射必须失效，恢复正确参数后重新映射。 | Main真实选择令牌、预览和Engine正式导入；独立mysql2读取精确大整数、正负DECIMAL(30,12)、SQL NULL、文字反斜线N、空串、BLOB HEX、完整文本，以及原目标旁行和邻表数据。 |
| 新表 | 原SchemaDialog默认主键及原新增控件；`datetime(3)`、`timestamp(6)`的DEFAULT/ON UPDATE；普通datetime明确不自动更新；varchar(64)合法前缀12；旁列普通默认值。三种错误组合在读取新表目标准备前拒绝；先普通时间预览，再前缀预览，两项原确认和准确库.表名后仅点一次CREATE。 | 两次预览后独立目录核目标表仍不存在，Main apply计数0；成功后SHOW CREATE、COLUMNS、STATISTICS核精度、DEFAULT、ON UPDATE、索引前缀、普通时间列及旁列；新表保持0行、邻表数据不变。未覆盖实际时间触发更新的数据行为。 |

CSV大整数从`18446744073709550000`起，每批偏移10；金额为正负`123456789012345678.123456789012`。NULL文件值为`\N`，文字反斜线N文件值为`\\N`，BLOB文件值为`base64:AAH/`和`base64:AP8Q`，独立预期HEX为`0001FF`和`00FF10`。

唯一选择器stub仅使`dialog.showOpenDialog`返回本例已登记的固定文件路径；它不证明操作系统文件选择器交互。不替换Main响应、令牌签发、Engine、导入结果、DDL预览或执行结果。Main透明审计只返回有界计数/布尔/分隔符枚举，不输出令牌、凭据或SQL正文。原fixture已有的消息框回答协议继续保留；返回结构草稿的浏览器确认只接受准确提示。

## 开启条件与运行边界

入口为`tests/e2e/v027-native-acceptance.spec.ts`。默认及列表路径只登记两条跳过项；列表先判断，不读环境值；默认只读两开关，不加载live、驱动或桌面fixture。离线unit通过VM模拟声明，未调用真实Playwright列表。

Root确认GUI可以恢复后，须显式提供本轮RAM环境：

| 变量 | 要求 |
| --- | --- |
| `DBARK_V027_NATIVE_ACCEPTANCE` / `DBARK_INTEGRATION_ENABLED` | 两者均为`1` |
| `DBARK_V027_RUN_NONCE` | 本轮Root生成32位小写十六进制身份 |
| `DBARK_TEST_HOST` / `DBARK_TEST_PORT` / `DBARK_TEST_TLS` | 上述准确目标、端口和`0` |
| `DBARK_TEST_USER` / `DBARK_TEST_PASSWORD` | 本轮显式账号/口令，不读.env，不提供默认凭据 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` / `DBARK_V027_PRODUCT_BUILD` | 上述固定UUID和完整构建SHA |
| `DBARK_V027_LAUNCH_MANIFEST` / `DBARK_V027_LAUNCH_SHA256` | Root批准的运行身份清单绝对路径及64位SHA-256，复用原身份核验器 |
| `DBARK_EXECUTABLE_PATH` | 安装候选须精确匹配清单；source清单时不得出现此变量，且须对应本clone的已批准dist |

拒绝外部renderer、用户目录、Node预加载及大小写环境别名。选定值/所有权一旦变化即永久停链。实际执行只允许Windows、单worker、0 retry、0 repeat；trace、screenshot、video全部为off。原TestInfo的120秒预算在声明时固定，包含准入、启动、主体、退出和精确清理；不延长或重签期限。

准入fixture先于自动桌面fixture执行：首次资源计划持久化→独立驱动只读核MySQL事实→核Root身份清单→原fixture启动。不要通过`pnpm test:e2e`触发额外构建或全套。Root未来可在准确clone及已设定RAM环境内执行以下单文件命令，本次未执行：

```powershell
pnpm exec playwright test tests/e2e/v027-native-acceptance.spec.ts --workers=1 --retries=0 --trace=off
```

## 未来写范围、归属和收尾

每个case生成独立32位随机nonce，并将下列身份先写入TestInfo输出目录`v027-ownership.ndjson`，每条fsync并核原文件身份，最多16条/16KiB，不写凭据：

- CSV库`dbark_v027_csv_<nonce>`，仅`__v027_owner`、`csv_target`、`neighbor`；时间库`dbark_v027_time_<nonce>`，仅`__v027_owner`、`time_defaults`、`neighbor`。写库前核不存在，库中记录nonce与原testId的SHA-256。
- CSV仅三份`v027_<nonce>_<0|1|2>.csv`，位于本例TestInfo输出目录，`wx`创建；精确路径在创建前登记，正常退出后按dev/ino、普通文件、单链接、realpath、字节SHA和大小界限核原文件再逐个删除及核不存在。
- 桌面目录仍由原fixture在系统临时目录选择`dbark-e2e-<32位随机身份>`。新增可选登记hook只在目录创建前等待落盘，不选择外部路径、不取得额外删除权。未启用hook的原路径继续使用原mkdtemp。应用的临时连接配置由原fixture目录承载。
- 仅两个隔离库的上述合成表、数据及文件会写入。无生产表、用户现有库、默认数据目录或共享凭据文件写入。

每次异步前后核同一原TestInfo、期限、环境、物理观察流和原桌面owner；不允许并发资源动作。任何未知、超时、迟到ACK、主体结束未完成或owner变化都停后续，保留现场，不自动重试、不补清理。

成功路径先核任务终态（CSV3项；新表两次get、两次preview及一次apply共5项），独立核数据/定义，再沿原fixture确认原应用正常退出及所属PID释放；退出后复读UUID/定义/数据、marker与准确表集合，才允许精确文件删除、精确DROP该nonce库、核无残留、原观察流正常close。原fixture继续独占正常退出及其目录删除；依赖fixture最后复核该准确目录已不存在，再追加`desktop-cleaned`记录。不增加强杀、不按进程名清理、不扫描删除其它资源。

失败记录保留于输出目录；afterEach附有界内存记录，最后的目录收尾记录以journal为准。失败后的人工恢复须先由Root核对该次journal、nonce、原owner和正常退出事实，不得凭前缀批量清库/删文件。

## 本次离线验证

仅执行`tests/unit/v027-acceptance-policy.test.ts`和`tsc --noEmit`。unit通过VM/RAM执行真实声明、目录分配表达式、登记函数及收尾方法；验证默认/list零live加载、固定目标漂移、原期限和迟到停链、写前登记、独立CSV解析、退出/marker/表集合/文件不符时零删除。不安装依赖，不运行原大套。

结果与原始初轮失败及最终结果分别保存于clone的`.cache/v027-preparation-evidence/`。最终交接给出固定提交、离线测试计数和证据SHA；真实选择器、实际GUI定位、数据库端行为、正常退出和实际无残留均等待Root另开真实验收，不能记为通过。

## f814独审两项P2的追加修复

本片仅修原验收夹具的两处已证缺口，不启动真实验收。独审原件和原红例脚本保留不动，本任务在`.cache/v027-p2-fix-evidence/`冻结副本并适配同样的RAM输入。

记录文件与样本文件的`open`回包后，原期限检查均移入该已取得句柄的`try/finally`范围。期限刚失效时只关闭该原句柄，不继续写、sync、登记或删除资源；原动作与关闭同时失败时用AggregateError保留两份原错误及首因。关闭失败不覆盖原期限/写入失败。

样本`readFile`完成并核字节哈希后，先再次核规范路径，再`lstat`核原dev/ino、普通文件、非符号链接、单链接及有界大小，并核长度与刚读字节一致，才进入原`unlink`。因此同路径同字节但inode改变也停链，后续unlink、DROP、完成均为0。删除仍是普通路径unlink：最后一次身份复核与实际unlink之间存在竞态窗口，本片没有跨进程原子CAS保证，也没有新增物理reader、扩大删除范围或清理权。

追加17项纯RAM回归与原44项保护测试共61项通过，类型检查通过。独审脚本适配副本的3组检查全部通过：16个断言加7条观测。原120秒late-open输入两处均为open=1、close=1、write/sync=0；同字节inode11→99输入为unlink=0、DROP=0、complete=false。正常对照及原退出未知/marker不符/额外表拒绝继续保留。

适配第一次遗漏父提交的`desktop-parent.ts`副本，脚本在加载阶段ENOENT退出，尚未执行三组检查；补齐原父文件后通过。初次错误日志保留，不将复制的旧红例报告当作新复核。除固定对象标签和新fixture快照/hash外，原独审RAM输入、动作和断言均未修改；独审原件内容哈希在交接时重新核对。
