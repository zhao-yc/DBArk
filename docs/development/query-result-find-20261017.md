# SQL当前结果的本地查找与跳转

固定基线：`078b21cbd129e1e3bc7c016dd07525fb678fd6f9`。分支：`codex/employee2-query-result-find-20261017`，使用独立普通clone，不使用worktree。

## 实际入口与范围

ResultsGrid在具有当前selectionScope和isCurrent、且非onActiveRowChange表格预览的查询结果中显示“查找结果”。Ctrl/Cmd+F只由网格与查找栏共同包围元素的冒泡事件处理，不注册document/window快捷键；Monaco不在该包围元素内。输入框Enter/Shift+Enter及上下按钮按行优先、可见列顺序环绕；Escape关闭。打开仅聚焦查找框，不发业务请求。

只读取已返回的rows和当前可见columns，按唯一内部key而非显示别名取值。界面明确列出已返回行数与可见列数，不能把它当成整库搜索，也不加载下一页或重新执行SQL。按匹配单元格计数，同格多次出现仍算一格。

文字是字面子串，不支持正则；默认使用JavaScript小写映射比较，可切换区分大小写，不做语言排序、去音调或数值转换。字符串搜索完整已返回原文本，含网格240字符预览以外部分；大整数和高精度小数字符串不转为Number。NULL按显示文字NULL搜索，空串/缺失值仍为空，空查询表示清空而非“搜索所有空格”。二进制只使用既有cellPreview的有界十六进制显示预览，不扫描后续字节、不搜索Base64、不尝试文本解码。

## 有界执行与私有代次

查询最多256个UTF-16单元；超出后明确提示，不拿截断前缀继续查。单段原文主片最多8192单元，末尾附加不超过有界查询长度的重叠用于跨段匹配。每批最多32768个主片单元或256个完成单元格，之后用setTimeout让出UI；原文只保留正在扫描格的引用，不克隆整表、不拼接全表字符串。大小写转换只作用于有界片段。

最多保留5000个命中坐标，达到上限停止并明确显示“仅在这些命中中跳转，其余未继续检索”；不谎报完整数量。每个代次只保存当前光标、至多一格原文、可见列键和有界坐标。新文字/大小写、关闭/重开、scope变化及卸载均取消旧定时器；迟到定时器须核原run后才能发布。

扫描与导航同时核原rows/columns/selectionScope、稳定Grid挂载归属及可取得的原宿主元素、Grid现有actionCurrent和父级isCurrent。观察到失效时永久清空该扫描的命中和原文，ABA恢复不能复活。父级既有选择接纳门负责忙碌、模态、切标签、连接修订、关闭及新结果/固定快照/列布局；本片未增加QueryTab结果表达式变量，也未绕过公共VM测试。

导航只调用原Grid ref的scrollToCell，并通过cellClass标记命中及显示行/可见列序号；不调用setActivePosition、不改selectedRows，不触发选择、复制或导出协议。已有勾选仍决定所选行复制/导出；当前结果导出仍覆盖全部已返回可见数据，与查找词无关。

## 验证与边界

初版cfbb322的固定来源：新增6项纯RAM与13项真实React/RAM对照，共19项；直接受影响的既有列管理真实UI、Grid选择归属、字节识别39项，共58/58通过，0失败、0跳过。TypeScript检查退出码0。

新专项覆盖字面与大小写、重复别名、隐藏/原型字段不读取、精确值、NULL/空串、二进制预览、长文本与跨段、字符/格/命中预算；真实React验证局部Ctrl/Cmd+F与Monaco隔离、分块进行中换词、旧导航/关闭、上下与Enter环绕、滚动索引、不更改勾选/复制，以及当前导出窗口的RAM请求保留完整范围和精确值。结果、pin、布局、job、version、inactive、closed、modal、binary、unmount十组变化后旧导航均拒绝，包括状态同批恢复。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-result-find.test.ts tests/unit/query-result-find-ui.test.tsx tests/unit/query-result-columns-ui.test.tsx tests/unit/result-selected-grid.test.tsx tests/unit/result-binary-cell.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/query-result-find/accepted.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

仅改ResultsGrid及新增helper/component/locale/CSS/tests/本文。未改QueryTab、shared/main/engine/App、依赖版本、表分页、文件协议或共享fixture。没有系统clipboard、DB、GUI、文件导出、full或build；复制与导出只验证RAM事件/请求。虚拟网格滚动布局、真实键盘焦点和Windows/macOS原生体验仍需Root后续明确安排验收，不能由RAM端口证明。


## cfbb322窄审两点修复

Root独审QF-1为P2：锁定并实际安装的react-data-grid 7.0.0-beta.61在lib/index.js第1940至1954行以无依赖数组的useImperativeHandle每次render重发handle。首次导航onHit引发父重绘后，原handle相等门误把同一网格判为替换。现在捕获稳定组件挂载token、原scope和可取得的原宿主；导航读取当前handle。真实宿主变化/离开文档、卸载、scope或父门失效仍永久撤销；没有把动态handle固定为常量。

真实React网格端口也改为每次render发布新handle，element来自实际RAM宿主ref；宿主key变化真实替换RAM节点，验证旧导航拒绝，重新打开的新查找仍可导航。独审原F1空element控制端口仍靠原scope及本组件准确挂载归属，不再依赖handle对象身份；实际有宿主时额外核同元素及ownerDocument.contains。

QF-2为P3：混合8191字符短格与长格时，循环入口的units检查不足以约束下一完整8192主片。现在每段计算batchUnits-units；装不下下一主片先让出并保留offset，end也受余量硬门约束。公开32768/8192预算不变，跨段重叠与空串计费不变。原反例本批主片处理量从40959降为32767，余下原文下一批继续。

本修复独立普通clone分支codex/employee2-query-result-find-fix-20261017，基线cfbb322c2a25a2326ad7c93f8c0ace3aeade867b。原独审测试SHA256 e4cf85bc625fb5da17009b4ffa755c5f2e2cd43fa2350d4c9cd659af66c22b33保持同字节，原F1/F2/F3在cfbb为1绿2红/2未选，修复后3绿0红/2未选。另选宿主替换撤销对照1绿/13未选及新增混合主片预算1绿/6未选；未重跑初版58/full/build，不把未选项计为通过。不启动GUI/DB/系统clipboard或实际文件导出。

本修复最终TypeScript类型检查退出码0。上述3+1+1均为本轮明确选中的专项；原58为初版固定来源，未重复执行。
