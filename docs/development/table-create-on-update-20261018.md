# 新建表受控自动更新时间

2026-10-18，基于0.26.0固定提交`3985b421c1ce908013321ed8a822212504d72428`。本变更只增加新建表字段能力，不改版本号、根覆盖总表或已有表patch合同。

## 草稿与界面合同

新表字段增加独立可选`onUpdate`，不把任意SQL传给创建接口：

| 输入 | 行为 |
| --- | --- |
| 省略键 | 保持原创建路径，字段默认未指定，不增加版本门或ON UPDATE |
| `null` | 明确不附加自动更新属性，仍核对类型、默认值和版本 |
| `{kind:'expression',expression:'current-timestamp',precision:3}` | 固定生成`ON UPDATE CURRENT_TIMESTAMP(3)` |
| 对象省略`precision` | 继承字段精度；不把省略当作零精度 |
| 显式`undefined`、字符串、未知对象键或任意表达式 | 拒绝，不降级成旧行为 |

字段区提供“未指定（保持原创建行为）”“明确不自动更新”“CURRENT_TIMESTAMP”和0至6精度。选回未指定真正删除草稿键。字段类型或默认值变更导致组合无效时保留用户选择，修正后才允许准备；不悄悄删除属性。新控件沿用字段身份、列数组和草稿代次守卫；重排、进入确认及返回后，旧事件不能改写新草稿。已有表不显示本控件。

## 明确范围

- 只接受非自增的普通`DATETIME`、`DATETIME(p)`、`TIMESTAMP`、`TIMESTAMP(p)`，`p`为0至6；省略字段精度为0。
- 显式新键要求明确默认值。只接受SQL NULL，或不区分大小写的`CURRENT_TIMESTAMP`、`CURRENT_TIMESTAMP()`、`CURRENT_TIMESTAMP(p)`；函数精度必须与类型一致。SQL NULL要求字段允许NULL；NOT NULL可搭配匹配精度的函数默认值。
- 日期常量、文字`NULL`、NOW别名、外括号表达式、CURRENT_DATE/CURRENT_TIME及其他SQL表达式不属于显式新属性的范围。省略新键时原默认值规则保持。
- 复用已有列时间属性和ADD时间属性的共享校验、受控函数识别及准确版本门：MySQL 5.7.44、8.0.46、8.4.11；MariaDB 10.11.19、11.4.13。版本后缀及MariaDB兼容前缀按原合同处理，不根据邻近补丁版本推断支持。
- MySQL 5.7仍读取并重核原能力事实。`explicit_defaults_for_timestamp`不满足原TIMESTAMP创建约束时拒绝；不自动执行SET或改变服务器配置。

本范围优先保证DATETIME；TIMESTAMP复用相同类型/默认值合同和原5.7能力门。五版当前只取得离线合同与RAM驱动证据，未宣称五版真实服务器或原生界面验收通过。

## 实际链路与失败语义

`SchemaDialog`冻结新表草稿后，原`TableCreateConfirmation`读取目标、生成只读SQL并执行准确库.表名及两项风险确认。真实`tableCreateServices`仍通过原IPC命令；`tableCreateDraftSchema`在预览入口验证结构和非法组合，Engine使用实际快照的方言、版本进行版本拒绝。

普通新表和前缀索引新表共用列生成器，只从受控结构生成固定函数。旧`schema.preview`不接受新键；旧整表ALTER生成入口也显式拒绝夹带新键。没有新增执行命令或SQL直传通道。

原单次预览令牌、一次授权、任务、目标锁、执行前身份重核、DDL成功事实及资源释放模型保持。CREATE成功后同时核对SHOW CREATE和COLUMNS目录中的自动更新属性与精度；目录EXTRA只接受可选单个DEFAULT_GENERATED标记及一条受控ON UPDATE。缺失、多出、精度差异或未知尾部属性均不能报完整定义核验成功。

仅对本次显式时间属性，把服务器`DATETIME`/`TIMESTAMP`与对应`(0)`、CURRENT_TIMESTAMP零精度的省略/空括号写法按相同精度核对。非零精度差异继续拒绝。旧省略路径的比较不变。

后核失败保留`ddlCompleted:true`、`definitionVerified:false`，令牌已经消费，不自动重放CREATE、回滚或DROP。前缀分支的完整列目录、完整索引、表选项及复读SHOW核验保持；显式非键时间列按同一受控合同核对，不再被旧EXTRA白名单一律误拒绝。

## 本轮验证与证据

运行目录为独立普通clone：`D:\svn\DBArk\.cache\parallel-20261015\employee1-table-create-on-update-20261018`。只读复用主目录依赖，未安装依赖、启动GUI/服务/端口、访问实际数据库或执行Docker。

实际运行时为`C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe`，Vitest入口为`D:/svn/DBArk/node_modules/vitest/vitest.mjs`。

1. 首轮新合同35项通过。Engine新增窄测首轮为15项通过、2项失败：零精度服务器规范化未被原比较识别。原始日志保留于`.cache/table-create-on-update/engine-first.log`；修正后17项通过。
2. 新合同、真实React到IPC、原前缀创建链/入口、字段排序、已有ADD时间属性的六个测试文件共106项通过。日志`.cache/table-create-on-update/targeted.log`。其中新React测试7项，真实服务适配器与IPC校验均运行，接收端和驱动为RAM替身。
3. Engine新增用例及必要旧创建回归共30项通过，132项无关用例按名称筛选未运行。涵盖两种时间类型0/3/6精度、准确版本、非法版本、5.7能力拒绝、NULL/NOT NULL兼容、SHOW及EXTRA反例、一次CREATE与重放拒绝。日志`.cache/table-create-on-update/engine-final.log`。
4. 运行`node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`，通过；日志`.cache/table-create-on-update/type-final.log`。首次类型检查发现新增比较器的unknown输入未收窄，已增加字符串守卫并复验。
5. `git diff --check`通过。只提交本功能源码、测试和本文；缓存脚本、运行日志及依赖不入提交。

复验命令：

```powershell
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-create-on-update.test.ts tests/unit/ui-table-create-on-update.test.tsx tests/unit/table-create-prefix-flow.test.ts tests/unit/table-create-prefix-entry.test.ts tests/unit/ui-table-create-column-order.test.tsx tests/unit/table-column-add-on-update.test.ts --reporter=verbose
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/engine-table-create.test.ts -t '新表受控自动时间实际Engine|显式空串默认值沿原新表任务|只读准备绑定设计|普通版本|严格协议拒绝SQL' --reporter=verbose
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

仍待Root集成和后续独立授权的真实服务器/原生UI验收；本轮未执行旧全套、构建或打包。创建初始fetch曾遇GitHub DNS失败，恢复后的本轮`git fetch origin`已成功；仍固定原授权基线，不合入其他任务或远端主分支。

## 前缀索引与非键时间列组合补核

Root独立审查指出原提交`36868c2ffacd4f55f221b64e904d9476c23091ab`遗漏前缀后核入口的EXTRA白名单。虽然外层时间属性核验正确，合法前缀索引加非键DATETIME自动更新时间仍会在CREATE成功后必然返回未核验；仅声明保守边界不能代替组合实现。本次在原分支追加修复，保留原提交。

`verifyCreatedPrefixIndexes`只对本次草稿自有`onUpdate`键的字段使用共享EXTRA精度匹配器，并再次核对请求与SHOW的受控自动属性。省略新键仍走原EXTRA白名单。没有全局放宽EXTRA，也没有删去完整列、索引、表选项、字符/二进制长度或复读SHOW检查。

`deriveTrustedIndexColumn`保持原实现：真实COLUMN_TYPE必须与SHOW完整类型一致，DATA_TYPE与类型首词一致，目录NULL/字符集/长度字段必须完整；已声明NULL、自增、生成、可见性与时间属性必须一致，时间精度不一致拒绝。未知附加属性、生成或不可见列不会形成可写语义证明。显式非键时间列也要求适配器无拒绝原因，并额外与请求草稿核对可空状态；因此SHOW省略NULL声明时，第二套COLUMNS的错误IS_NULLABLE仍会被拒绝。它不被加入计划索引列或授予新的前缀能力。

组合沿原前缀能力门，仅MySQL 8.4.11、InnoDB、DYNAMIC、16KiB及已证明MAXLEN；时间列仍是非键列，本次不扩展时间列索引规划范围。

新增真实Engine配RAM驱动的23项组合用例：DATETIME 0/3/6精度及TIMESTAMP(3)成功，显式null成功；独立完整目录中EXTRA缺失、错误精度、未知/生成属性、类型、NULL、字符目录矛盾均拒绝；另核SHOW缺失/精度错误、原普通目录缺失、其他非键未知属性、索引前缀错误和旧省略路径意外自动属性。成功与失败均检查一次CREATE，消费后的令牌不得重放。

- 原始反例：`prefix-first-red.log`，4失败、19通过、35按名称筛选未运行；4个失败均是合法组合已CREATE而definitionVerified为false。补修前测试副本为`prefix-red-fixture.test.ts`，位于同一缓存目录。
- 第一轮修复：`prefix-after-fix.log`，57通过、1失败，暴露SHOW省略NULL时独立目录可空状态未与请求比较；已补比较，未删除负例。
- 最终窄测：`prefix-final.log`，三个文件共145项通过，含本文件原前缀回归、适配器及独立元数据补核。命令为下方所示。
- 类型：`type-prefix-final.log`，`tsc --noEmit`退出0。差异检查通过。

```powershell
& 'C:\Users\zhao-\.fnm\node-versions\v24.17.0\installation\node.exe' D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-create-prefix-flow.test.ts tests/unit/table-index-metadata.test.ts tests/unit/table-create-prefix-metadata.test.ts --reporter=verbose
```

上述补核日志均位于`.cache/table-create-on-update/`且不入Git。仅修改本组合后核、对应测试及本文，不进行GUI、实库、CI、构建、服务或Docker操作。
