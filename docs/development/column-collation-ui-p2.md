# 列排序规则前端两项 P2 窄修

固定原件为 `0a98c3ea012cc525f9359d5fdc829f29fb3b1922`。员工4交接 SHA256：`4fba884beeac93a0d9c7a1ec56860a9f9e10ed1033916e8f864be786c9b1f1d2`。原两红及诊断只读复制并保留，未追改独审原件。

排序规则预览现在要求四项基础/新增 ACK 全部存在且无重复；缺项释放令牌，未知项继续显示并禁止执行。不将前端 RAM 投递误称为后端接受或 DDL 执行。

所有 `saveRow` 先核当前编辑器、补丁数组、原快照对象/ID/摘要/列数组，以及既有列的准确对象与 columnRef，再区分普通属性或 collation。旧普通保存闭包不能清掉重读后的新草稿；合法普通属性、新增时间列与既有自动更新时间路径保留。旧回调是合同反例，未证明自然 GUI 可达，未声称实际用户丢草稿。

只运行原两红、六项必要窄对照及两项新增/既有自动更新时间对照：10项通过，另外2项既有测试因定向过滤未执行；没有重跑原61项。原两红的断言体原样保留，仅测试服务mock补充真实输入类型。实际命令为 `node .cache/employee5-column-collation-p2-v2/run.cjs` 与 `node .cache/employee5-column-collation-p2-v2/typecheck.cjs`。未运行GUI、数据库、认证、剪贴板、full/build；不改共享、Engine、Main、Root。提交仅本地交付，不推新ref。默认关闭spec另分支准备，不混入此修正。
