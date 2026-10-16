# 数据修改可靠键谓词去重复

本修复基于固定 `383aa8774c5d12d3d808d76ecebcfa59bb5037fc`，分支 `codex/employee3-key-predicate-dedup-20261016`。只改数据修改SQL构造器及必要回归、说明，不包含D06界面、保留字夹具、重命名或其他表属性功能。

## 问题与证据

完整原行保护原先同时生成键定位条件和全部列旧值条件，同一个BIGINT可靠键由此出现两份相同的 `<=> ?`。ROOT run638的正式旧用例在MySQL 5.7出现误冲突，不能仅凭“数据被修改/删除/定位不唯一”提示推断存在外部并发；该提示统一用于affectedRows不等于1并回滚整批的情况。

ROOT随后在六个隔离组合执行run639及run641原生谓词探针。员工3只读核对其摘要：同一原行的重复最大无符号BIGINT条件在5.7及两版MariaDB的预处理/文本协议都不命中；8.0、8.4及严格TLS的预处理命中、文本协议不命中。只保留一份键条件和其它全部原值的fullOnce在所有组合、两种协议均精确命中原行。

run641另以两个相邻UINT64最大键证明：fullOnce只命中正确原ID；非键DECIMAL增加0.000001、或原键被移走后，两种协议均不再命中。双CAST以及单CAST键在不同版本/协议下有实际失败，旧失败和清理证据由ROOT保留，不能把CAST键或写失败后切换协议作为通用修复。

本地独立执行实际buildChanges、deserializeCell、mysql2编码和execute：BIGINT与DECIMAL始终保留精确字符串，Unicode为完整UTF-8，BLOB还原00ff。实际COM_STMT_EXECUTE中的字符串为VAR_STRING，Buffer为BLOB，没有JS浮点转换或执行失败后回退文本。服务器参数推断及优化仍可能受表达式形态影响，不能仅凭客户端字节正确宣布服务器比较保真。

## 最小行为变化

只在 `src/engine/sql.ts` 的原值条件筛选中消除已被可靠键条件覆盖的**非文本键重复比较**，不新增键CAST、不改绑定值、不切换驱动或协议。

- 全部键条件仍来自同一before快照；修改主键时SET使用新值，WHERE使用旧值。
- CHAR/VARCHAR/TEXT/ENUM/SET/JSON等文本类型继续保留原索引条件，以及统一UTF-8后的BINARY精确字节旧值检查。CI/AI/PAD SPACE相等不能代替大小写、字节或尾空格相等。
- 全部非键原值继续比较，包括未编辑列、精确DECIMAL、文本、BLOB、BIT、NULL和生成列原值；完整before、缺键/空键、InnoDB及可靠键要求不变。
- UPDATE、DELETE和复合键采用同一规则。INSERT不变。原单事务内恰命中一行、任一冲突整批回滚的执行逻辑完全不改。

这是删除逻辑等价的重复非文本键谓词，不是把全旧值校验缩减为只校验主键。MySQL的字符串/数值比较存在隐式类型转换，相关规则只能作为继续验证的机制线索，真实版本/协议结果以探针为准：[MySQL表达式类型转换](https://dev.mysql.com/doc/refman/8.0/en/type-conversion.html)。

## 本分支纯检查

新增14项回归使用真实SQL构造器和mysql2 COM_STMT_EXECUTE编码/解码，检查复合文本键CI/PAD保护、更新键的旧值定位、DELETE、非键DECIMAL末位、Unicode/BLOB/NULL、参数序号及完整before拒绝。单元中的CI/PAD检查只证明字节条件和参数保留，不能代替服务器排序规则实证。相关实际Engine既有用例继续验证第二条冲突时回滚第一条，不提交部分修改。

相关四文件85项通过；最终全量3337项全部通过、0失败/跳过，类型检查和源码构建通过，构建仅保留既有大分块等提示。首轮全量3335通过、2失败，两个失败均是既有原型列测试仍期待重复的旧主键参数；仅更新这处参数期望，保留原型列、精度及所有非键保护。两轮日志分别保留，不把首轮失败或重复执行次数累加为通过覆盖。全量测试的TEMP/TMP仅在本次进程中指向已核对的本克隆缓存目录，未修改系统环境。

## 默认关闭的真实Engine核心入口

新增 `tests/integration/engine-row-change-key-guards.integration.test.ts`，必须同时显式设置 `DBARK_INTEGRATION_ENABLED=1` 和 `DBARK_ROW_CHANGE_KEY_GUARD_TEST=1` 才执行。复用已核对六实例的纯目标门，严格TLS组合必须使用显式TLS开关、原有CA和严格证书校验，不创建账号/证书、不加载凭据文件或自动探测服务器。单例/钩子沿用原30秒期限。

六项核心实际调用Engine的table.page/table.apply，驱动、参数绑定、事务和服务器响应不替换：

1. 相邻UINT64最大键仅更新正确原行，保持DECIMAL、Unicode、BLOB和NULL。
2. 非键DECIMAL末位、文本大小写/尾空格、BLOB或NULL被外部修改后，原草稿必须冲突且不覆盖外部结果。
3. 第二行原值冲突时回滚第一行已命中的修改，验证整批原子性。
4. 原主键外部移动后，旧UPDATE和DELETE都不得误命中相邻键。
5. 主键更新按旧键定位，重新读取后DELETE仅删除正确行。
6. 复合文本键在CI/PAD排序规则下“索引相等、字节不同”仍冲突，同时保留正常更新键和DELETE路径。

观察连接只布置本轮随机库和两张带本轮所有权标记的表，夹具键变更使用原生精确整数字面量，避免用待研究CAST影响前置条件。收尾先关闭Engine，再按实际线程编号及隔离库核零，确认对象名称/标记、无额外程序对象后精确删除测试库，关闭观察连接；失败证据写本轮缓存，未知对象或残留连接保留现场并报错。

本员工只检查默认关闭时6项跳过，**未执行新入口的真实六组合、GUI或安装验收**。ROOT后续在固定提交、核对目标和原有环境后串行运行：

```powershell
# 仅ROOT在已核对目标后显式注入当前进程，不把连接值写入文档。
$env:DBARK_INTEGRATION_ENABLED='1'
$env:DBARK_ROW_CHANGE_KEY_GUARD_TEST='1'
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-row-change-key-guards.integration.test.ts --maxWorkers=1
```

run639/run641是ROOT此前的最小谓词实证，不能改称本提交六项真实Engine回归通过，也不能替代正式D06旧用例复验。更广类型/版本、GUI、安装产物和发布仍按各自验收记录判断。

ROOT后续集成为d94930f：run647六组合各6项共36真实Engine核心通过，run650原两项正式D06界面在六组合共12次通过，包括MySQL5.7原集中提交失败按原断言通过；182文件3337单元、类型及构建也已过，相关资源独立核零。作者交付时的默认跳过和首轮旧参数期望失败仍保留，详见[正式验收及原失败](../../tests/integration/acceptance-d06-current-and-key-guards-20261016.md)。0.18未发布，不代表安装、其它驱动或macOS私网已验。
