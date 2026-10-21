# 筛选条件启停整合版 Windows 验收操作单

## 准确对象与既有现场

本单为Root明确授权的串行条件链：准备成功才运行一个GUI整例；GUI通过并封存原文件身份及SHA后才独立Python读回。任一阶段失败停链保留，不追加full、Q01旧例、安装、其它数据库或发布。

产品目标`c4495066f4f570fbff69769ea377f442c66a0aea`，src树`0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2`。main已正常合入Q01及筛选启停；Root核Q01输入与准确0a4相同，筛选启停和904组合用例未被覆盖，整合类型／265项／构建已通过。预计Git源码576文件、tests1312文件，以准确对象逐文件核对，不把旧1308套用到新目标。

Root已接受原0a4 GUI回合completed、exit0、91封存及严格资源收尾。新任务开始先核VM仍在干净0a4，source576／tests1308／dist109原图、十套旧封存（原九套加Q01的91）及原CSV／JSON身份、长度、SHA不变。不要读旧profile或清理旧失败／unknown。

允许一次fetch统筹指定的操作单提交并用git show读取本单，目标是该提交祖先，不重复fetch。核原0a4为目标祖先，在原VM分支ff-only至准确c449；不checkout最新main、不新建分支／clone／worktree、不stash／reset／强推或修改产品和用例。

## 独占准备

新独占metadata：`outputs/result-filter-enabled-c449506-vm-20261021`。存在目录或本例已有活进程就回报原任务，不另建代次或重复启动。复用已验证的正常控制模板；语法门、observer ready及首CIM先于正式Node。保存原.NET handle的PID、创建和退出，实际exe分列；stdout／stderr原字节与控制返回值分离，异步返回用`[void]`，字符串替换使用函数回调，不用eval。

先只读记录原dist图；本次普通构建会合法替换dist实体，新图另存，不要求旧实体在构建后保持。精确核新源码／测试／构建输入与Git对象。准备子环境移除全部大小写形式DBARK_*，父RAM目标／凭据／准确UUID仅回保留布尔，禁止展开或打印敏感对象。仅一次：

```sh
node scripts/check-local.mjs --build tests/unit/query-result-filter-enabled.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-sort-case-gate.test.ts tests/unit/query-result-sort-case-grid.test.ts
```

保持原类型、Vitest配置及workers；四文件当前144项。不需要重装依赖；若补丁门或其它输入不匹配则停并回报，不放宽门槛，不重复原699或完整测试。

## 唯一实库 GUI

准备全部通过后，原新dist及构建输入保持。只使用已有RAM中200／13384的认证和准确UUID，先独立只读身份预检并确认native／stream正常关闭。禁止SSH／Docker、用户权限变更、凭据轮换或落盘。正式GUI子环境清除旧DBARK_*后，仅重建queryResultColumnsUiKeys合同的必要RAM字段；DBARK_TEST_HOST为既有192.168.31.200、DBARK_TEST_PORT为13384、DBARK_TEST_TLS为0，设置DBARK_INTEGRATION_ENABLED、DBARK_QUERY_RESULT_COLUMNS_UI、DBARK_QUERY_RESULT_SORT_CASE_UI三个门为1，不带SSH、默认库、CA或EXECUTABLE_PATH。helper/raw取同一显式快照，不修改原父helper路径或凭据。

在本metadata下生成一次新的`dbark-query-columns-<32位小写hex>`输出路径，设置DBARK_QUERY_COLUMNS_OUT_DIR，以及DBARK_QUERY_COLUMNS_CSV_PATH／DBARK_QUERY_COLUMNS_JSON_PATH分别为其中`visible-selected.csv`／`visible-selected.json`的准确答案；两个文件及nonce目录预先不存在，由原用例创建。不能使用或覆盖旧两文件。仅一次：

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/query-result-sort-case.spec.ts --reporter=json
```

保持原120秒、workers1、零重试、trace／screenshot／video原关闭合同及所有断言。一个整例含原排序／筛选／复制／两文件导出及新启停：停用副本、OR省略停用项、全部停用、重启副本、恢复AND。读真实虚拟表格ID，保留每次实际几何和顺序附件，不能重填期待或修改DOM替代产品。只执行一条原常量SELECT，无数据库或用户创建；任务须准确一查询、两导出、全部completed、pending0／revision0，历史不变。复制仅本页合成DataTransfer，不读写系统剪贴板，不追加系统输入或电脑控制。

严格owner退出及原观察连接native／stream关闭必须确认；未知则停并保留应用、profile及连接，不强杀、补清理或重跑。成功后封存新两文件的原七字段、字节及SHA，原文件保持以供下一阶段。

## 条件独立读回与最终封存

仅GUI成功、严格收尾及原文件checkpoint已写入并校验后，执行Root在本单预先授权的独立读回。将准确目标的`scripts/testing/verify-query-result-sort-case.py`按Git原始Buffer提取到本metadata的reader目录，记录blob／长度／SHA并核与已验39脚本相同；不导入产品。使用原已确认Python3.12.14的准确路径，`-I -B`，清除全部DBARK_*，仅一次：

```text
python -I -B <本例独立脚本> --csv <本例CSV绝对路径> --json <本例JSON绝对路径> --csv-sha256 <此前GUI checkpoint摘要> --json-sha256 <此前GUI checkpoint摘要>
```

禁止根据读回时输入补造原摘要或改期待。应独立确认四行八列、18字符串／11NULL／3二进制、原精度／Unicode及stableRead=true。原GUI checkpoint的文件身份／长度／SHA在读回前后再核，不改旧第一次49失败或旧污染通道。无需重跑21项合成或full。

最后核新source／tests／dist图／构建输入／Git、十套旧封存、旧两文件及新文件原身份、本例所有原进程身份和退出、父RAM三布尔，逐项SHA封存报告／manifest／原日志／附件；失败及未验范围如实列出后停止。已知敏感值扫描只回布尔，不复制此前误输出对象；暴露用途及范围仍未知，不擅自删原件或轮换凭据。
