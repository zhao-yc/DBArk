# 已有字符列跨字符集转换

本切片补充字段级字符集／排序规则配对转换。同字符集的排序规则修改仍使用原入口；跨字符集必须单列、单属性独立预览，不与改名、类型、默认值、自增、生成表达式或其它列混批。

## 操作与范围

在字段差异编辑器选择实际列，再选择真实目录中的目标字符集及其排序规则。恢复原配对消除差异，不丢弃其它草稿。CHAR／VARCHAR及可证明的普通TEXT族保留原类型、NULL、默认值、备注和旁列；不自动缩短字段、扩大TEXT类型、删除索引或外键。二进制重解释不属于本属性。

普通、唯一和复合BTREE不能仅因参与索引就全部拒绝，但须根据目标字符集实际MAXLEN逐部分计算完整键、字符前缀及组合字节成本。外键字符集配对需要多目标方案，单列转换仍须明确拒绝；生成列、CHECK、未知表达式及不能证明COPY保真的默认值继续只读。

转换语义及独立MODIFY字段方式见[MySQL字符集转换说明](https://dev.mysql.com/doc/refman/8.4/en/charset-conversion.html)和[列字符集配对规则](https://dev.mysql.com/doc/refman/8.4/en/charset-column.html)。不会通过BLOB或VARBINARY临时改写来绕过真实字符映射。

## 执行与正确性

预览和发送前分别在服务器完整扫描目标列，检查转换到目标、再转换回原字符集后的二进制内容及长度，并单独检查文本默认值。只返回固定聚合计数和最大转换字节，不抽样、不传输整列内容；TEXT族转换后字节数不能超原类型容量。

预检不是数据快照，不能消除其它客户端在扫描与DDL之间的写入窗口。独立结构会话保留原模式，追加并读回严格模式与NO_AUTO_VALUE_ON_ZERO；单条MODIFY明确COPY／LOCK=EXCLUSIVE。维护窗口、复制成本、排他锁及已完成DDL不能回滚的风险须确认。执行后只按准确目标编码及其目录衍生值作专用后核，不以“预检通过”宣称原行已跨语句原子验证。

## 已确认的原生行为

独立探针已核对200六实例实际身份，覆盖MySQL5.7.44、8.0.46、8.4.11、MariaDB10.11.19、11.4.13和另一个严格TLS MySQL8.4.11。普通VARCHAR带唯一复合键及字符前缀，从latin1_bin转换到utf8mb4_bin并恢复，均零警告，原字符、NULL、空串、NUL／非ASCII字节及旁列重复自增零值、负数、大整数、DECIMAL、BLOB保持。带索引的utf8／utf8mb3升级及适长TEXT升级同样通过。

六组合均在严格COPY中拒绝不可表示字符1366、目标排序规则唯一碰撞1062、TEXT扩张溢出1406，原数据／定义保持。MySQL对769字符完整键扩到3076字节返回1071；**两个MariaDB即使严格模式也会完成DDL、返回1071警告并把完整索引改成768字符前缀**。因此键成本必须在投递前阻断，不能靠严格模式或完成后的警告补救。

独立类型探针另在六实例逐一转换CHAR、VARCHAR及四种TEXT，每种均零警告且原字符读回保持，准确单表资源全部清理。实际目录中，CHAR／VARCHAR的字符数保持、字节长度按MAXLEN变化；四种TEXT的CHARACTER_MAXIMUM_LENGTH和CHARACTER_OCTET_LENGTH均保留各自容量，不能猜测为“字节容量除MAXLEN”。最终后核按真实目录证明。

首轮在MariaDB意外成功处停止；独立读回确认真实前缀后，准确核归属并清理原五表。仅接续未完成的两个MariaDB及TLS组合，没有重跑已通过的三个MySQL。全部本轮随机库已精确删除、原流关闭；原失败和接续结果分别保留。MySQL8创建旧utf8mb3夹具会返回1287／3778弃用警告，不冒称转换到utf8mb4的警告，也不自动忽略其它警告。

## UTF8升级与弃用警告

产品首轮MySQL8.0在utf8mb3升级预检中收到两条1287：预检自己引用旧USING名称，即使往返损失计数为零也按原门拒绝。原四表库已独立核归属、原线程零并精确清理，失败原件保留。

仅受支持版本、原实体方言／版本一致、实际目录和可信列均证明三字节UTF8、目标目录证明utf8mb4四字节时，采用原UTF8字节与转换后字节比较，默认值比较其UTF8十六进制与utf8mb4解码字节。该升级不再主动引用弃用名称，其它方向保留双向转换；任何警告（包括1287）仍拒绝，不建立警告白名单。[MySQL官方相同字节规则](https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb4.html)与[MariaDB Unicode说明](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/unicode)为前提；MariaDB的utf8别名不能脱离实际MAXLEN猜测。以弃用字符集为目标的其它方向仍可能因服务器警告拒绝。

## 产品验证与边界

冻结最终源码后，本机Windows类型、41文件1095项相关回归、完整15337通过／1平台跳过、构建、默认实库关闭门及正式窗口定义列表通过，2343份源码／测试输入不变。实际命令为`node scripts/typecheck.mjs`、`node node_modules/vitest/vitest.mjs run --maxWorkers=2`、`node scripts/build.mjs`。实库使用`vitest.integration.config.ts`、`DBARK_INTEGRATION_ENABLED=1`与`DBARK_COLUMN_ENCODING_TEST=1`，逐端口独立原120秒、零重试。

六实例实际Engine均通过：每例VARCHAR／CHAR往返各二次、普通TEXT及真实utf8目录别名升级各一次；另一次CI唯一冲突由原严格DDL真实拒绝，共36成功／6预期失败DDL。整列和仅默认值有损、TEXT容量、完整键超预算、预览后插入不可表示值、外部DDL、缺确认和主动释放均核验零DDL拒绝；外键双端及旁生成列只读。旁列重复零／负值／大整数、DECIMAL、BLOB、NULL、历史时间及CURRENT_TIMESTAMP默认／自动更新时间保持。六随机库精确删除，全部原流关闭，原任务线程零，严格TLS不降级。

初轮两个测试夹具类型错误及旧丢稿确认重入回归均保留并修复，原断言不降。沙箱临时目录rename导致的361项失败及独立目录下剩余9项junction权限失败分别保留；53项文件操作诊断和正常权限34项junction补验通过。最后在正常Windows权限、仓库内独立TEMP下重新执行完整检查获得上述单轮全绿，未以补验拼接替代。

WIN11-TEST原任务已终态，新预检派发未确认；按用户连接不稳时的本机授权接续，无重复产品测试派发。准确`5d859ac7`的[Windows正式源码窗口与六实例验收](../../tests/integration/acceptance-column-encoding-5d859ac7-20261023.md)已通过真实选择／两次COPY转换与恢复、完整字节／定义／索引目录保持、五阶段来源、原App正常退出及精确清理；2449输入不变，Main全部IPC审计未做。安装包、macOS、实际锁取消／断线／限权、TTL／实体替换及大表成本另验。完整O01继续为“部分”，暂不发布。
