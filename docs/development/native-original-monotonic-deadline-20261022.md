# 原生验收沿TestInfo原单调期限计时

## 原问题与实现

准确741安装CI的CRLF首次模型用例在launch身份检查处因Date.now回退1毫秒进入clock-reversed，详见[原失败](../../tests/integration/acceptance-main-7410f68-ci-20261022.md)。不能据此认定格式化已失败，也不能用其它源码窗口通过追认此安装回合。

默认守卫现在延迟解析本克隆锁定的Playwright1.64.0内核iso.monotonicTime，与实际TestInfo._startTime使用同一worker时间原点。以原_startTime计算已消耗时间，再映射至原_startWallTime用于既有诊断及deadline检查；绑定前的准备耗时也计入原120秒。不会在绑定时以当前时间重新签起点，不读取后续Date.now，不加毫秒容忍或clamp。

原墙钟字段仍作为不可变身份核对。缺失／无效／变化的单调起点、框架函数或时间原点漂移均拒绝；单调时间本身回退继续进入原clock-reversed，失败永久保留。原TestInfo、状态、超时值、afterEach墓碑、配置及所有资源归属检查不变。只有显式RAM注入的时钟继续沿原毫秒域，既有诊断反例及属性读取合同保持。

解析只在显式原生回合绑定时发生；默认及列表不加载内核、创建目录或启动App。CommonJS测试入口使用项目绝对package.json的既有createRequire方式，未改变模块类型或依赖。

## 本机验证

先核锁定框架实际源码：TestInfo构造时保存_startTime=iso.monotonicTime及_startWallTime=Date.now；内核单调函数使用performance.now加固定worker原点偏移。直接使用裸performance.now会漏该偏移，因此未采用。

初始候选使用import.meta.url，Playwright列表发现CommonJS语法不兼容、0例；改用现有项目解析方式后准确登记1例。该准备失败保留，不描述为原生或单元成功。

会话99429类型27.17秒、三文件40项通过，总30.00秒；新8例走真实默认框架路径，只控制performance.now，包含墙钟回退／大幅校时／拒读、提前消耗119秒、原deadline、单调回退和起点／原点漂移。后继会话83391类型28.86秒、12文件304项通过，总33.69秒、退出0，覆盖全部共享调用方与CI报告合同。产品src仍为9440d6b590e11de785be46cd92261492465dd610，未为只改测试守卫重复产品构建。

原生四例、实际安装及三平台CI另验；本记录只是计时修正及RAM证据，不追认原741失败，不发布。

## 后继原生与合法时间域

准确eb0ea00c的[本机Windows源码正式四例](../../tests/integration/acceptance-native-monotonic-eb0ea00c-source-20261022.md)已通过，八个原App正常退出、四目录移除、32行为见证及113原运行字节复核通过；同次构建后按真实本机Root清单批准，没有冒充CI或重新签名失败回合。该证据不覆盖实际安装、macOS或真实OS校时。

进一步使用框架真实setTimeOrigin构造有限负时间戳，新增反例先因无效起点误拒绝而失败。去掉非负假设，仍要求原有限值及不漂移，以elapsed核前后和deadline；无穷值、缺失、回退及原点变动继续拒绝。后继会话71558类型29.53秒、同12文件305项通过，总34.36秒。旧eb0克隆与批准保持，只按RAM记录新增边界，原生及CI后继另验。

eb0全量CI另发现[执行计划AST测试端口缺少历史回调引用](../../tests/integration/acceptance-main-eb0ea00c-ci-20261022.md)，保留11707通过／1失败／10跳过。后继只补真实函数抽取及准确未绑定状态，追加回调无副作用断言，五文件186项及类型通过；没有更改产品代码或计时条件。新全量CI及三平台安装终态仍须另核，不把定向或源码四例替代整体通过。
