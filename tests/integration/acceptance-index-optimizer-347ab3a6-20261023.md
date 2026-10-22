# 索引参与优化器：源码与实库验收

## 来源与结论

实现提交 `347ab3a656182e21f8df643b7c5364cd46c7a26f`，src 树 `5175176224ab9390214b9ca712a4ada33fee18f7`。Windows 本机、Node24.17.0、源码 Electron44.7.0；类型、22文件621项相关、完整15218通过／1平台条件跳过、构建和默认关闭门通过。六实例实际Engine各1整例及Windows正式源码窗口1整例通过，暂不发布。

WIN11-TEST可读后派发仍返回先前提交未确认，后续状态又不可达。本轮新测试从未派往VM；原b641任务PID16500已有失败终态，按用户授权在本机接续，没有重复执行。

源码和Engine检查发生在5544a910基线的未提交修改上，不冒称当时已提交。2328份输入在检查期间保持；提交前仅移除一个新单元文件的末尾空行，原断言和运行时代码未变，该文件17项另行通过。原哈希、唯一差异及归一规则保留于忽略的`index-optimizer-final-source-match-20261023.json`。正式窗口直接锁定347ab3a6，2434份源码／测试／编译输入前后保持。

候选[源码CI39836086274](https://github.com/zhao-yc/DBArk/actions/runs/39836086274)记录时仍进行中，不能计通过；任务分支不代替原生验收。上一基线5544的三平台CI已成功，不能扩称本切片原生结果。

## 行为与安全范围

表页“索引与主键差异”提供“设置优化器使用状态”，显示实际状态并支持隐藏／恢复；恢复原值消除差异，严格单索引单属性，不能与新增、删除、改名或键定义混批。旧隐藏索引的删除／重建权限不放宽。MySQL使用VISIBLE／INVISIBLE，MariaDB使用NOT IGNORED／IGNORED；单条原生ALTER INDEX明确INPLACE／LOCK=NONE，不删除或重建索引，不承诺无元数据锁等待或实际选中。

原生目录证明真实聚簇角色，显式／隐式主键拒绝，同一无PK表的其它唯一键可用。SHOW、完整STATISTICS键部分、物理编号、版本、权限、模式和原定义交叉重核；仅剥准确已知选项，字符串、反引号名称和未知executable comment不能借此授权。一次令牌在等待前消费；发送时撤销同快照其它预览，释放期间迟到get不发布快照。后核仅豁免目标状态；其它列、键、关系、表尾和物理编号保持，原partial外部目录仍是partial，不升格为全库关系证明。警告、取消、断线或后核失败保留已完成事实，不自动重放。

## 检查与失败保留

| 检查 | 原PID／退出码 | 实际结果 |
| --- | --- | --- |
| 首次界面反例环境 | 57288／1 | 5项因缺window.setTimeout失败，不计产品反例 |
| 原计时器下产品红反例 | 40648／1 | 5真实失败：旧apply、旧ACK、旧close/read、确认期间重入 |
| 界面修复 | 7352／0 | 41通过，8个输入保持 |
| 新纯／Engine RAM | 62920／0 | 2文件41通过 |
| 首轮类型 | 31460／2 | 默认参数被推断为const字面量；后续检查未启动 |
| 最终类型 | 9368／0 | 35.047秒；仅补显式string类型 |
| 最终相关 | 22988／0 | 22文件621通过，11.427秒 |
| 最终完整 | 27236／0 | 742文件通过／1跳过，15218通过／1跳过，320.675秒 |
| 最终构建 | 28700／0 | 32.905秒 |
| 默认实库／UI列表 | 22340／0；23504／0 | 实库1条件跳过；列表只登记默认关闭定义，不加载认证或执行窗口 |
| 末尾空行专项 | 10808／0 | 1文件17通过，4.773秒；断言和运行时代码不变 |

原5个失败断言保留，以同步ACK引用／单调代次、当前草稿引用和确认锁修复闭包；另覆盖同值ABA、父守卫重入、迟到取消、释放失败和未知结果。RAM仅替数据库驱动端口，不冒称真实锁取消或权限验收。

核心原命令如下；启动器另外绑定清洁环境、明确目标及启动清单，凭据不写命令或文档。默认不打开实库／原生专项门。

```sh
node scripts/typecheck.mjs
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=dot
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/index-optimizer.test.ts --reporter=json
node node_modules/@playwright/test/cli.js test tests/e2e/index-optimizer.spec.ts --reporter=json
```

原生实际命令另带本轮私有`--output`目录；Engine使用`DBARK_INTEGRATION_ENABLED=1`和`DBARK_INDEX_OPTIMIZER_TEST=1`，原生使用`DBARK_INDEX_OPTIMIZER_UI=1`及准确清单，具体门见对应测试定义。

## 六实例实际Engine

| 端口 | 真实版本 | PID／退出码 | 秒 | 往返／DDL |
| --- | --- | --- | ---: | ---: |
| 13357 | MySQL5.7.44 | 16280／0 | 5.280 | 0／0，明确拒绝 |
| 13380 | MySQL8.0.46 | 75400／0 | 25.299 | 8／16 |
| 13384 | MySQL8.4.11 | 19644／0 | 24.607 | 8／16 |
| 13310 | MariaDB10.11.19 | 24824／0 | 20.093 | 8／16 |
| 13311 | MariaDB11.4.13 | 35704／0 | 20.314 | 8／16 |
| 13484 | MySQL8.4.11严格TLS | 16580／0 | 25.502 | 8／16 |

现代实例覆盖普通复合键、Unicode／反引号名称、唯一键、无PK第二唯一及可空唯一键、自增列的唯一支撑普通索引、父端唯一键和子端唯一支撑普通索引。隐藏期间真实验证1062重复、1451父删除、1452孤儿插入拒绝及自增默认插入得到8；原生TYPE=3隐式键和主键拒绝。负数、BIGINT UNSIGNED最大值、超JS安全整数、DECIMAL、二进制、NULL保持。

共40组往返／80条Engine属性DDL。observer独立核SHOW、原行及所有物理表／索引编号；Engine原SQL／回调真透传，只允许准确预览写入。所有任务流真实关闭、原线程核零；核随机库完整对象及标记、无附加对象后精确DROP并读回不存在。无新用户、GRANT、Docker、业务资源或系统剪贴板操作。

独立空表探针另覆盖五组合各13个角色情形，不计产品路径。首探针在重复备选唯一索引创建警告停下；首次清理因连接数值读取选项不同而身份比较拒绝，未删除，保持原选项后精确清理。修正版仅允许准确夹具的1831创建警告，属性DDL仍零警告；全部恢复、删除和关闭。

## Windows正式源码窗口

Playwright原PID56044，UTC18:59:07.360至18:59:20.091，exit0，12.752秒；原Electron进程对象另核正常退出码0，不将Playwright PID当作App PID。

真实连接表单不记密码，原索引设计器中停止／恢复idx_id，经过实际布尔控件、本行草稿、只读预览、三确认和apply。预览阶段独立核零变更；只接受准确随机库.subject／idx_id、指定方向及INPLACE／LOCK=NONE。两个回执均definitionVerified=true，最终完整SHOW、全部STATISTICS和全部5行恢复，历史为空。

仅旁观并限制本例schema.indexes的原Main请求／响应：2get／2preview／2apply、pending0，不改输入或返回，不扩称全部IPC或底层SQL全审计。原App正常退出后，原observer及Root控制流关闭、目标线程为零；Root独立核全部定义和原行、唯一表及归属后精确清理。截图已查看，SQL、三确认和footer可见，不扩称其它尺寸；完整来源在五个明确阶段核验，不扩大为每个动作重读全清单。

- 启动清单SHA256：`8536b4fa4ab2a7c1ce21ccffc816bcae69d59938e89fdfe43654db557970bfee`。
- 截图SHA256：`e0e70eff8967009daca12926590b8063ee24e53525c769c0db1d620b5d235156`。
- 原件在忽略的`.cache/index-optimizer-ui-local-20261023/`，不公开凭据、原始日志或逐行测试数据。

## 封存与未验范围

以下是相应`.cache/`目录中manifest.json的SHA256：

| 目录 | SHA256 |
| --- | --- |
| index-optimizer-probe-fixed-20261023 | c70ae5d8d814fb9df024685b9ade24e4910b407e1374a16e0ce254b516cf8b29 |
| index-optimizer-probe-first-cleanup-fixed-20261023 | bbb29a4400b97fd2a7f49c5b81c6141d9e88b707567f80311b9298809ad262a8 |
| index-optimizer-red-native-timers-20261023 | 1d1675aff8e88a78c007b33d4003e7af0e35ea6e880c26663243a7f31e5a49f9 |
| index-optimizer-check-20261023 | 3439c68b3f395b66a45734a136e1652837d0f4921fd36a28a68e1c7088b47956 |
| index-optimizer-fixed-check-20261023 | cee3c22a840a1b61552ad4750789d481e5b1a9a2c5adb868f41bcfbd5ea40e87 |
| index-optimizer-eof-unit-20261023 | 13897552a7b38ae2945e2b1d38ebedc757e9cfad111862f21c577631af605fa8 |
| index-optimizer-six-20261023 | 7f510828f331a08d02a55d0b2f119046752eb76b4bf32cc4de0b031c54d04e70 |
| index-optimizer-ui-local-20261023 | bae4784bfd83eeb830735fc9e3dc4cff21510ab334ef1958651e09294ee3155d |

本路径的安装包、macOS、其它五实例正式窗口、SSH、真实限权／MDL等待取消／断线／磁盘不足及大表成本另验。角色目录权限不足、未知映射／版本／属性继续只读，RAM或空表探针不代替这些组合。完整O01仍为“部分”，发行计数不增，暂不发布。
