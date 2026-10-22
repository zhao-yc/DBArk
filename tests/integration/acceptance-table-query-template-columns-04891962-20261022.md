# SQL模板选列与字段顺序验收

## 固定源码与平台

- 代码提交：`04891962c21b34fced6114825e9659d5cd256fa5`；src树：`f8cf6c690e1be3ad33ebd33462b710dba4742278`。
- 平台：开发电脑Windows源码App。WIN11-TEST状态快照曾恢复，随后read_thread再次返回主机不可达；旧b641回合已终结，本轮未向VM派发测试，按用户授权本机回退，没有重复运行。
- 提交前不可变输入的2292个非dist文件与提交后正式窗口来源逐项SHA256相同。没有密钥、证书、认证文件或测试数据入库。

## 类型、单元与构建

正常权限下运行原脚本和断言：

| 检查 | 原PID | 结果 |
| --- | --- | --- |
| `node scripts/typecheck.mjs` | 47856 | exit0，32.844秒 |
| 23文件相关Vitest，maxWorkers=2 | 16168 | 599通过，exit0，12.899秒 |
| 完整Vitest，maxWorkers=2 | 2192 | 14950通过、1条件跳过，exit0，305.337秒 |
| `node scripts/build.mjs` | 11572 | exit0，33.148秒 |
| 新专项默认关闭`--list` | 68268 | exit0，未启动App或数据库 |

覆盖默认四模板逐字兼容、选列顺序、空INSERT／SELECT／UPDATE、可靠复合或唯一键、自增／生成字段、四SQL模式单语句参数绑定、宽表和预算、数组迭代器／getter零调用，以及真实TableTab旧事件、连接／标签／上限ABA和50项分页接线。

首轮沙箱原完整PID43364已exit1、372.912秒：37文件／361项失败、14589通过、1跳过；原日志包含354个EPERM失败块，另有初始化失败的后续错误。临时SQLite原子替换及junction受限，原件封存，不追认为成功；之后以正常文件权限执行完整原断言。原生观察器的sessionId合同误用在静态复核时修正，未据错误版本启动GUI。

## MySQL8.4正式窗口

Root先核对200服务器13384的实际版本、主机、UUID及端口，只创建本轮唯一随机库；不执行Docker、不创建用户或授权。夹具为61行普通表、同数据视图和205个可写字段的宽表。

原Playwright PID9632，UTC `2026-10-22T15:57:39.3362093Z` 至 `15:57:51.1459374Z`，exit0、11.832秒；单例通过，零失败／跳过／重试。正式表单连接不保存密码。

1. 原note字段暂存草稿；清空SELECT拒绝打开，选择id、amount、note再上移note，生成顺序note／id／amount。
2. 打开新查询不执行。用户明确执行一次，61行、三列内部唯一键及顺序正确；原id=`9007199254740993`、amount=`123456789012345678.000001`、note为空字符串，未读取父草稿替代值。
3. INSERT选note／amount，正式参数名为value_1／value_2；UPDATE只选note，参数为value_1／key_1，完整id条件和LIMIT1保持。自增id及生成computed不提供写入选择。
4. DELETE无选列，原完整键条件保持。宽表默认INSERT超过200参数拒绝打开，实测50项分页；清空并搜索c204后生成单字段、单参数模板。
5. 原note草稿保持并可撤销。产品正文执行1次、参数名称读取2次、写操作0次；历史1条。观察器仅在真实sessions.open成功回包后登记原sessionId，不修改输入或回包，也不冒充完整Main逐条审计。

原App正常退出0；原观察连接严格关闭、目标线程0。Root独立复读三个对象的全部定义、subject及view全部61行和wide全部206列，与原快照一致；核对随机owner、无额外触发器／过程／事件和线程后精确删库，读回不存在，原控制socket关闭。未覆盖剪贴板或修改系统设置。

## 封存与未验范围

私有本机证据根目录均在`.cache/`，不入Git：

| 目录 | manifest SHA256 |
| --- | --- |
| `template-columns-check-local-20261022`（首轮失败27件） | `db95e1c25f8a9da2132cee52d364f46895676aa9fa9b7c505bd5b3a99a23c0d1` |
| `template-columns-permissions-check-local-20261022`（通过43件） | `a899ef0cf50bc85ce14d7becb401abf635ef2b8160d0e99e061164081702ed18` |
| `template-columns-ui-local-20261022`（通过18件） | `50b39c40e3fb19cc78794da3a5d70258dc7af45a1120666e65cf94bdc8481304` |

正式窗口原来源清单SHA256：`e55603d4cc58c9cba64292d2c31f4a627bb640e53ecf3a78ec0c1a0d8ebdf7d4`，实际身份及五阶段完整集合复读通过。截图SHA256：`f94ed9f9f2f6449a0deff7ecf88e077f94b2f703d85142262ed2ee9c80d6e41f`，人工复看可见字段顺序、预览及打开按钮。

本轮未执行生成的INSERT／UPDATE／DELETE，未进行其它五实例、SSH／TLS、安装包或macOS新专项；4096字段仅单元接线验证。候选CI39809732266查询时进行中，不计为已通过。完整Navicat工作包和发行计数不增加，暂不发布。
