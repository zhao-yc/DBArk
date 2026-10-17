# 列排序规则准备核心运行时合同窄修

父提交：`6ac6a73a2fb33e02599dd697f43063826ebc940e`。固定独审报告SHA256：`981fce93b6a3a1397c45394d38238e38baa9562503d0afe59d20f6882bddb635`。保留原候选和报告，未把准备片当作完整列collation功能。

## 变更

仅增加私有 `tableColumnCollationInput.ts`，并在已有私有读取、unchanged、候选生成及后核边界调用：

- 权限与出向完整性必须是自有布尔数据字段，资格要求明确`true`；所有可信列的generated/hidden/nullable标记必须明确为布尔，目标generated/hidden要求明确`false`。缺失、字符串、数字或getter不冒充证明。Map采用原生检查与既有4096列预算。
- 下一配对先拒绝Proxy、自定义原型、getter/setter、toJSON和额外字段；只提取两个自有可枚举数据字符串，检查长度，再把独立纯数据副本交给现有共享配对校验。反射之前用Node原生Proxy检查，不调用调用方的get/descriptor陷阱；没有更改共享schema。
- v1事实必须持有准确`blocked`枚举和原两项强制原因，数组不得缺项、增项、乱序或含访问器。未知或篡改状态不能得到结构匹配成功。
- 候选输出、unchanged及后核在输出前再次核对关键运行时事实；后核原因由模块内部不可变常量生成独立副本，不转发可变的`after.execution.reasons`。

没有增加可执行ALTER、执行授权、TABLE_ID或算法证明，`definitionVerified`仍始终false。Root的run1528没有被写为常数或一般化保证。共享schema、Tasks、四RPC、UI与真实权限读取未扩展。

## 原字节证据及本轮验证

独立测试原字节SHA256：`267d946297d890853364c4e27381e0f022c093fd14f8b0c07048c6f813b61151`；独立RAM行集夹具SHA256：`8a1f2d429333370d3da76290536ac12585b7a0638ae6bf40c26972d5a866a283`。

在新普通clone的ignored目录展开原source.zip并复制上述原字节，先仅运行P3/P4/P5/P6，**4失败、2未选中**。修复后只替换镜像中的三个私有源码文件，原独立测试6项（四红＋两项正常/拒绝对照）全部通过。原文件、before报告及独审目录未改。

新增必要运行时对照16项通过：明确布尔正常路径、缺失/非布尔标记、两个pair字段访问器零调用、toJSON/自定义原型/Proxy零调用、关键布尔getter零调用、六类未知/篡改execution、阻断原因getter零调用。正常结构后核仍只返回`structuralMatch:true,definitionVerified:false`并保留两项原因；修改输出原因数组不影响下次结果。

```powershell
# 工作目录：clone/.cache/column-collation-runtime-review，修改前
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest.config.ts -t 'P3|P4|P5|P6' --reporter=json --reporter=verbose --outputFile=before-results.json
# 同工作目录，修改后（原字节六项）
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=json --reporter=verbose --outputFile=ready-results.json
# clone根目录
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/table-column-collation-runtime.test.ts --reporter=json --reporter=verbose --outputFile=.cache/column-collation-runtime-review/ready-controls-results.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本轮未重跑作者64项、旧全套/full/build，未访问DB/200/SSH/GUI/OS业务/剪贴板或私料，不占用Root实际资源。只使用本地固定候选和原独审证据，交付末尾可尝试已授权Git任务分支正常推送；没有其它服务网络操作。类型结果、精确提交及原/新证据SHA256存于本任务ignored `.cache/column-collation-runtime-review/handoff.json`。
