# 新建表 CHECK 验收（2026-10-28）

## 候选和源码门

Root 基线 `891e8d0f802f1efc6b8ec90f0621c66ef5584ee4`，同目录 main 开发，不使用工作树。候选21代码／测试文件：7旧文件按基线LF核对、14新路径必须原不存在。源码包271621字节／23项，SHA256 `f909a454bd4a51bae4ca0395012f642ef8d43219792c68f3097101fa1458fc39`；另附2808项运行源码／测试／脚本／构建配置摘要，747612字节，SHA256 `85ee3057aa0c453c08824910396a8c4f4e62c2ece40f9943b9000e35fdd5fa0d`。

本轮是实际 SchemaDialog → TableCreateConfirmation → Main／utility 的 CREATE 路径。保留四种建表生成路线及主键、普通／前缀索引、外键、生成列和字段编码的原限制。先以 SHOW＋两套 CHECK 目录完整证明，再只剔已证范围给旧核验链；MariaDB JSON 与 LONGTEXT 的等价需私有完整目录 proof，不改真实类型或源文字。静态审阅已修正表达式归一化将 TRUE 常量／ABS 函数错当同名列的边界，并补反例；不把此审阅计为实测。

WIN11-TEST先确认上轮 source04 原进程终态且无新测试／App在途，备份并只应用候选21，保留旧source96、dist109及其它dirty。重新核对2808项全部运行基线，不用局部候选一致替代完整比较。按序类型、20文件定向单元（6新＋14旧）、一次完整单元、构建、正式spec默认关闭和list；首错停链，保原PID、完整输出、退出码、源码前后字节及新dist清单。常规pnpm shim后代NODE_PATH只如实记录，不将父进程清理外推整链。不自行改产品／断言／pool／并发／超时或重试。

source01原类型PID13932 exit0（67.64秒），20文件定向PID9012 exit0（18.16秒）／645项通过；完整原PID16880 exit0（442.90秒），917文件通过／1跳过，19414项通过／1跳过。唯一平台跳过为POSIX文件模式。原build PID6856 exit0（108.21秒），新dist109单独核对；默认PID15864 exit0／恰1skip，list PID4212 exit0／恰1占位。原stderr提示保留，不宣称零警告或把默认跳过当作真实窗口通过。

Root完整回读2013551字节／226根项／249递归项原件，SHA256 `5797bf48f1dee8151b36c1b6aaa35904ad5a36e210f852a00a5e6f3c1890e38f`。CRC、逐项哈希、路径／私钥块、六门原stdout／stderr及退出码均匹配；source116与前轮source96＋候选21及本地逐字一致，其余95旧源码保持。2808项前后比较为2783 raw相同、17原行尾差异、8验收Markdown缺少、0实质差异，其它dirty及Git状态未变，未切换VM旧HEAD。

本机未运行产品测试；未读取认证或启动App／数据库，不执行Docker、安装、剪贴板或发布。旧ibYVwq失败profile与1392范围未触碰。现有表CHECK上一提交891e8d0f的CI `40615005544` 已终态success；它不覆盖本轮未提交的新建表候选或真实数据库验收。

## 正式实库计划（未执行）

已准备本轮精确隔离资源清单，Root已就本轮和已有表CHECK两份准确清单合并发出增补授权问题，尚未获得回答或执行。仅拟使用200的13357／13380／13384／13310／13311／13484，各一个随机 `dbark_e2e_createchecks_*` 库。只预置 owner 标记的 parent 表及id1；产品窗口在同库创建唯一 `created_subject`，包含主键、索引、指向 parent 的外键、JSON、DECIMAL／NULL 与命名 ck_amount。5.7应拒含CHECK设计且零CREATE。不得创建用户／授权、改全局或访问业务、旧CHECK库／1392。

实际 fixture manifest 必须绑定准确服务器身份、严格TLS状态、原parent DDL／行摘要、ownerNonce及待建表初始不存在。产品真实预览须零DDL；提交仅一次Main／utility CREATE，之后由独立只读目录核对约束、原parent和新表空行。探针仅新表BEGIN内两条合成合法行及id3／amount=-1拒绝测试，始终ROLLBACK、无COMMIT，并严格关闭。现代MySQL预期3819，MariaDB预期4025；未授权时不读取认证或执行探针。

正式单例120秒、单worker、零重试、关闭trace／截图／录像，记录原owned进程正常退出及任务／令牌／连接收尾。失败保留原App、profile和准确库，不强杀、自动重放或通配清理。结束后由Root按owner清单精确清理。默认／list跳过、RAM或静态代码不计真实窗口通过；其它建表组合、生效关闭、平台和安装范围另验，暂不发布。
