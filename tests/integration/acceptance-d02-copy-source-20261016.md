# D02完整复制源真实Engine验收准备

本片从`8eb9775642a4dd247587b20420ccab1b360bafcb`新建普通分支，只增加集成入口、辅助策略、纯测试和本文，不修改产品。原任务分支保持固定。ROOT拥有200独占实跑窗口；作者只验证纯策略、类型、默认跳过与list，不连接服务器、读取实际env/key/CA、运行GUI/剪贴板/Docker或手动CI。

## 正式入口与边界

入口：`tests/integration/engine-table-copy-source.integration.test.ts`，共8项。

专用配置：`tests/integration/helpers/d02-copy-source-vitest.config.ts`。`envDir:false`禁止Vite自动加载.env；配置只收集本片，避免ROOT启用集成总门时误带其它夹具。入口默认只读取两个开关；未同时为1时不执行beforeAll、不动态导入真实夹具、Engine或mysql2，也不读取CA。没有默认凭据、自动发现服务器或自动读取`.cache/dbark-test.env`。

开启后使用正式`validateCommand → Engine.handle分发 → mysql2`。只有`connections.open`由测试适配器补入本轮可信profile，其它公开输入都经过原严格校验；SQL、原键、行引用、返回值不被mock。mysql2工厂旁路仅记录真实连接/线程/TLS，不替换语句或返回。观察连接独立读取行、列目录、TABLE_ID、MDL及线程事实。没有Electron IPC、主进程SQLite历史或真实UI，这些不在本入口的实库验收范围。

## ROOT必须显式注入

| 变量 | 要求 |
| --- | --- |
| `DBARK_INTEGRATION_ENABLED` | `1`，总门 |
| `DBARK_D02_COPY_SOURCE_ENABLED` | `1`，本片独立门 |
| `DBARK_TEST_HOST` | 严格`192.168.31.200` |
| `DBARK_TEST_PORT` | 严格`13384`或`13484` |
| `DBARK_D02_COPY_ROOT_CONFIRM` | `server-200/192.168.31.200:<实际端口>/d02-copy-source` |
| `DBARK_D02_COPY_SERVER_UUID` | ROOT已独立核对的该端口实际MySQL UUID，不在本文给示例真值 |
| `DBARK_TEST_USER`、`DBARK_TEST_PASSWORD` | ROOT在本轮进程中注入既有观察/夹具账号；不保存到仓库或报告 |
| `DBARK_TEST_TLS` | 13484必须为`1`；13384显式启用TLS时也走相同严格路径 |
| `DBARK_TEST_CA` | 严格TLS时使用原CA绝对路径，不复制/下载/生成CA |
| `DBARK_D02_COPY_CA_SHA256` | ROOT已核对的原CA摘要；读取文件后必须相同，不能自签替换 |

禁止SSH。连接先核实际UUID、MySQL8.4/Linux、大小写目录及无强制角色；既有观察账号必须已有直接PROCESS及读取MySQL权限目录、performance_schema的能力，MDL观察仪表须已启用。缺条件就中止，不新增PROCESS、不修改全局设置、不自动修复权限。严格TLS还须实际每条连接均有加密及认证成功证据。

ROOT仅在自己的独占窗口与上述环境确认后执行：

```powershell
node node_modules/vitest/vitest.mjs run --config tests/integration/helpers/d02-copy-source-vitest.config.ts tests/integration/engine-table-copy-source.integration.test.ts --maxWorkers=1
```

作者的安全验证入口（两个门均明确为0，且不继承凭据环境）：

```powershell
node node_modules/vitest/vitest.mjs run --config tests/integration/helpers/d02-copy-source-vitest.config.ts tests/integration/helpers/d02-copy-source-policy.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config tests/integration/helpers/d02-copy-source-vitest.config.ts tests/integration/engine-table-copy-source.integration.test.ts --maxWorkers=1
node tests/integration/helpers/d02-copy-source-list.mjs
node node_modules/typescript/bin/tsc --noEmit
```

## 八项真实断言

| 用例 | 独立服务器事实与预期 |
| --- | --- |
| 完整混合行 | 普通SELECT星号确实缺INVISIBLE；BIGINT、DECIMAL、微秒、NULL、BLOB、全部列及已加载值与观察连接一致；前后行和条数不变 |
| 并发已加载值变化 | 观察到UPDATE成功后，旧租约`changed`；不混合快照、不自动写回 |
| 同名重建 | 观察到实际TABLE_ID变化、真实DDL及行键值仍相同，旧来源拒绝 |
| DDL漂移 | 观察目录新增真实INVISIBLE列，旧来源拒绝 |
| 原键/释放/到期 | 自造键在建连前被validation拒绝；原键更新、显式释放、真实五分钟TTL分别拒绝；服务器时钟独立确认经过时间 |
| 整行超预算 | 观察到隐藏BLOB为256KiB+1；补取整体`budget`拒绝，源行不裁短/改写 |
| MDL等待取消 | 通过performance_schema观察目标真实PENDING；原query.cancel结束读取/控制线程，原blocker仍GRANTED；释放后租约不能用 |
| 无PROCESS的SELECT账号 | 精确subject SELECT且无额外权限/角色；真实页明确`identity-permission`；不能读取同一Engine中管理员的旧真实租约，管理员原租约仍可正常读取 |

普通用例各60秒；真实TTL用例390秒，保留原产品5分钟TTL、15秒任务期限，不使用假时钟或缩短配置。完整跑预计至少五分钟，必须预留清理窗口；所有普通夹具SQL10秒超时只报告结果未知并保留现场，不把本地销毁当服务端完成。MDL等待观察最多8秒，独立线程归零等待12秒，均不更改产品期限。

Vitest 3.2原生`list`会过滤skipped定义，所以关闭门时原生JSON为0项，此原始结果保留。上述专用list使用官方`createVitest/collect`收集真实注册定义，强制双门为0且不执行beforeAll，列出8项并逐项确认状态为skipped；没有为列清单放开验收门，也没有制造替代测试。

## 资源与清理

每项独立随机库。普通库只用`dbark_e2e_d02_<12hex>`；限权库只用原授权`dbark_colperm_<12hex>.subject`，账号严格`cp_<12hex>@%`，只授精确该表SELECT，无schema/global/column/role扩权。subject注释和账号ATTRIBUTE带本轮所有权令牌。临时口令只在内存中使用，不写报告或材料；不生成密钥、证书或持久服务。

复用已审过`cleanupC02`顺序：关闭Engine/阻塞连接 → 独立观察目标线程归零 → 核账号/库归属 → 精确删除临时账号/库 → 严格关闭观察连接。源租约通过公开release/expired及Engine关闭验证，不读取产品私有缓存。观察连接自身最后严格关闭；对Engine、控制、blocker及临时账号线程有独立服务器归零证据，不用观察连接递归证明自己已消失。

CREATE/GRANT或其它夹具写操作响应未知，不重放、不自动DROP；额外授权、归属标记变化、未知对象、无法取得线程编号或线程仍在也保留现场。安全错误保留固定阶段、类别/编号和精确随机资源名，不展示凭据、SQL参数、行内容或驱动原文。ROOT据输出的精确库/临时用户名独立核对后再处理，不按前缀批量删除。

## 本片交付证据与未验边界

作者证据留在本普通克隆`.cache/d02-copy-source-integration-8eb9775/`：纯策略、类型、默认8项跳过、8项list及产品blob一致。上述不算实库通过。真实权限、精度、并发、TABLE_ID、五分钟到期、MDL取消、TLS和清理必须由ROOT实际执行后另记端口/UUID、源码SHA、结果和残留边界；有跳过、未跑或清理失败不能标全通过。
