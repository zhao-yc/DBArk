# 新建表字段顺序调整

## 范围及实现

本任务从`05838aaf90cd6f518c0c75c7c4e070abae1d61de`建立普通clone和独立分支`codex/employee2-table-create-column-order-20261017`，不使用工作树，原prefix分支及历史保持不变。静态核对该父版本SchemaDialog只有添加／删除字段，没有完整的相邻上移／下移入口。

新建表每个字段行新增上移、下移按钮，首行上移及末行下移禁用；已有表不显示排序入口，也不新增任何ALTER排序操作。排序只交换列对象，保留名称、类型、可空、自增、默认值及说明；索引和外键的列名引用及对象保持原值。SQL仍由已有生成器按最终columns数组生成，不修改engine、main、共享合同、App或索引协议。

新表React行键使用renderer内的稳定身份，不使用数组位置或可编辑列名作为身份。行编辑、默认值选择、删除、移动、添加均绑定渲染时的列列表和草稿代次；操作时还核原父目标／修订／lifetime。列表或代次改变后，旧行闭包不能按旧位置改到另一列。修改列对象时转移稳定行身份；重排不重建DOM行来掩盖身份问题。

进入确认先同步锁定草稿，即使React尚未重绘，旧行回调也不能再修改。返回草稿先递增父修订、撤销旧确认租约；回到相同数组也不会复活旧行事件。旧预览按钮始终读取liveDesign中的最终草稿，重复确认入口在锁定后无效。确认页服务guard、能力释放、单次提交及父目标ABA合同沿用058，不改公共连接生命周期。

## 最小验证

专属纯草稿与真实React专项12/12通过：交换对象不丢属性；空名／同名仍有独立身份；边界及非法对象拒绝；真实表单最终顺序；空字符串、SQL NULL、文字NULL及id自增保持；正常索引和FK按名引用；重排后旧编辑／删除／移动闭包；删后同位置新增；确认前同步锁定；返回后旧确认回调／旧行回调不复活；父修订与数据库ABA；已有表无排序；StrictMode、卸载和新实例隔离；旧预览按钮及重复确认入口。

另选取原ui-schema-empty-default中的10项直接关联用例通过：已有空串默认与ALTER预览、已有表等待期间修改草稿、父观察先失效的同步窗口、get／preview等待后父租约、旧能力释放等待。该文件42项按名称过滤，没有把它们计入通过数或执行数。类型检查通过；没有运行180／全量套、构建、CI人工触发、真实200或GUI。

实际命令在本普通clone执行，复用已安装依赖，没有安装包：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/new-table-column-order.test.ts tests/unit/ui-table-create-column-order.test.tsx --maxWorkers=2 --reporter=json --outputFile=.cache/column-order/final-focused.json
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/ui-schema-empty-default.test.tsx --testNamePattern='已有空串默认初始|已有表等待预览期间切换草稿|父观察已失效|等待后活读父租约|释放旧能力等待后' --maxWorkers=1 --reporter=json --outputFile=.cache/column-order/related.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

RAM服务只替代传输，预览经过真实SchemaDialog、确认组件及现有buildDesign。12项不是实际数据库或原生桌面验收，也没有证明某个服务器完成CREATE。

## 默认关闭的备用正式场景

入口为`tests/e2e/table-create-column-order.spec.ts`，`--list`先短路；未显式同时设置`DBARK_INTEGRATION_ENABLED=1`和`DBARK_TABLE_CREATE_COLUMN_ORDER_UI=1`时不加载桌面／认证模块。此任务只准备代码，**没有执行该入口，包括没有执行list**。

未来须由Root先通过共享资源host及退出夹具审查，固定整合源码、产物、专属owner及调度档期，再明确允许的200主机、准确MySQL8.4.11明文13384、server UUID、既有账号，以及已存在的`dbark_e2e_column_order_<32位小写十六进制>`专用库。单worker、零重试运行该spec；不建库、建用户或授权，不读取旧env／私料，不用系统剪贴板，关闭trace／截图／视频。正式表单保存连接仍沿产品认证存储，不宣称密码只留RAM。

备用场景在一个随机新表中通过真实行按钮将id／a／b改为id／b／a；保留a的空串默认及说明、b的SQL NULL、id自增和PRIMARY按名引用。只读预览核最终SQL顺序、表尚不存在、相对于本owner任务基线没有新增apply任务；确认后双击只产生一个新专用apply任务，不使用通用schema.apply。通过应用受管只读session独立读取COLUMNS的ORDINAL_POSITION、默认值、说明及EXTRA，读取STATISTICS与SHOW确认实际列序和主键引用。该备用场景不包含实际FK引用表准备；正常索引／FK引用保持先由上述真实React用例覆盖。任务数量不是底层驱动CREATE发送次数的独立仪表证明。

每步复核原owner及TestInfo开始起最多90秒的原期限，本地停链后不可复活。失败／取消／超时／未知保留本例资源，禁止finally补DROP或猜测退出成功。成功只关闭本例受管session及通过owner握手确认的所属应用，保留随机表和本例配置／隔离userData供Root复核，不自动删库／表／配置或全局终止进程。

Root已有旧Maria5原生现场；本文仅说明本任务未启动实际DB／GUI，不能记成全局native0，也不能复用、关闭或清理其它owner的旧现场。最终正式执行及保留资源处理由Root另行调度。
