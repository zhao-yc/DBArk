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

WIN11-TEST仍执行固定338a06b的原准备回合，本增量不切换该队列。尚无真实四行文件读回证据，不读取旧失败的ENOENT文件或profile，不自动启动GUI／完整回归；暂不发布。
