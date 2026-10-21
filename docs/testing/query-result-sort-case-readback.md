# 四行排序筛选导出的独立读回

`scripts/testing/verify-query-result-sort-case.py`仅用Python标准库，独立手写原行1／3／6／7的八字段期待，不导入产品比较器或TypeScript夹具，不联网。适用于后继七行窗口成功导出的四行CSV及JSON，不适用于旧两行NULL夹具或任意业务数据。

## 输入及结果

GUI成功且原文件身份／摘要已封存后，由Root另行派发。使用同一本例 `dbark-query-columns-<32位小写hex>` 目录下的两个绝对路径，文件名必须为 `visible-selected.csv` 和 `visible-selected.json`；两个SHA256均取自此前原GUI封存，不根据当前输入补造原记录。

```text
python -I -B scripts/testing/verify-query-result-sort-case.py --csv <CSV绝对路径> --json <JSON绝对路径> --csv-sha256 <原CSV摘要> --json-sha256 <原JSON摘要>
```

每文件最多32768字节；只读普通文件，拒绝文件链接及直接父目录链接／Windows重解析点，核原文件描述符和读前／读后路径身份，读完两文件再次核对。CSV逐字段、整行及顺序相等，JSON另核原类型、全部字段顺序并拒绝重复字段。BIGINT／DECIMAL／微秒／负TIME不转浮点，空字节／NULL、U+0130和U+0069／U+0307独立。

stdout只输出结构化校验报告，校验成功退出0、校验失败退出1；缺少参数由命令行解析退出2。不创建或覆盖报告及输入文件。成功固定四行八列、JSON18字符串／11null／3二进制；身份和纳秒时间以字符串记录。`stableRead`只证明本次读取窗口，不回填原GUI未记录的身份、owner退出或DB观察流关闭。

## 自动检查与范围

`tests/python/test_query_result_sort_case_readback.py`新增16项标准库检查，独立构造合成字节，覆盖末位精度、大数、类型、NULL、字节、Unicode、缺行／顺序／额外字段／重复键、预算、SHA、链接、读后漂移及真实CLI只读行为；`-O`下失败仍不能回显合成秘密。合成文件仅在测试独占临时目录内创建和清理。

Linux CI在原类型／Vitest／构建前新增 `python3 -I -B tests/python/test_query_result_sort_case_readback.py`，不安装依赖，不更改原生平台或发行门。Python16项与Vitest统计分列，不合并为同框架数量。

准确 `49c109ff49663f8896f322d9c85208a1a6aa09fd` 的[Linux CI39518836049](https://github.com/zhao-yc/DBArk/actions/runs/39518836049)、job118957437136已成功。Root读取原日志：Python16项全部通过、0.215秒；另有Vitest591文件11380通过、10平台跳过、222.41秒，类型及构建通过、Vite31.13秒。两个框架分列统计，`-O`失败脱敏及真实CLI只读反例包含在16项内；原生、剪贴板和发布job跳过。

WIN11-TEST固定338a06b的准备回合已通过类型／363定向／新构建及66份封存；其GUI已1/1通过，四行原文件和112份封存已返回，见[本批记录](query-result-sort-case-grid.md)。Root另派同一338的独立读回，通过后一次完整Vitest，本增量不切换产品工作树。

准确49脚本由Root静态读取Git原始blob复算：Git blob为 `7940470887003318e3568152f5ec7723eb8bb52c`，7669字节，SHA256为 `9c4ecd332305bc3c72a631c89de71d53c06d5c33e0f65ea1f7f7ebe67265de22`。VM仅允许提取该脚本到新metadata目录，不checkout／merge49；若缺Git对象，仅一次获取准确49对象。读取两个已封存文件的原SHA，不重用旧两行夹具或profile。

## 首次Windows读回失败与兼容修正

固定338产品源码的首次独立读回已失败：准确49脚本的Python16172退出1，原正文片段为 `{"passed": false, "error": "文件打开时身份已变化"}`，停在85行的lstat／fstat快照比较，尚未解析CSV或JSON。完整Vitest依门未启动。Python原.NET句柄记录创建时间为北京时间2026-10-21 08:53:43.5240852、0.5945962秒；ready及首CIM先通过。控制器17984／launcher4732／监督器15680均exit1，观察器16040 exit0；七个本例PID身份终核零匹配。原两文件身份、383／827字节和SHA不变，源码574／测试1306／构建109、Git及六套旧封存不变，RAM三项保留，63份新封存通过。

监督器转发stdout后混入两行 `System.Threading.Tasks.VoidTaskResult`，没有独立纯Python stdout原文件；包装器executable字段还误沿用Node，实际CIM身份为PowerShell。这些原记录保留，不能清洗或回改。原失败没有记录两组stat tuple，具体不等字段仍未知，不能用后继实验回填。

原件均位于 `outputs/query-result-sort-case-readback-338a06b-vm-20261021`，以下来自VM回报，Root未下载复算：`reader-original.json`（混合原通道）SHA256为 `46c6fdc44e4729fb16baf36e94d55d344e27fe5ed5e71ad7302c0ee69699f09e`；`readback-full-report.json` 为 `19da09707cf6a96c0e62a261dc7ded2cf0dcd5608daf42cf3da97046546a23f5`；`SHA256SUMS.txt` 为 `c7731790d115227c5c852a7f429581f7645b66c21f5937218e1b060971064694`。

[CPython官方问题157671](https://github.com/python/cpython/issues/157671)记录Windows部分版本路径stat将ctime映射为创建时间，而fstat保留元数据变更时间；[Python文档](https://docs.python.org/3.14/library/os.html#os.stat_result.st_birthtime_ns)明确提供birthtime创建时间。此处据此修正跨接口比较，不声称已确诊旧失败的具体字段：Windows具备birthtime时，跨路径／句柄以设备、inode、大小、mtime和birthtime绑定；旧Windows及POSIX保持原时间语义。原路径ctime与原句柄ctime分别在各自接口内前后完整核对，birthtime、普通文件／重解析属性、原SHA及完整值检查也保留。

新增5项Python反例，覆盖合成Windows跨接口ctime差异、旧版本无birthtime、真实有界读取的合成句柄差异、句柄ctime／birthtime／类型／重解析属性漂移，以及路径ctime漂移。总21项Linux已通过，WIN11-TEST待验证；未在开发机运行。后继提取新准确脚本及测试到新metadata代次，产品工作树仍为338；先合成检查，通过后另一次真实四行读回，再依门完整Vitest。旧失败及所有旧封存保持。

修正提交 `39e9b247d4fcdf670dfe2ca5a4a07ea9538889ed`；Root只读取Git原始Buffer复算来源，不执行Python：脚本blob `0912a2271330d84d6fe1bb315165e907cfbfc8d6`、8589字节、SHA256 `7b927e233725cb6a1be4c7bd81813df1f169c17a661176116c35488a32f0b7a0`；测试blob `521c55e8d3ee5349c9b20ea1cea5e17431af748c`、16430字节、SHA256 `466dd2dad8dfb953d859555d8b77c18d55c8d05a34e6c06105e2dcbcb32dc82a`。候选Linux CI为39525029394；后继VM不checkout该提交的Q01代码。

准确39的[Linux CI39525029394](https://github.com/zhao-yc/DBArk/actions/runs/39525029394)、job118977538869已成功。Root读取原日志：Python21项通过、0.275秒；另有Vitest592文件11419通过／10跳过、235.38秒，类型及构建通过、Vite33.67秒。全部新增Windows语义合成反例和真实临时CLI反例包含在Python21项内；Linux运行仍不是Windows实件读回，后续Q01运行码也未被338的GUI验收覆盖。原生、剪贴板及发布job跳过。

后继bcb1420／0757803的Q01源码不进入本批。main整合及新安装／macOS未完成，暂不发布。
