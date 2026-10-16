本片基于已推送的f9dfa3c4f877b6b58f218d3d8c1b69b451014f71，为现有执行历史概要分页增加执行开始时间范围。默认两端为空，不发送timeRange，保持旧匹配和保留策略。版本、依赖、数据库结构、历史保留上限、真实历史数据及共享desktop fixture均不修改；这是待Root整合与原生验收的源码切片。

界面明确显示打开面板时的本机IANA时区，时间卡片也按此固定时区显示；打开期间系统时区改变不会重新解释草稿。开始端点包含，结束端点不包含，即[from,until)。可只填一端，也可清除全部；清除或编辑后必须明确重新搜索。输入保留原文字，不trim、不补日期、不静默修改非法日历。支持本机YYYY-MM-DD HH:mm[:ss[.SSS]]，或明确带Z/数值偏移的ISO时间。

本机时间先严格校验日历，再用固定Intl时区在前后两天有界读取97个整小时样本的真实偏移，并对所有候选做日历往返。普通时刻须唯一；夏令时缺口、半小时跳变、跨日期线跳日或重复时刻均不能沿Date默认规则前移/择早。重复时刻要求明确填写Z/偏移来指定哪一次。已覆盖纽约、Lord Howe半小时和Apia跳日反例；本轮没有原生系统时区、浏览器或所有历史时区组合验收。

后端只接收24字符规范UTC YYYY-MM-DDTHH:mm:ss.SSSZ，拒绝无时区、非规范偏移、归一化日期、空范围、相等/倒序或额外字段。原startedAt允许明确Z或数值偏移、最多毫秒精度，按真实绝对时刻比较；不按索引字面量比较时间。无范围不新增时间有效性限制；启用范围时，无时区或坏时间的遗留记录进入既有onError stop/continue和有界失败明细，不能悄悄符合或当作无命中。错误不回显输入、SQL、完整历史错误或JSON正文。

时间筛选在现有工作线程完成，不增加SQL WHERE时间过滤，以免SQLite的字面量日期比较漏报坏/遗留时间。仍按既有started_at/id二进制复合索引续读，排序行为不变，不承诺将不同偏移格式的遗留索引重排为UTC顺序。每批最多25条、概要128KiB、原文128MiB、1000条保留及正文/错误按需读取均沿用。没有把SQL全文移入时间筛选日志或任务历史，也不修改历史记录。

初次请求由Zod复制规范范围，随原LocalSqlPages状态保留；续页协议只能携带taskId/cursor，不能追加或篡改时间。编辑条件同步禁用续读，重新搜索先释放旧cursor；非法输入不发新请求，旧cursor仍归当前面板所有，关闭时清理。取消等待worker真实终止，关闭等待活动请求及迟到cursor释放；失败不丢失清理责任。没有新增游标/任务生命周期。

58项定向测试通过：新严格时间18、真实SQLite/worker5、真实ReactDOM5、默认关闭收集守卫6，加原历史14及主进程互斥/取消接线10。SQLite测试只操作本任务创建的合成临时库，确认范围读取前后数据库文件字节不变、任务记录为空、原对象修改不改变cursor筛选、坏时间遵循onError、取消后线程编号-1、释放/关闭后cursor不可续读。DOM通过真实ReactDOM事件委派，只替换IPC与工作区端口，未替换转换、load或清理函数。全工程类型检查结果见交接缓存。

首次SQLite测试在沙箱临时目录因原子rename被EPERM限制，既有测试也同样失败；将TEMP/TMP限定到本任务.cache/history-test-temp后，新旧19项实际通过，未修改生产保存逻辑或共享夹具。

原生离线定义history-time-filter.spec.ts默认关闭，仅DBARK_HISTORY_TIME_FILTER_TEST=1且非--list时加载live。收集守卫纯RAM测试证明--list/--list=json即使门已开，也不读环境、不导入live/desktop。准备的单项定义通过真实历史界面检查端点、遗留错误、清除和关闭；只有合成夹具，打开历史不执行SQL。本轮没有启动原生产品、Playwright list、200、clipboard、Docker或手动CI，没有读取凭据、修改用户历史文件或构建安装包。原生定义须由Root另行绑定候选及已审退出fixture后执行，不继承旧许可。

时间行为依据：[Date的溢出与夏令时默认归一化](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)、[Intl formatToParts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts)。本片明确避开默认归一化，不引入新日期依赖。
