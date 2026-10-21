# 七行排序筛选窗口的虚拟滚动读取

## 原失败与调整依据

准确7f的CLI1956原例在clientHeight254小于264时失败；查询已完成，功能断言尚未执行。原件、264高度断言失败及资源收尾unknown均保持，见[封存记录](../development/query-result-filter-duplicate-20261021.md)。原例未保存viewport和矩形，不能倒推具体宿主尺寸或宣称产品布局已修复。

264来自40像素表头加七行32像素，而产品布局合同只为网格内容另留96像素。虚拟表格允许滚动，完整七行排序不要求同时显示七行。后继将“全部内容”和“可见视口”分别验证，保留全部手写ID矩阵及原CSV／JSON期待，不调整窗口、显示模式或页面样式。

## 后继读取方式

- `tests/helpers/queryResultSortCaseGrid.ts`序列化到同一原页面，仅读取固定常量网格的ID列和ARIA位置，不读取React状态、源结果或产品比较器。
- 原网格须存续，视口至少96像素，内容高度至少40＋实际行数×32；七行内容仍需至少264像素。最多七数据行、八次页面采样，按完整32像素行推进，读取完全可见的单元格，再依ARIA位置拼成完整顺序。
- 行数、宽高、内容高度和重叠行值漂移、重复位置／ID、缺失末行或滚动不前进均失败，不把可见子集当作全部行。成功回到首行首列，失败不追加滚动或收尾。
- 每次读取前记录实际viewport、网格、编辑区、分栏和工具条几何；成功读取另存每页位置及ID顺序。附件只含常量ID、固定CSS类名和几何，不含认证、SQL正文或用户数据。

新增11项隔离RAM用例，包括原254／264组合、96像素下半行遗漏反例、空／单行／四行过滤、低高度、错误内容高度、停滞、缺行及身份漂移。这些只能证明读取器算法，不能替代真实窗口。

## 实施与验证边界

产品树仍为148bb40的585875a1c1dc39062cf65969a6f063342809536c。原1944字节SQL、七行八列、大小写／NULL／日期／负TIME／复制条件矩阵和四行文件期待不变，原120秒／零重试、一查询两导出三任务及原owner／DB观察流收尾保持。后继另加小数简写区间：`.12345678901234567890`至`1.`包含1／6／7，闭区间外只有3，均排除NULL；重开保留输入原文。

准确 `338a06b0366248cac93dd7c0d5cbe680e908b2e4` 的[Linux CI39516804309](https://github.com/zhao-yc/DBArk/actions/runs/39516804309)、job118950803755已成功。Root读取原日志：类型／591文件11380通过、10平台跳过／构建成功，单元170.61秒、Vite28.45秒。新增读取器11项通过，QueryTab组合110项通过，均含在总计内；原生、剪贴板及发布job跳过，不是GUI或私网证据。

WIN11-TEST原7f任务已终态封存，不重跑或更新旧profile。Root另派准确338的Windows准备，metadata为 `outputs/query-result-sort-case-grid-check-338a06b-vm-20261021`：先核四套封存、旧图及Git，安全快进后移除子进程环境全部DBARK变量，仅一次八文件check-local，包含类型及新构建。须先通过新控制实例语法门／ready／首CIM，分别留存本次控制器、launcher、观察器及正式CLI身份；原7f的109文件构建不复用。

Root已读取最终回报：原CLI13552退出0、111.659秒，类型39.71秒，八文件363通过／0失败／0跳过、14.17秒，新构建57.68秒。控制器14488／launcher14024／观察器16512／CLI均exit0，创建记录已保存，ready及首CIM通过后才启动check。源码574／测试1306前后不变，新构建109文件与旧图分列，Git净，23个本例新进程身份终核零匹配；四套旧封存未变，本轮66份封存校验通过，RAM三项保留。stdout为原文本，stderr既有Rollup／chunk警告保留；不把准备阶段通过当成GUI成功。

实际命令（子环境移除全部DBARK变量，原worker／超时不改）：

```text
node scripts/check-local.mjs --build tests/unit/query-result-sort-case-grid.test.ts tests/unit/query-result-sort-case-gate.test.ts tests/unit/query-result-sort-case.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-columns-audit-claim.test.ts tests/unit/query-result-columns-ui-preparation.test.ts tests/unit/recorded-process-identity.test.ts
```

以下摘要来自VM原最终报告，Root未下载复算；目录为 `outputs/query-result-sort-case-grid-check-338a06b-vm-20261021`：

| 原件 | SHA256 |
| --- | --- |
| stage-result.json | `5a5cb3085b1170b1825200d80100fb8775ab18bd4d39fbc726a62b3d6de90713` |
| check-stdout.log | `7ef7c349ddcd6093ad8ab5831c2f4d28efed910cba3ef0de600c9aa4f2e11452` |
| check-stderr.log | `5cd93a38703c97fd6f8521da509fa752582269f38016d600eb413bcb68570967` |
| source-hashes.json | `2679d0be6984f693f8ff65b9841974964ac6966a2e70b242c662092f999d02ba` |
| dist-hashes.json | `542a6e1aa43ebdaa87614866d7d49c614b95f90f6288509e6370ad4c7d7ac151` |
| SHA256SUMS.txt | `e7efb0fdf17acd523f2f2a57fc15554ff6dcda30191ef2f47d142d71d41abb05` |

准备通过后，Root已另派固定338及本轮新构建的独立GUI，metadata为 `outputs/query-result-sort-case-grid-gui-338a06b-vm-20261021`；先核本轮66及旧封存和完整图，再使用新nonce及经语法／ready门的新控制实例，正式120秒／零重试，失败或成功均封存后停止。当前仅确认送达，尚无GUI句柄或结果。Python独立读回、完整回归及main整合均未完成，暂不发布；原7f高度失败及全部unknown保持。

后继补充[四行标准库独立读回工具](query-result-sort-case-readback.md)，只为GUI成功后的准确原文件和SHA提供可复用入口。49c109f的Linux Python16项、另591文件11380项及类型／构建通过、10平台跳过；实件读回另记，不修改当前固定338准备任务或沿用旧两行期待。
