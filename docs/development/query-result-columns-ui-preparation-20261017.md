# SQL结果列布局真实App验收准备

本片只准备代码，不是实际验收。普通clone分支为`codex/employee2-query-columns-ui-preparation-20261017`，严格从`14f537d10c86c0dd33dca990fddb2b8d7954ceba`开始；只新增两个e2e文件、一个私有helper、专属纯测试及本文。没有修改产品、共享desktop fixture、main、engine或任何文件协议。原产品分支的独审永久撤销修复另在`9cadd95656b88d9b85da1ac615992ec7a8a8d3ea`，不混入准备分支；Root实跑前必须先吸收该修复、完成独审并冻结最终整合源码和App产物。

## 双门和真正列表短路

入口为`tests/e2e/query-result-columns.spec.ts`。先识别真正`--list`，列表分支不读任何环境配置、不导入helper／live／桌面／认证模块。非列表也只有`DBARK_INTEGRATION_ENABLED=1`与`DBARK_QUERY_RESULT_COLUMNS_UI=1`同时存在且准确时才读取本用途配置。其它情况只注册一个默认关闭占位，不计实际验收。

Root必须为本轮在进程RAM中明确提供下表，不读旧env、密码文件或之前的连接资料，不猜用户名、密码、UUID或输出位置。空密码也须明确提供键；raw与helper副本的值及存在性必须一致，任一变化被观测后永久停链，改回也不复活。

| 配置 | 准确要求 |
| --- | --- |
| `DBARK_TEST_HOST`／`DBARK_TEST_PORT`／`DBARK_TEST_TLS` | 仅`192.168.31.200`／`13384`／`0`，不接受别名、其它版本端口或TLS降级 |
| `DBARK_TEST_USER`／`DBARK_TEST_PASSWORD` | Root本轮给定既有账号；不创建用户、授权或保存密码 |
| `DBARK_TEST_EXPECTED_SERVER_UUID` | Root预先给定UUID；独立只读观察连接实读准确MySQL8.4.11、Linux、lower_case_table_names=0及同UUID |
| `DBARK_TEST_SSH`／`DBARK_TEST_DATABASE`／`DBARK_TEST_CA` | 不启用SSH、不指定默认库、不读取证书文件 |
| `DBARK_QUERY_COLUMNS_OUT_DIR` | Root明确的绝对规范路径，目录末段为`dbark-query-columns-<32位小写十六进制>`；必须尚不存在，父目录已存在 |
| `DBARK_QUERY_COLUMNS_CSV_PATH` | 准确为上述out目录中的`visible-selected.csv` |
| `DBARK_QUERY_COLUMNS_JSON_PATH` | 准确为上述out目录中的`visible-selected.json` |

out目录由未来实跑以非recursive mkdir独占建立，已存在就停止，不读取或覆盖旧目录。它必须位于本例临时userData之外，避免共享fixture成功收尾删除验收文件。两次原生保存位置只回答Root明确的准确路径，每个答案限定原sender一次，立即恢复原函数；真正文件token、格式、原子写入及结果全部走产品实现，不能制造成功回包。

## 唯一实际场景

单worker、零重试；通过真实连接表单创建本例RAM密码连接，留空默认库、关闭密码保存，不点击测试连接、不展开对象树、不建库／表／用户、不执行DDL／DROP。独立观察连接只做固定身份SELECT；App只执行一次自带常量SELECT，共三行七列：id显式CHAR、重复别名的UNSIGNED大数字及DECIMAL字符串、NULL、空串、二进制／零字节和隐藏哨兵。id显式转CHAR避免依赖整数协议类型推断；精确原值不经Number或parseInt转换。

正式列管理器搜索重复别名并核原第2／3列；隐藏至只剩第7列，确认最后一列不可取消。再显示前六列、隐藏第7列、移动bytes并恢复原顺序，核恢复顺序保留显隐；最后将bytes移至首位。实际DOM表头应为bytes、id、repeated、repeated、null_value、empty_value，隐藏列不在网格中。

用真实网格行选择先勾第3行再勾第1行。复制只给当前真实网格单元格投递合成ClipboardEvent和新建DataTransfer，在RAM中读回typed及TSV，核实际按显示行序和可见列序保存。**不调用navigator.clipboard、不用系统复制快捷键、不申请系统剪贴板许可**。不能把此项称为原生剪贴板验收。

随后依次经真实ResultExportDialog导出所选两行CSV和JSON，均为UTF-8。读取本例两个实际文件，使用独立手写期望及csv-parse拆列验证，不调用产品列映射／编码器生成答案。两文件可见列顺序一致；重复标题按既有规则映射到repeated及repeated [4]；BIGINT／DECIMAL字符串、NULL、空串及Base64包装准确，隐藏哨兵完全不出现。CSV完成关闭后重新勾选，不能借旧行选择打开JSON。整个过程App历史及IPC计数证明常量SQL只执行一次。

## 所属目标、修订与原始期限

生命周期参考固定S02准备模式，但helper全部在本片私有文件中，不扩共享端口。固定原TestInfo `_startWallTime`起120秒、准确timeout／框架状态和单调时间；不从body、helper或afterEach重计。每次等待前后核原page、application、目标绑定和本地sticky；保留通知throw／noop都不能重新授予权限。

在本例原sender安装对既有`dbark:request`原handler的观察器，仅观察原请求和真实回包。准确锁定连接id、查询标签、常量SQL及受管session；连接修改、标签／SQL上下文变化、其它执行路径、第二条SQL、未知handler或目标错位均在委托前永久停链。修订是本例对连接修改／上下文请求的保守观测epoch，不伪称读取了产品未公开的内部revision数值。每步另核原handler身份，外来sender仍交原处理器自身权限门，不接管其它owner。

两种导出须使用本例真实files.choose返回的对应token，任务列表精确为一条成功query.execute及两条成功files.exportResult；空列表、running、失败、额外任务或未结束观察都不能补证。只有任务证据、正常同owner退出及捕获原观察native／stream严格close全部成功，才记录成功终态。严格关闭复用原closeMysqlConnection并受剩余原期限约束，Promise end或换流不能冒充close。

失败／取消／超时／未知先本地停链并保留原owner、观察句柄和out文件；finally只关闭活动门，afterEach只核已有事实，均不补退出、关流、删文件或重新执行来掩盖首因。正常退出答案遇未知资源只返回工作台，不能强制退出。共享fixture仅在此前已确认的成功边界处理自己独占的临时userData；本片不删除out目录或文件。Root已有旧Maria5现场不在本片owner内，不能复用、扫描或清理，不声称全局native0。

## 准备验证

只运行专属纯测试、真正列表及类型检查。纯测试37项通过，覆盖双门列表、目标／保存答案、配置ABA、原期限与pending、通知异常、原生同流关闭、IPC原样委托与修订墓碑，以及CSV／JSON／RAMcopy独立期望。真正`--list`在双门同时设置为1时成功，1个关闭占位、errors为空、实际0；不会读取认证或加载live。最终日志及固定源码摘要见本普通clone`.cache/query-columns-preparation/`交接。

实际准备命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-result-columns-ui-preparation.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/query-columns-preparation/accepted.json
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_QUERY_RESULT_COLUMNS_UI='1'
node D:/svn/DBArk/node_modules/@playwright/test/cli.js test tests/e2e/query-result-columns.spec.ts --list --reporter=json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本轮实际UI／DB／文件导出／系统clipboard／SSH／Docker／安装／full／build／私料读取全0。上述双门只用于真正list的短路验证，没有提供真实目标认证、没有实跑，也没有生成验收CSV／JSON。未来实际命令及Root本轮RAM值须由Root完成调度后给出，不能由本准备提交自行开启。
