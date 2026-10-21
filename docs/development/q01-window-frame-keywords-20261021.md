# Q01 窗口帧关键字补全开发候选

## 来源与当前范围

排序／结果筛选的固定验收检查点保留为 `4bd2fd3e03e4ac62f9d6e3c4401b65846871ba8a`；测试机仍执行准确338a06b的原GUI，本增量不切换、重建或重复派发它。Q01源码已存在普通窗口字段、命名窗口及LATERAL，本次不重复实现这些历史能力。

本增量参考[MySQL帧定义](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html)及[MariaDB帧定义](https://mariadb.com/docs/server/reference/sql-functions/special-functions/window-functions/window-frames)，在普通SELECT／WITH的内联OVER和本块命名WINDOW定义中提供ROWS／RANGE、BETWEEN／AND、CURRENT ROW、UNBOUNDED及前后边界关键字。空白位置可插入完整固定边界；编辑已有词时替换完整后缀，不改其它SQL，不创建Monaco片段参数，不执行语句。

## 实际入口与保护

沿用SQL编辑器的本地Worker、`analyzeCompletion`和`completionSuggestions`。仅实际会话／服务器事实明确开启windowFunctions能力时启用，不新增IPC或目录接口。帧候选返回空syntax／关系／本地关系列表，建议管道只交付关键字；字段、函数目录及用户事务均不访问。

先验证有界完整帧形状，再将固定候选放回整条规范化语句，使用原静默MySQL解析器核验。已知非负数字边界用十进制文本比较，保留大整数差一位和小数精度；仅四位有界指数转Number作为小数点位置，不转换偏移值。数字文本最多128字符、指数绝对值1024；参数运行值不猜测。原262144字符／token／括号和Worker超时取消边界保持。

本次不开放INTERVAL、GROUPS／EXCLUDE、基窗口继承帧、函数／子查询偏移或例程复合体；未知及不完整语法继续停止，不借目录回退。全语句语法校验不是服务器类型／权限／执行成功证明，完整窗口及Q01工作包仍为部分。

## 检查安排

新增真实分析／建议管道34项，涵盖逐词和完整边界、命名定义、四词法模式、精确大数顺序、能力关闭、取消和原字段作用域；另增真实构建Worker入口1项。既有两条空边界和八条帧反例完整保留：有效位置改为精确本地关键字期待，函数／字段／子查询偏移继续blocked，全部保留零目录调用要求，不删掉原场景。

本地仅静态检查，尚待独立Linux检查；Windows／实库／安装及macOS未验。新能力不归入当前338的363项或GUI证据，验后再整合main，暂不发布，不增加完整工作包计数。
