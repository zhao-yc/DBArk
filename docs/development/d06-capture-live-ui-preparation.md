# D06 捕获替换正式产品UI验收准备

日期：2026-10-16。员工3独立普通分支`codex/employee3-d06-capture-ui-20261016`，固定基线`23feb3046a6bfbb61fff3a20639dc6fbe1717d2b`。本片只新增测试、必要纯辅助及说明，未修改产品、旧D06用例、live-helpers、桌面夹具、期限、依赖或配置。预算修复、原075报告和严格失败探针继续冻结。

状态：仅完成本地类型、纯单元和用例列表验证；尚未执行这三项真实GUI或实库。ROOT负责在包含捕获、预算及可靠键修复的最终集成版本上执行Windows六组合，不能把当前普通分支不含ROOT可靠键产品修复的事实换算成实库通过或失败。

## 三个严格逻辑用例

新文件`tests/e2e/page-capture-live.spec.ts`通过真实对象树打开表、真实查找面板勾选捕获、真实Worker产生预览及草稿，最终集中提交沿用原数据预览和确认按钮。不伪造Worker结果、不替换IPC处理器、不直接调用提交IPC、不修改React或Monaco模型。

| 固定用例ID | 严格观察 |
| --- | --- |
| D06-CAPTURE-BATCH-UI | 先核默认捕获关闭，普通/正则默认美元保持字面；完整预览后取消不留草稿。明确勾选捕获后，以原生String.replace计算数字组、命名组、未参与组、$$和$&的两行完整after；预览确认前与形成草稿后均独立观察服务器原值不变，最后由原集中预览确认写入正确两行及精确UINT64键。 |
| D06-CAPTURE-CURRENT-UI | 原文含emoji和三个old，模板$1-$1-$1长8、实际插入old-old-old长11。第一次仅替换原第一处，必须定位4/5、UTF-16位置15；第二次必须替换原第二处并定位7/7，不能落到新插入的old。完整after由原生单次/sticky替换确定，服务器始终原文，只留本地草稿。 |
| D06-CAPTURE-UNICODE-UI | emoji零宽模式同时引用原文前缀与后缀，完整after取原生Unicode/global静态替换。全部可见列8处匹配只允许note一格生成补丁；DECIMAL、BLOB、NULL及生成列保持替换禁用/排除。独立观察预览及草稿零写库，最后集中提交只更新note，生成列由服务器按note自然计算，精确数值和二进制保持原值。 |

三项沿用Playwright原配置期限，没有增加timeout、sleep、强制点击或重试。预览表逐格读取完整DOM文本；不以after片段或标题出现冒充完整结果。

## Monaco完整性与独立观察

集中提交前，`completeCaptureSql`核对本片已知隔离夹具的全部UPDATE、note赋值、WHERE、完整JSON参数尾部、占位符数量、精确键、原文及原生after。它不调用产品SQL生成器，兼容ROOT可靠键去重前后的预览布局，避免本测试绑定旧重复键实现。

Monaco须先在同一次`innerText()`读取中达到上述完整条件，再保存该完整DOM快照。尝试普通键盘写入后仍用同一`innerText()`接口逐字比较，不混用textContent，不只等待UPDATE字样。辅助仅消除Monaco软换行并还原显示空格，不删除JSON值中的真实空格。新增5项纯单元覆盖完整两种键布局、半份预览、缺尾部、错原值/after、重复行、占位符不符和真实空格。

每次集中提交都在SQL完整且只读断言之后、点击确认提交之前，再通过独立观察连接验证全部原值未变；确认后观察实际数据库结果。观察连接只负责隔离夹具、只读断言和清理，不替代产品提交链路。

## 默认关闭与隔离

双门均须显式为1：`DBARK_INTEGRATION_ENABLED`和`DBARK_D06_CAPTURE_UI`。静态skip在自动桌面夹具之前生效，默认不启动应用。真实运行只接受已核对的`192.168.31.200`及13357、13380、13384、13310、13311、13484六个专用端口；13484还要求既有严格TLS开关，CA及身份校验沿用live-helpers，不降级。

复用`isolatedDatabase`的每例随机`dbark_e2e_*`数据库和现有测试用户；不新建用户、凭据或证书。测试只在本例库建表，原finally先退出本次应用再精确清理本例数据库并核不存在。trace关闭，避免连接参数进入追踪；测试截图仅在ROOT真实执行时产生。

ROOT确认服务器身份、环境及最终集成版本后，执行入口为：

```powershell
$env:DBARK_INTEGRATION_ENABLED = '1'
$env:DBARK_D06_CAPTURE_UI = '1'
# 既有六组合连接/TLS配置由ROOT分别提供，不在源码保存密码或新建用户。
node node_modules/@playwright/test/cli.js test tests/e2e/page-capture-live.spec.ts --workers=1 --retries=0
```

上面是交接命令，本员工没有执行。三个逻辑用例在六组合理论共18次，必须以ROOT各次实际结果为准；当前不填写通过次数。

## 本员工实际验证

两道开关均显式关闭，只执行：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run tests/unit/page-capture-live-sql.test.ts tests/unit/page-capture-budget.test.ts tests/unit/page-capture-replacement.test.ts tests/unit/page-capture-worker.test.ts tests/unit/page-find-worker-client.test.ts tests/unit/page-replace-current.test.ts tests/unit/page-replace-intent.test.ts tests/unit/ui-page-find-replace.test.ts --maxWorkers=2
node node_modules/@playwright/test/cli.js test tests/e2e/page-capture-live.spec.ts --list
```

结果：TypeScript退出0；相关8文件123项通过、0失败/跳过；列表准确列出3项用例。没有运行GUI、200、剪贴板、Docker、工作树或生产部署，也没有提高限额、截断原生预期或修改旧断言。原相关118项与新增5项分开可追溯，不能把本地纯验证称作新UI验收。
