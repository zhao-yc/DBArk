# 完整CSV／CSV ZIP分隔符：18组合真实后台验收

固定测试头 `b40d9ec6d98982542e72998a70767c1c2475d42b`，产品及构建输入仍为 `3553750`。2026-10-18在 Windows Node 的真实 Engine／mysql2／文件系统与准确 Server-200 MySQL8.4.11 验收，18个不同正式身份分2＋16两轮通过，0失败／重试。每轮未选身份分别16／2跳过，合并覆盖全部18，不能把它们视为额外通过。

| 维度 | 实际范围 |
| --- | --- |
| 格式 | 单CSV指定第2个行结果集；ZIP包含空行集CSV、301行CSV及UTF-8 manifest |
| 编码 | UTF-8、UTF-16LE、GB18030 |
| 分隔符 | 缺省逗号、分号、Tab；缺省请求不附字段 |
| 原执行 | 同一真实managed／thread，空SELECT、DO状态、源表SELECT顺序共3句；源表SELECT每例恰一次，执行期间不新增连接 |
| 精度与字节 | UINT64、INT64下界、DECIMAL(65,30)、DATETIME／TIME微秒、JSON内UINT64数字、SQL NULL／JSON null／空串、前导反斜线、引号／CRLF／分隔符／中文emoji、NULL／空／非空二进制 |

每例独立301行种子与原SQL CAST／HEX／DATE_FORMAT投影深比较。CSV完整编码字节用独立csv-stringify生成预期，再以ICU解码及csv-parse核字段；ZIP用独立目录／CRC解析器核条目、全部CSV字节和严格manifest的位置／名称／类型／序号／状态／字节／行数／分隔符。产品预览仅200行并标截断，待写峰值1行、字节有界；此为小样本队列证据，不是百万行或吞吐／内存基准。

原partial从真实open句柄取得身份，贯穿rename前登记、真实发布、读取和清理，不从目标同字节重新认领；每例同一原native／stream及两份真实driver回执均确认正常关闭。任务完成、精确原线程后核、nonce／case标记、完整三表及SHOW定义、无额外对象、源／邻表保持、目录和文件身份检查后才精确收尾。18个成功库、文件／目录均按原路径清理，journal终态为`cleaned`；只读原末尾附录与journal互相核对一致。

Root另开准确实例的只读观察连接，核18成功schema缺席及54成功原thread缺席；连同首批原线程共60个精确ID均不存在。只执行3条只读SQL、0变更，原观察流正常关闭。证明 `.cache/parallel-integration/run1848-qcsv-postcheck/proof.json` SHA-256 `a0fd3bd2fefbd5f06cd6f85ee456a1d008a90f1a2de9ca752a8d49be8dc24e1e`。两轮原日志SHA-256分别 `31b4e73bc8844444ed5f3b4a77ac48b8f74f1a238d7630a27e38955259d4a8e3`、`a778ccee73975168fa06bbe49ec8ea9de21c2e3cf2a5494ca46622eab70a4a89`。

首批 `e48e487` 的原单CSV通过、ZIP空集字段类型期待失败及16未选保留。Root独立原mysql2只读实测同一`SELECT 0`字段码8／LONGLONG，才将严格期待和RAM种子从LONG改为LONGLONG，不扩大可接受集合、不修改产品；原失败日志／ZIP／目录／journal及小型随机库保持，原六线程外部核已缺席，不补造其正常关闭。原先仅JSON记者未输出末尾附录，新轮使用default＋JSON输出原有记录。准确逐轮及证明见[统筹记录](../../docs/development/query-csv-root-20261018.md)。

准备增量独审为五个自有文件、三个连接RAM场景；Root窄139项及类型通过，计数不与实际18相加。本验收不含GUI／Main文件令牌／保存选择器、Electron安装、macOS、新驱动、其它数据库版本／TLS、取消矩阵、百万行或完整性能，不执行Docker或剪贴板操作，没有新公开版本，Q05／F01继续“部分”。
